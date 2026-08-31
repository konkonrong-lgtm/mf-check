#!/usr/bin/env node

import { checkBundles } from './checks/bundle.js';
import { checkApplications } from './checks/application.js';
import { checkPermissionSets } from './checks/permissionSet.js';
import { checkProfiles } from './checks/profile.js';
import { checkAppAccess } from './checks/appAccess.js';
import { discoverProject } from './project/discovery.js';
import { checkSchema, type SchemaCheckRuntimeInfo } from './checks/schema.js';
import { checkGaMigration } from './checks/gaMigration.js';
import type { DiagnosticResult } from './diagnostics/types.js';
import { hasFailures, hasReadinessBlockers } from './diagnostics/result.js';
import { renderCheckResults } from './renderers/checkRenderer.js';
import { renderDoctorResults } from './renderers/doctorRenderer.js';

const args = process.argv.slice(2);

const command = args[0];
const projectPath = args[1];

const targetOrgIndex = args.indexOf('--target-org');
const hasTargetOrgFlag = targetOrgIndex !== -1;
const targetOrg = hasTargetOrgFlag ? args[targetOrgIndex + 1] : undefined;

const refresh = args.includes('--refresh');
const debug = args.includes('--debug');

if (command !== 'check' && command !== 'doctor') {
  console.error(
    'Usage: mf-check <check|doctor> <project-path> [--target-org <alias>] [--refresh] [--debug]'
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
const projectDiscoveryFailed = hasFailures(discoveryResult.diagnostics);
const metadataRoots = discoveryResult.metadataRoots;
const uiBundlesPaths = discoveryResult.uiBundlesPaths;

const bundleResult = checkBundles(uiBundlesPaths);
const gaMigrationResult = checkGaMigration(projectPath, uiBundlesPaths);

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

if (!projectDiscoveryFailed) {
  if (targetOrg) {
    const schemaResult = await checkSchema(
      projectPath,
      uiBundlesPaths,
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
      whyItMatters:
        'Without a target org, mf-check cannot confirm that local GraphQL operations are compatible with the live Salesforce schema.',
      remediation: [
        'Provide a target org when you want mf-check to perform live GraphQL schema validation.',
      ],
    });
  }
}
const diagnostics = [
  ...discoveryResult.diagnostics,
  ...bundleResult.diagnostics,
  ...gaMigrationResult.diagnostics,
  ...applicationResult.diagnostics,
  ...permissionSetResult.diagnostics,
  ...profileResult.diagnostics,
  ...appAccessResult.diagnostics,
  ...schemaDiagnostics,
];

const readinessBlocked = hasReadinessBlockers(diagnostics);

if (command === 'doctor') {
  renderDoctorResults(diagnostics, {
    projectPath,
    hasError: readinessBlocked,
    ...(schemaRuntime ? { schemaRuntime } : {}),
  });
} else {
  renderCheckResults(diagnostics, {
    projectPath,
    hasError: readinessBlocked,
    ...(schemaRuntime ? { schemaRuntime } : {}),
  });
}

if (readinessBlocked) {
  process.exitCode = 1;
}
