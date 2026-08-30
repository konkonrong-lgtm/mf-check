import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { DiagnosticResult } from '../diagnostics/types.js';
import { readVisibleApplications } from '../access/applicationVisibility.js';

type PermissionSetCheckResult = {
  diagnostics: DiagnosticResult[];
  visibleApplications: string[];
};

export function checkPermissionSets(metadataRoots: string[]): PermissionSetCheckResult {
  const diagnostics: DiagnosticResult[] = [];
  const visibleApplications = new Set<string>();
  if (metadataRoots.length === 0) {
    return {
      visibleApplications: [...visibleApplications],
      diagnostics,
    };
  }

  const permissionSetsPaths = metadataRoots
    .map((metadataRoot) => join(metadataRoot, 'permissionsets'))
    .filter((permissionSetsPath) => existsSync(permissionSetsPath));

  for (const permissionSetsPath of permissionSetsPaths) {
    const permissionSetFiles = readdirSync(permissionSetsPath).filter((file) =>
      file.endsWith('.permissionset-meta.xml')
    );

    for (const file of permissionSetFiles) {
      const filePath = join(permissionSetsPath, file);

      try {
        const applications = readVisibleApplications(filePath, 'PermissionSet');

        for (const application of applications) {
          visibleApplications.add(application);
        }
      } catch (error) {
        diagnostics.push({
          id: 'MF-ACCESS-002',
          category: 'access',
          status: 'FAIL',
          summary: `${file}: could not parse PermissionSet metadata`,
          problem: error instanceof Error ? error.message : String(error),
          file: filePath,
        });
      }
    }
  }

  return {
    visibleApplications: [...visibleApplications],
    diagnostics,
  };
}
