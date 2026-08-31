import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkAppAccess } from './appAccess.js';
import { checkPermissionSets } from './permissionSet.js';

describe('checkPermissionSets', () => {
  let projectPath: string;
  let metadataRoot: string;
  let permissionSetsPath: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'mf-check-'));

    metadataRoot = join(projectPath, 'src', 'main', 'default');

    permissionSetsPath = join(metadataRoot, 'permissionsets');

    mkdirSync(permissionSetsPath, {
      recursive: true,
    });
  });

  afterEach(() => {
    rmSync(projectPath, {
      recursive: true,
      force: true,
    });
  });

  it('collects visible application from PermissionSet', () => {
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

    const result = checkPermissionSets([metadataRoot]);

    expect(result.visibleApplications).toEqual(['MfLabReact']);

    expect(result.diagnostics).toEqual([]);
  });

  it('returns no visible applications when visibility is missing', () => {
    writeFileSync(
      join(permissionSetsPath, 'MfLab.permissionset-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
      <PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
      </PermissionSet>`
    );

    const result = checkPermissionSets([metadataRoot]);

    expect(result.visibleApplications).toEqual([]);

    expect(result.diagnostics).toEqual([]);
  });

  it('ignores application visibility when visible is false', () => {
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

    const result = checkPermissionSets([metadataRoot]);

    expect(result.visibleApplications).toEqual([]);

    expect(result.diagnostics).toEqual([]);
  });

  it('fails when PermissionSet metadata contains invalid XML', () => {
    writeFileSync(
      join(permissionSetsPath, 'MfLab.permissionset-meta.xml'),
      '<PermissionSet><applicationVisibilities>'
    );

    const result = checkPermissionSets([metadataRoot]);
    expect(result.visibleApplications).toEqual([]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-ACCESS-002',
          status: 'FAIL',
        }),
      ])
    );

    const accessResult = checkAppAccess(['MfLabReact'], result.visibleApplications, []);

    expect(accessResult.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-ACCESS-003',
          status: 'UNKNOWN',
          problem:
            'mf-check did not confirm application visibility for "MfLabReact" in the local PermissionSet or Profile metadata that it could inspect.',
        }),
      ])
    );
  });

  it('finds PermissionSets across multiple metadata roots', () => {
    const secondMetadataRoot = join(projectPath, 'feature', 'main', 'default');

    const secondPermissionSetsPath = join(secondMetadataRoot, 'permissionsets');

    mkdirSync(secondPermissionSetsPath, {
      recursive: true,
    });

    writeFileSync(
      join(secondPermissionSetsPath, 'MfLab.permissionset-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
      <PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
        <applicationVisibilities>
          <application>MfLabReact</application>
          <visible>true</visible>
        </applicationVisibilities>
      </PermissionSet>`
    );

    const result = checkPermissionSets([metadataRoot, secondMetadataRoot]);

    expect(result.visibleApplications).toEqual(['MfLabReact']);

    expect(result.diagnostics).toEqual([]);
  });

  it('reports an unreadable permissionsets path and continues other metadata roots', () => {
    rmSync(permissionSetsPath, { recursive: true, force: true });
    writeFileSync(permissionSetsPath, 'not a directory');

    const secondMetadataRoot = join(projectPath, 'feature', 'main', 'default');
    const secondPermissionSetsPath = join(secondMetadataRoot, 'permissionsets');

    mkdirSync(secondPermissionSetsPath, { recursive: true });
    writeFileSync(
      join(secondPermissionSetsPath, 'MfLab.permissionset-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
      <PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
        <applicationVisibilities>
          <application>MfLabReact</application>
          <visible>true</visible>
        </applicationVisibilities>
      </PermissionSet>`
    );

    const result = checkPermissionSets([metadataRoot, secondMetadataRoot]);

    expect(result.visibleApplications).toEqual(['MfLabReact']);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-ACCESS-006',
          status: 'FAIL',
          file: permissionSetsPath,
          problem: expect.stringContaining('ENOTDIR'),
        }),
      ])
    );
  });

  it('returns empty result when no metadata root contains permissionsets', () => {
    rmSync(permissionSetsPath, {
      recursive: true,
      force: true,
    });

    const secondMetadataRoot = join(projectPath, 'feature', 'main', 'default');

    mkdirSync(secondMetadataRoot, {
      recursive: true,
    });

    const result = checkPermissionSets([metadataRoot, secondMetadataRoot]);

    expect(result.visibleApplications).toEqual([]);

    expect(result.diagnostics).toEqual([]);
  });
});
