import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();

  return {
    ...actual,
    lstatSync: vi.fn(actual.lstatSync),
    readdirSync: vi.fn(actual.readdirSync),
  };
});

import { checkAppAccess } from '../checks/appAccess.js';
import { checkApplications } from '../checks/application.js';
import { checkBundles } from '../checks/bundle.js';
import { checkPermissionSets } from '../checks/permissionSet.js';
import { discoverProject } from './discovery.js';

describe('discoverProject', () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'mf-check-'));
  });

  afterEach(() => {
    rmSync(projectPath, {
      recursive: true,
      force: true,
    });
  });

  it('discovers metadata roots from packageDirectories', () => {
    writeFileSync(
      join(projectPath, 'sfdx-project.json'),
      JSON.stringify({
        packageDirectories: [
          {
            path: 'src',
            default: true,
          },
        ],
        sourceApiVersion: '67.0',
      })
    );

    const metadataRoot = join(projectPath, 'src', 'main', 'default');
    const uiBundlesPath = join(metadataRoot, 'uiBundles');

    mkdirSync(uiBundlesPath, {
      recursive: true,
    });

    const result = discoverProject(projectPath);

    expect(result.metadataRoots).toEqual([metadataRoot]);
    expect(result.uiBundlesPaths).toEqual([uiBundlesPath]);
  });

  it('discovers uiBundles under a custom main source directory', () => {
    writeFileSync(
      join(projectPath, 'sfdx-project.json'),
      JSON.stringify({
        packageDirectories: [
          {
            path: 'force-app',
            default: true,
          },
        ],
        sourceApiVersion: '67.0',
      })
    );

    const metadataRoot = join(projectPath, 'force-app', 'main', 'default');
    const customUiBundlesPath = join(
      projectPath,
      'force-app',
      'main',
      'react-recipes',
      'uiBundles'
    );

    mkdirSync(metadataRoot, { recursive: true });
    mkdirSync(customUiBundlesPath, { recursive: true });

    const result = discoverProject(projectPath);

    expect(result.metadataRoots).toEqual([metadataRoot]);
    expect(result.uiBundlesPaths).toEqual([
      join(metadataRoot, 'uiBundles'),
      customUiBundlesPath,
    ]);
  });

  it('discovers all custom uiBundles when .forceignore is absent', () => {
    writeFileSync(
      join(projectPath, 'sfdx-project.json'),
      JSON.stringify({
        packageDirectories: [{ path: 'force-app' }],
        sourceApiVersion: '67.0',
      })
    );

    const mainPath = join(projectPath, 'force-app', 'main');
    const angularUiBundlesPath = join(mainPath, 'angular-recipes', 'uiBundles');
    const reactUiBundlesPath = join(mainPath, 'react-recipes', 'uiBundles');

    mkdirSync(angularUiBundlesPath, { recursive: true });
    mkdirSync(reactUiBundlesPath, { recursive: true });

    const result = discoverProject(projectPath);

    expect(result.uiBundlesPaths).toEqual([
      join(mainPath, 'default', 'uiBundles'),
      angularUiBundlesPath,
      reactUiBundlesPath,
    ]);
  });

  it('excludes forceignored source directories while discovering other uiBundles', () => {
    writeFileSync(
      join(projectPath, 'sfdx-project.json'),
      JSON.stringify({
        packageDirectories: [{ path: 'force-app' }],
        sourceApiVersion: '67.0',
      })
    );
    writeFileSync(
      join(projectPath, '.forceignore'),
      '# Preview source\n\nforce-app/main/angular-recipes/**\n'
    );

    const mainPath = join(projectPath, 'force-app', 'main');
    const angularUiBundlesPath = join(mainPath, 'angular-recipes', 'uiBundles');
    const reactUiBundlesPath = join(mainPath, 'react-recipes', 'uiBundles');

    mkdirSync(angularUiBundlesPath, { recursive: true });
    mkdirSync(reactUiBundlesPath, { recursive: true });

    const result = discoverProject(projectPath);

    expect(result.uiBundlesPaths).toEqual([
      join(mainPath, 'default', 'uiBundles'),
      reactUiBundlesPath,
    ]);
    expect(result.uiBundlesPaths).not.toContain(angularUiBundlesPath);
  });

  it('discovers metadata roots from multiple packageDirectories', () => {
    writeFileSync(
      join(projectPath, 'sfdx-project.json'),
      JSON.stringify({
        packageDirectories: [
          {
            path: 'core',
            default: true,
          },
          {
            path: 'feature',
          },
        ],
        sourceApiVersion: '67.0',
      })
    );

    const coreMetadataRoot = join(projectPath, 'core', 'main', 'default');
    const coreUiBundlesPath = join(coreMetadataRoot, 'uiBundles');
    const featureMetadataRoot = join(projectPath, 'feature', 'main', 'default');
    const featureUiBundlesPath = join(
      projectPath,
      'feature',
      'main',
      'feature-ui',
      'uiBundles'
    );

    mkdirSync(coreUiBundlesPath, {
      recursive: true,
    });

    mkdirSync(featureMetadataRoot, {
      recursive: true,
    });

    mkdirSync(featureUiBundlesPath, {
      recursive: true,
    });

    const result = discoverProject(projectPath);

    expect(result.metadataRoots).toEqual([coreMetadataRoot, featureMetadataRoot]);
    expect(result.uiBundlesPaths).toEqual([
      coreUiBundlesPath,
      join(featureMetadataRoot, 'uiBundles'),
      featureUiBundlesPath,
    ]);
  });

  it('connects bundles to applications and PermissionSets across main source directories', () => {
    writeFileSync(
      join(projectPath, 'sfdx-project.json'),
      JSON.stringify({
        packageDirectories: [
          {
            path: 'force-app',
            default: true,
          },
        ],
        sourceApiVersion: '67.0',
      })
    );

    const metadataRoot = join(projectPath, 'force-app', 'main', 'default');
    const applicationsPath = join(metadataRoot, 'applications');
    const permissionSetsPath = join(metadataRoot, 'permissionsets');
    const bundlePath = join(
      projectPath,
      'force-app',
      'main',
      'react-recipes',
      'uiBundles',
      'reactRecipes'
    );

    mkdirSync(applicationsPath, { recursive: true });
    mkdirSync(permissionSetsPath, { recursive: true });
    mkdirSync(join(bundlePath, 'dist'), { recursive: true });

    writeFileSync(
      join(bundlePath, 'ui-bundle.json'),
      JSON.stringify({ outputDir: 'dist' })
    );
    writeFileSync(
      join(bundlePath, 'reactRecipes.uibundle-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
      <UIBundle xmlns="http://soap.sforce.com/2006/04/metadata">
        <masterLabel>React Recipes</masterLabel>
        <target>CustomApplication</target>
      </UIBundle>`
    );
    writeFileSync(join(bundlePath, 'dist', 'index.html'), '<div id="root"></div>');
    writeFileSync(
      join(applicationsPath, 'ReactRecipes.app-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
      <CustomApplication xmlns="http://soap.sforce.com/2006/04/metadata">
        <uiType>Lightning</uiType>
        <uiBundle>c__reactRecipes</uiBundle>
      </CustomApplication>`
    );
    writeFileSync(
      join(permissionSetsPath, 'ReactRecipes.permissionset-meta.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>
      <PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
        <applicationVisibilities>
          <application>ReactRecipes</application>
          <visible>true</visible>
        </applicationVisibilities>
      </PermissionSet>`
    );

    const discoveryResult = discoverProject(projectPath);
    const bundleResult = checkBundles(discoveryResult.uiBundlesPaths);
    const applicationResult = checkApplications(
      discoveryResult.metadataRoots,
      bundleResult.bundles
    );
    const permissionSetResult = checkPermissionSets(discoveryResult.metadataRoots);
    const accessResult = checkAppAccess(
      applicationResult.applicationNames,
      permissionSetResult.visibleApplications,
      []
    );

    expect(bundleResult.bundles).toEqual([
      expect.objectContaining({
        name: 'reactRecipes',
        target: 'CustomApplication',
      }),
    ]);
    expect(applicationResult.applicationNames).toEqual(['ReactRecipes']);
    expect(permissionSetResult.visibleApplications).toEqual(['ReactRecipes']);
    expect(accessResult.diagnostics).toEqual([
      expect.objectContaining({ id: 'MF-ACCESS-004', status: 'PASS' }),
    ]);
  });

  it('does not search outside a missing package directory', () => {
    writeFileSync(
      join(projectPath, 'sfdx-project.json'),
      JSON.stringify({
        packageDirectories: [{ path: 'missing-package' }],
        sourceApiVersion: '67.0',
      })
    );

    const unrelatedUiBundlesPath = join(
      projectPath,
      'main',
      'react-recipes',
      'uiBundles'
    );
    mkdirSync(unrelatedUiBundlesPath, { recursive: true });

    const result = discoverProject(projectPath);
    const expectedMetadataRoot = join(projectPath, 'missing-package', 'main', 'default');

    expect(result.metadataRoots).toEqual([expectedMetadataRoot]);
    expect(result.uiBundlesPaths).toEqual([join(expectedMetadataRoot, 'uiBundles')]);
    expect(result.uiBundlesPaths).not.toContain(unrelatedUiBundlesPath);
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.id === 'MF-PROJECT-010')
    ).toBe(false);
  });

  it('ignores build and dependency directories under main', () => {
    writeFileSync(
      join(projectPath, 'sfdx-project.json'),
      JSON.stringify({
        packageDirectories: [{ path: 'force-app' }],
        sourceApiVersion: '67.0',
      })
    );

    const mainPath = join(projectPath, 'force-app', 'main');
    const ignoredNames = ['node_modules', 'dist', 'build', 'cache', '.cache'];

    for (const ignoredName of ignoredNames) {
      mkdirSync(join(mainPath, ignoredName, 'uiBundles'), { recursive: true });
    }

    const result = discoverProject(projectPath);

    expect(result.uiBundlesPaths).toEqual([join(mainPath, 'default', 'uiBundles')]);
  });

  it('reads sfdx-project.json with a UTF-8 BOM', () => {
    writeFileSync(
      join(projectPath, 'sfdx-project.json'),
      '\uFEFF' +
        JSON.stringify({
          packageDirectories: [
            {
              path: 'src',
              default: true,
            },
          ],
          sourceApiVersion: '67.0',
        })
    );

    const metadataRoot = join(projectPath, 'src', 'main', 'default');
    const uiBundlesPath = join(metadataRoot, 'uiBundles');

    mkdirSync(uiBundlesPath, {
      recursive: true,
    });

    const result = discoverProject(projectPath);

    expect(result.metadataRoots).toEqual([metadataRoot]);
    expect(result.uiBundlesPaths).toEqual([uiBundlesPath]);

    expect(result.sourceApiVersion).toBe('67.0');
  });

  it('preserves the project namespace from sfdx-project.json', () => {
    writeFileSync(
      join(projectPath, 'sfdx-project.json'),
      JSON.stringify({
        packageDirectories: [
          {
            path: 'src',
            default: true,
          },
        ],
        namespace: 'acme',
        sourceApiVersion: '67.0',
      })
    );

    const metadataRoot = join(projectPath, 'src', 'main', 'default');

    mkdirSync(metadataRoot, {
      recursive: true,
    });

    const result = discoverProject(projectPath);

    expect(result.namespace).toBe('acme');
  });

  it('reports a diagnostic and continues when a package main directory cannot be enumerated', () => {
    writeFileSync(
      join(projectPath, 'sfdx-project.json'),
      JSON.stringify({
        packageDirectories: [{ path: 'blocked' }, { path: 'working' }],
        sourceApiVersion: '67.0',
      })
    );

    const blockedMainPath = join(projectPath, 'blocked', 'main');
    const workingMainPath = join(projectPath, 'working', 'main');
    const workingUiBundlesPath = join(workingMainPath, 'custom', 'uiBundles');

    mkdirSync(blockedMainPath, { recursive: true });
    mkdirSync(workingUiBundlesPath, { recursive: true });

    expect(lstatSync(blockedMainPath).isDirectory()).toBe(true);

    const accessError = Object.assign(new Error('EACCES: permission denied'), {
      code: 'EACCES',
    });
    vi.mocked(readdirSync).mockImplementationOnce(() => {
      throw accessError;
    });

    let result: ReturnType<typeof discoverProject> | undefined;

    expect(() => {
      result = discoverProject(projectPath);
    }).not.toThrow();

    expect(result?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-PROJECT-010',
          category: 'project',
          status: 'FAIL',
          problem: 'EACCES: permission denied',
          file: blockedMainPath,
        }),
      ])
    );
    expect(result?.uiBundlesPaths).toContain(workingUiBundlesPath);
  });

  it('distinguishes a package main lstat failure from an absent path and continues', () => {
    writeFileSync(
      join(projectPath, 'sfdx-project.json'),
      JSON.stringify({
        packageDirectories: [{ path: 'blocked' }, { path: 'working' }],
        sourceApiVersion: '67.0',
      })
    );

    const blockedMainPath = join(projectPath, 'blocked', 'main');
    const workingUiBundlesPath = join(
      projectPath,
      'working',
      'main',
      'custom',
      'uiBundles'
    );

    mkdirSync(blockedMainPath, { recursive: true });
    mkdirSync(workingUiBundlesPath, { recursive: true });

    const accessError = Object.assign(new Error('EACCES: permission denied'), {
      code: 'EACCES',
    });
    vi.mocked(lstatSync).mockImplementationOnce(() => {
      throw accessError;
    });

    const result = discoverProject(projectPath);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-PROJECT-010',
          status: 'FAIL',
          problem: 'EACCES: permission denied',
          file: blockedMainPath,
        }),
      ])
    );
    expect(result.uiBundlesPaths).toContain(workingUiBundlesPath);
  });

  it('reports a custom uiBundles path that exists but is not a directory', () => {
    writeFileSync(
      join(projectPath, 'sfdx-project.json'),
      JSON.stringify({
        packageDirectories: [{ path: 'force-app' }],
        sourceApiVersion: '67.0',
      })
    );

    const mainPath = join(projectPath, 'force-app', 'main');
    const invalidUiBundlesPath = join(mainPath, 'custom', 'uiBundles');

    mkdirSync(join(mainPath, 'default'), { recursive: true });
    mkdirSync(join(mainPath, 'custom'), { recursive: true });
    writeFileSync(invalidUiBundlesPath, 'not a directory');

    const result = discoverProject(projectPath);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-PROJECT-013',
          status: 'FAIL',
          file: invalidUiBundlesPath,
        }),
      ])
    );
  });
});
