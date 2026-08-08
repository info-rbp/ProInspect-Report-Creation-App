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
      isClean: null,
      isUndamaged: null,
      isWorking: null,
    });

    expect(getAggregateRoomStatus([
      { id: '1', name: 'Walls', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: '2', name: 'Floor', isClean: false, isUndamaged: true, isWorking: true, comment: '' },
    ])).toEqual({
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
