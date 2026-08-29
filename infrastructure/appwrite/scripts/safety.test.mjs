import { describe, expect, it } from 'vitest';
import { assertDevelopmentTarget } from './safety.mjs';

describe('Appwrite deployment safety', () => {
  const input = { projectId: 'proinspect-development', projectName: 'ProInspect Development', endpoint: 'https://syd.cloud.appwrite.io/v1' };
  it('accepts an explicit Development target and confirmation', () => expect(assertDevelopmentTarget(input, 'push-development')).toEqual(input));
  it('rejects ambiguous and production project names', () => {
    expect(() => assertDevelopmentTarget({ ...input, projectName: 'ProInspect Platform' }, 'push-development')).toThrow(/Development/);
    expect(() => assertDevelopmentTarget({ ...input, projectName: 'ProInspect Production' }, 'push-development')).toThrow(/Development/);
  });
  it('rejects placeholder IDs and missing confirmation', () => {
    expect(() => assertDevelopmentTarget({ ...input, projectId: 'DEVELOPMENT_PROJECT_ID_REQUIRED' }, 'push-development')).toThrow(/real Development/);
    expect(() => assertDevelopmentTarget(input, undefined)).toThrow(/confirmation/);
  });
  it('rejects the prohibited project, any other Development ID, and a non-Sydney endpoint', () => {
    expect(() => assertDevelopmentTarget({ ...input, projectId: '6a911f1e0031e90015b2' }, 'push-development')).toThrow(/prohibited/);
    expect(() => assertDevelopmentTarget({ ...input, projectId: 'another-development' }, 'push-development')).toThrow(/proinspect-development/);
    expect(() => assertDevelopmentTarget({ ...input, endpoint: 'https://cloud.appwrite.io/v1' }, 'push-development')).toThrow(/syd/);
  });
});
