import {
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  buildClientSchema,
  getIntrospectionQuery,
  parse,
  printSchema,
  validate,
} from 'graphql';
import { pruneSchema } from '@graphql-tools/utils';

function normalizeSchema(content: string) {
  return content.replace(/\r\n/g, '\n').trim();
}

function runSfJson(args: string[]) {
  const command =
    process.platform === 'win32'
      ? process.env.ComSpec ?? 'cmd.exe'
      : 'sf';

  const commandArgs =
    process.platform === 'win32'
      ? ['/d', '/s', '/c', 'sf', ...args]
      : args;

  const output = execFileSync(command, commandArgs, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return JSON.parse(output);
}

function findGraphqlFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  const results: string[] = [];

  const entries = readdirSync(directory, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      results.push(...findGraphqlFiles(fullPath));
      continue;
    }

    if (
      entry.isFile() &&
      entry.name.endsWith('.graphql')
    ) {
      results.push(fullPath);
    }
  }

  return results;
}

export async function checkSchema(
  projectPath: string,
  targetOrg: string
) {
  try {
    console.time('org-info');

    // 1. Salesforce org 정보
    const orgDisplay = runSfJson([
      'org',
      'display',
      '--target-org',
      targetOrg,
      '--json',
    ]);

    const instanceUrl =
      orgDisplay.result?.instanceUrl;

    if (!instanceUrl) {
      console.timeEnd('org-info');

      console.error(
        '✗ Could not determine Salesforce instance URL'
      );

      return { hasError: true };
    }

    // 2. Access token
    const tokenResult = runSfJson([
      'org',
      'auth',
      'show-access-token',
      '--target-org',
      targetOrg,
      '--json',
    ]);

    const accessToken =
      tokenResult.result?.accessToken;

    if (!accessToken) {
      console.timeEnd('org-info');

      console.error(
        '✗ Could not obtain Salesforce access token'
      );

      return { hasError: true };
    }

    // 3. 프로젝트 API version
    const projectConfigPath = join(
      projectPath,
      'sfdx-project.json'
    );

    const projectConfig = JSON.parse(
      readFileSync(projectConfigPath, 'utf-8')
    );

    const apiVersion =
      projectConfig.sourceApiVersion;

    console.timeEnd('org-info');

    if (!apiVersion) {
      console.error(
        '✗ sourceApiVersion not found in sfdx-project.json'
      );

      return { hasError: true };
    }

    console.log(
      `✓ Connected to target org: ${targetOrg} (API v${apiVersion})`
    );

    // 4. Salesforce live GraphQL schema 가져오기
    console.time('graphql-fetch');

    const response = await fetch(
      `${instanceUrl}/services/data/v${apiVersion}/graphql`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Chatter-Entity-Encoding': 'false',
        },
        body: JSON.stringify({
          query: getIntrospectionQuery(),
          variables: {},
          operationName: 'IntrospectionQuery',
        }),
      }
    );

    if (!response.ok) {
      console.timeEnd('graphql-fetch');

      console.error(
        `✗ GraphQL schema request failed: HTTP ${response.status}`
      );

      return { hasError: true };
    }

    const body = (await response.json()) as {
      data?: unknown;
      errors?: unknown;
    };

    console.timeEnd('graphql-fetch');

    if (!body.data) {
      console.error(
        '✗ Salesforce returned no GraphQL schema'
      );

      return { hasError: true };
    }

    // 5. Introspection → GraphQLSchema
    console.time('schema-processing');

    const liveGraphqlSchema = buildClientSchema(
        body.data as any,
        {
            assumeValid: true,
        }
    );

    const prunedSchema =
      pruneSchema(liveGraphqlSchema);

    const liveSchemaText =
      printSchema(prunedSchema);

    console.timeEnd('schema-processing');

    // 6. local schema와 비교
    const localSchemaPath = join(
      projectPath,
      'schema.graphql'
    );

    if (existsSync(localSchemaPath)) {
      const localSchema = readFileSync(
        localSchemaPath,
        'utf-8'
      );

      if (
        normalizeSchema(localSchema) ===
        normalizeSchema(liveSchemaText)
      ) {
        console.log(
          '✓ GraphQL schema is fresh'
        );
      } else {
        console.warn(
          '⚠ Local GraphQL schema differs from target org'
        );
      }
    } else {
      console.warn(
        '⚠ Local schema.graphql not found'
      );
    }

    // 7. 프로젝트가 실제 사용하는 GraphQL operation 검사
    const uiBundlesPath = join(
      projectPath,
      'force-app',
      'main',
      'default',
      'uiBundles'
    );

    const graphqlFiles =
      findGraphqlFiles(uiBundlesPath);

    if (graphqlFiles.length === 0) {
      console.log(
        '○ No .graphql operations found'
      );

      return { hasError: false };
    }

    console.log(
      `Checking ${graphqlFiles.length} GraphQL operation(s)...`
    );

    let hasOperationError = false;

    for (const filePath of graphqlFiles) {
      const displayPath = relative(
        projectPath,
        filePath
      );

      try {
        const source = readFileSync(
          filePath,
          'utf-8'
        );

        const document = parse(source);

        const errors = validate(
          liveGraphqlSchema,
          document
        );

        if (errors.length === 0) {
          console.log(
            `✓ ${displayPath}`
          );

          continue;
        }

        hasOperationError = true;

        console.error(
          `✗ ${displayPath}`
        );

        for (const error of errors) {
          console.error(
            `  → ${error.message}`
          );
        }
      } catch (error) {
        hasOperationError = true;

        console.error(
          `✗ ${displayPath}`
        );

        console.error(
          `  → ${
            error instanceof Error
              ? error.message
              : String(error)
          }`
        );
      }
    }

    if (hasOperationError) {
      console.error(
        '✗ One or more GraphQL operations are invalid against the target org'
      );

      return { hasError: true };
    }

    console.log(
      '✓ All GraphQL operations are valid against the target org'
    );

    return { hasError: false };
  } catch (error) {
    console.error(
      `✗ Schema check failed: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );

    return { hasError: true };
  }
}