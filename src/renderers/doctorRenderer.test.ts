import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderDoctorResults } from './doctorRenderer.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('renderDoctorResults', () => {
  it('renders PASS diagnostics in one line and ends with READY', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    renderDoctorResults(
      [
        {
          id: 'MF-META-001',
          category: 'metadata',
          status: 'PASS',
          summary: 'UI Bundle configuration is valid',
        },
      ],
      {
        projectPath: 'C:\\test-project',
        hasError: false,
      }
    );

    const output = logSpy.mock.calls.map(([message]) => String(message)).join('\n');

    expect(output).toContain('Diagnosing project: C:\\test-project');
    expect(output).toContain('✓ UI Bundle configuration is valid');
    expect(output).toContain('READY');
  });

  it('renders detailed information for UNKNOWN and WARN diagnostics', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    renderDoctorResults(
      [
        {
          id: 'MF-ACCESS-003',
          category: 'access',
          status: 'UNKNOWN',
          summary: 'Application access not confirmed',
          problem: 'Application visibility could not be confirmed.',
          whyItMatters: 'Users may not be able to open the application.',
          possibleCauses: ['Application access may exist only in the target org.'],
          remediation: ['Check Permission Set or Profile application visibility.'],
          file: 'force-app/main/default/applications/Test.app-meta.xml',
          docsUrl: 'https://example.com/docs',
        },
        {
          id: 'MF-META-999',
          category: 'metadata',
          status: 'WARN',
          summary: 'Metadata may require review',
        },
      ],
      {
        projectPath: 'C:\\test-project',
        hasError: false,
      }
    );

    const output = logSpy.mock.calls.map(([message]) => String(message)).join('\n');

    expect(output).toContain('○ MF-ACCESS-003 Application access not confirmed');
    expect(output).toContain('Problem:');
    expect(output).toContain('Application visibility could not be confirmed.');
    expect(output).toContain('Why it matters:');
    expect(output).toContain('Users may not be able to open the application.');
    expect(output).toContain('Possible causes:');
    expect(output).toContain('- Application access may exist only in the target org.');
    expect(output).toContain('How to fix:');
    expect(output).toContain('- Check Permission Set or Profile application visibility.');
    expect(output).toContain('force-app/main/default/applications/Test.app-meta.xml');
    expect(output).toContain('https://example.com/docs');
    expect(output).toContain('! MF-META-999 Metadata may require review');
    expect(output).toContain('READY');
  });

  it('renders FAIL diagnostics and ends with NOT READY', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    renderDoctorResults(
      [
        {
          id: 'MF-PROJECT-006',
          category: 'project',
          status: 'FAIL',
          summary: 'sfdx-project.json not found',
          problem: 'The Salesforce project configuration could not be found.',
          file: 'C:\\test-project\\sfdx-project.json',
          line: 12,
        },
      ],
      {
        projectPath: 'C:\\test-project',
        hasError: true,
      }
    );

    const output = logSpy.mock.calls.map(([message]) => String(message)).join('\n');

    expect(output).toContain('✗ MF-PROJECT-006 sfdx-project.json not found');
    expect(output).toContain('The Salesforce project configuration could not be found.');
    expect(output).toContain('C:\\test-project\\sfdx-project.json:12');
    expect(output).toContain('NOT READY');
  });
});
