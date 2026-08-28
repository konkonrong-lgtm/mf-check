import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function checkBundles(projectPath: string) {
  let hasError = false;

  const uiBundlesPath = join(
    projectPath,
    'force-app',
    'main',
    'default',
    'uiBundles'
  );

  if (!existsSync(uiBundlesPath)) {
    console.error('✗ uiBundles directory not found.');
    return { hasError: true, bundles: [] as string[] };
  }

  console.log(`✓ Found uiBundles directory: ${uiBundlesPath}`);

  const bundles = readdirSync(uiBundlesPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  if (bundles.length === 0) {
    console.error('✗ No UI Bundles found.');
    return { hasError: true, bundles };
  }

  console.log(`✓ Found UI Bundles: ${bundles.join(', ')}`);

  for (const bundle of bundles) {
    const bundlePath = join(uiBundlesPath, bundle);
    const configPath = join(bundlePath, 'ui-bundle.json');

    if (!existsSync(configPath)) {
      console.error(`✗ ${bundle}: ui-bundle.json not found.`);
      hasError = true;
      continue;
    }

    const configText = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configText);

    const outputDir = config.outputDir;

    if (!outputDir) {
      console.error(`✗ ${bundle}: outputDir is not defined.`);
      hasError = true;
      continue;
    }

    console.log(`✓ ${bundle}: outputDir = ${outputDir}`);

    const outputPath = join(bundlePath, outputDir);

    if (!existsSync(outputPath)) {
      console.error(
        `✗ ${bundle}: output directory does not exist: ${outputDir}`
      );
      hasError = true;
      continue;
    }

    console.log(`✓ ${bundle}: output directory exists`);
  }

  return { hasError, bundles };
}