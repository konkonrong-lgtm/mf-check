import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkApplications } from './application.js';

describe('checkApplications', () => {
  let projectPath: string;
  let applicationsPath: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'mf-check-'));

    applicationsPath = join(projectPath, 'force-app', 'main', 'default', 'applications');

    mkdirSync(applicationsPath, {
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

  it('passes when a Lightning application links to a local UI Bundle', () => {
    writeFileSync(
      join(applicationsPath, 'MfLabReact.app-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
      <CustomApplication xmlns="http://soap.sforce.com/2006/04/metadata">
      <uiType>Lightning</uiType>
      <uiBundle>c__MfLab</uiBundle>
      </CustomApplication>`
    );

    const result = checkApplications(projectPath, ['MfLab']);

    expect(result.hasError).toBe(false);

    expect(result.applicationNames).toEqual(['MfLabReact']);
  });

  it('fails when an application is not Lightning', () => {
    writeFileSync(
      join(applicationsPath, 'MfLabReact.app-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
      <CustomApplication xmlns="http://soap.sforce.com/2006/04/metadata">
      <uiType>Classic</uiType>
      <uiBundle>c__MfLab</uiBundle>
      </CustomApplication>`
    );

    const result = checkApplications(projectPath, ['MfLab']);

    expect(result.hasError).toBe(true);
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

    const result = checkApplications(projectPath, ['MfLab']);

    expect(result.hasError).toBe(true);
  });

  it('fails when application metadata cannot be parsed', () => {
    writeFileSync(
      join(applicationsPath, 'MfLabReact.app-meta.xml'),
      '<CustomApplication><uiBundle>'
    );

    const result = checkApplications(projectPath, ['MfLab']);
    expect(result.hasError).toBe(true);
  });
});
