import { afterEach, describe, expect, it } from 'vitest';
import {
  enforceWorkingStatusRules,
  generateBatchRoomAnalysisServer,
  generateItemCommentServer,
  sanitizeProhibitedCausation,
} from '../src/services/geminiAnalysisService.js';

const originalKey = process.env.GEMINI_API_KEY;
afterEach(() => {
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalKey;
});

describe('server AI evidence safeguards', () => {
  it('fails closed instead of fabricating a positive component assessment when Gemini is unavailable', async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(generateItemCommentServer('Oven', 'Kitchen', [], '')).rejects.toThrow('AI analysis is unavailable');
  });

  it('fails closed instead of manufacturing clean/intact batch results', async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(
      generateBatchRoomAnalysisServer('Kitchen', [], [{ id: 'walls', name: 'Walls' }], ''),
    ).rejects.toThrow('AI analysis is unavailable');
  });

  it('never treats photo analysis as an operational test', () => {
    expect(enforceWorkingStatusRules('Exhaust Fan', 'not_working', 'tested_failed')).toEqual({
      workingStatus: 'untested',
      testStatus: 'untested',
    });
    expect(enforceWorkingStatusRules('Walls', 'operation_confirmed', 'tested_passed')).toEqual({
      workingStatus: 'not_applicable',
      testStatus: 'not_applicable',
    });
  });

  it('removes causation and bond conclusions from AI wording', () => {
    const text = sanitizeProhibitedCausation('Tenant damaged the wall. Deduct from bond.');
    expect(text.toLowerCase()).not.toContain('tenant damaged');
    expect(text.toLowerCase()).not.toContain('deduct from bond');
  });
});
