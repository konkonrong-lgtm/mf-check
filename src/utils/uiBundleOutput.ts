import { join, resolve, sep } from 'node:path';

const DOT_DOT_SEGMENT = /(?:^|[/\\])\.\.[/\\]|(?:^|[/\\])\.\.$/;

function getUnsafePathReason(value: string): string | undefined {
  if (DOT_DOT_SEGMENT.test(value) || value === '..') {
    return 'path traversal (..)';
  }

  if (value === '.' || value === './') {
    return 'current directory reference (use a subdirectory path)';
  }

  if (value.startsWith('/') || value.startsWith('\\')) {
    return 'absolute path';
  }

  if (value.includes('\0')) {
    return 'null byte';
  }

  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) < 0x20) {
      return 'control character';
    }
  }

  if (value.includes('*') || value.includes('?')) {
    return 'glob wildcard';
  }

  if (value.includes('\\')) {
    return 'backslash (use forward slashes)';
  }

  if (value.includes('%')) {
    return 'percent-encoding';
  }

  return undefined;
}

export function resolveUiBundleOutputPath(
  bundlePath: string,
  rawOutputDir: string
): string {
  // SDR treats leading forward slashes as bundle-relative for outputDir.
  const outputDir = rawOutputDir.replace(/^\/+/, '');

  if (outputDir.length === 0) {
    throw new Error('outputDir must not be empty.');
  }

  const unsafeReason = getUnsafePathReason(outputDir);

  if (unsafeReason) {
    throw new Error(`outputDir "${rawOutputDir}" contains ${unsafeReason}.`);
  }

  const resolvedBundlePath = resolve(bundlePath);
  const resolvedOutputPath = resolve(join(bundlePath, outputDir));
  const bundlePrefix = `${resolvedBundlePath}${sep}`;

  if (
    !resolvedOutputPath.startsWith(bundlePrefix) &&
    resolvedOutputPath !== resolvedBundlePath
  ) {
    throw new Error(
      `outputDir "${rawOutputDir}" resolves outside the application bundle.`
    );
  }

  if (resolvedOutputPath === resolvedBundlePath) {
    throw new Error(
      `outputDir "${rawOutputDir}" resolves to the bundle root and must reference a subdirectory.`
    );
  }

  return resolvedOutputPath;
}
