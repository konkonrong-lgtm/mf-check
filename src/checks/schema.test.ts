import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildSchema, introspectionFromSchema } from 'graphql';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();

  return {
    ...actual,
    readFileSync: vi.fn(actual.readFileSync),
  };
});

vi.mock('../salesforce/schema.js', () => ({
  getSalesforceSchema: vi.fn(),
}));

import { getSalesforceSchema } from '../salesforce/schema.js';

import { hasReadinessBlockers } from '../diagnostics/result.js';
import { checkSchema } from './schema.js';

const mockedGetSalesforceSchema = vi.mocked(getSalesforceSchema);

describe('checkSchema', () => {
  let projectPath: string;
  let metadataRoot: string;
  let bundlePath: string;
  let graphqlPath: string;
  let introspectionData: ReturnType<typeof introspectionFromSchema>;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'mf-check-'));

    metadataRoot = join(projectPath, 'src', 'main', 'default');

    bundlePath = join(metadataRoot, 'uiBundles', 'MfLab');

    graphqlPath = join(bundlePath, 'src', 'api');

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

    introspectionData = introspectionFromSchema(schema);

    mockedGetSalesforceSchema.mockResolvedValue({
      data: introspectionData,
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

    const result = await checkSchema(
      projectPath,
      [join(metadataRoot, 'uiBundles')],
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

    expect(mockedGetSalesforceSchema).toHaveBeenCalledWith(
      'vscodeOrg',
      '67.0',
      false,
      false
    );
  });

  it('returns a blocking UNKNOWN when the live schema cannot be retrieved', async () => {
    mockedGetSalesforceSchema.mockRejectedValueOnce(new Error('authentication failed'));

    const result = await checkSchema(
      projectPath,
      [join(metadataRoot, 'uiBundles')],
      '67.0',
      'vscodeOrg'
    );

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        id: 'MF-GRAPHQL-006',
        status: 'UNKNOWN',
        blocksReadiness: true,
        problem: 'authentication failed',
      }),
    ]);
    expect(hasReadinessBlockers(result.diagnostics)).toBe(true);
  });

  it('continues local validation when the fetched schema was not cached', async () => {
    const operationPath = join(graphqlPath, 'getAccounts.graphql');

    mockedGetSalesforceSchema.mockResolvedValueOnce({
      data: introspectionData,
      runtime: {
        targetOrg: 'vscodeOrg',
        apiVersion: '67.0',
        cacheStatus: 'MISS',
        cacheWritten: false,
        cacheTtlMinutes: 5,
      },
    });
    writeFileSync(
      operationPath,
      'query GetAccounts { Account { edges { node { Id } } } }'
    );

    const result = await checkSchema(
      projectPath,
      [join(metadataRoot, 'uiBundles')],
      '67.0',
      'vscodeOrg'
    );

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        id: 'MF-GRAPHQL-003',
        status: 'PASS',
        file: operationPath,
      }),
    ]);
  });

  it('validates an operation and fragment from separate files together', async () => {
    const fragmentPath = join(graphqlPath, 'accountFields.graphql');
    const operationPath = join(graphqlPath, 'getAccounts.graphql');

    writeFileSync(
      fragmentPath,
      `
        fragment AccountFields on Account {
          Id
          Name
        }
      `
    );

    writeFileSync(
      operationPath,
      `
        query GetAccounts {
          Account {
            edges {
              node {
                ...AccountFields
              }
            }
          }
        }
      `
    );

    const result = await checkSchema(
      projectPath,
      [join(metadataRoot, 'uiBundles')],
      '67.0',
      'vscodeOrg'
    );

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-GRAPHQL-003',
          status: 'PASS',
          file: fragmentPath,
        }),
        expect.objectContaining({
          id: 'MF-GRAPHQL-003',
          status: 'PASS',
          file: operationPath,
        }),
      ])
    );

    expect(result.diagnostics.some((diagnostic) => diagnostic.status === 'FAIL')).toBe(
      false
    );
  });

  it('fails when GraphQL operation contains an unknown field', async () => {
    const operationPath = join(graphqlPath, 'getAccounts.graphql');

    writeFileSync(
      operationPath,
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

    const result = await checkSchema(
      projectPath,
      [join(metadataRoot, 'uiBundles')],
      '67.0',
      'vscodeOrg'
    );

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-GRAPHQL-004',
          status: 'FAIL',
          file: operationPath,
          line: 3,
        }),
      ])
    );
  });

  it('fails when a GraphQL file contains invalid syntax', async () => {
    const operationPath = join(graphqlPath, 'broken.graphql');

    writeFileSync(operationPath, 'query Broken { Account {');

    const result = await checkSchema(
      projectPath,
      [join(metadataRoot, 'uiBundles')],
      '67.0',
      'vscodeOrg'
    );

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        id: 'MF-GRAPHQL-005',
        status: 'FAIL',
        file: operationPath,
        line: 1,
      }),
    ]);
  });

  it('returns a blocking UNKNOWN when a GraphQL file cannot be read', async () => {
    const operationPath = join(graphqlPath, 'getAccounts.graphql');
    const accessError = Object.assign(new Error('EACCES: permission denied'), {
      code: 'EACCES',
    });

    writeFileSync(
      operationPath,
      'query GetAccounts { Account { edges { node { Id } } } }'
    );
    vi.mocked(readFileSync).mockImplementationOnce(() => {
      throw accessError;
    });

    const result = await checkSchema(
      projectPath,
      [join(metadataRoot, 'uiBundles')],
      '67.0',
      'vscodeOrg'
    );

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        id: 'MF-GRAPHQL-005',
        status: 'UNKNOWN',
        blocksReadiness: true,
        problem: 'EACCES: permission denied',
        file: operationPath,
      }),
    ]);
    expect(hasReadinessBlockers(result.diagnostics)).toBe(true);
  });

  it('excludes SDL-only files from live operation validation', async () => {
    writeFileSync(
      join(graphqlPath, 'local-schema.graphql'),
      `
        type LocalOnly {
          id: ID!
        }
      `
    );

    const result = await checkSchema(
      projectPath,
      [join(metadataRoot, 'uiBundles')],
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
    expect(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.id === 'MF-GRAPHQL-004' || diagnostic.id === 'MF-GRAPHQL-005'
      )
    ).toBe(false);
  });

  it('excludes generated, dependency, build, coverage, and fixture directories', async () => {
    const ignoredDirectories = [
      'node_modules',
      'dist',
      'build',
      'coverage',
      'fixtures',
      '__fixtures__',
      'test-fixtures',
      'generated',
      '__generated__',
    ];

    for (const directory of ignoredDirectories) {
      const ignoredPath = join(bundlePath, directory);
      mkdirSync(ignoredPath, { recursive: true });
      writeFileSync(
        join(ignoredPath, 'ignored.graphql'),
        'query Ignored { MissingField }'
      );
    }

    const result = await checkSchema(
      projectPath,
      [join(metadataRoot, 'uiBundles')],
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
    expect(result.diagnostics.some((diagnostic) => diagnostic.status === 'FAIL')).toBe(
      false
    );
  });

  it('validates only the source copy when a custom outputDir contains the same operation', async () => {
    const sourcePath = join(graphqlPath, 'getAccounts.graphql');
    const outputPath = join(bundlePath, 'release-output');
    const outputGraphqlPath = join(outputPath, 'getAccounts.graphql');
    const query = `query GetAccounts {
      Account { edges { node { Id } } }
    }`;

    mkdirSync(outputPath, { recursive: true });
    writeFileSync(
      join(bundlePath, 'ui-bundle.json'),
      JSON.stringify({ outputDir: 'release-output' })
    );
    writeFileSync(sourcePath, query);
    writeFileSync(outputGraphqlPath, query);

    const result = await checkSchema(
      projectPath,
      [join(metadataRoot, 'uiBundles')],
      '67.0',
      'vscodeOrg'
    );

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        id: 'MF-GRAPHQL-003',
        status: 'PASS',
        file: sourcePath,
      }),
    ]);
  });

  it('does not collect GraphQL files from a configured custom outputDir', async () => {
    const outputPath = join(bundlePath, 'release-output');

    mkdirSync(outputPath, { recursive: true });
    writeFileSync(
      join(bundlePath, 'ui-bundle.json'),
      JSON.stringify({ outputDir: 'release-output' })
    );
    writeFileSync(
      join(outputPath, 'generated.graphql'),
      'query Generated { MissingField }'
    );

    const result = await checkSchema(
      projectPath,
      [join(metadataRoot, 'uiBundles')],
      '67.0',
      'vscodeOrg'
    );

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        id: 'MF-GRAPHQL-002',
        status: 'PASS',
      }),
    ]);
  });

  it('still fails for invalid source GraphQL when a custom outputDir is configured', async () => {
    const operationPath = join(graphqlPath, 'getAccounts.graphql');
    const outputPath = join(bundlePath, 'release-output');

    mkdirSync(outputPath, { recursive: true });
    writeFileSync(
      join(bundlePath, 'ui-bundle.json'),
      JSON.stringify({ outputDir: 'release-output' })
    );
    writeFileSync(operationPath, 'query InvalidSource { MissingField }');
    writeFileSync(
      join(outputPath, 'generated.graphql'),
      'query Generated { MissingField }'
    );

    const result = await checkSchema(
      projectPath,
      [join(metadataRoot, 'uiBundles')],
      '67.0',
      'vscodeOrg'
    );

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-GRAPHQL-004',
          status: 'FAIL',
          file: operationPath,
        }),
      ])
    );
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.file === join(outputPath, 'generated.graphql')
      )
    ).toBe(false);
  });

  it('applies each bundle custom outputDir only to that bundle', async () => {
    const firstSourcePath = join(graphqlPath, 'first.graphql');
    const firstOutputPath = join(bundlePath, 'shared-output');
    const secondBundlePath = join(metadataRoot, 'uiBundles', 'SecondBundle');
    const secondSourcePath = join(secondBundlePath, 'shared-output', 'second.graphql');
    const secondOutputPath = join(secondBundlePath, 'second-output');

    mkdirSync(firstOutputPath, { recursive: true });
    mkdirSync(join(secondBundlePath, 'shared-output'), { recursive: true });
    mkdirSync(secondOutputPath, { recursive: true });

    writeFileSync(
      join(bundlePath, 'ui-bundle.json'),
      JSON.stringify({ outputDir: 'shared-output' })
    );
    writeFileSync(
      join(secondBundlePath, 'ui-bundle.json'),
      JSON.stringify({ outputDir: 'second-output' })
    );
    writeFileSync(
      firstSourcePath,
      'query FirstAccounts { Account { edges { node { Id } } } }'
    );
    writeFileSync(
      join(firstOutputPath, 'generated.graphql'),
      'query GeneratedFirst { MissingField }'
    );
    writeFileSync(
      secondSourcePath,
      'query SecondAccounts { Account { edges { node { Name } } } }'
    );
    writeFileSync(
      join(secondOutputPath, 'generated.graphql'),
      'query GeneratedSecond { MissingField }'
    );

    const result = await checkSchema(
      projectPath,
      [join(metadataRoot, 'uiBundles')],
      '67.0',
      'vscodeOrg'
    );

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-GRAPHQL-003',
          status: 'PASS',
          file: firstSourcePath,
        }),
        expect.objectContaining({
          id: 'MF-GRAPHQL-003',
          status: 'PASS',
          file: secondSourcePath,
        }),
      ])
    );
    expect(result.diagnostics.some((diagnostic) => diagnostic.status === 'FAIL')).toBe(
      false
    );
  });

  it('validates bundles independently when they use the same fragment name', async () => {
    const secondGraphqlPath = join(
      metadataRoot,
      'uiBundles',
      'SecondBundle',
      'src',
      'api'
    );
    mkdirSync(secondGraphqlPath, { recursive: true });

    writeFileSync(
      join(graphqlPath, 'accountFields.graphql'),
      'fragment SharedAccountFields on Account { Id }'
    );
    writeFileSync(
      join(graphqlPath, 'getAccounts.graphql'),
      `query FirstAccounts {
        Account { edges { node { ...SharedAccountFields } } }
      }`
    );
    writeFileSync(
      join(secondGraphqlPath, 'accountFields.graphql'),
      'fragment SharedAccountFields on Account { Name }'
    );
    writeFileSync(
      join(secondGraphqlPath, 'getAccounts.graphql'),
      `query SecondAccounts {
        Account { edges { node { ...SharedAccountFields } } }
      }`
    );

    const result = await checkSchema(
      projectPath,
      [join(metadataRoot, 'uiBundles')],
      '67.0',
      'vscodeOrg'
    );

    expect(
      result.diagnostics.filter((diagnostic) => diagnostic.status === 'PASS')
    ).toHaveLength(4);
    expect(result.diagnostics.some((diagnostic) => diagnostic.status === 'FAIL')).toBe(
      false
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

    await checkSchema(
      projectPath,
      [join(metadataRoot, 'uiBundles')],
      '67.0',
      'vscodeOrg',
      true
    );

    expect(mockedGetSalesforceSchema).toHaveBeenCalledWith(
      'vscodeOrg',
      '67.0',
      true,
      false
    );
  });

  it('forwards debug option to Salesforce schema loader', async () => {
    await checkSchema(
      projectPath,
      [join(metadataRoot, 'uiBundles')],
      '67.0',
      'vscodeOrg',
      false,
      true
    );

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
      [join(metadataRoot, 'uiBundles'), join(secondMetadataRoot, 'uiBundles')],
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
      [join(metadataRoot, 'uiBundles'), join(secondMetadataRoot, 'uiBundles')],
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
