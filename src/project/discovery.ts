import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { DiagnosticResult } from '../diagnostics/types.js';

export type ProjectDiscoveryResult = {
  metadataRoots: string[];
  uiBundlesPaths: string[];
  sourceApiVersion?: string;
  diagnostics: DiagnosticResult[];
};

const ignoredMainDirectories = new Set([
  'node_modules',
  'dist',
  'build',
  'cache',
  '.cache',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function discoverProject(projectPath: string): ProjectDiscoveryResult {
  const diagnostics: DiagnosticResult[] = [];
  const metadataRoots = new Set<string>();
  const uiBundlesPaths = new Set<string>();

  const configPath = join(projectPath, 'sfdx-project.json');

  if (!existsSync(configPath)) {
    diagnostics.push({
      id: 'MF-PROJECT-006',
      category: 'project',
      status: 'FAIL',
      summary: 'sfdx-project.json not found',
      problem: 'The project configuration file sfdx-project.json could not be found.',
      file: configPath,
    });

    return {
      metadataRoots: [],
      uiBundlesPaths: [],
      diagnostics,
    };
  }

  let config: unknown;

  try {
    const rawConfig = readFileSync(configPath, 'utf-8');
    const configText = rawConfig.replace(/^\uFEFF/, '');

    config = JSON.parse(configText);
  } catch (error) {
    diagnostics.push({
      id: 'MF-PROJECT-007',
      category: 'project',
      status: 'FAIL',
      summary: 'sfdx-project.json is invalid',
      problem: error instanceof Error ? error.message : String(error),
      file: configPath,
    });

    return {
      metadataRoots: [],
      uiBundlesPaths: [],
      diagnostics,
    };
  }

  if (
    !isRecord(config) ||
    !Array.isArray(config.packageDirectories) ||
    config.packageDirectories.length === 0
  ) {
    diagnostics.push({
      id: 'MF-PROJECT-008',
      category: 'project',
      status: 'FAIL',
      summary: 'packageDirectories not found',
      problem: 'The sfdx-project.json file does not define any packageDirectories.',
      file: configPath,
    });

    return {
      metadataRoots: [],
      uiBundlesPaths: [],
      diagnostics,
    };
  }

  const sourceApiVersion =
    typeof config.sourceApiVersion === 'string' ? config.sourceApiVersion : undefined;

  for (const packageDirectory of config.packageDirectories) {
    if (
      !isRecord(packageDirectory) ||
      typeof packageDirectory.path !== 'string' ||
      packageDirectory.path.trim() === ''
    ) {
      diagnostics.push({
        id: 'MF-PROJECT-009',
        category: 'project',
        status: 'FAIL',
        summary: 'Invalid packageDirectories entry',
        problem: 'Every packageDirectories entry must define a non-empty path.',
        file: configPath,
      });

      continue;
    }

    const packagePath = resolve(projectPath, packageDirectory.path);
    const mainPath = join(packagePath, 'main');
    const defaultMetadataRoot = join(mainPath, 'default');

    metadataRoots.add(defaultMetadataRoot);
    uiBundlesPaths.add(join(defaultMetadataRoot, 'uiBundles'));

    if (!isDirectory(mainPath)) {
      continue;
    }

    const sourceDirectories = readdirSync(mainPath, {
      withFileTypes: true,
    })
      .filter(
        (entry) =>
          entry.isDirectory() && !ignoredMainDirectories.has(entry.name.toLowerCase())
      )
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const sourceDirectory of sourceDirectories) {
      const uiBundlesPath = join(mainPath, sourceDirectory.name, 'uiBundles');

      if (isDirectory(uiBundlesPath)) {
        uiBundlesPaths.add(uiBundlesPath);
      }
    }
  }

  return {
    metadataRoots: [...metadataRoots],
    uiBundlesPaths: [...uiBundlesPaths],
    diagnostics,
    ...(sourceApiVersion ? { sourceApiVersion } : {}),
  };
}
