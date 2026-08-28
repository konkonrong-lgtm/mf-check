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
  let graphqlPath: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'mf-check-'));

    graphqlPath = join(
      projectPath,
      'force-app',
      'main',
      'default',
      'uiBundles',
      'MfLab',
      'src',
      'api'
    );

    mkdirSync(graphqlPath, {
      recursive: true,
    });

    writeFileSync(
      join(projectPath, 'sfdx-project.json'),
      JSON.stringify({
        sourceApiVersion: '67.0',
      })
    );

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

    mockedGetSalesforceSchema.mockResolvedValue(introspectionFromSchema(schema));

    vi.spyOn(console, 'log').mockImplementation(() => {});

    vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.spyOn(console, 'time').mockImplementation(() => {});

    vi.spyOn(console, 'timeEnd').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

    const result = await checkSchema(projectPath, 'vscodeOrg');

    expect(result.hasError).toBe(false);

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

    const result = await checkSchema(projectPath, 'vscodeOrg');

    expect(result.hasError).toBe(true);
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

    await checkSchema(projectPath, 'vscodeOrg', true);

    expect(mockedGetSalesforceSchema).toHaveBeenCalledWith(
      'vscodeOrg',
      '67.0',
      true,
      false
    );
  });

  it('forwards debug option to Salesforce schema loader', async () => {
    await checkSchema(projectPath, 'vscodeOrg', false, true);

    expect(mockedGetSalesforceSchema).toHaveBeenCalledWith(
      'vscodeOrg',
      '67.0',
      false,
      true
    );
  });
});
