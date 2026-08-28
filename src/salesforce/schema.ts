import { existsSync } from 'node:fs';
import { getIntrospectionQuery } from 'graphql';

import { runSfJson } from './cli.js';

import {
  CACHE_TTL_MINUTES,
  getSchemaCachePath,
  readFreshSchemaCache,
  writeSchemaCache,
  formatCacheAge,
  type CachedSchema,
} from '../cache/schemaCache.js';

async function fetchSalesforceSchema(
  instanceUrl: string,
  apiVersion: string,
  targetOrg: string,
  debug = false
) {
  if (debug) {
    console.time('auth-token');
  }

  const tokenResult = runSfJson([
    'org',
    'auth',
    'show-access-token',
    '--target-org',
    targetOrg,
    '--json',
  ]);

  if (debug) {
    console.timeEnd('auth-token');
  }

  const accessToken = tokenResult.result?.accessToken;

  if (!accessToken) {
    throw new Error('Could not obtain Salesforce access token');
  }

  if (debug) {
    console.time('graphql-fetch');
  }

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

  if (debug) {
    console.timeEnd('graphql-fetch');
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

  return body.data;
}

export async function getSalesforceSchema(
  targetOrg: string,
  apiVersion: string,
  refresh = false,
  debug = false
) {
  if (debug) {
    console.time('org-info');
  }

  const orgDisplay = runSfJson(['org', 'display', '--target-org', targetOrg, '--json']);

  if (debug) {
    console.timeEnd('org-info');
  }

  const instanceUrl = orgDisplay.result?.instanceUrl;
  const username = orgDisplay.result?.username;

  if (!instanceUrl || !username) {
    throw new Error('Could not determine Salesforce org identity');
  }

  console.log(`✓ Connected to target org: ${targetOrg} (API v${apiVersion})`);

  const cachePath = getSchemaCachePath(instanceUrl, apiVersion, username);

  const cached = refresh ? null : readFreshSchemaCache(cachePath);

  if (cached) {
    const age = Date.now() - cached.fetchedAt;

    console.log(`✓ Using cached Salesforce schema (${formatCacheAge(age)} old)`);

    return cached.data;
  }

  if (refresh) {
    console.log('○ Cache bypassed by --refresh');
  } else if (existsSync(cachePath)) {
    console.log('○ Cached schema expired; fetching latest schema');
  } else {
    console.log('○ No cached schema; fetching latest schema');
  }

  const introspectionData = await fetchSalesforceSchema(
    instanceUrl,
    apiVersion,
    targetOrg,
    debug
  );

  const cache: CachedSchema = {
    fetchedAt: Date.now(),
    data: introspectionData,
    apiVersion,
    instanceUrl,
    username,
  };

  writeSchemaCache(cachePath, cache);

  console.log(`✓ Salesforce schema cached for ${CACHE_TTL_MINUTES} minutes`);

  return introspectionData;
}
