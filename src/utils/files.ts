import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function findGraphqlFiles(directory: string): string[] {
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
      results.push(...findGraphqlFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.graphql')) {
      results.push(fullPath);
    }
  }

  return results;
}
