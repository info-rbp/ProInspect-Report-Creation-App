import { describe, expect, it } from 'vitest';
import { buildTotpMfaUpdate } from './totp-mfa-config.mjs';

describe('TOTP Identity Platform configuration', () => {
  it('is idempotent when the requested TOTP policy is already enabled', () => {
    expect(buildTotpMfaUpdate({
      multiFactorConfig: {
        state: 'ENABLED',
        providerConfigs: [{
          state: 'ENABLED',
          totpProviderConfig: { adjacentIntervals: 1 },
        }],
      },
    }, 1)).toEqual({ changed: false });
  });

  it('preserves other MFA configuration while enabling TOTP', () => {
    const existingProvider = { state: 'ENABLED', customProviderConfig: { mode: 'future-provider' } };
    const result = buildTotpMfaUpdate({
      multiFactorConfig: {
        state: 'ENABLED',
        factorIds: ['phone'],
        providerConfigs: [existingProvider],
      },
    }, 1);

    expect(result).toEqual({
      changed: true,
      multiFactorConfig: {
        state: 'ENABLED',
        factorIds: ['phone'],
        providerConfigs: [
          existingProvider,
          { state: 'ENABLED', totpProviderConfig: { adjacentIntervals: 1 } },
        ],
      },
    });
  });
});
