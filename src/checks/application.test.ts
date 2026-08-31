import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkApplications } from './application.js';

describe('checkApplications', () => {
  let projectPath: string;
  let metadataRoot: string;
  let applicationsPath: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'mf-check-'));

    metadataRoot = join(projectPath, 'src', 'main', 'default');

    applicationsPath = join(metadataRoot, 'applications');

    mkdirSync(applicationsPath, {
      recursive: true,
    });
  });

  afterEach(() => {
    rmSync(projectPath, {
      recursive: true,
      force: true,
    });
  });

  it('passes when a Lightning application links to a local UI Bundle', () => {
    writeFileSync(
      join(applicationsPath, 'MfLabReact.app-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
      <CustomApplication xmlns="http://soap.sforce.com/2006/04/metadata">
        <uiType>Lightning</uiType>
        <uiBundle>c__MfLab</uiBundle>
      </CustomApplication>`
    );

    const result = checkApplications([metadataRoot], ['MfLab']);

    expect(result.applicationNames).toEqual(['MfLabReact']);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-META-010',
          status: 'PASS',
        }),
      ])
    );
  });

  it('fails for Classic application without reporting the referenced bundle as unlinked', () => {
    writeFileSync(
      join(applicationsPath, 'MfLabReact.app-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
    <CustomApplication xmlns="http://soap.sforce.com/2006/04/metadata">
      <uiType>Classic</uiType>
      <uiBundle>c__MfLab</uiBundle>
    </CustomApplication>`
    );

    const result = checkApplications([metadataRoot], ['MfLab']);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-META-008',
          status: 'FAIL',
        }),
      ])
    );

    expect(result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-META-011')).toBe(
      false
    );

    expect(result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-META-010')).toBe(
      false
    );

    expect(result.applicationNames).toEqual([]);
  });

  it('fails when an application points to an unknown UI Bundle', () => {
    writeFileSync(
      join(applicationsPath, 'MfLabReact.app-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
      <CustomApplication xmlns="http://soap.sforce.com/2006/04/metadata">
        <uiType>Lightning</uiType>
        <uiBundle>c__UnknownBundle</uiBundle>
      </CustomApplication>`
    );

    const result = checkApplications([metadataRoot], ['MfLab']);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-META-009',
          status: 'FAIL',
        }),
      ])
    );
  });

  it('fails when application metadata contains invalid XML', () => {
    writeFileSync(
      join(applicationsPath, 'MfLabReact.app-meta.xml'),
      '<CustomApplication><uiBundle>'
    );

    const result = checkApplications([metadataRoot], ['MfLab']);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-META-007',
          status: 'FAIL',
        }),
      ])
    );
    expect(result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-META-011')).toBe(
      false
    );
  });

  it('fails without claiming missing linkage when application metadata cannot be read', () => {
    mkdirSync(join(applicationsPath, 'Broken.app-meta.xml'));

    const result = checkApplications([metadataRoot], ['MfLab']);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-META-007',
          status: 'FAIL',
          file: join(applicationsPath, 'Broken.app-meta.xml'),
        }),
      ])
    );
    expect(result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-META-011')).toBe(
      false
    );
  });

  it('fails without claiming missing linkage when application metadata has the wrong root', () => {
    writeFileSync(
      join(applicationsPath, 'Broken.app-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
      <PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata" />`
    );

    const result = checkApplications([metadataRoot], ['MfLab']);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-META-007',
          status: 'FAIL',
          summary: 'Broken: invalid application metadata root',
        }),
      ])
    );
    expect(result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-META-011')).toBe(
      false
    );
  });

  it('finds applications across multiple metadata roots', () => {
    const secondMetadataRoot = join(projectPath, 'feature', 'main', 'default');

    const secondApplicationsPath = join(secondMetadataRoot, 'applications');

    mkdirSync(secondApplicationsPath, {
      recursive: true,
    });

    writeFileSync(
      join(secondApplicationsPath, 'MfLabReact.app-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
      <CustomApplication xmlns="http://soap.sforce.com/2006/04/metadata">
        <uiType>Lightning</uiType>
        <uiBundle>c__MfLab</uiBundle>
      </CustomApplication>`
    );

    const result = checkApplications([metadataRoot, secondMetadataRoot], ['MfLab']);

    expect(result.applicationNames).toEqual(['MfLabReact']);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-META-010',
          status: 'PASS',
        }),
      ])
    );
  });

  it('reports an unreadable applications path and continues other metadata roots', () => {
    rmSync(applicationsPath, { recursive: true, force: true });
    writeFileSync(applicationsPath, 'not a directory');

    const secondMetadataRoot = join(projectPath, 'feature', 'main', 'default');
    const secondApplicationsPath = join(secondMetadataRoot, 'applications');

    mkdirSync(secondApplicationsPath, { recursive: true });
    writeFileSync(
      join(secondApplicationsPath, 'MfLabReact.app-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
      <CustomApplication xmlns="http://soap.sforce.com/2006/04/metadata">
        <uiType>Lightning</uiType>
        <uiBundle>c__MfLab</uiBundle>
      </CustomApplication>`
    );

    const result = checkApplications([metadataRoot, secondMetadataRoot], ['MfLab']);

    expect(result.applicationNames).toEqual(['MfLabReact']);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-PROJECT-011',
          status: 'FAIL',
          file: applicationsPath,
          problem: expect.stringContaining('ENOTDIR'),
        }),
        expect.objectContaining({
          id: 'MF-META-010',
          status: 'PASS',
        }),
      ])
    );
  });

  it('fails when no metadata root contains applications', () => {
    rmSync(applicationsPath, {
      recursive: true,
      force: true,
    });

    const secondMetadataRoot = join(projectPath, 'feature', 'main', 'default');

    mkdirSync(secondMetadataRoot, {
      recursive: true,
    });

    const result = checkApplications([metadataRoot, secondMetadataRoot], ['MfLab']);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-PROJECT-005',
          status: 'FAIL',
        }),
      ])
    );
  });
});
