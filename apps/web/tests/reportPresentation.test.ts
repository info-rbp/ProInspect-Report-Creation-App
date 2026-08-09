import {
  ENTRY_REPORT_TYPE,
  EXIT_REPORT_TYPE,
  ROUTINE_REPORT_TYPE,
  formatChecklistValue,
  getAggregateRoomStatus,
  getReportDisplayTitle,
  supportsComparison,
} from '../services/reportPresentation';

describe('reportPresentation', () => {
  it('maps report types to display titles', () => {
    expect(getReportDisplayTitle(ENTRY_REPORT_TYPE)).toBe('Property Condition Report');
    expect(getReportDisplayTitle(ROUTINE_REPORT_TYPE)).toBe('Routine Inspection Report');
    expect(getReportDisplayTitle(EXIT_REPORT_TYPE)).toBe('Exit Condition Report');
  });

  it('detects report types that support comparison', () => {
    expect(supportsComparison(ENTRY_REPORT_TYPE)).toBe(false);
    expect(supportsComparison(ROUTINE_REPORT_TYPE)).toBe(true);
    expect(supportsComparison(EXIT_REPORT_TYPE)).toBe(true);
  });

  it('aggregates item statuses correctly', () => {
    expect(getAggregateRoomStatus([])).toEqual({
      allClean: false,
      allIntact: false,
      issuesCount: 0,
      maintenanceCount: 0,
      untestedCount: 0,
      isClean: null,
      isUndamaged: null,
      isWorking: null,
    });

    expect(getAggregateRoomStatus([
      { id: '1', name: 'Walls', cleanlinessCategory: 'clean', conditionCategory: 'intact', workingStatus: 'operation_confirmed', testStatus: 'not_applicable', defects: [], maintenanceRequired: false, comment: '' },
      { id: '2', name: 'Floor', cleanlinessCategory: 'requires_cleaning', conditionCategory: 'intact', workingStatus: 'operation_confirmed', testStatus: 'not_applicable', defects: [], maintenanceRequired: false, comment: '' },
    ])).toEqual({
      allClean: false,
      allIntact: true,
      issuesCount: 1,
      maintenanceCount: 0,
      untestedCount: 0,
      isClean: false,
      isUndamaged: true,
      isWorking: true,
    });
  });

  it('formats checklist values for PDF output', () => {
    expect(formatChecklistValue(true)).toBe('Y');
    expect(formatChecklistValue(false)).toBe('N');
    expect(formatChecklistValue(null)).toBe('');
  });
});
