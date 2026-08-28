#!/usr/bin/env node

import { checkBundles } from './checks/bundle.js';
import { checkApplications } from './checks/application.js';
import { checkPermissionSets } from './checks/permissionSet.js';
import { checkSchema } from './checks/schema.js';

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

console.log(`Checking project: ${projectPath}`);

const bundleResult = checkBundles(projectPath);
const applicationResult = checkApplications(projectPath, bundleResult.bundles);
const permissionSetResult = checkPermissionSets(
  projectPath,
  applicationResult.applicationNames
);

let schemaResult = { hasError: false };

if (targetOrg) {
  schemaResult = await checkSchema(projectPath, targetOrg, refresh, debug);
} else {
  console.log('○ Live GraphQL check skipped: no --target-org provided');
}

const hasError =
  bundleResult.hasError ||
  applicationResult.hasError ||
  permissionSetResult.hasError ||
  schemaResult.hasError;

if (hasError) {
  console.log('\nNOT READY');
  process.exitCode = 1;
} else {
  console.log('\nREADY');
}
