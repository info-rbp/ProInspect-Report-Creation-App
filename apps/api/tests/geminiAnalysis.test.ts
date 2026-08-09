import { describe, expect, it } from 'vitest';
import {
  enforceWorkingStatusRules,
  sanitizeProhibitedCausation,
  validateEvidenceProvenance,
  isGeminiAvailable,
} from '../src/services/geminiAnalysisService.js';

describe('Gemini Analysis Server Rules', () => {
  it('enforces working status untested for operational items and not_applicable for static items', () => {
    // Operational items must be forced to untested
    const switchRule = enforceWorkingStatusRules('Light Switch', 'operation_confirmed', 'tested_passed');
    expect(switchRule.workingStatus).toBe('untested');
    expect(switchRule.testStatus).toBe('untested');

    const ovenRule = enforceWorkingStatusRules('Oven/Stove', 'operation_confirmed', 'tested_passed');
    expect(ovenRule.workingStatus).toBe('untested');
    expect(ovenRule.testStatus).toBe('untested');

    // Static items must be forced to not_applicable
    const wallRule = enforceWorkingStatusRules('Walls', 'operation_confirmed', 'tested_passed');
    expect(wallRule.workingStatus).toBe('not_applicable');
    expect(wallRule.testStatus).toBe('not_applicable');

    // Broken operational items preserve failure state
    const brokenSwitch = enforceWorkingStatusRules('Light Switch', 'not_working', 'tested_failed');
    expect(brokenSwitch.workingStatus).toBe('not_working');
    expect(brokenSwitch.testStatus).toBe('tested_failed');
  });

  it('sanitizes prohibited causation claims alleging tenant fault', () => {
    const rawInput = 'Tenant caused damage to wall surface near doorway due to misuse.';
    const sanitized = sanitizeProhibitedCausation(rawInput);
    expect(sanitized).not.toMatch(/tenant caused/i);
    expect(sanitized).not.toMatch(/misuse/i);
    expect(sanitized).toContain('visible wear/damage observed');
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
