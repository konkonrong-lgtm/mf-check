import type { DiagnosticResult } from './types.js';

export function hasFailures(diagnostics: DiagnosticResult[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.status === 'FAIL');
}
