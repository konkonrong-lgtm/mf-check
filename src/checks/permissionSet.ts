import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { XMLParser } from 'fast-xml-parser';

export function checkPermissionSets(projectPath: string, applicationNames: string[]) {
  if (applicationNames.length === 0) {
    return { hasError: false };
  }

  let hasError = false;

  const permissionSetsPath = join(
    projectPath,
    'force-app',
    'main',
    'default',
    'permissionsets'
  );

  if (!existsSync(permissionSetsPath)) {
    console.error('✗ permissionsets directory not found.');
    return { hasError: true };
  }

  const permissionSetFiles = readdirSync(permissionSetsPath).filter((file) =>
    file.endsWith('.permissionset-meta.xml')
  );

  const parser = new XMLParser();
  const visibleApplications = new Set<string>();

  for (const file of permissionSetFiles) {
    const filePath = join(permissionSetsPath, file);

    let parsed;

    try {
      const xml = readFileSync(filePath, 'utf-8');
      parsed = parser.parse(xml);
    } catch {
      console.error(`✗ ${file}: could not parse PermissionSet metadata`);
      hasError = true;
      continue;
    }

    const visibilities = parsed.PermissionSet?.applicationVisibilities;

    if (!visibilities) {
      continue;
    }

    const visibilityList = Array.isArray(visibilities) ? visibilities : [visibilities];

    for (const visibility of visibilityList) {
      if (visibility.visible === true && visibility.application) {
        visibleApplications.add(String(visibility.application));
      }
    }
  }

  for (const appName of applicationNames) {
    if (!visibleApplications.has(appName)) {
      console.error(`✗ ${appName}: no PermissionSet grants application visibility`);
      hasError = true;
      continue;
    }

    console.log(`✓ ${appName}: application visibility granted by PermissionSet`);
  }

  return { hasError };
}
