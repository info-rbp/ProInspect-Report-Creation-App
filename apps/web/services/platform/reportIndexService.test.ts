import { describe, expect, it } from 'vitest';
import type { ReportIndex } from '../../types/platform';
import { normaliseReportIndex } from './reportIndexService';

describe('normaliseReportIndex', () => {
  it('uses the authoritative report resource id when legacy reportId is absent', () => {
    const record = { id: 'report-123' } as unknown as ReportIndex;
    expect(normaliseReportIndex(record)).toMatchObject({ id: 'report-123', reportId: 'report-123' });
  });

  it('preserves an explicit reportId for legacy report index records', () => {
    const record = { id: 'index-123', reportId: 'report-456' } as unknown as ReportIndex;
    expect(normaliseReportIndex(record)).toMatchObject({ id: 'index-123', reportId: 'report-456' });
  });

  it('rejects records that cannot produce a stable report route', () => {
    expect(() => normaliseReportIndex({ id: '' } as unknown as ReportIndex)).toThrow('stable report ID');
  });
});
