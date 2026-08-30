import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkBundles } from './bundle.js';

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

  it('passes when a UI Bundle has a valid output directory', () => {
    const bundlePath = join(metadataRoot, 'uiBundles', 'MfLab');

    mkdirSync(join(bundlePath, 'dist'), {
      recursive: true,
    });

    writeFileSync(
      join(bundlePath, 'ui-bundle.json'),
      JSON.stringify({
        outputDir: 'dist',
      })
    );

    const result = checkBundles([metadataRoot]);

    expect(result.bundles).toEqual(['MfLab']);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-META-006',
          status: 'PASS',
        }),
      ])
    );
  });

  it('fails when the configured output directory does not exist', () => {
    const bundlePath = join(metadataRoot, 'uiBundles', 'MfLab');

    mkdirSync(bundlePath, {
      recursive: true,
    });

    writeFileSync(
      join(bundlePath, 'ui-bundle.json'),
      JSON.stringify({
        outputDir: 'dist',
      })
    );

    const result = checkBundles([metadataRoot]);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-META-005',
          status: 'FAIL',
        }),
      ])
    );
  });

  it('fails when ui-bundle.json contains invalid JSON', () => {
    const bundlePath = join(metadataRoot, 'uiBundles', 'MfLab');

    mkdirSync(bundlePath, {
      recursive: true,
    });

    writeFileSync(join(bundlePath, 'ui-bundle.json'), '{ invalid json');

    const result = checkBundles([metadataRoot]);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-META-002',
          status: 'FAIL',
        }),
      ])
    );
  });

  it('finds UI Bundles across multiple metadata roots', () => {
    const secondMetadataRoot = join(projectPath, 'feature', 'main', 'default');

    mkdirSync(secondMetadataRoot, {
      recursive: true,
    });

    const bundlePath = join(secondMetadataRoot, 'uiBundles', 'MfLab');

    mkdirSync(join(bundlePath, 'dist'), {
      recursive: true,
    });

    writeFileSync(
      join(bundlePath, 'ui-bundle.json'),
      JSON.stringify({
        outputDir: 'dist',
      })
    );

    const result = checkBundles([metadataRoot, secondMetadataRoot]);

    expect(result.bundles).toEqual(['MfLab']);

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

    const result = checkBundles([metadataRoot, secondMetadataRoot]);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-PROJECT-001',
          status: 'FAIL',
        }),
      ])
    );
  });
});
