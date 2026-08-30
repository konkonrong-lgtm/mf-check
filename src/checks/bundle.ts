import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DiagnosticResult } from '../diagnostics/types.js';

type BundleCheckResult = {
  bundles: string[];
  diagnostics: DiagnosticResult[];
};

export function checkBundles(metadataRoots: string[]): BundleCheckResult {
  const diagnostics: DiagnosticResult[] = [];

  // Project discovery already reports this failure.
  if (metadataRoots.length === 0) {
    return {
      bundles: [],
      diagnostics,
    };
  }

  const uiBundlesPaths = metadataRoots
    .map((metadataRoot) => join(metadataRoot, 'uiBundles'))
    .filter((uiBundlesPath) => existsSync(uiBundlesPath));

  if (uiBundlesPaths.length === 0) {
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

  for (const uiBundlesPath of uiBundlesPaths) {
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

  for (const uiBundlesPath of uiBundlesPaths) {
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

  for (const bundle of bundleLocations) {
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

    diagnostics.push({
      id: 'MF-META-004',
      category: 'metadata',
      status: 'PASS',
      summary: `${bundle.name}: outputDir = ${outputDir}`,
      file: configPath,
    });

    const outputPath = join(bundle.path, outputDir);

    if (!existsSync(outputPath)) {
      diagnostics.push({
        id: 'MF-META-005',
        category: 'metadata',
        status: 'FAIL',
        summary: `${bundle.name}: output directory does not exist`,
        problem: `The configured output directory "${outputDir}" does not exist.`,
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
  }

  return {
    bundles,
    diagnostics,
  };
}
