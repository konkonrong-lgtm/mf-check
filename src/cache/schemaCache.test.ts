import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CACHE_TTL_MS,
  getSchemaCachePath,
  readFreshSchemaCache,
  writeSchemaCache,
  type CachedSchema,
} from './schemaCache.js';

describe('schema cache', () => {
  let tempDirectory: string;
  let cachePath: string;

  beforeEach(() => {
    tempDirectory = mkdtempSync(join(tmpdir(), 'mf-check-cache-'));
    cachePath = join(tempDirectory, 'schema.json');

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();

    rmSync(tempDirectory, {
      recursive: true,
      force: true,
    });
  });

  it('returns a cached schema while it is still fresh', () => {
    const cache: CachedSchema = {
      fetchedAt: Date.now(),
      data: { __schema: {} },
    };

    writeSchemaCache(cachePath, cache);

    vi.setSystemTime(new Date(Date.now() + CACHE_TTL_MS - 1));

    expect(readFreshSchemaCache(cachePath)).toEqual(cache);
  });

  it('returns null when the cached schema has expired', () => {
    const cache: CachedSchema = {
      fetchedAt: Date.now(),
      data: { __schema: {} },
    };

    writeSchemaCache(cachePath, cache);

    vi.setSystemTime(new Date(Date.now() + CACHE_TTL_MS));

    expect(readFreshSchemaCache(cachePath)).toBeNull();
  });

  it('uses a different cache key for different Salesforce users', () => {
    const firstPath = getSchemaCachePath(
      'https://example.my.salesforce.com',
      '67.0',
      'first@example.com'
    );

    const secondPath = getSchemaCachePath(
      'https://example.my.salesforce.com',
      '67.0',
      'second@example.com'
    );

    expect(firstPath).not.toBe(secondPath);
  });
});
