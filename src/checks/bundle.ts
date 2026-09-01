import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

import type { DiagnosticResult } from '../diagnostics/types.js';
import { resolveUiBundleOutputPath } from '../utils/uiBundleOutput.js';

export type BundleInfo = {
  name: string;
  path: string;
  target?: string;
};

type BundleCheckResult = {
  bundles: BundleInfo[];
  diagnostics: DiagnosticResult[];
};

const MAX_CONTENT_RECURSION_DEPTH = 20;

function hasDeployableContent(directoryPath: string, depth = 0): boolean {
  if (depth >= MAX_CONTENT_RECURSION_DEPTH) {
    return false;
  }

  for (const entry of readdirSync(directoryPath)) {
    const entryPath = join(directoryPath, entry);

    if (!existsSync(entryPath)) {
      continue;
    }

    if (statSync(entryPath).isDirectory()) {
      if (hasDeployableContent(entryPath, depth + 1)) {
        return true;
      }
    } else {
      return true;
    }
  }

  return false;
}

export function checkBundles(uiBundlesPaths: string[]): BundleCheckResult {
  const diagnostics: DiagnosticResult[] = [];

  // Project discovery already reports this failure.
  if (uiBundlesPaths.length === 0) {
    return {
      bundles: [],
      diagnostics,
    };
  }

  const readableUiBundlesPaths: string[] = [];

  const bundleLocations: BundleInfo[] = [];

  for (const uiBundlesPath of uiBundlesPaths) {
    if (!existsSync(uiBundlesPath)) {
      continue;
    }

    try {
      const bundleDirectories = readdirSync(uiBundlesPath, {
        withFileTypes: true,
      }).filter((entry) => entry.isDirectory());

      readableUiBundlesPaths.push(uiBundlesPath);

      for (const entry of bundleDirectories) {
        bundleLocations.push({
          name: entry.name,
          path: join(uiBundlesPath, entry.name),
        });
      }
    } catch (error) {
      diagnostics.push({
        id: 'MF-PROJECT-012',
        category: 'project',
        status: 'FAIL',
        summary: 'uiBundles directory could not be inspected',
        problem: error instanceof Error ? error.message : String(error),
        whyItMatters:
          'mf-check cannot reliably discover or validate UI Bundles under this path when the directory cannot be enumerated.',
        remediation: [
          'Make sure the uiBundles path exists, is a directory, and is readable by the current user, then run mf-check again.',
        ],
        file: uiBundlesPath,
      });

      continue;
    }
  }

  if (readableUiBundlesPaths.length === 0) {
    diagnostics.push({
      id: 'MF-PROJECT-001',
      category: 'project',
      status: 'FAIL',
      summary: 'No readable uiBundles directory found',
      problem:
        'mf-check could not find a readable uiBundles directory in the project package directories.',
      whyItMatters:
        'Without access to a uiBundles directory, mf-check cannot discover or validate Multi-Framework UI Bundles.',
      remediation: [
        'Make sure a uiBundles directory exists in the expected package location and is readable, then run mf-check again.',
      ],
    });

    return {
      bundles: [],
      diagnostics,
    };
  }

  for (const uiBundlesPath of readableUiBundlesPaths) {
    diagnostics.push({
      id: 'MF-PROJECT-003',
      category: 'project',
      status: 'PASS',
      summary: 'uiBundles directory found',
      file: uiBundlesPath,
    });
  }

  if (bundleLocations.length === 0) {
    diagnostics.push({
      id: 'MF-PROJECT-002',
      category: 'project',
      status: 'FAIL',
      summary: 'No UI Bundles found',
      problem:
        'Readable uiBundles directories were found, but none contain a UI Bundle directory.',
      whyItMatters:
        'Without a discovered UI Bundle, mf-check has no Multi-Framework bundle to validate.',
      remediation: [
        'Make sure at least one UI Bundle directory exists under a discovered uiBundles directory, then run mf-check again.',
      ],
    });

    return {
      bundles: [],
      diagnostics,
    };
  }

  const bundlesNames = [...new Set(bundleLocations.map((bundle) => bundle.name))];

  diagnostics.push({
    id: 'MF-PROJECT-004',
    category: 'project',
    status: 'PASS',
    summary: `Found UI Bundles: ${bundlesNames.join(', ')}`,
  });

  const xmlParser = new XMLParser();

  for (const bundle of bundleLocations) {
    const metadataPath = join(bundle.path, `${bundle.name}.uibundle-meta.xml`);

    if (!existsSync(metadataPath)) {
      diagnostics.push({
        id: 'MF-META-012',
        category: 'metadata',
        status: 'FAIL',
        summary: `${bundle.name}: UIBundle metadata not found`,
        problem: `The UI Bundle "${bundle.name}" does not contain ${bundle.name}.uibundle-meta.xml.`,
        whyItMatters:
          'Without UIBundle metadata, mf-check cannot validate this directory as a complete UI Bundle definition.',
        remediation: [
          `Add ${bundle.name}.uibundle-meta.xml to the UI Bundle directory and define the required UIBundle metadata.`,
        ],
        file: metadataPath,
      });
    } else {
      try {
        const metadataXml = readFileSync(metadataPath, 'utf-8');
        const validationResult = XMLValidator.validate(metadataXml);

        if (validationResult !== true) {
          diagnostics.push({
            id: 'MF-META-013',
            category: 'metadata',
            status: 'FAIL',
            summary: `${bundle.name}: invalid UIBundle metadata XML`,
            problem: validationResult.err.msg,
            whyItMatters:
              'mf-check cannot reliably inspect the UIBundle metadata until the XML is valid.',
            remediation: [
              `Fix the XML syntax in ${bundle.name}.uibundle-meta.xml, then run mf-check again.`,
            ],
            file: metadataPath,
          });
        } else {
          const parsedMetadata = xmlParser.parse(metadataXml);

          if (
            typeof parsedMetadata !== 'object' ||
            parsedMetadata === null ||
            !Object.hasOwn(parsedMetadata, 'UIBundle') ||
            typeof parsedMetadata.UIBundle !== 'object' ||
            parsedMetadata.UIBundle === null ||
            Array.isArray(parsedMetadata.UIBundle)
          ) {
            diagnostics.push({
              id: 'MF-META-014',
              category: 'metadata',
              status: 'FAIL',
              summary: `${bundle.name}: invalid UIBundle metadata root`,
              problem: 'The metadata XML root element must be UIBundle.',
              whyItMatters:
                'mf-check cannot treat this file as valid UIBundle metadata when the expected UIBundle root element is missing.',
              remediation: [
                `Make sure ${bundle.name}.uibundle-meta.xml uses UIBundle as its root element, then run mf-check again.`,
              ],
              file: metadataPath,
            });
          } else {
            const hasTarget = Object.hasOwn(parsedMetadata.UIBundle, 'target');
            const target = parsedMetadata.UIBundle.target;

            if (!hasTarget) {
              bundle.target = 'CustomApplication';

              diagnostics.push({
                id: 'MF-META-015',
                category: 'metadata',
                status: 'PASS',
                summary: `${bundle.name}: valid UIBundle metadata`,
                file: metadataPath,
              });
            } else if (
              typeof target !== 'string' ||
              !['CustomApplication', 'Experience', 'AppLauncher'].includes(target)
            ) {
              diagnostics.push({
                id: 'MF-META-014',
                category: 'metadata',
                status: 'FAIL',
                summary: `${bundle.name}: invalid UIBundle target`,
                problem:
                  'The target element must contain exactly one supported value: CustomApplication, Experience, or AppLauncher.',
                whyItMatters:
                  'mf-check cannot determine the UI Bundle topology from an empty, repeated, or unsupported target value.',
                remediation: [
                  'Set target to CustomApplication or Experience. Use AppLauncher only while identifying metadata that still requires GA migration.',
                ],
                file: metadataPath,
              });
            } else if (target === 'AppLauncher') {
              bundle.target = target;

              diagnostics.push({
                id: 'MF-META-017',
                category: 'metadata',
                status: 'FAIL',
                summary: `${bundle.name}: deprecated AppLauncher target`,
                problem:
                  'The AppLauncher target is deprecated. Use CustomApplication for an internal application.',
                whyItMatters:
                  'Salesforce Multi-Framework GA uses CustomApplication as the application entry point for internal apps instead of the deprecated AppLauncher target.',
                remediation: [
                  'Remove the AppLauncher target from the UIBundle metadata.',
                  'Expose the UI Bundle through a Lightning CustomApplication instead.',
                ],
                file: metadataPath,
                docsUrl:
                  'https://developer.salesforce.com/blogs/2026/07/build-with-react-on-salesforce-multi-framework-is-now-ga',
              });
            } else {
              bundle.target = target;

              diagnostics.push({
                id: 'MF-META-015',
                category: 'metadata',
                status: 'PASS',
                summary: `${bundle.name}: valid UIBundle metadata`,
                file: metadataPath,
              });
            }
          }
        }
      } catch (error) {
        diagnostics.push({
          id: 'MF-META-013',
          category: 'metadata',
          status: 'FAIL',
          summary: `${bundle.name}: could not inspect UIBundle metadata XML`,
          problem: error instanceof Error ? error.message : String(error),
          whyItMatters:
            'mf-check cannot verify this UI Bundle metadata when the file cannot be read or parsed.',
          remediation: [
            `Make sure ${bundle.name}.uibundle-meta.xml is readable and contains valid XML, then run mf-check again.`,
          ],
          file: metadataPath,
        });
      }
    }

    const configPath = join(bundle.path, 'ui-bundle.json');

    if (!existsSync(configPath)) {
      diagnostics.push({
        id: 'MF-META-001',
        category: 'metadata',
        status: 'FAIL',
        summary: `${bundle.name}: ui-bundle.json not found`,
        problem: `The UI Bundle "${bundle.name}" does not contain a ui-bundle.json file.`,
        whyItMatters:
          'Without ui-bundle.json, mf-check cannot determine the UI Bundle build output directory.',
        remediation: [
          'Add a ui-bundle.json file to the UI Bundle directory and define a valid outputDir.',
        ],
        file: configPath,
      });

      continue;
    }

    let configText: string;

    try {
      configText = readFileSync(configPath, 'utf-8');
    } catch (error) {
      diagnostics.push({
        id: 'MF-META-018',
        category: 'metadata',
        status: 'UNKNOWN',
        blocksReadiness: true,
        summary: `${bundle.name}: ui-bundle.json could not be read`,
        problem: error instanceof Error ? error.message : String(error),
        whyItMatters:
          'mf-check cannot reliably inspect the UI Bundle build output configuration when ui-bundle.json cannot be read.',
        remediation: [
          'Make sure ui-bundle.json is a readable file, then run mf-check again.',
        ],
        file: configPath,
      });

      continue;
    }

    let config: { outputDir?: unknown };

    try {
      config = JSON.parse(configText);
    } catch {
      diagnostics.push({
        id: 'MF-META-002',
        category: 'metadata',
        status: 'FAIL',
        summary: `${bundle.name}: invalid ui-bundle.json`,
        problem: `The ui-bundle.json file for "${bundle.name}" is not valid JSON.`,
        whyItMatters:
          'mf-check cannot determine the UI Bundle build output configuration until ui-bundle.json contains valid JSON.',
        remediation: ['Fix the JSON syntax in ui-bundle.json, then run mf-check again.'],
        file: configPath,
      });

      continue;
    }

    if (typeof config.outputDir !== 'string' || !config.outputDir) {
      diagnostics.push({
        id: 'MF-META-003',
        category: 'metadata',
        status: 'FAIL',
        summary: `${bundle.name}: outputDir is not defined`,
        problem: `The ui-bundle.json file for "${bundle.name}" does not define a valid outputDir.`,
        whyItMatters:
          'mf-check cannot locate or validate the UI Bundle build output without a valid outputDir.',
        remediation: [
          'Define outputDir as a non-empty string in ui-bundle.json, then run mf-check again.',
        ],
        file: configPath,
      });

      continue;
    }

    const outputDir = config.outputDir;
    let outputPath: string;

    try {
      outputPath = resolveUiBundleOutputPath(bundle.path, outputDir);
    } catch (error) {
      diagnostics.push({
        id: 'MF-META-003',
        category: 'metadata',
        status: 'FAIL',
        summary: `${bundle.name}: outputDir is invalid`,
        problem: error instanceof Error ? error.message : String(error),
        whyItMatters:
          'An invalid outputDir can point outside the UI Bundle or to an unsafe location, so mf-check cannot safely validate the build output.',
        remediation: [
          'Update outputDir to reference a valid subdirectory inside the UI Bundle, then run mf-check again.',
        ],
        file: configPath,
      });

      continue;
    }

    diagnostics.push({
      id: 'MF-META-004',
      category: 'metadata',
      status: 'PASS',
      summary: `${bundle.name}: outputDir = ${outputDir}`,
      file: configPath,
    });

    let outputIsDirectory = false;

    try {
      outputIsDirectory = statSync(outputPath).isDirectory();
    } catch {
      outputIsDirectory = false;
    }

    if (!outputIsDirectory) {
      diagnostics.push({
        id: 'MF-META-005',
        category: 'metadata',
        status: 'FAIL',
        summary: `${bundle.name}: output directory is invalid`,
        problem: `The configured output path "${outputDir}" does not exist or is not a directory.`,
        whyItMatters:
          'mf-check cannot verify deployable UI Bundle build output when the configured output directory is missing or not a directory.',
        remediation: [
          'Build the UI Bundle so the configured outputDir exists as a directory, or update outputDir to the correct build output location.',
        ],
        file: outputPath,
      });

      continue;
    }

    diagnostics.push({
      id: 'MF-META-006',
      category: 'metadata',
      status: 'PASS',
      summary: `${bundle.name}: output directory exists`,
      file: outputPath,
    });

    try {
      if (!hasDeployableContent(outputPath)) {
        diagnostics.push({
          id: 'MF-META-016',
          category: 'metadata',
          status: 'FAIL',
          summary: `${bundle.name}: output directory has no deployable content`,
          problem:
            'The configured output directory does not contain any files to deploy.',
          whyItMatters:
            'A UI Bundle build output must contain generated files before it can be treated as deployable content.',
          remediation: [
            'Build the UI Bundle and make sure the configured outputDir contains the generated output files, then run mf-check again.',
          ],
          file: outputPath,
          docsUrl:
            'https://github.com/forcedotcom/source-deploy-retrieve/blob/main/HANDBOOK.md',
        });
      }
    } catch (error) {
      diagnostics.push({
        id: 'MF-META-016',
        category: 'metadata',
        status: 'FAIL',
        summary: `${bundle.name}: output directory could not be inspected`,
        problem: error instanceof Error ? error.message : String(error),
        whyItMatters:
          'mf-check cannot confirm whether the configured output directory contains deployable UI Bundle content when the directory cannot be inspected.',
        remediation: [
          'Make sure the output directory and its contents are readable, then run mf-check again.',
        ],
        file: outputPath,
      });
    }
  }

  return {
    bundles: bundleLocations,
    diagnostics,
  };
}
