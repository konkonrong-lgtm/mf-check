#!/usr/bin/env node

import { checkBundles } from './checks/bundle.js';
import { checkApplications } from './checks/application.js';
import { checkPermissionSets } from './checks/permissionSet.js';
import { checkProfiles } from './checks/profile.js';
import { checkAppAccess } from './checks/appAccess.js';
import { discoverProject } from './project/discovery.js';
import { checkSchema, type SchemaCheckRuntimeInfo } from './checks/schema.js';
import type { DiagnosticResult } from './diagnostics/types.js';
import { hasFailures } from './diagnostics/result.js';
import { renderCheckResults } from './renderers/checkRenderer.js';

const args = process.argv.slice(2);

const command = args[0];
const projectPath = args[1];

const targetOrgIndex = args.indexOf('--target-org');
const hasTargetOrgFlag = targetOrgIndex !== -1;
const targetOrg = hasTargetOrgFlag ? args[targetOrgIndex + 1] : undefined;

const refresh = args.includes('--refresh');
const debug = args.includes('--debug');

if (command !== 'check') {
  console.error(
    'Usage: mf-check check <project-path> [--target-org <alias>] [--refresh] [--debug]'
  );
  process.exit(1);
}

if (!projectPath) {
  console.error('Project path is required.');
  process.exit(1);
}

if (hasTargetOrgFlag && (!targetOrg || targetOrg.startsWith('--'))) {
  console.error('--target-org requires an org alias.');
  process.exit(1);
}

if (refresh && !targetOrg) {
  console.error('--refresh requires --target-org.');
  process.exit(1);
}

const discoveryResult = discoverProject(projectPath);
const metadataRoots = discoveryResult.metadataRoots;

const bundleResult = checkBundles(metadataRoots);

const applicationResult = checkApplications(metadataRoots, bundleResult.bundles);

const permissionSetResult = checkPermissionSets(metadataRoots);

const profileResult = checkProfiles(metadataRoots);

const appAccessResult = checkAppAccess(
  applicationResult.applicationNames,
  permissionSetResult.visibleApplications,
  profileResult.visibleApplications
);

let schemaDiagnostics: DiagnosticResult[] = [];
let schemaRuntime: SchemaCheckRuntimeInfo | undefined;

if (targetOrg) {
  const schemaResult = await checkSchema(
    projectPath,
    metadataRoots,
    discoveryResult.sourceApiVersion,
    targetOrg,
    refresh,
    debug
  );

  schemaDiagnostics = schemaResult.diagnostics;
  schemaRuntime = schemaResult.runtime;
} else {
  schemaDiagnostics.push({
    id: 'MF-GRAPHQL-007',
    category: 'data',
    status: 'UNKNOWN',
    summary: 'Live GraphQL check skipped: no target org provided',
    problem:
      'The target org was not provided, so live GraphQL validation was not performed.',
  });
}
const diagnostics = [
  ...discoveryResult.diagnostics,
  ...bundleResult.diagnostics,
  ...applicationResult.diagnostics,
  ...permissionSetResult.diagnostics,
  ...profileResult.diagnostics,
  ...appAccessResult.diagnostics,
  ...schemaDiagnostics,
];

const hasError = hasFailures(diagnostics);

renderCheckResults(diagnostics, {
  projectPath,
  hasError,
  ...(schemaRuntime ? { schemaRuntime } : {}),
});

if (hasError) {
  process.exitCode = 1;
}
