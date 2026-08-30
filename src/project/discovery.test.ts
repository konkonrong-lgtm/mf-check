import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

    mkdirSync(join(projectPath, 'src', 'main', 'default'), {
      recursive: true,
    });

    const result = discoverProject(projectPath);

    expect(result.metadataRoots).toEqual([join(projectPath, 'src', 'main', 'default')]);
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

    mkdirSync(join(projectPath, 'core', 'main', 'default'), {
      recursive: true,
    });

    mkdirSync(join(projectPath, 'feature', 'main', 'default'), {
      recursive: true,
    });

    const result = discoverProject(projectPath);

    expect(result.metadataRoots).toEqual([
      join(projectPath, 'core', 'main', 'default'),
      join(projectPath, 'feature', 'main', 'default'),
    ]);
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

    mkdirSync(join(projectPath, 'src', 'main', 'default'), {
      recursive: true,
    });

    const result = discoverProject(projectPath);

    expect(result.metadataRoots).toEqual([join(projectPath, 'src', 'main', 'default')]);

    expect(result.sourceApiVersion).toBe('67.0');
  });
});
