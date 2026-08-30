import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ignoredGraphqlDirectories = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  'fixtures',
  '__fixtures__',
  'test-fixtures',
  'generated',
  '__generated__',
]);

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
        ignoredGraphqlDirectories.has(entry.name.toLowerCase()) ||
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

export function findGraphqlFiles(
  directory: string,
  excludedDirectoryPaths: string[] = []
): string[] {
  const excludedDirectories = new Set(
    excludedDirectoryPaths.map(normalizePathForComparison)
  );

  return collectGraphqlFiles(directory, excludedDirectories);
}
