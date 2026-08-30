import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

import type { DiagnosticResult } from '../diagnostics/types.js';

type ApplicationCheckResult = {
  applicationNames: string[];
  diagnostics: DiagnosticResult[];
};

export function checkApplications(
  metadataRoots: string[],
  bundles: string[]
): ApplicationCheckResult {
  const diagnostics: DiagnosticResult[] = [];

  if (metadataRoots.length === 0) {
    return {
      applicationNames: [],
      diagnostics,
    };
  }

  const applicationPaths = metadataRoots
    .map((metadataRoot) => join(metadataRoot, 'applications'))
    .filter((applicationsPath) => existsSync(applicationsPath));

  if (applicationPaths.length === 0) {
    diagnostics.push({
      id: 'MF-PROJECT-005',
      category: 'project',
      status: 'FAIL',
      summary: 'applications directory not found',
      problem:
        'None of the project package directories contain an applications directory.',
    });

    return {
      applicationNames: [],
      diagnostics,
    };
  }

  const parser = new XMLParser();
  const linkedBundles = new Set<string>();
  const applicationNames = new Set<string>();

  for (const applicationsPath of applicationPaths) {
    const applicationFiles = readdirSync(applicationsPath).filter((file) =>
      file.endsWith('.app-meta.xml')
    );

    for (const file of applicationFiles) {
      const filePath = join(applicationsPath, file);
      const appName = file.replace('.app-meta.xml', '');

      try {
        const xml = readFileSync(filePath, 'utf-8');

        const validationResult = XMLValidator.validate(xml);

        if (validationResult !== true) {
          diagnostics.push({
            id: 'MF-META-007',
            category: 'metadata',
            status: 'FAIL',
            summary: `${appName}: application metadata is invalid XML`,
            problem: validationResult.err.msg,
            file: filePath,
          });

          continue;
        }

        const parsed = parser.parse(xml);

        const uiBundle = parsed?.CustomApplication?.uiBundle;

        if (!uiBundle) {
          continue;
        }

        const uiType = parsed?.CustomApplication?.uiType;

        if (uiType !== 'Lightning') {
          diagnostics.push({
            id: 'MF-META-008',
            category: 'metadata',
            status: 'FAIL',
            summary: `${appName}: invalid uiType`,
            problem: `The application "${appName}" must use uiType "Lightning", but found "${uiType ?? 'missing'}".`,
            file: filePath,
          });

          continue;
        }

        const bundleName = String(uiBundle).replace(/^c__/, '');

        if (!bundles.includes(bundleName)) {
          diagnostics.push({
            id: 'MF-META-009',
            category: 'metadata',
            status: 'FAIL',
            summary: `${appName}: references missing UI Bundle "${uiBundle}"`,
            problem: `The application "${appName}" references UI Bundle "${uiBundle}", but that bundle was not found locally.`,
            file: filePath,
          });

          continue;
        }

        applicationNames.add(appName);
        linkedBundles.add(bundleName);

        diagnostics.push({
          id: 'MF-META-010',
          category: 'metadata',
          status: 'PASS',
          summary: `${appName}: linked to UI Bundle ${uiBundle}`,
          file: filePath,
        });
      } catch (error) {
        diagnostics.push({
          id: 'MF-META-007',
          category: 'metadata',
          status: 'FAIL',
          summary: `${appName}: could not read application metadata`,
          problem: error instanceof Error ? error.message : String(error),
          file: filePath,
        });
      }
    }
  }

  for (const bundle of bundles) {
    if (!linkedBundles.has(bundle)) {
      diagnostics.push({
        id: 'MF-META-011',
        category: 'metadata',
        status: 'FAIL',
        summary: `${bundle}: no CustomApplication references this UI Bundle`,
        problem: `The UI Bundle "${bundle}" is not referenced by any CustomApplication.`,
      });
    }
  }

  return {
    applicationNames: [...applicationNames],
    diagnostics,
  };
}
