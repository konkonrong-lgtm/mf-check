import { describe, expect, it } from 'vitest';

import type { DiagnosticResult } from './types.js';
import { hasReadinessBlockers } from './result.js';

function diagnostic(
  status: DiagnosticResult['status'],
  blocksReadiness?: boolean
): DiagnosticResult {
  return {
    id: 'TEST-DIAGNOSTIC',
    category: 'project',
    status,
    summary: 'Test diagnostic',
    ...(blocksReadiness === undefined ? {} : { blocksReadiness }),
  };
}

describe('hasReadinessBlockers', () => {
  it('blocks readiness for an explicitly blocking UNKNOWN diagnostic', () => {
    expect(hasReadinessBlockers([diagnostic('UNKNOWN', true)])).toBe(true);
  });

  it('blocks readiness for a FAIL diagnostic', () => {
    expect(hasReadinessBlockers([diagnostic('FAIL')])).toBe(true);
  });

  it('does not block readiness for a regular UNKNOWN diagnostic', () => {
    expect(
      hasReadinessBlockers([
        {
          id: 'MF-GRAPHQL-007',
          category: 'data',
          status: 'UNKNOWN',
          summary: 'Live GraphQL check skipped: no target org provided',
        },
      ])
    ).toBe(false);
  });

  it('does not block readiness when every diagnostic passes', () => {
    expect(hasReadinessBlockers([diagnostic('PASS')])).toBe(false);
  });
});
