import type { DiagnosticResult } from '../diagnostics/types.js';
import type { SchemaCheckRuntimeInfo } from '../checks/schema.js';
import { renderSchemaRuntime } from './schemaRuntimeRenderer.js';

type CheckRendererOptions = {
  projectPath: string;
  hasError: boolean;
  schemaRuntime?: SchemaCheckRuntimeInfo;
};

export function renderCheckResults(
  diagnostics: DiagnosticResult[],
  options: CheckRendererOptions
): void {
  console.log(`Checking project: ${options.projectPath}`);

  if (options.schemaRuntime) {
    renderSchemaRuntime(options.schemaRuntime);
  }

  for (const diagnostic of diagnostics) {
    const prefix =
      diagnostic.status === 'PASS'
        ? '✓'
        : diagnostic.status === 'FAIL'
          ? '✗'
          : diagnostic.status === 'WARN'
            ? '!'
            : '○';

    console.log(`${prefix} ${diagnostic.summary}`);
  }

  if (options.hasError) {
    console.log('\nNOT READY');
  } else {
    console.log('\nREADY');
  }
}
