import type { DiagnosticResult } from './types.js';

export function hasFailures(diagnostics: DiagnosticResult[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.status === 'FAIL');
}

export function hasReadinessBlockers(diagnostics: DiagnosticResult[]): boolean {
  return diagnostics.some(
    (diagnostic) => diagnostic.status === 'FAIL' || diagnostic.blocksReadiness === true
  );
}
