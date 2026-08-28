import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkBundles } from './bundle.js';

describe('checkBundles', () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'mf-check-'));

    vi.spyOn(console, 'log').mockImplementation(() => {});

    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();

    rmSync(projectPath, {
      recursive: true,
      force: true,
    });
  });

  it('passes when a UI Bundle has a valid output directory', () => {
    const bundlePath = join(
      projectPath,
      'force-app',
      'main',
      'default',
      'uiBundles',
      'MfLab'
    );

    mkdirSync(join(bundlePath, 'dist'), {
      recursive: true,
    });

    writeFileSync(
      join(bundlePath, 'ui-bundle.json'),
      JSON.stringify({
        outputDir: 'dist',
      })
    );

    const result = checkBundles(projectPath);

    expect(result.hasError).toBe(false);

    expect(result.bundles).toEqual(['MfLab']);
  });

  it('fails when the configured output directory does not exist', () => {
    const bundlePath = join(
      projectPath,
      'force-app',
      'main',
      'default',
      'uiBundles',
      'MfLab'
    );

    mkdirSync(bundlePath, {
      recursive: true,
    });

    writeFileSync(
      join(bundlePath, 'ui-bundle.json'),
      JSON.stringify({
        outputDir: 'dist',
      })
    );

    const result = checkBundles(projectPath);

    expect(result.hasError).toBe(true);
  });

  it('fails when ui-bundle.json contains invalid JSON', () => {
    const bundlePath = join(
      projectPath,
      'force-app',
      'main',
      'default',
      'uiBundles',
      'MfLab'
    );

    mkdirSync(bundlePath, {
      recursive: true,
    });

    writeFileSync(join(bundlePath, 'ui-bundle.json'), '{ invalid json');

    const result = checkBundles(projectPath);

    expect(result.hasError).toBe(true);
  });
});
