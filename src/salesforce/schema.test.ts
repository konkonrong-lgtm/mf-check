import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./cli.js', () => ({
  runSfJson: vi.fn(),
}));

vi.mock('../cache/schemaCache.js', () => ({
  CACHE_TTL_MINUTES: 5,
  getSchemaCachePath: vi.fn(),
  readFreshSchemaCache: vi.fn(),
  writeSchemaCache: vi.fn(),
}));

import {
  getSchemaCachePath,
  readFreshSchemaCache,
  writeSchemaCache,
} from '../cache/schemaCache.js';
import { runSfJson } from './cli.js';
import { getSalesforceSchema } from './schema.js';

const mockedGetSchemaCachePath = vi.mocked(getSchemaCachePath);
const mockedReadFreshSchemaCache = vi.mocked(readFreshSchemaCache);
const mockedRunSfJson = vi.mocked(runSfJson);
const mockedWriteSchemaCache = vi.mocked(writeSchemaCache);

describe('getSalesforceSchema', () => {
  beforeEach(() => {
    mockedGetSchemaCachePath.mockReturnValue(
      join(tmpdir(), 'mf-check-schema-cache-test', 'schema.json')
    );
    mockedReadFreshSchemaCache.mockReturnValue(null);
    mockedRunSfJson.mockImplementation((args) => {
      if (args[0] === 'org' && args[1] === 'display') {
        return {
          result: {
            instanceUrl: 'https://example.my.salesforce.com',
            username: 'user@example.com',
          },
        };
      }

      return {
        result: {
          accessToken: 'token',
        },
      };
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            __schema: {
              queryType: null,
            },
          },
        }),
      })
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns the fetched schema when writing the cache fails', async () => {
    mockedWriteSchemaCache.mockImplementationOnce(() => {
      throw new Error('EACCES: cache is read-only');
    });

    const result = await getSalesforceSchema('vscodeOrg', '67.0');

    expect(result.data).toEqual({
      __schema: {
        queryType: null,
      },
    });
    expect(result.runtime.cacheWritten).toBe(false);
  });
});
