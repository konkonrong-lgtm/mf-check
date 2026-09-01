import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hasReadinessBlockers } from '../diagnostics/result.js';
import { checkBundles } from './bundle.js';

function createValidBundle(
  bundlePath: string,
  bundleName = 'MfLab',
  target = 'CustomApplication'
): void {
  mkdirSync(join(bundlePath, 'dist'), {
    recursive: true,
  });

  writeFileSync(
    join(bundlePath, `${bundleName}.uibundle-meta.xml`),
    `<?xml version="1.0" encoding="UTF-8"?>
    <UIBundle xmlns="http://soap.sforce.com/2006/04/metadata">
      <masterLabel>${bundleName}</masterLabel>
      <target>${target}</target>
    </UIBundle>`
  );

  writeFileSync(
    join(bundlePath, 'ui-bundle.json'),
    JSON.stringify({
      outputDir: 'dist',
    })
  );

  writeFileSync(join(bundlePath, 'dist', 'index.html'), '<div id="root"></div>');
}

function createNestedContent(outputPath: string, directoryDepth: number): void {
  let contentPath = outputPath;

  for (let depth = 0; depth < directoryDepth; depth += 1) {
    contentPath = join(contentPath, `level-${depth + 1}`);
    mkdirSync(contentPath);
  }

  writeFileSync(join(contentPath, 'index.html'), '<div id="root"></div>');
}

