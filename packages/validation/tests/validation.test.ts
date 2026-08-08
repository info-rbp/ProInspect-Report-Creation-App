import { describe, expect, it } from 'vitest';
import { parseInspectionType, requireNonEmptyString } from '../src/index.js';
describe('shared validation', () => {
  it('accepts the five inspection types', () => expect(parseInspectionType('comparison')).toEqual({ ok: true, value: 'comparison' }));
  it('returns a consistent error', () => expect(requireNonEmptyString('', 'propertyId')).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', status: 400 } }));
});
