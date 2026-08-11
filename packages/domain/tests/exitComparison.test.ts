import { describe, expect, it } from 'vitest';
import { compareComponentEntryToExit } from '../src/comparisonEngine.js';
import { sanitizeProhibitedCausation } from '../src/security.js';

describe('Exit Inspection & Entry-to-Exit Comparison Engine', () => {
  it('identifies no material change when Entry and Exit conditions match', () => {
    const entry = {
      id: 'walls-01',
      component: 'Walls',
      conditionCategory: 'intact',
      cleanlinessCategory: 'clean',
      workingStatus: 'not_applicable',
      testStatus: 'not_applicable',
      defects: [],
      commentary: 'Walls are clean and intact.',
    };

    const exit = {
      id: 'walls-01',
      component: 'Walls',
      conditionCategory: 'intact',
      cleanlinessCategory: 'clean',
      workingStatus: 'not_applicable',
      testStatus: 'not_applicable',
      defects: [],
      commentary: 'Walls inspected at exit; clean and undamaged.',
    };

    const result = compareComponentEntryToExit(entry, exit);
    expect(result.comparisonStatus).toBe('no_material_change');
    expect(result.presenceComparison).toBe('present_both');
    expect(result.conditionComparison).toBe('no_material_change');
    expect(result.cleanlinessComparison).toBe('no_material_change');
    expect(result.comparisonCommentary).not.toMatch(/tenant|bond/i);
  });

  it('detects condition deterioration when Exit component requires repair', () => {
    const entry = {
      id: 'door-01',
      component: 'Door Frame',
      conditionCategory: 'intact',
      cleanlinessCategory: 'clean',
      workingStatus: 'operation_confirmed',
      testStatus: 'tested_passed',
      defects: [],
      commentary: 'Door frame intact.',
    };

    const exit = {
      id: 'door-01',
      component: 'Door Frame',
      conditionCategory: 'repair_required',
      cleanlinessCategory: 'clean',
      workingStatus: 'operation_confirmed',
      testStatus: 'tested_passed',
      defects: ['Deep gouge to lower timber frame'],
      commentary: 'Timber gouge noted.',
    };

    const result = compareComponentEntryToExit(entry, exit);
    expect(result.comparisonStatus).toBe('material_change');
    expect(result.conditionComparison).toBe('deteriorated');
    expect(result.comparisonCommentary).toContain('Deep gouge to lower timber frame');
  });

  it('safeguards operational testing: untested at Exit yields unable_to_compare rather than failure', () => {
    const entry = {
      id: 'oven-01',
      component: 'Oven Elements',
      conditionCategory: 'intact',
      cleanlinessCategory: 'clean',
      workingStatus: 'operation_confirmed',
      testStatus: 'tested_passed',
      defects: [],
      commentary: 'Oven tested operational at entry.',
    };

    const exit = {
      id: 'oven-01',
      component: 'Oven Elements',
      conditionCategory: 'intact',
      cleanlinessCategory: 'clean',
      workingStatus: 'untested',
      testStatus: 'untested',
      defects: [],
      commentary: 'Visual inspection completed at exit; operational test omitted.',
    };

    const result = compareComponentEntryToExit(entry, exit);
    expect(result.workingComparison).toBe('unable_to_compare');
    expect(result.comparisonStatus).toBe('unable_to_compare');
    expect(result.comparisonCommentary).toContain('operational testing was not conducted at Exit');
  });

  it('handles missing component at Exit as material difference', () => {
    const entry = {
      id: 'blind-01',
      component: 'Vertical Blinds',
      conditionCategory: 'intact',
      cleanlinessCategory: 'clean',
      workingStatus: 'operation_confirmed',
      testStatus: 'tested_passed',
      defects: [],
      commentary: 'Blinds installed and operational.',
    };

    const result = compareComponentEntryToExit(entry, null);
    expect(result.presenceComparison).toBe('present_at_entry_not_identified_at_exit');
    expect(result.comparisonStatus).toBe('material_change');
  });

  it('filters prohibited causation and liability language strictly', () => {
    const rawText = 'Damage caused by tenant misconduct resulting in bond deduction.';
    const sanitized = sanitizeProhibitedCausation(rawText);
    expect(sanitized).not.toContain('tenant misconduct');
    expect(sanitized).not.toContain('bond deduction');
  });
});
