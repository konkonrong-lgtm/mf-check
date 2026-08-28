import { checkBundles } from './checks/bundle.js';
import { checkApplications } from './checks/application.js';
import { checkPermissionSets } from './checks/permissionSet.js';

const [, , command, projectPath] = process.argv;

if (command !== 'check') {
  console.error('Usage: mf-check check <project-path>');
  process.exit(1);
}

if (!projectPath) {
  console.error('Project path is required.');
  process.exit(1);
}

console.log(`Checking project: ${projectPath}`);

const bundleResult = checkBundles(projectPath);

const applicationResult = checkApplications(
  projectPath,
  bundleResult.bundles
);

const permissionSetResult = checkPermissionSets(
  projectPath,
  applicationResult.applicationNames
);

const hasError =
  bundleResult.hasError ||
  applicationResult.hasError ||
  permissionSetResult.hasError;

if (hasError) {
  console.log('\nNOT READY');
  process.exitCode = 1;
} else {
  console.log('\nREADY');
}