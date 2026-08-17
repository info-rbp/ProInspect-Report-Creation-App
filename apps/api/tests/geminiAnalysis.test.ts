import { describe, expect, it } from 'vitest';
import {
  enforceWorkingStatusRules,
  sanitizeProhibitedCausation,
  validateEvidenceProvenance,
  isGeminiAvailable,
} from '../src/services/geminiAnalysisService.js';

describe('Gemini Analysis Server Rules', () => {
  it('keeps operational items untested during photo analysis and marks static items not applicable', () => {
    const switchRule = enforceWorkingStatusRules('Light Switch', 'operation_confirmed', 'tested_passed');
    expect(switchRule.workingStatus).toBe('untested');
    expect(switchRule.testStatus).toBe('untested');

    const ovenRule = enforceWorkingStatusRules('Oven/Stove', 'operation_confirmed', 'tested_passed');
    expect(ovenRule.workingStatus).toBe('untested');
    expect(ovenRule.testStatus).toBe('untested');

    const wallRule = enforceWorkingStatusRules('Walls', 'operation_confirmed', 'tested_passed');
    expect(wallRule.workingStatus).toBe('not_applicable');
    expect(wallRule.testStatus).toBe('not_applicable');

    // A photo-only model response is not a physical operational test, even if the
    // model attempts to return a failure state. Tested failure belongs to the
    // inspector/test workflow, not visual analysis.
    const photoOnlyFailure = enforceWorkingStatusRules('Light Switch', 'not_working', 'tested_failed');
    expect(photoOnlyFailure.workingStatus).toBe('untested');
    expect(photoOnlyFailure.testStatus).toBe('untested');
  });

  it('sanitizes prohibited causation claims alleging tenant fault while retaining the visible issue', () => {
    const rawInput = 'Tenant caused damage to wall surface near doorway due to misuse.';
    const sanitized = sanitizeProhibitedCausation(rawInput);
    expect(sanitized).not.toMatch(/tenant caused/i);
    expect(sanitized).not.toMatch(/misuse/i);
    expect(sanitized.toLowerCase()).toContain('damage to wall surface near doorway');
  });

  it('validates evidence photo provenance against request photo set', () => {
    const validPhotos = new Set(['photo-1', 'photo-2']);

    const validEvidence = validateEvidenceProvenance(['photo-1'], validPhotos);
    expect(validEvidence).toEqual(['photo-1']);

    const invalidEvidence = validateEvidenceProvenance(['invalid-id-999'], validPhotos);
    expect(invalidEvidence).toEqual([]);
  });

  it('checks Gemini API availability based on server environment variable', () => {
    const originalKey = process.env.GEMINI_API_KEY;
    try {
      process.env.GEMINI_API_KEY = 'test-key-123';
      expect(isGeminiAvailable()).toBe(true);

      process.env.GEMINI_API_KEY = '';
      expect(isGeminiAvailable()).toBe(false);
    } finally {
      process.env.GEMINI_API_KEY = originalKey;
    }
  });
});
