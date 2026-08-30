import { describe, expect, it } from 'vitest';

import { hasReadinessBlockers } from '../diagnostics/result.js';
import { checkAppAccess } from './appAccess.js';

describe('checkAppAccess', () => {
  it('passes when application visibility is granted by PermissionSet', () => {
    const result = checkAppAccess(['MfLabReact'], ['MfLabReact'], []);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-ACCESS-004',
          status: 'PASS',
          summary: 'MfLabReact: application visibility granted by PermissionSet',
        }),
      ])
    );
  });

  it('passes when application visibility is granted by Profile', () => {
    const result = checkAppAccess(['MfLabReact'], [], ['MfLabReact']);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-ACCESS-004',
          status: 'PASS',
          summary: 'MfLabReact: application visibility granted by Profile',
        }),
      ])
    );
  });

  it('passes when application visibility is granted by both PermissionSet and Profile', () => {
    const result = checkAppAccess(['MfLabReact'], ['MfLabReact'], ['MfLabReact']);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-ACCESS-004',
          status: 'PASS',
          summary:
            'MfLabReact: application visibility granted by PermissionSet and Profile',
        }),
      ])
    );
  });

  it('returns UNKNOWN when application visibility is not granted by PermissionSet or Profile', () => {
    const result = checkAppAccess(['MfLabReact'], [], []);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'MF-ACCESS-003',
          status: 'UNKNOWN',
          blocksReadiness: true,
        }),
      ])
    );

    expect(hasReadinessBlockers(result.diagnostics)).toBe(true);
  });
});
