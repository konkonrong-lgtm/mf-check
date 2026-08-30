import type { DiagnosticResult } from '../diagnostics/types.js';
import type { SchemaCheckRuntimeInfo } from '../checks/schema.js';
import { renderSchemaRuntime } from './schemaRuntimeRenderer.js';

type DoctorRendererOptions = {
  projectPath: string;
  hasError: boolean;
  schemaRuntime?: SchemaCheckRuntimeInfo;
};

export function renderDoctorResults(
  diagnostics: DiagnosticResult[],
  options: DoctorRendererOptions
): void {
  console.log(`Diagnosing project: ${options.projectPath}`);
  if (options.schemaRuntime) {
    renderSchemaRuntime(options.schemaRuntime);
  }
  for (const diagnostic of diagnostics) {
    if (diagnostic.status === 'PASS') {
      console.log(`✓ ${diagnostic.summary}`);
      continue;
    }

    const prefix =
      diagnostic.status === 'FAIL' ? '✗' : diagnostic.status === 'WARN' ? '!' : '○';

    console.log(`\n${prefix} ${diagnostic.id} ${diagnostic.summary}`);

    if (diagnostic.problem) {
      console.log('  Problem:');
      console.log(`  ${diagnostic.problem}`);
    }

    if (diagnostic.whyItMatters) {
      console.log('  Why it matters:');
      console.log(`  ${diagnostic.whyItMatters}`);
    }

    if (diagnostic.possibleCauses) {
      console.log('  Possible causes:');

      for (const cause of diagnostic.possibleCauses) {
        console.log(`  - ${cause}`);
      }
    }

    if (diagnostic.remediation) {
      console.log('  How to fix:');

      for (const step of diagnostic.remediation) {
        console.log(`  - ${step}`);
      }
    }

    if (diagnostic.file) {
      const location =
        diagnostic.line !== undefined
          ? `${diagnostic.file}:${diagnostic.line}`
          : diagnostic.file;

      console.log('  File:');
      console.log(`  ${location}`);
    }

    if (diagnostic.docsUrl) {
      console.log('  Docs:');
      console.log(`  ${diagnostic.docsUrl}`);
    }
  }

  if (options.hasError) {
    console.log('\nNOT READY');
  } else {
    console.log('\nREADY');
  }
}
