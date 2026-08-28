import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { XMLParser } from 'fast-xml-parser';

export function checkApplications(
  projectPath: string,
  bundles: string[]
) {
  let hasError = false;

  const applicationsPath = join(
    projectPath,
    'force-app',
    'main',
    'default',
    'applications'
  );

  if (!existsSync(applicationsPath)) {
    console.error('✗ applications directory not found.');
    return {
      hasError: true,
      applicationNames: [] as string[],
    };
  }

  const applicationFiles = readdirSync(applicationsPath)
    .filter((file) => file.endsWith('.app-meta.xml'));

  const parser = new XMLParser();
  const linkedBundles = new Set<string>();
  const applicationNames: string[] = [];

  for (const file of applicationFiles) {
    const filePath = join(applicationsPath, file);
    const xml = readFileSync(filePath, 'utf-8');
    const parsed = parser.parse(xml);

    const appName = file.replace('.app-meta.xml', '');
    const uiBundle = parsed.CustomApplication?.uiBundle;

    if (!uiBundle) {
      continue;
    }

    applicationNames.push(appName);

    const uiType = parsed.CustomApplication?.uiType;

    if (uiType !== 'Lightning') {
      console.error(
        `✗ ${appName}: UI Bundle app must use uiType "Lightning" (found: ${uiType ?? 'missing'})`
      );
      hasError = true;
      continue;
    }

    const bundleName = String(uiBundle).replace(/^c__/, '');

    if (!bundles.includes(bundleName)) {
      console.error(
        `✗ ${appName}: references missing UI Bundle "${uiBundle}"`
      );
      hasError = true;
      continue;
    }

    linkedBundles.add(bundleName);

    console.log(
      `✓ ${appName}: Lightning app linked to UI Bundle ${uiBundle}`
    );
  }

  for (const bundle of bundles) {
    if (!linkedBundles.has(bundle)) {
      console.error(
        `✗ ${bundle}: no CustomApplication references this UI Bundle`
      );
      hasError = true;
    }
  }

  return {
    hasError,
    applicationNames,
  };
}