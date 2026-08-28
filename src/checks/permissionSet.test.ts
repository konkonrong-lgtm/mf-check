import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkPermissionSets } from './permissionSet.js';

describe('checkPermissionSets', () => {
  let projectPath: string;
  let permissionSetsPath: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'mf-check-'));

    permissionSetsPath = join(
      projectPath,
      'force-app',
      'main',
      'default',
      'permissionsets'
    );

    mkdirSync(permissionSetsPath, {
      recursive: true,
    });

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

  it('passes when application visibility is granted', () => {
    writeFileSync(
      join(permissionSetsPath, 'MfLab.permissionset-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
      <PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
      <applicationVisibilities>
      <application>MfLabReact</application>
      <visible>true</visible>
      </applicationVisibilities>
      </PermissionSet>`
    );

    const result = checkPermissionSets(projectPath, ['MfLabReact']);

    expect(result.hasError).toBe(false);
  });

  it('fails when application visibility is missing', () => {
    writeFileSync(
      join(permissionSetsPath, 'MfLab.permissionset-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
      <PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
      </PermissionSet>`
    );

    const result = checkPermissionSets(projectPath, ['MfLabReact']);

    expect(result.hasError).toBe(true);
  });

  it('fails when application visibility is false', () => {
    writeFileSync(
      join(permissionSetsPath, 'MfLab.permissionset-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
      <PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
      <applicationVisibilities>
      <application>MfLabReact</application>
      <visible>false</visible>
      </applicationVisibilities>
      </PermissionSet>`
    );

    const result = checkPermissionSets(projectPath, ['MfLabReact']);

    expect(result.hasError).toBe(true);
  });

  it('fails when PermissionSet metadata cannot be parsed', () => {
    writeFileSync(
      join(permissionSetsPath, 'MfLab.permissionset-meta.xml'),
      '<PermissionSet><applicationVisibilities>'
    );

    const result = checkPermissionSets(projectPath, ['MfLabReact']);

    expect(result.hasError).toBe(true);
  });
});
