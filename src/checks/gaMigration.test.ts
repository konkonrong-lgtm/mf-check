import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkGaMigration } from './gaMigration.js';

describe('checkGaMigration', () => {
  let projectPath: string;
  let uiBundlesPath: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'mf-check-'));
    uiBundlesPath = join(projectPath, 'uiBundles');

    mkdirSync(uiBundlesPath, {
      recursive: true,
    });
  });

  afterEach(() => {
    rmSync(projectPath, {
      recursive: true,
      force: true,
    });
  });

  it('detects deprecated @salesforce/sdk-data dependency', () => {
    const bundlePath = join(uiBundlesPath, 'TestBundle');

    mkdirSync(bundlePath, {
      recursive: true,
    });

    writeFileSync(
      join(bundlePath, 'package.json'),
      JSON.stringify({
        dependencies: {
          '@salesforce/sdk-data': '^1.0.0',
        },
      })
    );

    const result = checkGaMigration(projectPath, [uiBundlesPath]);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-MIGRATION-001',
          status: 'FAIL',
        }),
      ])
    );
  });

  it('does not flag @salesforce/platform-sdk dependency', () => {
    const bundlePath = join(uiBundlesPath, 'TestBundle');

    mkdirSync(bundlePath, {
      recursive: true,
    });

    writeFileSync(
      join(bundlePath, 'package.json'),
      JSON.stringify({
        dependencies: {
          '@salesforce/platform-sdk': '^10.24.0',
        },
      })
    );

    const result = checkGaMigration(projectPath, [uiBundlesPath]);

    expect(
      result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-MIGRATION-001')
    ).toBe(false);
  });

  it('detects deprecated UIBundleSettings scratch configuration', () => {
    const configPath = join(projectPath, 'config');

    mkdirSync(configPath, {
      recursive: true,
    });

    writeFileSync(
      join(configPath, 'project-scratch-def.json'),
      JSON.stringify({
        settings: {
          UIBundleSettings: {
            webAppOptIn: true,
          },
        },
      })
    );

    const result = checkGaMigration(projectPath, [uiBundlesPath]);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-MIGRATION-002',
          status: 'FAIL',
        }),
      ])
    );
  });

  it('does not flag scratch configuration without UIBundleSettings', () => {
    const configPath = join(projectPath, 'config');

    mkdirSync(configPath, {
      recursive: true,
    });

    writeFileSync(
      join(configPath, 'project-scratch-def.json'),
      JSON.stringify({
        settings: {
          lightningExperienceSettings: {
            enableS1DesktopEnabled: true,
          },
        },
      })
    );

    const result = checkGaMigration(projectPath, [uiBundlesPath]);

    expect(
      result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-MIGRATION-002')
    ).toBe(false);
  });

  it('detects Beta Data SDK graphql() calls', () => {
    const bundlePath = join(uiBundlesPath, 'TestBundle');
    const sourcePath = join(bundlePath, 'src');

    mkdirSync(sourcePath, {
      recursive: true,
    });

    const sourceFile = join(sourcePath, 'accounts.ts');

    writeFileSync(
      sourceFile,
      `
      import { createDataSDK } from '@salesforce/sdk-data';

      export async function getAccounts() {
        const sdk = await createDataSDK();
        const result = await sdk.graphql({ query: QUERY });

        return result;
      }
      `
    );

    const result = checkGaMigration(projectPath, [uiBundlesPath]);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-MIGRATION-003',
          status: 'FAIL',
          file: sourceFile,
        }),
      ])
    );
  });

  it('does not confuse SDK variables with the same name in different scopes', () => {
    const bundlePath = join(uiBundlesPath, 'TestBundle');
    const sourcePath = join(bundlePath, 'src');

    mkdirSync(sourcePath, {
      recursive: true,
    });

    writeFileSync(
      join(sourcePath, 'accounts.ts'),
      `
      import { createDataSDK } from '@salesforce/sdk-data';

      export async function createSalesforceSdk() {
        const sdk = await createDataSDK();
        return sdk;
      }

      export function useAnotherSdk() {
        const sdk = createOtherSdk();
        return sdk.graphql();
      }
      `
    );

    const result = checkGaMigration(projectPath, [uiBundlesPath]);

    expect(
      result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-MIGRATION-003')
    ).toBe(false);
  });

  it('detects legacy graphql() when createDataSDK is imported with an alias', () => {
    const bundlePath = join(uiBundlesPath, 'TestBundle');
    const sourcePath = join(bundlePath, 'src');

    mkdirSync(sourcePath, {
      recursive: true,
    });

    writeFileSync(
      join(sourcePath, 'accounts.ts'),
      `
      import { createDataSDK as makeSdk } from '@salesforce/sdk-data';

      export async function getAccounts() {
        const client = await makeSdk();
        return client.graphql({ query: QUERY });
      }
      `
    );

    const result = checkGaMigration(projectPath, [uiBundlesPath]);

    expect(
      result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-MIGRATION-003')
    ).toBe(true);
  });

  it('detects optional legacy graphql() calls', () => {
    const bundlePath = join(uiBundlesPath, 'TestBundle');
    const sourcePath = join(bundlePath, 'src');

    mkdirSync(sourcePath, {
      recursive: true,
    });

    writeFileSync(
      join(sourcePath, 'accounts.ts'),
      `
      import { createDataSDK } from '@salesforce/sdk-data';

      export async function getAccounts() {
        const sdk = await createDataSDK();
        return sdk.graphql?.({ query: QUERY });
      }
      `
    );

    const result = checkGaMigration(projectPath, [uiBundlesPath]);

    expect(
      result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-MIGRATION-003')
    ).toBe(true);
  });

  it('does not flag graphql() after the Data SDK variable is reassigned', () => {
    const bundlePath = join(uiBundlesPath, 'TestBundle');
    const sourcePath = join(bundlePath, 'src');

    mkdirSync(sourcePath, {
      recursive: true,
    });

    writeFileSync(
      join(sourcePath, 'accounts.ts'),
      `
import { createDataSDK } from '@salesforce/sdk-data';

export async function getAccounts() {
  let sdk = await createDataSDK();
  sdk = createOtherSdk();

  return sdk.graphql();
}
`
    );

    const result = checkGaMigration(projectPath, [uiBundlesPath]);

    expect(
      result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-MIGRATION-003')
    ).toBe(false);
  });

  it('detects deprecated @salesforce/sdk-data dependency in JSON with BOM', () => {
    const bundlePath = join(uiBundlesPath, 'TestBundle');

    mkdirSync(bundlePath, {
      recursive: true,
    });

    writeFileSync(
      join(bundlePath, 'package.json'),
      '\uFEFF' +
        JSON.stringify({
          dependencies: {
            '@salesforce/sdk-data': '^1.0.0',
          },
        })
    );

    const result = checkGaMigration(projectPath, [uiBundlesPath]);

    expect(
      result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-MIGRATION-001')
    ).toBe(true);
  });

  it('detects deprecated UIBundleSettings in JSON with BOM', () => {
    const configPath = join(projectPath, 'config');

    mkdirSync(configPath, {
      recursive: true,
    });

    writeFileSync(
      join(configPath, 'project-scratch-def.json'),
      '\uFEFF' +
        JSON.stringify({
          settings: {
            UIBundleSettings: {
              enableLwcPreviewPref: true,
            },
          },
        })
    );

    const result = checkGaMigration(projectPath, [uiBundlesPath]);

    expect(
      result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-MIGRATION-002')
    ).toBe(true);
  });

  it('detects legacy graphql() through a TypeScript type assertion', () => {
    const bundlePath = join(uiBundlesPath, 'TestBundle');
    const sourcePath = join(bundlePath, 'src');

    mkdirSync(sourcePath, {
      recursive: true,
    });

    writeFileSync(
      join(sourcePath, 'accounts.ts'),
      `
import { createDataSDK } from '@salesforce/sdk-data';

export async function getAccounts() {
  const sdk = (await createDataSDK()) as DataSDK;
  return sdk.graphql({ query: QUERY });
}
`
    );

    const result = checkGaMigration(projectPath, [uiBundlesPath]);

    expect(
      result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-MIGRATION-003')
    ).toBe(true);
  });

  it('ignores legacy graphql() calls inside fixture directories', () => {
    const bundlePath = join(uiBundlesPath, 'TestBundle');
    const fixturePath = join(bundlePath, 'src', 'fixture');

    mkdirSync(fixturePath, {
      recursive: true,
    });

    writeFileSync(
      join(fixturePath, 'legacy.ts'),
      `
import { createDataSDK } from '@salesforce/sdk-data';

export async function getAccounts() {
  const sdk = await createDataSDK();
  return sdk.graphql({ query: QUERY });
}
`
    );

    const result = checkGaMigration(projectPath, [uiBundlesPath]);

    expect(
      result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-MIGRATION-003')
    ).toBe(false);
  });

  it('ignores legacy graphql() calls inside a custom outputDir', () => {
    const bundlePath = join(uiBundlesPath, 'TestBundle');
    const outputPath = join(bundlePath, 'src', 'release-output');

    mkdirSync(outputPath, {
      recursive: true,
    });

    writeFileSync(
      join(bundlePath, 'ui-bundle.json'),
      JSON.stringify({
        outputDir: 'src/release-output',
      })
    );

    writeFileSync(
      join(outputPath, 'legacy.ts'),
      `
import { createDataSDK } from '@salesforce/sdk-data';

export async function getAccounts() {
  const sdk = await createDataSDK();
  return sdk.graphql({ query: QUERY });
}
`
    );

    const result = checkGaMigration(projectPath, [uiBundlesPath]);

    expect(
      result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-MIGRATION-003')
    ).toBe(false);
  });

  it('ignores legacy graphql() calls inside a leading-slash custom outputDir', () => {
    const bundlePath = join(uiBundlesPath, 'TestBundle');
    const outputPath = join(bundlePath, 'src', 'release-output');

    mkdirSync(outputPath, {
      recursive: true,
    });

    writeFileSync(
      join(bundlePath, 'ui-bundle.json'),
      JSON.stringify({
        outputDir: '/src/release-output',
      })
    );

    writeFileSync(
      join(outputPath, 'legacy.ts'),
      `
import { createDataSDK } from '@salesforce/sdk-data';

export async function getAccounts() {
  const sdk = await createDataSDK();
  return sdk.graphql({ query: QUERY });
}
`
    );

    const result = checkGaMigration(projectPath, [uiBundlesPath]);

    expect(
      result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-MIGRATION-003')
    ).toBe(false);
  });

  it.each(['src', '/src'])(
    'reports UNKNOWN instead of scanning generated output when outputDir is %s',
    (outputDir) => {
      const bundlePath = join(uiBundlesPath, 'TestBundle');
      const sourcePath = join(bundlePath, 'src');
      const uiBundleJsonPath = join(bundlePath, 'ui-bundle.json');

      mkdirSync(sourcePath, { recursive: true });
      writeFileSync(uiBundleJsonPath, JSON.stringify({ outputDir }));
      writeFileSync(
        join(sourcePath, 'generated.js'),
        `
        const { createDataSDK } = require('@salesforce/sdk-data');
        const sdk = createDataSDK();
        sdk.graphql({ query: QUERY });
        `
      );

      const result = checkGaMigration(projectPath, [uiBundlesPath]);

      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'MF-MIGRATION-007',
            status: 'UNKNOWN',
            blocksReadiness: false,
            file: uiBundleJsonPath,
          }),
        ])
      );
      expect(
        result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-MIGRATION-003')
      ).toBe(false);
    }
  );

  it('does not crash when bundle package.json is unreadable', () => {
    const bundlePath = join(uiBundlesPath, 'TestBundle');
    const sourcePath = join(bundlePath, 'src');

    mkdirSync(sourcePath, {
      recursive: true,
    });

    mkdirSync(join(bundlePath, 'package.json'));

    writeFileSync(
      join(sourcePath, 'accounts.ts'),
      `
import { createDataSDK } from '@salesforce/sdk-data';

export async function getAccounts() {
  const sdk = await createDataSDK();
  return sdk.graphql({ query: QUERY });
}
`
    );

    const result = checkGaMigration(projectPath, [uiBundlesPath]);

    expect(
      result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-MIGRATION-003')
    ).toBe(true);
  });

  it('does not crash when project-scratch-def.json is unreadable', () => {
    const configPath = join(projectPath, 'config');

    mkdirSync(configPath, {
      recursive: true,
    });

    mkdirSync(join(configPath, 'project-scratch-def.json'));

    const bundlePath = join(uiBundlesPath, 'TestBundle');
    const sourcePath = join(bundlePath, 'src');

    mkdirSync(sourcePath, {
      recursive: true,
    });

    writeFileSync(
      join(sourcePath, 'accounts.ts'),
      `
import { createDataSDK } from '@salesforce/sdk-data';

export async function getAccounts() {
  const sdk = await createDataSDK();
  return sdk.graphql({ query: QUERY });
}
`
    );

    const result = checkGaMigration(projectPath, [uiBundlesPath]);

    expect(
      result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-MIGRATION-003')
    ).toBe(true);
  });

  it('reports UNKNOWN and continues when a uiBundles path cannot be enumerated', () => {
    const invalidUiBundlesPath = join(projectPath, 'invalid-uiBundles');
    const bundleSourcePath = join(uiBundlesPath, 'TestBundle', 'src');

    writeFileSync(invalidUiBundlesPath, 'not a directory');
    mkdirSync(bundleSourcePath, { recursive: true });
    writeFileSync(
      join(bundleSourcePath, 'legacy.ts'),
      `
      import { createDataSDK } from '@salesforce/sdk-data';
      const sdk = createDataSDK();
      sdk.graphql({ query: QUERY });
      `
    );

    const result = checkGaMigration(projectPath, [invalidUiBundlesPath, uiBundlesPath]);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-MIGRATION-008',
          status: 'UNKNOWN',
          blocksReadiness: false,
          file: invalidUiBundlesPath,
        }),
        expect.objectContaining({
          id: 'MF-MIGRATION-003',
          status: 'FAIL',
          file: join(bundleSourcePath, 'legacy.ts'),
        }),
      ])
    );
  });

  it('does not crash when a bundle source path cannot be enumerated', () => {
    const bundlePath = join(uiBundlesPath, 'TestBundle');

    mkdirSync(bundlePath, {
      recursive: true,
    });

    writeFileSync(join(bundlePath, 'src'), 'not a directory');

    const result = checkGaMigration(projectPath, [uiBundlesPath]);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-MIGRATION-007',
          category: 'migration',
          status: 'UNKNOWN',
          file: join(bundlePath, 'src'),
        }),
      ])
    );
  });

  it('returns migration diagnostics in deterministic bundle and source order', () => {
    const zBundlePath = join(uiBundlesPath, 'ZBundle', 'src');
    const aBundlePath = join(uiBundlesPath, 'ABundle', 'src');

    mkdirSync(zBundlePath, { recursive: true });
    mkdirSync(aBundlePath, { recursive: true });

    const legacySource = `
    import { createDataSDK } from '@salesforce/sdk-data';

    export async function run() {
      const sdk = await createDataSDK();
      return sdk.graphql({ query: QUERY });
    }
    `;

    writeFileSync(join(zBundlePath, 'z.ts'), legacySource);
    writeFileSync(join(zBundlePath, 'a.ts'), legacySource);
    writeFileSync(join(aBundlePath, 'c.ts'), legacySource);

    const result = checkGaMigration(projectPath, [uiBundlesPath]);

    const files = result.diagnostics
      .filter((diagnostic) => diagnostic.id === 'MF-MIGRATION-003')
      .map((diagnostic) => diagnostic.file);

    expect(files).toEqual([
      join(aBundlePath, 'c.ts'),
      join(zBundlePath, 'a.ts'),
      join(zBundlePath, 'z.ts'),
    ]);
  });

  it('detects legacy graphql() with computed property access', () => {
    const bundlePath = join(uiBundlesPath, 'TestBundle');
    const sourcePath = join(bundlePath, 'src');

    mkdirSync(sourcePath, {
      recursive: true,
    });

    writeFileSync(
      join(sourcePath, 'accounts.ts'),
      `
      import { createDataSDK } from '@salesforce/sdk-data';

      export async function getAccounts() {
        const sdk = await createDataSDK();
        return sdk['graphql']({ query: QUERY });
      }
      `
    );

    const result = checkGaMigration(projectPath, [uiBundlesPath]);

    expect(
      result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-MIGRATION-003')
    ).toBe(true);
  });

  it('detects legacy graphql() with a namespace Data SDK import', () => {
    const bundlePath = join(uiBundlesPath, 'TestBundle');
    const sourcePath = join(bundlePath, 'src');

    mkdirSync(sourcePath, {
      recursive: true,
    });

    writeFileSync(
      join(sourcePath, 'accounts.ts'),
      `
import * as dataSdk from '@salesforce/sdk-data';

export async function getAccounts() {
  const sdk = await dataSdk.createDataSDK();
  return sdk.graphql({ query: QUERY });
}
`
    );

    const result = checkGaMigration(projectPath, [uiBundlesPath]);

    expect(
      result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-MIGRATION-003')
    ).toBe(true);
  });

  it('detects legacy graphql() with CommonJS require', () => {
    const bundlePath = join(uiBundlesPath, 'TestBundle');
    const sourcePath = join(bundlePath, 'src');

    mkdirSync(sourcePath, {
      recursive: true,
    });

    writeFileSync(
      join(sourcePath, 'accounts.js'),
      `
const { createDataSDK } = require('@salesforce/sdk-data');

async function getAccounts() {
  const sdk = await createDataSDK();
  return sdk.graphql({ query: QUERY });
}
`
    );

    const result = checkGaMigration(projectPath, [uiBundlesPath]);

    expect(
      result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-MIGRATION-003')
    ).toBe(true);
  });

  it('does not flag CommonJS factory after createDataSDK is reassigned', () => {
    const bundlePath = join(uiBundlesPath, 'TestBundle');
    const sourcePath = join(bundlePath, 'src');

    mkdirSync(sourcePath, {
      recursive: true,
    });

    writeFileSync(
      join(sourcePath, 'accounts.js'),
      `
let { createDataSDK } = require('@salesforce/sdk-data');

createDataSDK = makeOtherFactory;

async function getAccounts() {
  const sdk = await createDataSDK();
  return sdk.graphql({ query: QUERY });
}
`
    );

    const result = checkGaMigration(projectPath, [uiBundlesPath]);

    expect(
      result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-MIGRATION-003')
    ).toBe(false);
  });

  it('reports UNKNOWN when bundle package.json cannot be inspected', () => {
    const bundlePath = join(uiBundlesPath, 'TestBundle');
    const packageJsonPath = join(bundlePath, 'package.json');

    mkdirSync(bundlePath, {
      recursive: true,
    });

    mkdirSync(packageJsonPath);

    const result = checkGaMigration(projectPath, [uiBundlesPath]);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-MIGRATION-004',
          category: 'migration',
          status: 'UNKNOWN',
          file: packageJsonPath,
        }),
      ])
    );
  });

  it('reports UNKNOWN when project-scratch-def.json cannot be inspected', () => {
    const configPath = join(projectPath, 'config');
    const scratchDefPath = join(configPath, 'project-scratch-def.json');

    mkdirSync(configPath, {
      recursive: true,
    });

    mkdirSync(scratchDefPath);

    const result = checkGaMigration(projectPath, [uiBundlesPath]);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-MIGRATION-005',
          category: 'migration',
          status: 'UNKNOWN',
          file: scratchDefPath,
        }),
      ])
    );
  });

  it('reports UNKNOWN and skips source migration scan when ui-bundle.json cannot be inspected', () => {
    const bundlePath = join(uiBundlesPath, 'TestBundle');
    const sourcePath = join(bundlePath, 'src');
    const uiBundleJsonPath = join(bundlePath, 'ui-bundle.json');

    mkdirSync(sourcePath, {
      recursive: true,
    });

    mkdirSync(uiBundleJsonPath);

    writeFileSync(
      join(sourcePath, 'legacy.ts'),
      `
import { createDataSDK } from '@salesforce/sdk-data';

export async function getAccounts() {
  const sdk = await createDataSDK();
  return sdk.graphql({ query: QUERY });
}
`
    );

    const result = checkGaMigration(projectPath, [uiBundlesPath]);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-MIGRATION-006',
          category: 'migration',
          status: 'UNKNOWN',
          file: uiBundleJsonPath,
        }),
      ])
    );

    expect(
      result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-MIGRATION-003')
    ).toBe(false);
  });

  it('reports UNKNOWN when a source file cannot be inspected', () => {
    const bundlePath = join(uiBundlesPath, 'TestBundle');
    const sourcePath = join(bundlePath, 'src');

    mkdirSync(sourcePath, {
      recursive: true,
    });

    writeFileSync(
      join(sourcePath, 'broken.ts'),
      `
export function broken( {
`
    );

    const result = checkGaMigration(projectPath, [uiBundlesPath]);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-MIGRATION-007',
          category: 'migration',
          status: 'UNKNOWN',
        }),
      ])
    );
  });

  it('reports UNKNOWN when bundle package.json is not a JSON object', () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'mf-check-'));
    const uiBundlesPath = join(projectPath, 'uiBundles');
    const bundlePath = join(uiBundlesPath, 'TestBundle');

    mkdirSync(bundlePath, { recursive: true });

    writeFileSync(join(bundlePath, 'package.json'), 'null', 'utf-8');

    const result = checkGaMigration(projectPath, [uiBundlesPath]);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-MIGRATION-004',
          category: 'migration',
          status: 'UNKNOWN',
          file: join(bundlePath, 'package.json'),
        }),
      ])
    );
  });

  it('reports UNKNOWN when project-scratch-def.json is not a JSON object', () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'mf-check-'));
    const uiBundlesPath = join(projectPath, 'uiBundles');
    const configPath = join(projectPath, 'config');

    mkdirSync(uiBundlesPath, { recursive: true });
    mkdirSync(configPath, { recursive: true });

    writeFileSync(join(configPath, 'project-scratch-def.json'), '[]', 'utf-8');

    const result = checkGaMigration(projectPath, [uiBundlesPath]);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-MIGRATION-005',
          category: 'migration',
          status: 'UNKNOWN',
          file: join(configPath, 'project-scratch-def.json'),
        }),
      ])
    );
  });

  it('reports UNKNOWN and skips source migration scan when outputDir is missing', () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'mf-check-'));
    const uiBundlesPath = join(projectPath, 'uiBundles');
    const bundlePath = join(uiBundlesPath, 'TestBundle');
    const sourcePath = join(bundlePath, 'src');

    mkdirSync(sourcePath, { recursive: true });

    writeFileSync(join(bundlePath, 'ui-bundle.json'), '{}', 'utf-8');

    writeFileSync(
      join(sourcePath, 'accounts.ts'),
      `
      import { createDataSDK } from '@salesforce/sdk-data';

      const sdk = createDataSDK();

      sdk.graphql({
        query: 'query Test { uiapi { query { Account { edges { node { Id } } } } } }',
      });
    `,
      'utf-8'
    );

    const result = checkGaMigration(projectPath, [uiBundlesPath]);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-MIGRATION-006',
          category: 'migration',
          status: 'UNKNOWN',
          file: join(bundlePath, 'ui-bundle.json'),
        }),
      ])
    );

    expect(
      result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-MIGRATION-003')
    ).toBe(false);
  });
});
