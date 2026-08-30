import { findGraphqlFiles } from '../utils/files.js';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  getSalesforceSchema,
  type SalesforceSchemaRuntimeInfo,
} from '../salesforce/schema.js';

import { buildClientSchema, parse, validate } from 'graphql';
import type { DiagnosticResult } from '../diagnostics/types.js';

export type SchemaCheckRuntimeInfo = SalesforceSchemaRuntimeInfo & {
  schemaProcessingMs?: number;
};

type SchemaCheckResult = {
  diagnostics: DiagnosticResult[];
  runtime?: SchemaCheckRuntimeInfo;
};

export async function checkSchema(
  projectPath: string,
  metadataRoots: string[],
  apiVersion: string | undefined,
  targetOrg: string,
  refresh = false,
  debug = false
): Promise<SchemaCheckResult> {
  const diagnostics: DiagnosticResult[] = [];

  try {
    if (!apiVersion) {
      diagnostics.push({
        id: 'MF-GRAPHQL-001',
        category: 'project',
        status: 'FAIL',
        summary: 'sourceApiVersion not found',
        problem: 'The sfdx-project.json file does not define sourceApiVersion.',
        file: join(projectPath, 'sfdx-project.json'),
      });

      return {
        diagnostics,
      };
    }

    const schemaResult = await getSalesforceSchema(targetOrg, apiVersion, refresh, debug);

    const introspectionData = schemaResult.data;

    const schemaProcessingStartedAt = debug ? performance.now() : undefined;

    const liveGraphqlSchema = buildClientSchema(introspectionData as any, {
      assumeValid: true,
    });

    const schemaProcessingMs =
      schemaProcessingStartedAt !== undefined
        ? performance.now() - schemaProcessingStartedAt
        : undefined;

    const runtime: SchemaCheckRuntimeInfo = {
      ...schemaResult.runtime,
      ...(schemaProcessingMs !== undefined ? { schemaProcessingMs } : {}),
    };

    const graphqlFiles = metadataRoots.flatMap((metadataRoot) => {
      const uiBundlesPath = join(metadataRoot, 'uiBundles');

      if (!existsSync(uiBundlesPath)) {
        return [];
      }

      return findGraphqlFiles(uiBundlesPath);
    });

    if (graphqlFiles.length === 0) {
      diagnostics.push({
        id: 'MF-GRAPHQL-002',
        category: 'data',
        status: 'PASS',
        summary: 'No .graphql operations found',
      });

      return {
        diagnostics,
        runtime,
      };
    }

    for (const filePath of graphqlFiles) {
      const displayPath = relative(projectPath, filePath);

      try {
        const source = readFileSync(filePath, 'utf-8');
        const document = parse(source);
        const errors = validate(liveGraphqlSchema, document);

        if (errors.length === 0) {
          diagnostics.push({
            id: 'MF-GRAPHQL-003',
            category: 'data',
            status: 'PASS',
            summary: `${displayPath}: valid against target org schema`,
            file: filePath,
          });

          continue;
        }

        diagnostics.push({
          id: 'MF-GRAPHQL-004',
          category: 'data',
          status: 'FAIL',
          summary: `${displayPath}: invalid against target org schema`,
          problem: errors.map((error) => error.message).join('\n'),
          possibleCauses: [
            'The referenced field or type may not exist in the target org.',
            'The authenticated user may not have access to the referenced field or type.',
            'The wrong target org may be selected.',
          ],
          file: filePath,
        });
      } catch (error) {
        diagnostics.push({
          id: 'MF-GRAPHQL-005',
          category: 'data',
          status: 'FAIL',
          summary: `${displayPath}: GraphQL operation could not be checked`,
          problem: error instanceof Error ? error.message : String(error),
          file: filePath,
        });
      }
    }

    return {
      diagnostics,
      runtime,
    };
  } catch (error) {
    diagnostics.push({
      id: 'MF-GRAPHQL-006',
      category: 'data',
      status: 'FAIL',
      summary: 'Schema check failed',
      problem: error instanceof Error ? error.message : String(error),
      possibleCauses: [
        'The target org may be unavailable or authentication may have failed.',
        'The Salesforce GraphQL schema could not be retrieved.',
        'The project configuration may be invalid.',
      ],
    });

    return {
      diagnostics,
    };
  }
}
