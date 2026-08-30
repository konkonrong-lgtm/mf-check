import { findGraphqlFiles } from '../utils/files.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  getSalesforceSchema,
  type SalesforceSchemaRuntimeInfo,
} from '../salesforce/schema.js';

import {
  buildClientSchema,
  getLocation,
  GraphQLError,
  Kind,
  parse,
  Source,
  validate,
  type DefinitionNode,
  type DocumentNode,
} from 'graphql';
import type { DiagnosticResult } from '../diagnostics/types.js';
import { resolveUiBundleOutputPath } from '../utils/uiBundleOutput.js';

export type SchemaCheckRuntimeInfo = SalesforceSchemaRuntimeInfo & {
  schemaProcessingMs?: number;
};

type SchemaCheckResult = {
  diagnostics: DiagnosticResult[];
  runtime?: SchemaCheckRuntimeInfo;
};

function getUiBundleOutputPath(bundlePath: string): string | undefined {
  const configPath = join(bundlePath, 'ui-bundle.json');

  if (!existsSync(configPath)) {
    return undefined;
  }

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as {
      outputDir?: unknown;
    };

    if (typeof config.outputDir !== 'string' || !config.outputDir) {
      return undefined;
    }

    return resolveUiBundleOutputPath(bundlePath, config.outputDir);
  } catch {
    // Bundle validation reports invalid descriptors and outputDir paths.
    return undefined;
  }
}

export async function checkSchema(
  projectPath: string,
  uiBundlesPaths: string[],
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

    const graphqlBundles = uiBundlesPaths.flatMap((uiBundlesPath) => {
      if (!existsSync(uiBundlesPath)) {
        return [];
      }

      return readdirSync(uiBundlesPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
          const bundlePath = join(uiBundlesPath, entry.name);
          const outputPath = getUiBundleOutputPath(bundlePath);

          return {
            files: findGraphqlFiles(bundlePath, outputPath ? [outputPath] : []),
          };
        });
    });

    let executableDefinitionCount = 0;
    let parseFailureCount = 0;

    for (const bundle of graphqlBundles) {
      const executableDefinitions: DefinitionNode[] = [];
      const executableFiles = new Set<string>();

      for (const filePath of bundle.files) {
        const displayPath = relative(projectPath, filePath);

        try {
          const source = new Source(readFileSync(filePath, 'utf-8'), filePath);
          const document = parse(source);

          for (const definition of document.definitions) {
            if (
              definition.kind !== Kind.OPERATION_DEFINITION &&
              definition.kind !== Kind.FRAGMENT_DEFINITION
            ) {
              continue;
            }

            executableDefinitions.push(definition);
            executableFiles.add(filePath);
            executableDefinitionCount += 1;
          }
        } catch (error) {
          parseFailureCount += 1;

          diagnostics.push({
            id: 'MF-GRAPHQL-005',
            category: 'data',
            status: 'FAIL',
            summary: `${displayPath}: GraphQL operation could not be checked`,
            problem: error instanceof Error ? error.message : String(error),
            file: filePath,
            ...(error instanceof GraphQLError && error.locations?.[0]
              ? { line: error.locations[0].line }
              : {}),
          });
        }
      }

      if (executableDefinitions.length === 0) {
        continue;
      }

      const executableDocument: DocumentNode = {
        kind: Kind.DOCUMENT,
        definitions: executableDefinitions,
      };
      const validationErrors = validate(liveGraphqlSchema, executableDocument);

      if (validationErrors.length === 0) {
        for (const filePath of executableFiles) {
          diagnostics.push({
            id: 'MF-GRAPHQL-003',
            category: 'data',
            status: 'PASS',
            summary: `${relative(projectPath, filePath)}: valid against target org schema`,
            file: filePath,
          });
        }

        continue;
      }

      const errorsByFile = new Map<
        string,
        {
          messages: Set<string>;
          line?: number;
        }
      >();

      for (const validationError of validationErrors) {
        const associatedFiles = new Set<string>();

        for (const node of validationError.nodes ?? []) {
          if (!node.loc) {
            continue;
          }

          const filePath = node.loc.source.name;
          associatedFiles.add(filePath);

          const existing = errorsByFile.get(filePath) ?? {
            messages: new Set<string>(),
          };

          existing.messages.add(validationError.message);
          existing.line ??= getLocation(node.loc.source, node.loc.start).line;
          errorsByFile.set(filePath, existing);
        }

        if (associatedFiles.size === 0) {
          const fallbackFile = executableFiles.values().next().value;

          if (fallbackFile) {
            const existing = errorsByFile.get(fallbackFile) ?? {
              messages: new Set<string>(),
            };

            existing.messages.add(validationError.message);
            errorsByFile.set(fallbackFile, existing);
          }
        }
      }

      for (const [filePath, fileErrors] of errorsByFile) {
        diagnostics.push({
          id: 'MF-GRAPHQL-004',
          category: 'data',
          status: 'FAIL',
          summary: `${relative(projectPath, filePath)}: invalid against target org schema`,
          problem: [...fileErrors.messages].join('\n'),
          possibleCauses: [
            'The referenced field or type may not exist in the target org.',
            'The authenticated user may not have access to the referenced field or type.',
            'The wrong target org may be selected.',
          ],
          file: filePath,
          ...(fileErrors.line !== undefined ? { line: fileErrors.line } : {}),
        });
      }
    }

    if (executableDefinitionCount === 0 && parseFailureCount === 0) {
      diagnostics.push({
        id: 'MF-GRAPHQL-002',
        category: 'data',
        status: 'PASS',
        summary: 'No .graphql operations found',
      });
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
