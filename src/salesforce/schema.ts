import { existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { getIntrospectionQuery } from 'graphql';

import { runSfJson } from './cli.js';

import {
  CACHE_TTL_MINUTES,
  getSchemaCachePath,
  readFreshSchemaCache,
  writeSchemaCache,
  type CachedSchema,
} from '../cache/schemaCache.js';

export type SchemaCacheStatus = 'HIT' | 'REFRESH_BYPASS' | 'EXPIRED' | 'MISS';

type SchemaFetchTimings = {
  authTokenMs?: number;
  graphqlFetchMs?: number;
};

export type SalesforceSchemaRuntimeInfo = {
  targetOrg: string;
  apiVersion: string;
  cacheStatus: SchemaCacheStatus;
  cacheAgeMs?: number;
  cacheWritten: boolean;
  cacheTtlMinutes: number;
  timings?: {
    orgInfoMs: number;
    authTokenMs?: number;
    graphqlFetchMs?: number;
  };
};

export type SalesforceSchemaResult = {
  data: unknown;
  runtime: SalesforceSchemaRuntimeInfo;
};

async function fetchSalesforceSchema(
  instanceUrl: string,
  apiVersion: string,
  targetOrg: string,
  debug = false
): Promise<{
  data: unknown;
  timings?: SchemaFetchTimings;
}> {
  const timings: SchemaFetchTimings | undefined = debug ? {} : undefined;

  const authStartedAt = debug ? performance.now() : undefined;

  const tokenResult = runSfJson(['org', 'auth', 'show-access-token', '--json'], {
    SF_TARGET_ORG: targetOrg,
  });

  if (timings && authStartedAt !== undefined) {
    timings.authTokenMs = performance.now() - authStartedAt;
  }

  const accessToken = tokenResult.result?.accessToken;

  if (!accessToken) {
    throw new Error('Could not obtain Salesforce access token');
  }

  const graphqlStartedAt = debug ? performance.now() : undefined;

  const response = await fetch(`${instanceUrl}/services/data/v${apiVersion}/graphql`, {
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
  });

  if (timings && graphqlStartedAt !== undefined) {
    timings.graphqlFetchMs = performance.now() - graphqlStartedAt;
  }

  if (!response.ok) {
    throw new Error(`GraphQL schema request failed: HTTP ${response.status}`);
  }

  const body = (await response.json()) as {
    data?: unknown;
  };

  if (!body.data) {
    throw new Error('Salesforce returned no GraphQL schema');
  }

  return {
    data: body.data,
    ...(timings ? { timings } : {}),
  };
}

export async function getSalesforceSchema(
  targetOrg: string,
  apiVersion: string,
  refresh = false,
  debug = false
): Promise<SalesforceSchemaResult> {
  const orgInfoStartedAt = debug ? performance.now() : undefined;

  const orgDisplay = runSfJson(['org', 'display', '--json'], {
    SF_TARGET_ORG: targetOrg,
  });

  const orgInfoMs =
    orgInfoStartedAt !== undefined ? performance.now() - orgInfoStartedAt : undefined;

  const instanceUrl = orgDisplay.result?.instanceUrl;
  const username = orgDisplay.result?.username;

  if (!instanceUrl || !username) {
    throw new Error('Could not determine Salesforce org identity');
  }

  const cachePath = getSchemaCachePath(instanceUrl, apiVersion, username);

  const cached = refresh ? null : readFreshSchemaCache(cachePath);

  if (cached) {
    return {
      data: cached.data,
      runtime: {
        targetOrg,
        apiVersion,
        cacheStatus: 'HIT',
        cacheAgeMs: Date.now() - cached.fetchedAt,
        cacheWritten: false,
        cacheTtlMinutes: CACHE_TTL_MINUTES,
        ...(orgInfoMs !== undefined
          ? {
              timings: {
                orgInfoMs,
              },
            }
          : {}),
      },
    };
  }

  const cacheStatus: SchemaCacheStatus = refresh
    ? 'REFRESH_BYPASS'
    : existsSync(cachePath)
      ? 'EXPIRED'
      : 'MISS';

  const fetched = await fetchSalesforceSchema(instanceUrl, apiVersion, targetOrg, debug);

  const cache: CachedSchema = {
    fetchedAt: Date.now(),
    data: fetched.data,
  };

  let cacheWritten = true;

  try {
    writeSchemaCache(cachePath, cache);
  } catch {
    cacheWritten = false;
  }

  return {
    data: fetched.data,
    runtime: {
      targetOrg,
      apiVersion,
      cacheStatus,
      cacheWritten,
      cacheTtlMinutes: CACHE_TTL_MINUTES,
      ...(orgInfoMs !== undefined
        ? {
            timings: {
              orgInfoMs,
              ...fetched.timings,
            },
          }
        : {}),
    },
  };
}
