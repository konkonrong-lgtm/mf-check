import type { SchemaCheckRuntimeInfo } from '../checks/schema.js';

function formatDuration(ms: number): string {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(3)}s`;
  }

  return `${ms.toFixed(3)}ms`;
}

function formatCacheAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);

  return `${minutes}m`;
}

export function renderSchemaRuntime(runtime: SchemaCheckRuntimeInfo): void {
  console.log(
    `✓ Connected to target org: ${runtime.targetOrg} (API v${runtime.apiVersion})`
  );

  if (runtime.cacheStatus === 'HIT') {
    const age =
      runtime.cacheAgeMs !== undefined
        ? ` (${formatCacheAge(runtime.cacheAgeMs)} old)`
        : '';

    console.log(`✓ Using cached Salesforce schema${age}`);
  } else if (runtime.cacheStatus === 'REFRESH_BYPASS') {
    console.log('○ Cache bypassed by --refresh');
  } else if (runtime.cacheStatus === 'EXPIRED') {
    console.log('○ Cached schema expired; fetched latest schema');
  } else {
    console.log('○ No cached schema; fetched latest schema');
  }

  if (runtime.cacheWritten) {
    console.log(`✓ Salesforce schema cached for ${runtime.cacheTtlMinutes} minutes`);
  }

  if (runtime.timings) {
    console.log(`○ Debug: org-info ${formatDuration(runtime.timings.orgInfoMs)}`);

    if (runtime.timings.authTokenMs !== undefined) {
      console.log(`○ Debug: auth-token ${formatDuration(runtime.timings.authTokenMs)}`);
    }

    if (runtime.timings.graphqlFetchMs !== undefined) {
      console.log(
        `○ Debug: graphql-fetch ${formatDuration(runtime.timings.graphqlFetchMs)}`
      );
    }
  }

  if (runtime.schemaProcessingMs !== undefined) {
    console.log(
      `○ Debug: schema-processing ${formatDuration(runtime.schemaProcessingMs)}`
    );
  }
}
