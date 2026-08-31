import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkAppAccess } from './appAccess.js';
import { checkProfiles } from './profile.js';

describe('checkProfiles', () => {
  let projectPath: string;
  let metadataRoot: string;
  let profilesPath: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'mf-check-'));

    metadataRoot = join(projectPath, 'src', 'main', 'default');

    profilesPath = join(metadataRoot, 'profiles');

    mkdirSync(profilesPath, {
      recursive: true,
    });
  });

  afterEach(() => {
    rmSync(projectPath, {
      recursive: true,
      force: true,
    });
  });

  it('collects visible application from Profile', () => {
    writeFileSync(
      join(profilesPath, 'Admin.profile-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
          <Profile xmlns="http://soap.sforce.com/2006/04/metadata">
            <applicationVisibilities>
              <application>MfLabReact</application>
              <visible>true</visible>
            </applicationVisibilities>
          </Profile>`
    );

    const result = checkProfiles([metadataRoot]);

    expect(result.visibleApplications).toEqual(['MfLabReact']);

    expect(result.diagnostics).toEqual([]);
  });

  it('ignores application visibility when visible is false', () => {
    writeFileSync(
      join(profilesPath, 'Admin.profile-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
          <Profile xmlns="http://soap.sforce.com/2006/04/metadata">
            <applicationVisibilities>
                <application>MfLabReact</application>
                <visible>false</visible>
            </applicationVisibilities>
          </Profile>`
    );

    const result = checkProfiles([metadataRoot]);

    expect(result.visibleApplications).toEqual([]);

    expect(result.diagnostics).toEqual([]);
  });

  it('fails when Profile metadata contains invalid XML', () => {
    writeFileSync(
      join(profilesPath, 'Admin.profile-meta.xml'),
      '<Profile><applicationVisibilities>'
    );

    const result = checkProfiles([metadataRoot]);

    expect(result.visibleApplications).toEqual([]);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-ACCESS-005',
          status: 'FAIL',
        }),
      ])
    );

    const accessResult = checkAppAccess(['MfLabReact'], [], result.visibleApplications);

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

  it('finds Profiles across multiple metadata roots', () => {
    const secondMetadataRoot = join(projectPath, 'feature', 'main', 'default');

    const secondProfilesPath = join(secondMetadataRoot, 'profiles');

    mkdirSync(secondProfilesPath, {
      recursive: true,
    });

    writeFileSync(
      join(secondProfilesPath, 'Admin.profile-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
          <Profile xmlns="http://soap.sforce.com/2006/04/metadata">
            <applicationVisibilities>
              <application>MfLabReact</application>
              <visible>true</visible>
            </applicationVisibilities>
          </Profile>`
    );

    const result = checkProfiles([metadataRoot, secondMetadataRoot]);

    expect(result.visibleApplications).toEqual(['MfLabReact']);

    expect(result.diagnostics).toEqual([]);
  });

  it('reports an unreadable profiles path and continues other metadata roots', () => {
    rmSync(profilesPath, { recursive: true, force: true });
    writeFileSync(profilesPath, 'not a directory');

    const secondMetadataRoot = join(projectPath, 'feature', 'main', 'default');
    const secondProfilesPath = join(secondMetadataRoot, 'profiles');

    mkdirSync(secondProfilesPath, { recursive: true });
    writeFileSync(
      join(secondProfilesPath, 'Admin.profile-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
      <Profile xmlns="http://soap.sforce.com/2006/04/metadata">
        <applicationVisibilities>
          <application>MfLabReact</application>
          <visible>true</visible>
        </applicationVisibilities>
      </Profile>`
    );

    const result = checkProfiles([metadataRoot, secondMetadataRoot]);

    expect(result.visibleApplications).toEqual(['MfLabReact']);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-ACCESS-007',
          status: 'FAIL',
          file: profilesPath,
          problem: expect.stringContaining('ENOTDIR'),
        }),
      ])
    );
  });

  it('returns empty result when no metadata root contains profiles', () => {
    rmSync(profilesPath, {
      recursive: true,
      force: true,
    });

    const secondMetadataRoot = join(projectPath, 'feature', 'main', 'default');

    mkdirSync(secondMetadataRoot, {
      recursive: true,
    });

    const result = checkProfiles([metadataRoot, secondMetadataRoot]);

    expect(result.visibleApplications).toEqual([]);

    expect(result.diagnostics).toEqual([]);
  });
});
