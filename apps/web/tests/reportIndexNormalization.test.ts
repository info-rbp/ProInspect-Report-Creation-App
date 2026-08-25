import { describe, expect, it } from 'vitest';
import type { ReportIndex } from '../types/platform';
import { normaliseReportIndex } from '../services/platform/reportIndexService';

function report(overrides: Partial<ReportIndex> = {}): ReportIndex {
  return {
    id: 'report-1',
    reportId: 'report-1',
    reportType: 'Routine Inspection',
    lifecycleStatus: 'draft',
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z',
    ...overrides,
  };
}

describe('report register identity normalization', () => {
  it('uses reportId as the canonical route identifier', () => {
    expect(normaliseReportIndex(report({ id: 'legacy-index-id', reportId: 'report-authoritative' }))).toMatchObject({
      id: 'report-authoritative',
      reportId: 'report-authoritative',
    });
  });

  it('recovers legacy records that only contain id', () => {
    const legacy = { ...report(), id: 'legacy-report-id', reportId: undefined } as unknown as ReportIndex;
    expect(normaliseReportIndex(legacy)).toMatchObject({ id: 'legacy-report-id', reportId: 'legacy-report-id' });
  });

  it('rejects records that cannot produce a stable report route', () => {
    const invalid = { ...report(), id: '', reportId: '' } as ReportIndex;
    expect(() => normaliseReportIndex(invalid)).toThrow(/stable report identifier/u);
  });
});
