import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { BundleInfo } from './bundle.js';
import { checkApplications } from './application.js';

function createBundleInfo(
  metadataRoot: string,
  name = 'MfLab',
  target = 'CustomApplication'
): BundleInfo {
  return {
    name,
    path: join(metadataRoot, 'uiBundles', name),
    target,
  };
}

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

    const result = checkApplications([metadataRoot], [createBundleInfo(metadataRoot)]);

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

  it('does not require a CustomApplication for an Experience UI Bundle', () => {
    const result = checkApplications(
      [metadataRoot],
      [createBundleInfo(metadataRoot, 'MfLab', 'Experience')]
    );

    expect(result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-META-011')).toBe(
      false
    );

    expect(result.applicationNames).toEqual([]);
  });

  it('fails when a CustomApplication references an Experience UI Bundle', () => {
    writeFileSync(
      join(applicationsPath, 'MfLabReact.app-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
      <CustomApplication xmlns="http://soap.sforce.com/2006/04/metadata">
        <uiType>Lightning</uiType>
        <uiBundle>c__MfLab</uiBundle>
      </CustomApplication>`
    );

    const result = checkApplications(
      [metadataRoot],
      [createBundleInfo(metadataRoot, 'MfLab', 'Experience')]
    );

    expect(result.applicationNames).toEqual([]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-META-009',
          status: 'FAIL',
        }),
      ])
    );
    expect(result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-META-010')).toBe(
      false
    );
  });

  it('returns UNKNOWN when a CustomApplication references a bundle with an unknown target', () => {
    writeFileSync(
      join(applicationsPath, 'MfLabReact.app-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
      <CustomApplication xmlns="http://soap.sforce.com/2006/04/metadata">
        <uiType>Lightning</uiType>
        <uiBundle>c__MfLab</uiBundle>
      </CustomApplication>`
    );

    const bundle = createBundleInfo(metadataRoot);
    delete bundle.target;

    const result = checkApplications([metadataRoot], [bundle]);

    expect(result.applicationNames).toEqual([]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-META-009',
          status: 'UNKNOWN',
          blocksReadiness: true,
        }),
      ])
    );
    expect(result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-META-010')).toBe(
      false
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

    const result = checkApplications([metadataRoot], [createBundleInfo(metadataRoot)]);

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

  it('reports missing CustomApplication linkage once for duplicate UI Bundle names', () => {
    const secondMetadataRoot = join(projectPath, 'feature', 'main', 'default');

    const result = checkApplications(
      [metadataRoot],
      [createBundleInfo(metadataRoot), createBundleInfo(secondMetadataRoot)]
    );

    const missingLinkageDiagnostics = result.diagnostics.filter(
      (diagnostic) => diagnostic.id === 'MF-META-011'
    );

    expect(missingLinkageDiagnostics).toHaveLength(1);
  });

  it('accepts a CustomApplication target among duplicate UI Bundle names', () => {
    const secondMetadataRoot = join(projectPath, 'feature', 'main', 'default');

    writeFileSync(
      join(applicationsPath, 'MfLabReact.app-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
      <CustomApplication xmlns="http://soap.sforce.com/2006/04/metadata">
        <uiType>Lightning</uiType>
        <uiBundle>c__MfLab</uiBundle>
      </CustomApplication>`
    );

    const result = checkApplications(
      [metadataRoot, secondMetadataRoot],
      [
        createBundleInfo(metadataRoot, 'MfLab', 'Experience'),
        createBundleInfo(secondMetadataRoot),
      ]
    );

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

  it('fails when an application points to an unknown UI Bundle', () => {
    writeFileSync(
      join(applicationsPath, 'MfLabReact.app-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
      <CustomApplication xmlns="http://soap.sforce.com/2006/04/metadata">
        <uiType>Lightning</uiType>
        <uiBundle>c__UnknownBundle</uiBundle>
      </CustomApplication>`
    );

    const result = checkApplications([metadataRoot], [createBundleInfo(metadataRoot)]);

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

    const result = checkApplications([metadataRoot], [createBundleInfo(metadataRoot)]);

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

    const result = checkApplications([metadataRoot], [createBundleInfo(metadataRoot)]);

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

    const result = checkApplications([metadataRoot], [createBundleInfo(metadataRoot)]);

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

    const result = checkApplications(
      [metadataRoot, secondMetadataRoot],
      [createBundleInfo(metadataRoot)]
    );

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
    rmSync(applicationsPath, {
      recursive: true,
      force: true,
    });

    writeFileSync(applicationsPath, 'not a directory');

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

    const result = checkApplications(
      [metadataRoot, secondMetadataRoot],
      [createBundleInfo(metadataRoot)]
    );

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

    const result = checkApplications(
      [metadataRoot, secondMetadataRoot],
      [createBundleInfo(metadataRoot)]
    );

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-PROJECT-005',
          status: 'FAIL',
        }),
      ])
    );
  });

  it('does not require an applications directory for Experience-only UI Bundles', () => {
    rmSync(applicationsPath, {
      recursive: true,
      force: true,
    });

    const result = checkApplications(
      [metadataRoot],
      [createBundleInfo(metadataRoot, 'MfLab', 'Experience')]
    );

    expect(
      result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-PROJECT-005')
    ).toBe(false);

    expect(result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-META-011')).toBe(
      false
    );
  });
});
