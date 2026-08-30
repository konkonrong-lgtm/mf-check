import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildSchema, introspectionFromSchema } from 'graphql';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../salesforce/schema.js', () => ({
  getSalesforceSchema: vi.fn(),
}));

import { getSalesforceSchema } from '../salesforce/schema.js';

import { checkSchema } from './schema.js';

const mockedGetSalesforceSchema = vi.mocked(getSalesforceSchema);

describe('checkSchema', () => {
  let projectPath: string;
  let metadataRoot: string;
  let graphqlPath: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'mf-check-'));

    metadataRoot = join(projectPath, 'src', 'main', 'default');

    graphqlPath = join(metadataRoot, 'uiBundles', 'MfLab', 'src', 'api');

    mkdirSync(graphqlPath, {
      recursive: true,
    });

    const schema = buildSchema(`
      type Query {
        Account: AccountConnection
      }

      type AccountConnection {
        edges: [AccountEdge!]!
      }

      type AccountEdge {
        node: Account!
      }

      type Account {
        Id: ID!
        Name: String
      }
    `);

    mockedGetSalesforceSchema.mockResolvedValue({
      data: introspectionFromSchema(schema),
      runtime: {
        targetOrg: 'vscodeOrg',
        apiVersion: '67.0',
        cacheStatus: 'MISS',
        cacheWritten: true,
        cacheTtlMinutes: 5,
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();

    rmSync(projectPath, {
      recursive: true,
      force: true,
    });
  });

  it('passes when GraphQL operation is valid against the target schema', async () => {
    writeFileSync(
      join(graphqlPath, 'getAccounts.graphql'),
      `
        query GetAccounts {
          Account {
            edges {
              node {
                Id
                Name
              }
            }
          }
        }
      `
    );

    const result = await checkSchema(projectPath, [metadataRoot], '67.0', 'vscodeOrg');

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-GRAPHQL-003',
          status: 'PASS',
        }),
      ])
    );

    expect(mockedGetSalesforceSchema).toHaveBeenCalledWith(
      'vscodeOrg',
      '67.0',
      false,
      false
    );
  });

  it('fails when GraphQL operation contains an unknown field', async () => {
    writeFileSync(
      join(graphqlPath, 'getAccounts.graphql'),
      `
        query GetAccounts {
          Accounnt {
            edges {
              node {
                Id
              }
            }
          }
        }
      `
    );

    const result = await checkSchema(projectPath, [metadataRoot], '67.0', 'vscodeOrg');

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-GRAPHQL-004',
          status: 'FAIL',
        }),
      ])
    );
  });

  it('forwards refresh option to Salesforce schema loader', async () => {
    writeFileSync(
      join(graphqlPath, 'getAccounts.graphql'),
      `
        query GetAccounts {
          Account {
            edges {
              node {
                Id
              }
            }
          }
        }
      `
    );

    await checkSchema(projectPath, [metadataRoot], '67.0', 'vscodeOrg', true);

    expect(mockedGetSalesforceSchema).toHaveBeenCalledWith(
      'vscodeOrg',
      '67.0',
      true,
      false
    );
  });

  it('forwards debug option to Salesforce schema loader', async () => {
    await checkSchema(projectPath, [metadataRoot], '67.0', 'vscodeOrg', false, true);

    expect(mockedGetSalesforceSchema).toHaveBeenCalledWith(
      'vscodeOrg',
      '67.0',
      false,
      true
    );
  });

  it('finds GraphQL operations across multiple metadata roots', async () => {
    const secondMetadataRoot = join(projectPath, 'feature', 'main', 'default');

    const secondGraphqlPath = join(
      secondMetadataRoot,
      'uiBundles',
      'FeatureBundle',
      'src',
      'api'
    );

    mkdirSync(secondGraphqlPath, {
      recursive: true,
    });

    writeFileSync(
      join(secondGraphqlPath, 'getAccounts.graphql'),
      `
        query GetAccounts {
          Account {
            edges {
              node {
                Id
              }
            }
          }
        }
      `
    );

    const result = await checkSchema(
      projectPath,
      [metadataRoot, secondMetadataRoot],
      '67.0',
      'vscodeOrg'
    );

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-GRAPHQL-003',
          status: 'PASS',
        }),
      ])
    );
  });

  it('passes when no metadata root contains GraphQL operations', async () => {
    const secondMetadataRoot = join(projectPath, 'feature', 'main', 'default');

    mkdirSync(secondMetadataRoot, {
      recursive: true,
    });

    const result = await checkSchema(
      projectPath,
      [metadataRoot, secondMetadataRoot],
      '67.0',
      'vscodeOrg'
    );

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-GRAPHQL-002',
          status: 'PASS',
        }),
      ])
    );
  });
});
