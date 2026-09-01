import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { BundleInfo } from './bundle.js';
import { checkExperienceLinkage } from './experience.js';

type FixturePaths = {
  bundlePath: string;
  siteSpacePath: string;
  cmsSitePath: string;
  contentPath: string;
  cmsMetaPath: string;
  digitalExperienceBundlePath: string;
  configPath: string;
  networkPath: string;
  sitePath: string;
};

type ContentOptions = {
  appContainer?: boolean;
  appSpace?: string;
  type?: string;
};

describe('checkExperienceLinkage', () => {
  const bundleName = 'MfLab';
  const siteName = 'CustomerPortal';
  const siteSpace = 'CustomerPortal1';
  const defaultNamespace = 'c';
  const defaultAppSpace = `${defaultNamespace}__${bundleName}`;

  let projectPath: string;
  let metadataRoot: string;
  let uiBundlesPath: string;
  let digitalExperiencesPath: string;
  let digitalExperienceConfigsPath: string;
  let networksPath: string;
  let sitesPath: string;

  let fixturePaths: FixturePaths;
  let experienceBundle: BundleInfo;

  function writeJson(filePath: string, value: unknown): void {
    writeFileSync(filePath, JSON.stringify(value, null, 2));
  }

  function writeContent(filePath: string, options: ContentOptions = {}): void {
    const {
      appContainer = true,
      appSpace = defaultAppSpace,
      type = 'sfdc_cms__site',
    } = options;

    writeJson(filePath, {
      type,
      title: siteName,
      urlName: 'customerportal',
      contentBody: {
        authenticationType: 'AUTHENTICATED_WITH_PUBLIC_ACCESS_ENABLED',
        appContainer,
        appSpace,
      },
    });
  }

  function writeCmsMeta(filePath: string, type = 'sfdc_cms__site'): void {
    writeJson(filePath, {
      apiName: siteSpace,
      path: '',
      type,
    });
  }

  function writeDigitalExperienceBundle(filePath: string): void {
    writeFileSync(
      filePath,
      `<?xml version="1.0" encoding="UTF-8"?>
      <DigitalExperienceBundle xmlns="http://soap.sforce.com/2006/04/metadata">
        <label>${siteSpace}</label>
      </DigitalExperienceBundle>`
    );
  }

  function writeDigitalExperienceConfig(
    filePath: string,
    space = `site/${siteSpace}`
  ): void {
    writeFileSync(
      filePath,
      `<?xml version="1.0" encoding="UTF-8"?>
      <DigitalExperienceConfig xmlns="http://soap.sforce.com/2006/04/metadata">
        <label>${siteName}</label>
        <site>
          <urlPathPrefix>customerportal</urlPathPrefix>
        </site>
        <space>${space}</space>
      </DigitalExperienceConfig>`
    );
  }

  function writeNetwork(
    filePath: string,
    picassoSite = siteSpace,
    customSite = siteName
  ): void {
    writeFileSync(
      filePath,
      `<?xml version="1.0" encoding="UTF-8"?>
      <Network xmlns="http://soap.sforce.com/2006/04/metadata">
        <picassoSite>${picassoSite}</picassoSite>
        <site>${customSite}</site>
      </Network>`
    );
  }

  function writeCustomSite(filePath: string): void {
    writeFileSync(
      filePath,
      `<?xml version="1.0" encoding="UTF-8"?>
      <CustomSite xmlns="http://soap.sforce.com/2006/04/metadata">
        <masterLabel>${siteName}</masterLabel>
        <siteType>ChatterNetwork</siteType>
        <urlPathPrefix>customerportalvforcesite</urlPathPrefix>
      </CustomSite>`
    );
  }

  function createValidExperienceFixture(): FixturePaths {
    const bundlePath = join(uiBundlesPath, bundleName);

    const siteSpacePath = join(digitalExperiencesPath, 'site', siteSpace);

    const cmsSitePath = join(siteSpacePath, 'sfdc_cms__site', siteSpace);

    mkdirSync(bundlePath, {
      recursive: true,
    });

    mkdirSync(cmsSitePath, {
      recursive: true,
    });

    const digitalExperienceBundlePath = join(
      siteSpacePath,
      `${siteSpace}.digitalExperience-meta.xml`
    );

    const contentPath = join(cmsSitePath, 'content.json');

    const cmsMetaPath = join(cmsSitePath, '_meta.json');

    const configPath = join(
      digitalExperienceConfigsPath,
      `${siteSpace}.digitalExperienceConfig-meta.xml`
    );

    const networkPath = join(networksPath, `${siteName}.network-meta.xml`);

    const sitePath = join(sitesPath, `${siteName}.site-meta.xml`);

    writeDigitalExperienceBundle(digitalExperienceBundlePath);

    writeCmsMeta(cmsMetaPath);
    writeContent(contentPath);
    writeDigitalExperienceConfig(configPath);
    writeNetwork(networkPath);
    writeCustomSite(sitePath);

    return {
      bundlePath,
      siteSpacePath,
      cmsSitePath,
      contentPath,
      cmsMetaPath,
      digitalExperienceBundlePath,
      configPath,
      networkPath,
      sitePath,
    };
  }

  function runCheck(
    bundles: BundleInfo[] = [experienceBundle],
    namespace = defaultNamespace
  ) {
    return checkExperienceLinkage([metadataRoot], bundles, namespace);
  }

  function getExperienceDiagnostics(result: ReturnType<typeof checkExperienceLinkage>) {
    return result.diagnostics.filter((diagnostic) => diagnostic.id === 'MF-META-019');
  }

  function expectSingleExperienceDiagnostic(
    result: ReturnType<typeof checkExperienceLinkage>,
    status: 'PASS' | 'FAIL' | 'UNKNOWN'
  ) {
    const diagnostics = getExperienceDiagnostics(result);

    expect(diagnostics).toHaveLength(1);

    expect(diagnostics[0]).toEqual(
      expect.objectContaining({
        id: 'MF-META-019',
        status,
      })
    );

    return diagnostics[0]!;
  }

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'mf-check-'));

    metadataRoot = join(projectPath, 'src', 'main', 'default');

    uiBundlesPath = join(metadataRoot, 'uiBundles');

    digitalExperiencesPath = join(metadataRoot, 'digitalExperiences');

    digitalExperienceConfigsPath = join(metadataRoot, 'digitalExperienceConfigs');

    networksPath = join(metadataRoot, 'networks');

    sitesPath = join(metadataRoot, 'sites');

    mkdirSync(uiBundlesPath, {
      recursive: true,
    });

    mkdirSync(digitalExperiencesPath, {
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

    fixturePaths = createValidExperienceFixture();

    experienceBundle = {
      name: bundleName,
      path: fixturePaths.bundlePath,
      target: 'Experience',
    };
  });

  afterEach(() => {
    rmSync(projectPath, {
      recursive: true,
      force: true,
    });
  });

  it('passes when an Experience UI Bundle is fully linked to a Digital Experience site', () => {
    const diagnostic = expectSingleExperienceDiagnostic(runCheck(), 'PASS');

    expect(diagnostic.summary).toContain(bundleName);
  });

  it('supports a custom namespace when resolving appSpace', () => {
    writeContent(fixturePaths.contentPath, {
      appSpace: `acme__${bundleName}`,
    });

    expectSingleExperienceDiagnostic(runCheck([experienceBundle], 'acme'), 'PASS');
  });

  it('defaults an empty namespace to c', () => {
    expectSingleExperienceDiagnostic(runCheck([experienceBundle], '   '), 'PASS');
  });

  it('ignores non-Experience UI Bundles', () => {
    const internalBundle: BundleInfo = {
      name: 'InternalApp',
      path: join(uiBundlesPath, 'InternalApp'),
      target: 'CustomApplication',
    };

    const result = runCheck([internalBundle]);

    expect(getExperienceDiagnostics(result)).toHaveLength(0);
  });

  it('does not infer Experience linkage for a bundle with an unknown target', () => {
    const unknownTargetBundle: BundleInfo = {
      name: 'UnknownTarget',
      path: join(uiBundlesPath, 'UnknownTarget'),
    };

    const result = runCheck([unknownTargetBundle]);

    expect(getExperienceDiagnostics(result)).toHaveLength(0);
  });

  it('checks an Experience bundle only once when duplicate bundle names are discovered', () => {
    const duplicateBundle: BundleInfo = {
      name: bundleName,
      path: join(projectPath, 'feature', 'main', 'default', 'uiBundles', bundleName),
      target: 'Experience',
    };

    const result = runCheck([experienceBundle, duplicateBundle]);

    expectSingleExperienceDiagnostic(result, 'PASS');
  });

  it('handles mixed internal and Experience UI Bundles', () => {
    const internalBundle: BundleInfo = {
      name: 'InternalApp',
      path: join(uiBundlesPath, 'InternalApp'),
      target: 'CustomApplication',
    };

    const result = runCheck([internalBundle, experienceBundle]);

    expectSingleExperienceDiagnostic(result, 'PASS');
  });

  it('fails when appContainer is false', () => {
    writeContent(fixturePaths.contentPath, {
      appContainer: false,
    });

    const diagnostic = expectSingleExperienceDiagnostic(runCheck(), 'FAIL');

    expect(diagnostic.problem).toContain('appContainer');
  });

  it('fails when no Digital Experience content references the expected appSpace', () => {
    writeContent(fixturePaths.contentPath, {
      appSpace: 'c__DifferentBundle',
    });

    const diagnostic = expectSingleExperienceDiagnostic(runCheck(), 'FAIL');

    expect(diagnostic.problem).toContain(defaultAppSpace);
  });

  it('returns UNKNOWN when content.json contains invalid JSON', () => {
    writeFileSync(fixturePaths.contentPath, '{invalid');

    const diagnostic = expectSingleExperienceDiagnostic(runCheck(), 'UNKNOWN');

    expect(diagnostic.blocksReadiness).toBe(true);
  });

  it('returns UNKNOWN when content.json cannot be read as a file', () => {
    rmSync(fixturePaths.contentPath, {
      force: true,
    });

    mkdirSync(fixturePaths.contentPath);

    const diagnostic = expectSingleExperienceDiagnostic(runCheck(), 'UNKNOWN');

    expect(diagnostic.blocksReadiness).toBe(true);
  });

  it('fails when the DigitalExperienceBundle metadata file is missing', () => {
    rmSync(fixturePaths.digitalExperienceBundlePath);

    const diagnostic = expectSingleExperienceDiagnostic(runCheck(), 'FAIL');

    expect(diagnostic.problem).toContain('DigitalExperienceBundle');
  });

  it('returns UNKNOWN when DigitalExperienceBundle metadata is malformed', () => {
    writeFileSync(fixturePaths.digitalExperienceBundlePath, '<DigitalExperienceBundle>');

    expectSingleExperienceDiagnostic(runCheck(), 'UNKNOWN');
  });

  it('fails when _meta.json is missing', () => {
    rmSync(fixturePaths.cmsMetaPath);

    const diagnostic = expectSingleExperienceDiagnostic(runCheck(), 'FAIL');

    expect(diagnostic.problem).toContain('_meta.json');
  });

  it('returns UNKNOWN when _meta.json contains invalid JSON', () => {
    writeFileSync(fixturePaths.cmsMetaPath, '{invalid');

    expectSingleExperienceDiagnostic(runCheck(), 'UNKNOWN');
  });

  it('fails when _meta.json does not describe an sfdc_cms__site record', () => {
    writeCmsMeta(fixturePaths.cmsMetaPath, 'different_type');

    const diagnostic = expectSingleExperienceDiagnostic(runCheck(), 'FAIL');

    expect(diagnostic.problem).toContain('sfdc_cms__site');
  });

  it('fails when _meta.json apiName does not match the site space', () => {
    writeJson(fixturePaths.cmsMetaPath, {
      apiName: 'DifferentSite1',
      path: '',
      type: 'sfdc_cms__site',
    });

    const diagnostic = expectSingleExperienceDiagnostic(runCheck(), 'FAIL');

    expect(diagnostic.problem).toContain('apiName');
    expect(diagnostic.problem).toContain(siteSpace);
  });

  it('fails when DigitalExperienceConfig metadata is missing', () => {
    rmSync(fixturePaths.configPath);

    const diagnostic = expectSingleExperienceDiagnostic(runCheck(), 'FAIL');

    expect(diagnostic.problem).toContain('DigitalExperienceConfig');
  });

  it('fails when DigitalExperienceConfig references a different site space', () => {
    writeDigitalExperienceConfig(fixturePaths.configPath, 'site/DifferentSite1');

    expectSingleExperienceDiagnostic(runCheck(), 'FAIL');
  });

  it('returns UNKNOWN when DigitalExperienceConfig metadata is malformed', () => {
    writeFileSync(fixturePaths.configPath, '<DigitalExperienceConfig>');

    expectSingleExperienceDiagnostic(runCheck(), 'UNKNOWN');
  });

  it('fails when Network metadata is missing', () => {
    rmSync(fixturePaths.networkPath);

    const diagnostic = expectSingleExperienceDiagnostic(runCheck(), 'FAIL');

    expect(diagnostic.problem).toContain('Network');
  });

  it('fails when Network references a different Digital Experience site space', () => {
    writeNetwork(fixturePaths.networkPath, 'DifferentSite1');

    expectSingleExperienceDiagnostic(runCheck(), 'FAIL');
  });

  it('returns UNKNOWN when Network metadata is malformed', () => {
    writeFileSync(fixturePaths.networkPath, '<Network>');

    expectSingleExperienceDiagnostic(runCheck(), 'UNKNOWN');
  });

  it('fails when Network points to a missing CustomSite', () => {
    writeNetwork(fixturePaths.networkPath, siteSpace, 'MissingSite');

    const diagnostic = expectSingleExperienceDiagnostic(runCheck(), 'FAIL');

    expect(diagnostic.problem).toContain('MissingSite');
  });

  it('returns UNKNOWN when the referenced CustomSite metadata is malformed', () => {
    writeFileSync(fixturePaths.sitePath, '<CustomSite>');

    expectSingleExperienceDiagnostic(runCheck(), 'UNKNOWN');
  });

  it('does not report Experience linkage when no metadata roots are available', () => {
    const result = checkExperienceLinkage([], [experienceBundle], defaultNamespace);

    expect(getExperienceDiagnostics(result)).toHaveLength(0);
  });
});
