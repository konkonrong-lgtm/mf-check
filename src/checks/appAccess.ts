import type { DiagnosticResult } from '../diagnostics/types.js';

type AppAccessCheckResult = {
  diagnostics: DiagnosticResult[];
};

export function checkAppAccess(
  applicationNames: string[],
  permissionSetApplications: string[],
  profileApplications: string[]
): AppAccessCheckResult {
  const diagnostics: DiagnosticResult[] = [];

  const permissionSetAccess = new Set(permissionSetApplications);

  const profileAccess = new Set(profileApplications);

  for (const appName of applicationNames) {
    const grantedByPermissionSet = permissionSetAccess.has(appName);

    const grantedByProfile = profileAccess.has(appName);

    if (!grantedByPermissionSet && !grantedByProfile) {
      diagnostics.push({
        id: 'MF-ACCESS-003',
        category: 'access',
        status: 'UNKNOWN',
        blocksReadiness: true,
        summary: `${appName}: application access not confirmed`,
        problem: `mf-check did not confirm application visibility for "${appName}" in the local PermissionSet or Profile metadata that it could inspect.`,
        whyItMatters:
          'Without confirmed application visibility, mf-check cannot establish that intended users can access this Multi-Framework application.',
        possibleCauses: [
          'Some local PermissionSet or Profile metadata may not have been available for inspection.',
          'Application access may be configured only in the target org and not represented in the local project metadata.',
        ],
        remediation: [
          'Add or retrieve a PermissionSet or Profile that grants visibility to this CustomApplication, then run mf-check again.',
          'If access exists only in the target org, verify that configuration and bring the relevant access metadata into the project when possible.',
        ],
      });

      continue;
    }

    const accessSources: string[] = [];

    if (grantedByPermissionSet) {
      accessSources.push('PermissionSet');
    }

    if (grantedByProfile) {
      accessSources.push('Profile');
    }

    diagnostics.push({
      id: 'MF-ACCESS-004',
      category: 'access',
      status: 'PASS',
      summary: `${appName}: application visibility granted by ${accessSources.join(' and ')}`,
    });
  }

  return {
    diagnostics,
  };
}
