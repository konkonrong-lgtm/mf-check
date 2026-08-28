import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

export const CACHE_TTL_MS = 5 * 60 * 1000;
export const CACHE_TTL_MINUTES = CACHE_TTL_MS / 60_000;

export type CachedSchema = {
  fetchedAt: number;
  data: unknown;
  apiVersion: string;
  instanceUrl: string;
  username: string;
};

export function getSchemaCachePath(
  instanceUrl: string,
  apiVersion: string,
  username: string
) {
  const cacheDirectory = join(homedir(), '.mf-check', 'cache');

  const cacheKey = createHash('sha256')
    .update(`${instanceUrl}|${apiVersion}|${username}`)
    .digest('hex');

  return join(cacheDirectory, `${cacheKey}.json`);
}

export function readFreshSchemaCache(cachePath: string): CachedSchema | null {
  if (!existsSync(cachePath)) {
    return null;
  }

  try {
    const cached = JSON.parse(readFileSync(cachePath, 'utf-8')) as CachedSchema;

    if (typeof cached.fetchedAt !== 'number' || !cached.data) {
      return null;
    }

    const age = Date.now() - cached.fetchedAt;

    if (age >= CACHE_TTL_MS) {
      return null;
    }

    return cached;
  } catch {
    return null;
  }
}

export function writeSchemaCache(cachePath: string, cache: CachedSchema) {
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(cache), 'utf-8');
}

export function formatCacheAge(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  }

  return `${Math.floor(seconds / 60)}m`;
}
