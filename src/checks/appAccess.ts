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
        problem: `No PermissionSet or Profile in the project grants application visibility for "${appName}".`,
        possibleCauses: [
          'Application access may be configured only in the target org and not represented in the local project metadata.',
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
