import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

import type { DiagnosticResult } from '../diagnostics/types.js';
import { resolveUiBundleOutputPath } from '../utils/uiBundleOutput.js';

type BundleCheckResult = {
  bundles: string[];
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

  const existingUiBundlesPaths = uiBundlesPaths.filter((uiBundlesPath) =>
    existsSync(uiBundlesPath)
  );

  if (existingUiBundlesPaths.length === 0) {
    diagnostics.push({
      id: 'MF-PROJECT-001',
      category: 'project',
      status: 'FAIL',
      summary: 'uiBundles directory not found',
      problem: 'None of the project package directories contain a uiBundles directory.',
    });

    return {
      bundles: [],
      diagnostics,
    };
  }

  for (const uiBundlesPath of existingUiBundlesPaths) {
    diagnostics.push({
      id: 'MF-PROJECT-003',
      category: 'project',
      status: 'PASS',
      summary: 'uiBundles directory found',
      file: uiBundlesPath,
    });
  }

  const bundleLocations: {
    name: string;
    path: string;
  }[] = [];

  for (const uiBundlesPath of existingUiBundlesPaths) {
    const bundleDirectories = readdirSync(uiBundlesPath, {
      withFileTypes: true,
    }).filter((entry) => entry.isDirectory());

    for (const entry of bundleDirectories) {
      bundleLocations.push({
        name: entry.name,
        path: join(uiBundlesPath, entry.name),
      });
    }
  }

  if (bundleLocations.length === 0) {
    diagnostics.push({
      id: 'MF-PROJECT-002',
      category: 'project',
      status: 'FAIL',
      summary: 'No UI Bundles found',
      problem:
        'UI Bundle directories were found, but they contain no UI Bundle directories.',
    });

    return {
      bundles: [],
      diagnostics,
    };
  }

  const bundles = [...new Set(bundleLocations.map((bundle) => bundle.name))];

  diagnostics.push({
    id: 'MF-PROJECT-004',
    category: 'project',
    status: 'PASS',
    summary: `Found UI Bundles: ${bundles.join(', ')}`,
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
            file: metadataPath,
          });
        } else {
          const parsedMetadata = xmlParser.parse(metadataXml);

          if (
            typeof parsedMetadata !== 'object' ||
            parsedMetadata === null ||
            !Object.hasOwn(parsedMetadata, 'UIBundle')
          ) {
            diagnostics.push({
              id: 'MF-META-014',
              category: 'metadata',
              status: 'FAIL',
              summary: `${bundle.name}: invalid UIBundle metadata root`,
              problem: 'The metadata XML root element must be UIBundle.',
              file: metadataPath,
            });
          } else {
            const target = parsedMetadata.UIBundle?.target;
            const targets = Array.isArray(target) ? target : [target];

            if (targets.includes('AppLauncher')) {
              diagnostics.push({
                id: 'MF-META-017',
                category: 'metadata',
                status: 'FAIL',
                summary: `${bundle.name}: deprecated AppLauncher target`,
                problem:
                  'The AppLauncher target is deprecated. Use CustomApplication for an internal application.',
                file: metadataPath,
                docsUrl:
                  'https://developer.salesforce.com/blogs/2026/07/build-with-react-on-salesforce-multi-framework-is-now-ga',
              });
            } else {
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
          summary: `${bundle.name}: could not read UIBundle metadata XML`,
          problem: error instanceof Error ? error.message : String(error),
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
        file: configPath,
      });

      continue;
    }

    let config: { outputDir?: unknown };

    try {
      config = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      diagnostics.push({
        id: 'MF-META-002',
        category: 'metadata',
        status: 'FAIL',
        summary: `${bundle.name}: invalid ui-bundle.json`,
        problem: `The ui-bundle.json file for "${bundle.name}" is not valid JSON.`,
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
            'The configured output directory must contain at least one non-metadata content file.',
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
        file: outputPath,
      });
    }
  }

  return {
    bundles,
    diagnostics,
  };
}
