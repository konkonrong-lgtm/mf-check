import { findGraphqlFiles } from '../utils/files.js';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { getSalesforceSchema } from '../salesforce/schema.js';

import { buildClientSchema, parse, validate } from 'graphql';

export async function checkSchema(
  projectPath: string,
  targetOrg: string,
  refresh = false,
  debug = false
) {
  try {
    const projectConfig = JSON.parse(
      readFileSync(join(projectPath, 'sfdx-project.json'), 'utf-8')
    );

    const apiVersion = projectConfig.sourceApiVersion;

    if (!apiVersion) {
      console.error('✗ sourceApiVersion not found in sfdx-project.json');

      return { hasError: true };
    }

    const introspectionData = await getSalesforceSchema(
      targetOrg,
      apiVersion,
      refresh,
      debug
    );

    if (debug) {
      console.time('schema-processing');
    }

    // Salesforce introspection can contain empty input object types that
    // buildClientSchema would otherwise reject before operation validation.
    const liveGraphqlSchema = buildClientSchema(introspectionData as any, {
      assumeValid: true,
    });

    if (debug) {
      console.timeEnd('schema-processing');
    }

    const uiBundlesPath = join(projectPath, 'force-app', 'main', 'default', 'uiBundles');

    const graphqlFiles = findGraphqlFiles(uiBundlesPath);

    if (graphqlFiles.length === 0) {
      console.log('○ No .graphql operations found');

      return { hasError: false };
    }

    console.log(`Checking ${graphqlFiles.length} GraphQL operation(s)...`);

    let hasOperationError = false;

    for (const filePath of graphqlFiles) {
      const displayPath = relative(projectPath, filePath);

      try {
        const source = readFileSync(filePath, 'utf-8');

        const document = parse(source);

        const errors = validate(liveGraphqlSchema, document);

        if (errors.length === 0) {
          console.log(`✓ ${displayPath}`);

          continue;
        }

        hasOperationError = true;

        console.error(`✗ ${displayPath}`);

        for (const error of errors) {
          console.error(`  → ${error.message}`);
        }
      } catch (error) {
        hasOperationError = true;

        console.error(`✗ ${displayPath}`);

        console.error(`  → ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (hasOperationError) {
      console.error(
        '✗ One or more GraphQL operations are invalid against the target org'
      );

      return { hasError: true };
    }

    console.log('✓ All GraphQL operations are valid against the target org');

    return { hasError: false };
  } catch (error) {
    console.error(
      `✗ Schema check failed: ${error instanceof Error ? error.message : String(error)}`
    );

    return { hasError: true };
  }
}
