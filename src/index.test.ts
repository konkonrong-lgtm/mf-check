import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('mf-check CLI', () => {
  const bundleName = 'MfLab';
  const siteName = 'CustomerPortal';
  const siteSpace = 'CustomerPortal1';
  const namespace = 'acme';
  const appSpace = `${namespace}__${bundleName}`;

  const currentDirectory = dirname(fileURLToPath(import.meta.url));

  const repositoryRoot = resolve(currentDirectory, '..');

  let projectPath: string;
  let metadataRoot: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'mf-check-cli-'));

    metadataRoot = join(projectPath, 'force-app', 'main', 'default');

    const uiBundlesPath = join(metadataRoot, 'uiBundles');

    const bundlePath = join(uiBundlesPath, bundleName);

    const distPath = join(bundlePath, 'dist');

    const siteSpacePath = join(metadataRoot, 'digitalExperiences', 'site', siteSpace);

    const cmsSitePath = join(siteSpacePath, 'sfdc_cms__site', siteSpace);

    const digitalExperienceConfigsPath = join(metadataRoot, 'digitalExperienceConfigs');

    const networksPath = join(metadataRoot, 'networks');

    const sitesPath = join(metadataRoot, 'sites');

    mkdirSync(distPath, {
      recursive: true,
    });

    mkdirSync(cmsSitePath, {
      recursive: true,
    });

    mkdirSync(digitalExperienceConfigsPath, {
      recursive: true,
    });

    mkdirSync(networksPath, {
      recursive: true,
    });

    mkdirSync(sitesPath, {
      recursive: true,
    });

    writeFileSync(
      join(projectPath, 'sfdx-project.json'),
      JSON.stringify(
        {
          packageDirectories: [
            {
              path: 'force-app',
              default: true,
            },
          ],
          namespace,
          sourceApiVersion: '67.0',
        },
        null,
        2
      )
    );

    writeFileSync(
      join(bundlePath, `${bundleName}.uibundle-meta.xml`),
      `<?xml version="1.0" encoding="UTF-8"?>
      <UIBundle xmlns="http://soap.sforce.com/2006/04/metadata">
        <masterLabel>${bundleName}</masterLabel>
        <target>Experience</target>
      </UIBundle>`
    );

    writeFileSync(
      join(bundlePath, 'ui-bundle.json'),
      JSON.stringify(
        {
          outputDir: 'dist',
        },
        null,
        2
      )
    );

    writeFileSync(join(distPath, 'index.html'), '<div id="root"></div>');

    writeFileSync(
      join(siteSpacePath, `${siteSpace}.digitalExperience-meta.xml`),
      `<?xml version="1.0" encoding="UTF-8"?>
      <DigitalExperienceBundle xmlns="http://soap.sforce.com/2006/04/metadata">
        <label>${siteSpace}</label>
      </DigitalExperienceBundle>`
    );

    writeFileSync(
      join(cmsSitePath, '_meta.json'),
      JSON.stringify(
        {
          apiName: siteSpace,
          path: '',
          type: 'sfdc_cms__site',
        },
        null,
        2
      )
    );

    writeFileSync(
      join(cmsSitePath, 'content.json'),
      JSON.stringify(
        {
          type: 'sfdc_cms__site',
          title: siteName,
          urlName: 'customerportal',
          contentBody: {
            authenticationType: 'AUTHENTICATED_WITH_PUBLIC_ACCESS_ENABLED',
            appContainer: true,
            appSpace,
          },
        },
        null,
        2
      )
    );

    writeFileSync(
      join(digitalExperienceConfigsPath, `${siteSpace}.digitalExperienceConfig-meta.xml`),
      `<?xml version="1.0" encoding="UTF-8"?>
      <DigitalExperienceConfig xmlns="http://soap.sforce.com/2006/04/metadata">
        <label>${siteName}</label>
        <site>
          <urlPathPrefix>customerportal</urlPathPrefix>
        </site>
        <space>site/${siteSpace}</space>
      </DigitalExperienceConfig>`
    );

    writeFileSync(
      join(networksPath, `${siteName}.network-meta.xml`),
      `<?xml version="1.0" encoding="UTF-8"?>
      <Network xmlns="http://soap.sforce.com/2006/04/metadata">
        <picassoSite>${siteSpace}</picassoSite>
        <site>${siteName}</site>
      </Network>`
    );

    writeFileSync(
      join(sitesPath, `${siteName}.site-meta.xml`),
      `<?xml version="1.0" encoding="UTF-8"?>
      <CustomSite xmlns="http://soap.sforce.com/2006/04/metadata">
        <masterLabel>${siteName}</masterLabel>
        <siteType>ChatterNetwork</siteType>
        <urlPathPrefix>customerportalvforcesite</urlPathPrefix>
      </CustomSite>`
    );
  });

  afterEach(() => {
    rmSync(projectPath, {
      recursive: true,
      force: true,
    });
  });

  it('accepts a fully linked Experience-only project without requiring a CustomApplication', () => {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', join(repositoryRoot, 'src', 'index.ts'), 'check', projectPath],
      {
        cwd: repositoryRoot,
        encoding: 'utf-8',
      }
    );

    expect(result.error).toBeUndefined();

    expect(result.stderr).toBe('');

    expect(result.stdout).toContain(
      `${bundleName}: linked to an Experience Cloud app container`
    );

    expect(result.stdout).not.toContain('applications directory not found');

    expect(result.stdout).not.toContain(
      `${bundleName}: no CustomApplication references this UI Bundle`
    );

    expect(result.stdout).toContain('READY');

    expect(result.status).toBe(0);
  });
});
