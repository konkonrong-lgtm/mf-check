export type DiagnosticStatus = 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN';

export type DiagnosticCategory =
  'project' | 'metadata' | 'access' | 'migration' | 'environment' | 'data';

export type DiagnosticResult = {
  id: string;
  category: DiagnosticCategory;
  status: DiagnosticStatus;
  blocksReadiness?: boolean;

  summary: string;

  problem?: string;
  whyItMatters?: string;
  possibleCauses?: string[];
  remediation?: string[];

  file?: string;
  line?: number;
  docsUrl?: string;
};
