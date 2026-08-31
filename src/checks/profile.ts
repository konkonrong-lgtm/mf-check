import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { DiagnosticResult } from '../diagnostics/types.js';
import { readVisibleApplications } from '../access/applicationVisibility.js';

type ProfileCheckResult = {
  visibleApplications: string[];
  diagnostics: DiagnosticResult[];
};

export function checkProfiles(metadataRoots: string[]): ProfileCheckResult {
  const diagnostics: DiagnosticResult[] = [];
  const visibleApplications = new Set<string>();

  const profilesPaths = metadataRoots
    .map((metadataRoot) => join(metadataRoot, 'profiles'))
    .filter((profilesPath) => existsSync(profilesPath));

  if (profilesPaths.length === 0) {
    return { visibleApplications: [], diagnostics };
  }

  for (const profilesPath of profilesPaths) {
    let profileFiles: string[];

    try {
      profileFiles = readdirSync(profilesPath).filter((file) =>
        file.endsWith('.profile-meta.xml')
      );
    } catch (error) {
      diagnostics.push({
        id: 'MF-ACCESS-007',
        category: 'access',
        status: 'FAIL',
        summary: 'profiles directory could not be inspected',
        problem: error instanceof Error ? error.message : String(error),
        whyItMatters:
          'mf-check cannot reliably determine application visibility from Profiles when this directory cannot be enumerated.',
        remediation: [
          'Make sure the profiles directory exists, is a directory, and is readable by the current user, then run mf-check again.',
        ],
        file: profilesPath,
      });

      continue;
    }

    for (const file of profileFiles) {
      const filePath = join(profilesPath, file);

      try {
        const applications = readVisibleApplications(filePath, 'Profile');

        for (const application of applications) {
          visibleApplications.add(application);
        }
      } catch (error) {
        diagnostics.push({
          id: 'MF-ACCESS-005',
          category: 'access',
          status: 'FAIL',
          summary: `${file}: could not inspect Profile metadata`,
          problem: error instanceof Error ? error.message : String(error),
          whyItMatters:
            'mf-check cannot reliably determine application visibility granted by this Profile when its metadata cannot be inspected.',
          remediation: [
            'Make sure the Profile metadata file is readable and contains valid XML, then run mf-check again.',
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
