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
    let permissionSetFiles: string[];

    try {
      permissionSetFiles = readdirSync(permissionSetsPath).filter((file) =>
        file.endsWith('.permissionset-meta.xml')
      );
    } catch (error) {
      diagnostics.push({
        id: 'MF-ACCESS-006',
        category: 'access',
        status: 'FAIL',
        summary: 'permissionsets directory could not be inspected',
        problem: error instanceof Error ? error.message : String(error),
        whyItMatters:
          'mf-check cannot reliably determine application visibility from PermissionSets when this directory cannot be enumerated.',
        remediation: [
          'Make sure the permissionsets directory exists, is a directory, and is readable by the current user, then run mf-check again.',
        ],
        file: permissionSetsPath,
      });

      continue;
    }

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
          summary: `${file}: could not inspect PermissionSet metadata`,
          problem: error instanceof Error ? error.message : String(error),
          whyItMatters:
            'mf-check cannot reliably determine application visibility granted by this PermissionSet when its metadata cannot be inspected.',
          remediation: [
            'Make sure the PermissionSet metadata file is readable and contains valid XML, then run mf-check again.',
          ],
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
