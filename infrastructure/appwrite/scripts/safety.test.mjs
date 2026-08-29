import { describe, expect, it } from 'vitest';
import { assertDevelopmentTarget } from './safety.mjs';

describe('Appwrite deployment safety', () => {
  const input = { projectId: 'development-id', projectName: 'ProInspect Development', endpoint: 'https://syd.cloud.appwrite.io/v1' };
  it('accepts an explicit Development target and confirmation', () => expect(assertDevelopmentTarget(input, 'push-development')).toEqual(input));
  it('rejects ambiguous and production project names', () => {
    expect(() => assertDevelopmentTarget({ ...input, projectName: 'ProInspect Platform' }, 'push-development')).toThrow(/Development/);
    expect(() => assertDevelopmentTarget({ ...input, projectName: 'ProInspect Production' }, 'push-development')).toThrow(/Development/);
  });
  it('rejects placeholder IDs and missing confirmation', () => {
    expect(() => assertDevelopmentTarget({ ...input, projectId: 'DEVELOPMENT_PROJECT_ID_REQUIRED' }, 'push-development')).toThrow(/real Development/);
    expect(() => assertDevelopmentTarget(input, undefined)).toThrow(/confirmation/);
  });
});
