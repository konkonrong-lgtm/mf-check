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
      whyItMatters:
        'mf-check cannot verify CustomApplication-to-UI-Bundle linkage or application visibility without local application metadata.',
      remediation: [
        'Make sure the Salesforce project contains CustomApplication metadata under an applications directory.',
      ],
    });

    return {
      applicationNames: [],
      diagnostics,
    };
  }

  const parser = new XMLParser();
  const applicationNames = new Set<string>();
  const referencedBundles = new Set<string>();
  let linkageInspectionComplete = true;

  for (const applicationsPath of applicationPaths) {
    let applicationFiles: string[];

    try {
      applicationFiles = readdirSync(applicationsPath).filter((file) =>
        file.endsWith('.app-meta.xml')
      );
    } catch (error) {
      linkageInspectionComplete = false;

      diagnostics.push({
        id: 'MF-PROJECT-011',
        category: 'project',
        status: 'FAIL',
        summary: 'applications directory could not be inspected',
        problem: error instanceof Error ? error.message : String(error),
        whyItMatters:
          'mf-check cannot reliably discover CustomApplication metadata or verify UI Bundle linkage when this directory cannot be enumerated.',
        remediation: [
          'Make sure the applications directory exists, is a directory, and is readable by the current user, then run mf-check again.',
        ],
        file: applicationsPath,
      });

      continue;
    }

    for (const file of applicationFiles) {
      const filePath = join(applicationsPath, file);
      const appName = file.replace('.app-meta.xml', '');

      try {
        const xml = readFileSync(filePath, 'utf-8');

        const validationResult = XMLValidator.validate(xml);

        if (validationResult !== true) {
          linkageInspectionComplete = false;

          diagnostics.push({
            id: 'MF-META-007',
            category: 'metadata',
            status: 'FAIL',
            summary: `${appName}: application metadata is invalid XML`,
            problem: validationResult.err.msg,
            whyItMatters:
              'mf-check cannot reliably inspect the CustomApplication metadata until the XML is valid.',
            remediation: [
              'Fix the XML syntax in this CustomApplication metadata file, then run mf-check again.',
            ],
            file: filePath,
          });

          continue;
        }

        const parsed = parser.parse(xml);

        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          !Object.hasOwn(parsed, 'CustomApplication')
        ) {
          linkageInspectionComplete = false;

          diagnostics.push({
            id: 'MF-META-007',
            category: 'metadata',
            status: 'FAIL',
            summary: `${appName}: invalid application metadata root`,
            problem: 'The metadata XML root element must be CustomApplication.',
            whyItMatters:
              'mf-check cannot reliably inspect this application or its UI Bundle linkage without the expected CustomApplication root element.',
            remediation: [
              'Make sure this application metadata file uses CustomApplication as its root element, then run mf-check again.',
            ],
            file: filePath,
          });

          continue;
        }

        const uiBundle = parsed?.CustomApplication?.uiBundle;

        if (!uiBundle) {
          continue;
        }

        const bundleName = String(uiBundle).replace(/^c__/, '');
        referencedBundles.add(bundleName);

        const uiType = parsed?.CustomApplication?.uiType;

        if (uiType !== 'Lightning') {
          diagnostics.push({
            id: 'MF-META-008',
            category: 'metadata',
            status: 'FAIL',
            summary: `${appName}: invalid uiType`,
            problem: `The application "${appName}" must use uiType "Lightning", but found "${uiType ?? 'missing'}".`,
            whyItMatters:
              'A Multi-Framework UI Bundle must be exposed through a Lightning CustomApplication.',
            remediation: [
              'Set the CustomApplication uiType to "Lightning" and deploy the corrected application metadata.',
            ],
            file: filePath,
          });

          continue;
        }

        if (!bundles.includes(bundleName)) {
          diagnostics.push({
            id: 'MF-META-009',
            category: 'metadata',
            status: 'FAIL',
            summary: `${appName}: references missing UI Bundle "${uiBundle}"`,
            problem: `The application "${appName}" references UI Bundle "${uiBundle}", but that bundle was not found locally.`,
            whyItMatters:
              'The CustomApplication cannot be validated as a working Multi-Framework entry point when its referenced UI Bundle is missing from the local project.',
            remediation: [
              'Make sure the referenced UI Bundle exists in the project or update the CustomApplication uiBundle value to reference the correct bundle.',
            ],
            file: filePath,
          });

          continue;
        }

        applicationNames.add(appName);

        diagnostics.push({
          id: 'MF-META-010',
          category: 'metadata',
          status: 'PASS',
          summary: `${appName}: linked to UI Bundle ${uiBundle}`,
          file: filePath,
        });
      } catch (error) {
        linkageInspectionComplete = false;

        diagnostics.push({
          id: 'MF-META-007',
          category: 'metadata',
          status: 'FAIL',
          summary: `${appName}: could not read application metadata`,
          problem: error instanceof Error ? error.message : String(error),
          whyItMatters:
            'mf-check cannot verify this CustomApplication or its UI Bundle linkage when the metadata file cannot be read.',
          remediation: [
            'Make sure the CustomApplication metadata file exists, is readable, and can be accessed by the current user, then run mf-check again.',
          ],
          file: filePath,
        });
      }
    }
  }

  if (linkageInspectionComplete) {
    for (const bundle of bundles) {
      if (!referencedBundles.has(bundle)) {
        diagnostics.push({
          id: 'MF-META-011',
          category: 'metadata',
          status: 'FAIL',
          summary: `${bundle}: no CustomApplication references this UI Bundle`,
          problem: `The UI Bundle "${bundle}" is not referenced by any CustomApplication.`,
          whyItMatters:
            'Without a CustomApplication reference, mf-check cannot confirm a user-facing application entry point for this UI Bundle.',
          remediation: [
            'Create or update a Lightning CustomApplication so its uiBundle references this UI Bundle.',
          ],
        });
      }
    }
  }

  return {
    applicationNames: [...applicationNames],
    diagnostics,
  };
}
