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
    const profileFiles = readdirSync(profilesPath).filter((file) =>
      file.endsWith('.profile-meta.xml')
    );

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
          summary: `${file}: could not parse Profile metadata`,
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