describe('checkBundles', () => {
  let projectPath: string;
  let metadataRoot: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'mf-check-'));

    metadataRoot = join(projectPath, 'src', 'main', 'default');

    mkdirSync(metadataRoot, {
      recursive: true,
    });
  });

  afterEach(() => {
    rmSync(projectPath, {
      recursive: true,
      force: true,
    });
  });

  it('passes when a UI Bundle has valid metadata and deployable output', () => {
    const bundlePath = join(metadataRoot, 'uiBundles', 'MfLab');

    createValidBundle(bundlePath);

    const result = checkBundles([join(metadataRoot, 'uiBundles')]);

    expect(result.bundles).toEqual([
      expect.objectContaining({
        name: 'MfLab',
        target: 'CustomApplication',
      }),
    ]);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-META-006',
          status: 'PASS',
        }),
        expect.objectContaining({
          id: 'MF-META-015',
          status: 'PASS',
        }),
      ])
    );

    expect(result.diagnostics.some((diagnostic) => diagnostic.status === 'FAIL')).toBe(
      false
    );
  });

  it('preserves the Experience target from UI Bundle metadata', () => {
    const bundlePath = join(metadataRoot, 'uiBundles', 'MfLab');

    createValidBundle(bundlePath, 'MfLab', 'Experience');

    const result = checkBundles([join(metadataRoot, 'uiBundles')]);

    expect(result.bundles).toEqual([
      expect.objectContaining({
        name: 'MfLab',
        target: 'Experience',
      }),
    ]);
  });

  it('defaults an omitted UI Bundle target to CustomApplication', () => {
    const bundlePath = join(metadataRoot, 'uiBundles', 'MfLab');

    createValidBundle(bundlePath);

    writeFileSync(
      join(bundlePath, 'MfLab.uibundle-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
    <UIBundle xmlns="http://soap.sforce.com/2006/04/metadata">
      <masterLabel>MfLab</masterLabel>
    </UIBundle>`
    );

    const result = checkBundles([join(metadataRoot, 'uiBundles')]);

    expect(result.bundles).toEqual([
      expect.objectContaining({
        name: 'MfLab',
        target: 'CustomApplication',
      }),
    ]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-META-015',
          status: 'PASS',
        }),
      ])
    );
    expect(result.diagnostics.some((diagnostic) => diagnostic.status === 'FAIL')).toBe(
      false
    );
  });

  it('does not infer a target when UI Bundle metadata cannot be parsed', () => {
    const bundlePath = join(metadataRoot, 'uiBundles', 'MfLab');

    createValidBundle(bundlePath);

    writeFileSync(join(bundlePath, 'MfLab.uibundle-meta.xml'), '<UIBundle><target>');

    const result = checkBundles([join(metadataRoot, 'uiBundles')]);

    expect(result.bundles).toHaveLength(1);
    expect(result.bundles[0]).toEqual(
      expect.objectContaining({
        name: 'MfLab',
      })
    );
    expect(result.bundles[0]).not.toHaveProperty('target');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-META-013',
          status: 'FAIL',
        }),
      ])
    );
    expect(result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-META-015')).toBe(
      false
    );
  });

  it.each([
    {
      description: 'an empty UIBundle root',
      metadata: '<UIBundle/>',
    },
    {
      description: 'an empty target',
      metadata: '<UIBundle><target/></UIBundle>',
    },
    {
      description: 'multiple targets',
      metadata:
        '<UIBundle><target>CustomApplication</target><target>Experience</target></UIBundle>',
    },
    {
      description: 'an unsupported target',
      metadata: '<UIBundle><target>Typo</target></UIBundle>',
    },
  ])('fails without inferring a target for $description', ({ metadata }) => {
    const bundlePath = join(metadataRoot, 'uiBundles', 'MfLab');

    createValidBundle(bundlePath);
    writeFileSync(join(bundlePath, 'MfLab.uibundle-meta.xml'), metadata);

    const result = checkBundles([join(metadataRoot, 'uiBundles')]);

    expect(result.bundles).toHaveLength(1);
    expect(result.bundles[0]).not.toHaveProperty('target');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-META-014',
          status: 'FAIL',
        }),
      ])
    );
    expect(result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-META-015')).toBe(
      false
    );
  });

  it.each(['.', '..', '../../shared', String.raw`build\client`])(
    'fails when outputDir uses an SDR-invalid path: %s',
    (outputDir) => {
      const bundlePath = join(metadataRoot, 'uiBundles', 'MfLab');
      const sharedPath = join(metadataRoot, 'shared');

      createValidBundle(bundlePath);
      mkdirSync(sharedPath, { recursive: true });
      writeFileSync(join(sharedPath, 'index.html'), '<div id="root"></div>');
      writeFileSync(join(bundlePath, 'ui-bundle.json'), JSON.stringify({ outputDir }));

      const result = checkBundles([join(metadataRoot, 'uiBundles')]);

      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'MF-META-003',
            status: 'FAIL',
          }),
        ])
      );
    }
  );

  it('passes when outputDir is a nested bundle-relative path', () => {
    const bundlePath = join(metadataRoot, 'uiBundles', 'MfLab');
    const outputPath = join(bundlePath, 'build', 'client');

    createValidBundle(bundlePath);
    mkdirSync(outputPath, { recursive: true });
    writeFileSync(join(outputPath, 'index.html'), '<div id="root"></div>');
    writeFileSync(
      join(bundlePath, 'ui-bundle.json'),
      JSON.stringify({ outputDir: 'build/client' })
    );

    const result = checkBundles([join(metadataRoot, 'uiBundles')]);

    expect(result.diagnostics.some((diagnostic) => diagnostic.status === 'FAIL')).toBe(
      false
    );
  });

  it('matches SDR by treating a leading forward slash as bundle-relative', () => {
    const bundlePath = join(metadataRoot, 'uiBundles', 'MfLab');

    createValidBundle(bundlePath);
    writeFileSync(
      join(bundlePath, 'ui-bundle.json'),
      JSON.stringify({ outputDir: '/dist' })
    );

    const result = checkBundles([join(metadataRoot, 'uiBundles')]);

    expect(result.diagnostics.some((diagnostic) => diagnostic.status === 'FAIL')).toBe(
      false
    );
  });

  it('fails when UIBundle metadata is missing', () => {
    const bundlePath = join(metadataRoot, 'uiBundles', 'MfLab');

    createValidBundle(bundlePath);
    rmSync(join(bundlePath, 'MfLab.uibundle-meta.xml'));

    const result = checkBundles([join(metadataRoot, 'uiBundles')]);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-META-012',
          status: 'FAIL',
        }),
      ])
    );
  });

  it('fails when UIBundle metadata contains invalid XML', () => {
    const bundlePath = join(metadataRoot, 'uiBundles', 'MfLab');

    createValidBundle(bundlePath);
    writeFileSync(
      join(bundlePath, 'MfLab.uibundle-meta.xml'),
      '<UIBundle><target>CustomApplication</target>'
    );

    const result = checkBundles([join(metadataRoot, 'uiBundles')]);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-META-013',
          status: 'FAIL',
        }),
      ])
    );
  });

  it('fails when UIBundle metadata has a different root element', () => {
    const bundlePath = join(metadataRoot, 'uiBundles', 'MfLab');

    createValidBundle(bundlePath);
    writeFileSync(
      join(bundlePath, 'MfLab.uibundle-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
      <CustomApplication xmlns="http://soap.sforce.com/2006/04/metadata">
        <uiType>Lightning</uiType>
      </CustomApplication>`
    );

    const result = checkBundles([join(metadataRoot, 'uiBundles')]);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-META-014',
          status: 'FAIL',
        }),
      ])
    );
  });

  it('fails when UIBundle metadata uses the deprecated AppLauncher target', () => {
    const bundlePath = join(metadataRoot, 'uiBundles', 'MfLab');

    createValidBundle(bundlePath);
    writeFileSync(
      join(bundlePath, 'MfLab.uibundle-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
      <UIBundle xmlns="http://soap.sforce.com/2006/04/metadata">
        <masterLabel>MfLab</masterLabel>
        <target>AppLauncher</target>
      </UIBundle>`
    );

    const result = checkBundles([join(metadataRoot, 'uiBundles')]);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-META-017',
          status: 'FAIL',
        }),
      ])
    );
  });

  it('fails when the configured output directory does not exist', () => {
    const bundlePath = join(metadataRoot, 'uiBundles', 'MfLab');

    createValidBundle(bundlePath);
    rmSync(join(bundlePath, 'dist'), {
      recursive: true,
    });

    const result = checkBundles([join(metadataRoot, 'uiBundles')]);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-META-005',
          status: 'FAIL',
        }),
      ])
    );
  });

  it('fails when the configured output path is a file', () => {
    const bundlePath = join(metadataRoot, 'uiBundles', 'MfLab');

    createValidBundle(bundlePath);
    rmSync(join(bundlePath, 'dist'), { recursive: true });
    writeFileSync(join(bundlePath, 'dist'), 'not a directory');

    const result = checkBundles([join(metadataRoot, 'uiBundles')]);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-META-005',
          status: 'FAIL',
        }),
      ])
    );
  });

  it('fails when the output directory contains no deployable content', () => {
    const bundlePath = join(metadataRoot, 'uiBundles', 'MfLab');

    createValidBundle(bundlePath);
    rmSync(join(bundlePath, 'dist', 'index.html'));

    const result = checkBundles([join(metadataRoot, 'uiBundles')]);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-META-016',
          status: 'FAIL',
        }),
      ])
    );
  });

  it('counts a file ending in -meta.xml as deployable content', () => {
    const bundlePath = join(metadataRoot, 'uiBundles', 'MfLab');
    const outputPath = join(bundlePath, 'dist');

    createValidBundle(bundlePath);
    rmSync(join(outputPath, 'index.html'));
    writeFileSync(join(outputPath, 'something-meta.xml'), '<content />');

    const result = checkBundles([join(metadataRoot, 'uiBundles')]);

    expect(result.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-META-016',
        }),
      ])
    );
  });

  it('counts a file named ui-bundle.json as deployable content', () => {
    const bundlePath = join(metadataRoot, 'uiBundles', 'MfLab');
    const outputPath = join(bundlePath, 'dist');

    createValidBundle(bundlePath);
    rmSync(join(outputPath, 'index.html'));
    writeFileSync(join(outputPath, 'ui-bundle.json'), '{}');

    const result = checkBundles([join(metadataRoot, 'uiBundles')]);

    expect(result.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-META-016',
        }),
      ])
    );
  });

  it('follows a symbolic link to deployable content', () => {
    const bundlePath = join(metadataRoot, 'uiBundles', 'MfLab');
    const outputPath = join(bundlePath, 'dist');
    const linkedContentPath = join(projectPath, 'linked-content');

    createValidBundle(bundlePath);
    rmSync(join(outputPath, 'index.html'));
    mkdirSync(linkedContentPath);
    writeFileSync(join(linkedContentPath, 'index.html'), '<div id="root"></div>');
    symlinkSync(
      linkedContentPath,
      join(outputPath, 'linked-content'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    const result = checkBundles([join(metadataRoot, 'uiBundles')]);

    expect(result.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-META-016',
        }),
      ])
    );
  });

  it('finds deployable content within the SDR recursion depth limit', () => {
    const bundlePath = join(metadataRoot, 'uiBundles', 'MfLab');
    const outputPath = join(bundlePath, 'dist');

    createValidBundle(bundlePath);
    rmSync(join(outputPath, 'index.html'));
    createNestedContent(outputPath, 19);

    const result = checkBundles([join(metadataRoot, 'uiBundles')]);

    expect(result.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-META-016',
        }),
      ])
    );
  });

  it('does not inspect deployable content at SDR recursion depth 20', () => {
    const bundlePath = join(metadataRoot, 'uiBundles', 'MfLab');
    const outputPath = join(bundlePath, 'dist');

    createValidBundle(bundlePath);
    rmSync(join(outputPath, 'index.html'));
    createNestedContent(outputPath, 20);

    const result = checkBundles([join(metadataRoot, 'uiBundles')]);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-META-016',
          status: 'FAIL',
        }),
      ])
    );
  });

  it('fails when ui-bundle.json contains invalid JSON', () => {
    const bundlePath = join(metadataRoot, 'uiBundles', 'MfLab');

    createValidBundle(bundlePath);
    writeFileSync(join(bundlePath, 'ui-bundle.json'), '{ invalid json');

    const result = checkBundles([join(metadataRoot, 'uiBundles')]);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-META-002',
          status: 'FAIL',
        }),
      ])
    );
    expect(result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-META-018')).toBe(
      false
    );
  });

  it('returns a blocking UNKNOWN when ui-bundle.json cannot be read', () => {
    const bundlePath = join(metadataRoot, 'uiBundles', 'MfLab');
    const configPath = join(bundlePath, 'ui-bundle.json');

    createValidBundle(bundlePath);
    rmSync(configPath);
    mkdirSync(configPath);

    const result = checkBundles([join(metadataRoot, 'uiBundles')]);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-META-018',
          status: 'UNKNOWN',
          blocksReadiness: true,
          file: configPath,
        }),
      ])
    );
    expect(result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-META-002')).toBe(
      false
    );
  });

  it('finds UI Bundles across multiple metadata roots', () => {
    const secondMetadataRoot = join(projectPath, 'feature', 'main', 'default');

    mkdirSync(secondMetadataRoot, {
      recursive: true,
    });

    const bundlePath = join(secondMetadataRoot, 'uiBundles', 'MfLab');

    createValidBundle(bundlePath);

    const result = checkBundles([
      join(metadataRoot, 'uiBundles'),
      join(secondMetadataRoot, 'uiBundles'),
    ]);

    expect(result.bundles).toEqual([
      expect.objectContaining({
        name: 'MfLab',
        target: 'CustomApplication',
      }),
    ]);

    expect(result.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-PROJECT-001',
          status: 'FAIL',
        }),
      ])
    );
  });

  it('fails when no metadata root contains uiBundles', () => {
    const secondMetadataRoot = join(projectPath, 'feature', 'main', 'default');

    mkdirSync(secondMetadataRoot, {
      recursive: true,
    });

    const result = checkBundles([
      join(metadataRoot, 'uiBundles'),
      join(secondMetadataRoot, 'uiBundles'),
    ]);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-PROJECT-001',
          status: 'FAIL',
        }),
      ])
    );
  });

  it('does not crash when uiBundles path is not a directory', () => {
    const invalidUiBundlesPath = join(projectPath, 'uiBundles');

    writeFileSync(invalidUiBundlesPath, 'not a directory');

    const result = checkBundles([invalidUiBundlesPath]);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-PROJECT-012',
          status: 'FAIL',
          file: invalidUiBundlesPath,
          problem: expect.stringContaining('ENOTDIR'),
        }),
      ])
    );
  });

  it('blocks readiness for an unreadable uiBundles root while continuing another root', () => {
    const invalidUiBundlesPath = join(projectPath, 'invalid-uiBundles');
    const validUiBundlesPath = join(metadataRoot, 'uiBundles');

    writeFileSync(invalidUiBundlesPath, 'not a directory');
    createValidBundle(join(validUiBundlesPath, 'MfLab'));

    const result = checkBundles([invalidUiBundlesPath, validUiBundlesPath]);

    expect(result.bundles).toEqual([
      expect.objectContaining({
        name: 'MfLab',
        target: 'CustomApplication',
      }),
    ]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-PROJECT-012',
          status: 'FAIL',
          file: invalidUiBundlesPath,
        }),
        expect.objectContaining({
          id: 'MF-META-015',
          status: 'PASS',
        }),
      ])
    );
    expect(hasReadinessBlockers(result.diagnostics)).toBe(true);
  });
});
