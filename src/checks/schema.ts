import {
  existsSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  buildClientSchema,
  getIntrospectionQuery,
  parse,
  validate,
} from 'graphql';

const CACHE_TTL_MS = 5 * 60 * 1000;

type CachedSchema = {
  fetchedAt: number;
  data: unknown;
  apiVersion: string;
  instanceUrl: string;
};

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

function getCachePath(
  instanceUrl: string,
  apiVersion: string
) {
  const cacheDirectory = join(
    homedir(),
    '.mf-check',
    'cache'
  );

  mkdirSync(cacheDirectory, {
    recursive: true,
  });

  const cacheKey = createHash('sha256')
    .update(`${instanceUrl}|${apiVersion}`)
    .digest('hex');

  return join(
    cacheDirectory,
    `${cacheKey}.json`
  );
}

function readFreshCache(
  cachePath: string
): CachedSchema | null {
  if (!existsSync(cachePath)) {
    return null;
  }

  try {
    const cached = JSON.parse(
      readFileSync(cachePath, 'utf-8')
    ) as CachedSchema;

    if (
      typeof cached.fetchedAt !== 'number' ||
      !cached.data
    ) {
      return null;
    }

    const age =
      Date.now() - cached.fetchedAt;

    if (age >= CACHE_TTL_MS) {
      return null;
    }

    return cached;
  } catch {
    return null;
  }
}

function formatAge(milliseconds: number) {
  const seconds = Math.floor(
    milliseconds / 1000
  );

  if (seconds < 60) {
    return `${seconds}s`;
  }

  return `${Math.floor(seconds / 60)}m`;
}

export async function checkSchema(
  projectPath: string,
  targetOrg: string,
  refresh = false
) {
  try {
    // 1. 프로젝트 API version
    const projectConfig = JSON.parse(
      readFileSync(
        join(projectPath, 'sfdx-project.json'),
        'utf-8'
      )
    );

    const apiVersion =
      projectConfig.sourceApiVersion;

    if (!apiVersion) {
      console.error(
        '✗ sourceApiVersion not found in sfdx-project.json'
      );

      return { hasError: true };
    }

    // 2. Org 식별
    console.time('org-info');

    const orgDisplay = runSfJson([
      'org',
      'display',
      '--target-org',
      targetOrg,
      '--json',
    ]);

    console.timeEnd('org-info');

    const instanceUrl =
      orgDisplay.result?.instanceUrl;

    if (!instanceUrl) {
      console.error(
        '✗ Could not determine Salesforce instance URL'
      );

      return { hasError: true };
    }

    console.log(
      `✓ Connected to target org: ${targetOrg} (API v${apiVersion})`
    );

    const cachePath = getCachePath(
      instanceUrl,
      apiVersion
    );

    let introspectionData: unknown;

    // 3. 유효한 캐시가 있으면 사용
    const cached = refresh
      ? null
      : readFreshCache(cachePath);

    if (cached) {
      const age =
        Date.now() - cached.fetchedAt;

      console.log(
        `✓ Using cached Salesforce schema (${formatAge(age)} old)`
      );

      introspectionData = cached.data;
    } else {
      if (refresh) {
        console.log(
          '○ Cache bypassed by --refresh'
        );
      } else if (existsSync(cachePath)) {
        console.log(
          '○ Cached schema expired; fetching latest schema'
        );
      } else {
        console.log(
          '○ No cached schema; fetching latest schema'
        );
      }

      // 4. 실제 access token은 live fetch할 때만 가져옴
      console.time('auth-token');

      const tokenResult = runSfJson([
        'org',
        'auth',
        'show-access-token',
        '--target-org',
        targetOrg,
        '--json',
      ]);

      console.timeEnd('auth-token');

      const accessToken =
        tokenResult.result?.accessToken;

      if (!accessToken) {
        console.error(
          '✗ Could not obtain Salesforce access token'
        );

        return { hasError: true };
      }

      // 5. Live Salesforce schema fetch
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
            operationName:
              'IntrospectionQuery',
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

      introspectionData = body.data;

      const cache: CachedSchema = {
        fetchedAt: Date.now(),
        data: body.data,
        apiVersion,
        instanceUrl,
      };

      writeFileSync(
        cachePath,
        JSON.stringify(cache),
        'utf-8'
      );

      console.log(
        '✓ Salesforce schema cached for 5 minutes'
      );
    }

    // 6. Introspection → GraphQLSchema
    console.time('schema-processing');

    const liveGraphqlSchema =
      buildClientSchema(
        introspectionData as any,
        {
          assumeValid: true,
        }
      );

    console.timeEnd('schema-processing');

    // 7. 프로젝트 GraphQL 파일 탐색
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

    // 8. Live org schema 기준 검증
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