import { existsSync, lstatSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import ignoreModule from 'ignore';
import type { Ignore } from 'ignore';

import type { DiagnosticResult } from '../diagnostics/types.js';

export type ProjectDiscoveryResult = {
  metadataRoots: string[];
  uiBundlesPaths: string[];
  sourceApiVersion?: string;
  namespace?: string;
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

function isMissingPathError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

function readForceIgnore(projectPath: string): Ignore | undefined {
  const forceIgnorePath = join(projectPath, '.forceignore');

  if (!existsSync(forceIgnorePath)) {
    return undefined;
  }

  try {
    return ignoreModule.default().add(readFileSync(forceIgnorePath, 'utf-8'));
  } catch {
    return undefined;
  }
}

function isForceIgnored(
  forceIgnore: Ignore | undefined,
  projectPath: string,
  directoryPath: string
): boolean {
  if (!forceIgnore) {
    return false;
  }

  try {
    const relativePath = relative(projectPath, directoryPath).split(sep).join('/');

    return forceIgnore.ignores(`${relativePath}/`);
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
      whyItMatters:
        'mf-check needs sfdx-project.json to discover package directories, metadata roots, UI Bundles, and the project API version.',
      remediation: [
        'Run mf-check from a Salesforce project that contains sfdx-project.json, or provide the correct project path.',
      ],
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
      summary: 'sfdx-project.json could not be inspected',
      problem: error instanceof Error ? error.message : String(error),
      whyItMatters:
        'mf-check cannot reliably discover the Salesforce project structure until sfdx-project.json can be read and parsed.',
      remediation: [
        'Make sure sfdx-project.json is readable and contains valid JSON, then run mf-check again.',
      ],
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
      whyItMatters:
        'mf-check uses packageDirectories to locate Salesforce metadata and Multi-Framework UI Bundles in the project.',
      remediation: [
        'Define at least one packageDirectories entry in sfdx-project.json, then run mf-check again.',
      ],
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
  const namespace = typeof config.namespace === 'string' ? config.namespace : undefined;
  const forceIgnore = readForceIgnore(projectPath);

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
        whyItMatters:
          'mf-check cannot discover metadata for a packageDirectories entry without a valid package path.',
        remediation: [
          'Add a non-empty path to every packageDirectories entry in sfdx-project.json, then run mf-check again.',
        ],
        file: configPath,
      });

      continue;
    }

    const packagePath = resolve(projectPath, packageDirectory.path);
    const mainPath = join(packagePath, 'main');
    const defaultMetadataRoot = join(mainPath, 'default');

    metadataRoots.add(defaultMetadataRoot);

    const defaultUiBundlesPath = join(defaultMetadataRoot, 'uiBundles');

    if (
      !isForceIgnored(forceIgnore, projectPath, defaultMetadataRoot) &&
      !isForceIgnored(forceIgnore, projectPath, defaultUiBundlesPath)
    ) {
      uiBundlesPaths.add(defaultUiBundlesPath);
    }

    let mainIsDirectory: boolean;

    try {
      mainIsDirectory = lstatSync(mainPath).isDirectory();
    } catch (error) {
      if (isMissingPathError(error)) {
        continue;
      }

      diagnostics.push({
        id: 'MF-PROJECT-010',
        category: 'project',
        status: 'FAIL',
        summary: `${packageDirectory.path}: package main directory could not be inspected`,
        problem: error instanceof Error ? error.message : String(error),
        whyItMatters:
          'mf-check cannot reliably discover source directories and UI Bundle locations under this package when its main directory cannot be inspected.',
        remediation: [
          'Make sure the package main directory exists and is readable by the current user, then run mf-check again.',
        ],
        file: mainPath,
      });

      continue;
    }

    if (!mainIsDirectory) {
      diagnostics.push({
        id: 'MF-PROJECT-010',
        category: 'project',
        status: 'FAIL',
        summary: `${packageDirectory.path}: package main path is not a directory`,
        problem: `The package main path "${mainPath}" exists but is not a directory.`,
        whyItMatters:
          'mf-check cannot reliably discover source directories and UI Bundle locations under this package without a package main directory.',
        remediation: [
          'Make sure the package main path is a directory, then run mf-check again.',
        ],
        file: mainPath,
      });

      continue;
    }

    let mainEntries: Dirent[];

    try {
      mainEntries = readdirSync(mainPath, {
        withFileTypes: true,
      });
    } catch (error) {
      diagnostics.push({
        id: 'MF-PROJECT-010',
        category: 'project',
        status: 'FAIL',
        summary: `${packageDirectory.path}: package main directory could not be inspected`,
        problem: error instanceof Error ? error.message : String(error),
        whyItMatters:
          'mf-check cannot reliably discover source directories and UI Bundle locations under this package when its main directory cannot be enumerated.',
        remediation: [
          'Make sure the package main directory exists and is readable by the current user, then run mf-check again.',
        ],
        file: mainPath,
      });

      continue;
    }

    const sourceDirectories = mainEntries
      .filter(
        (entry) =>
          entry.isDirectory() && !ignoredMainDirectories.has(entry.name.toLowerCase())
      )
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const sourceDirectory of sourceDirectories) {
      const sourceDirectoryPath = join(mainPath, sourceDirectory.name);
      const uiBundlesPath = join(sourceDirectoryPath, 'uiBundles');

      if (
        isForceIgnored(forceIgnore, projectPath, sourceDirectoryPath) ||
        isForceIgnored(forceIgnore, projectPath, uiBundlesPath)
      ) {
        continue;
      }

      try {
        const uiBundlesStats = lstatSync(uiBundlesPath);

        if (!uiBundlesStats.isDirectory()) {
          diagnostics.push({
            id: 'MF-PROJECT-013',
            category: 'project',
            status: 'FAIL',
            summary: `${sourceDirectory.name}: uiBundles path is not a directory`,
            problem: `The uiBundles path "${uiBundlesPath}" exists but is not a directory.`,
            whyItMatters:
              'mf-check cannot reliably discover or validate UI Bundles under this source directory without a readable uiBundles directory.',
            remediation: [
              'Make sure the uiBundles path is a directory, then run mf-check again.',
            ],
            file: uiBundlesPath,
          });

          continue;
        }

        uiBundlesPaths.add(uiBundlesPath);
      } catch (error) {
        if (isMissingPathError(error)) {
          continue;
        }

        diagnostics.push({
          id: 'MF-PROJECT-013',
          category: 'project',
          status: 'FAIL',
          summary: `${sourceDirectory.name}: uiBundles path could not be inspected`,
          problem: error instanceof Error ? error.message : String(error),
          whyItMatters:
            'mf-check cannot reliably discover or validate UI Bundles under this source directory when the uiBundles path cannot be inspected.',
          remediation: [
            'Make sure the uiBundles path is readable by the current user, then run mf-check again.',
          ],
          file: uiBundlesPath,
        });
      }
    }
  }

  return {
    metadataRoots: [...metadataRoots],
    uiBundlesPaths: [...uiBundlesPaths],
    diagnostics,
    ...(sourceApiVersion ? { sourceApiVersion } : {}),
    ...(namespace !== undefined ? { namespace } : {}),
  };
}
