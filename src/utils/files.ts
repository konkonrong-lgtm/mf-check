import { existsSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ignoredScanDirectories = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  'fixture',
  'fixtures',
  '__fixtures__',
  'test-fixtures',
  'generated',
  '__generated__',
]);

const sourceFileExtensions = new Set(['.ts', '.tsx', '.js', '.jsx']);

function normalizePathForComparison(path: string): string {
  const normalizedPath = resolve(path);

  return process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath;
}

function collectGraphqlFiles(
  directory: string,
  excludedDirectories: ReadonlySet<string>
): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  const results: string[] = [];

  const entries = readdirSync(directory, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (
        ignoredScanDirectories.has(entry.name.toLowerCase()) ||
        excludedDirectories.has(normalizePathForComparison(fullPath))
      ) {
        continue;
      }

      results.push(...collectGraphqlFiles(fullPath, excludedDirectories));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.graphql')) {
      results.push(fullPath);
    }
  }

  return results;
}

function collectSourceFiles(
  directory: string,
  excludedDirectories: ReadonlySet<string>
): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  const results: string[] = [];

  const entries = readdirSync(directory, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (
        ignoredScanDirectories.has(entry.name.toLowerCase()) ||
        excludedDirectories.has(normalizePathForComparison(fullPath))
      ) {
        continue;
      }

      results.push(...collectSourceFiles(fullPath, excludedDirectories));
      continue;
    }

    if (entry.isFile() && sourceFileExtensions.has(extname(entry.name).toLowerCase())) {
      results.push(fullPath);
    }
  }

  return results;
}

export function findGraphqlFiles(
  directory: string,
  excludedDirectoryPaths: string[] = []
): string[] {
  const excludedDirectories = new Set(
    excludedDirectoryPaths.map(normalizePathForComparison)
  );

  return collectGraphqlFiles(directory, excludedDirectories);
}

export function findSourceFiles(
  directory: string,
  excludedDirectoryPaths: string[] = []
): string[] {
  const excludedDirectories = new Set(
    excludedDirectoryPaths.map(normalizePathForComparison)
  );

  return collectSourceFiles(directory, excludedDirectories).sort((a, b) =>
    a.localeCompare(b)
  );
}
