import {
  MAX_IMAGE_SIZE_BYTES,
  MAX_PREVIOUS_REPORT_SIZE_BYTES,
  sanitizeReportData,
  validateImageFiles,
  validatePreviousReportFile,
  validateReport,
} from '../services/validationService';
import { ReportData } from '../types';

const buildReport = (): ReportData => ({
  id: 'report-1',
  propertyAddress: ' 12 Example Street ',
  agentName: ' Inspector ',
  agentCompany: ' Remote Business Partner ',
  agentAddress: ' Perth ',
  agentPhone: ' 0400 000 000 ',
  agentEmail: ' test@example.com ',
  clientName: ' Client ',
  inspectionDate: '2026-05-26',
  tenantName: ' Tenant ',
  reportType: 'Property Condition Report',
  rooms: [
    {
      id: 'room-1',
      name: ' Kitchen ',
      status: 'draft',
      overallComment: '  Needs review.  ',
      photos: [],
      items: [
        { id: 'item-1', name: ' Walls ', isClean: true, isUndamaged: true, isWorking: true, comment: '  Clean. ' },
      ],
    },
  ],
});

describe('validationService', () => {
  it('sanitizes report text fields', () => {
    const sanitized = sanitizeReportData(buildReport());

    expect(sanitized.propertyAddress).toBe('12 Example Street');
    expect(sanitized.agentName).toBe('Inspector');
    expect(sanitized.rooms[0].name).toBe('Kitchen');
    expect(sanitized.rooms[0].items[0].comment).toBe('Clean.');
  });

  it('reports missing required fields', () => {
    const report = buildReport();
    report.propertyAddress = '';
    report.rooms = [];

    const result = validateReport(report);
    expect(result.errors).toContain('Property address is required.');
    expect(result.errors).toContain('At least one room or area must be added before saving or exporting a report.');
  });

  it('validates image uploads', () => {
    const validFile = new File(['x'], 'kitchen.jpg', { type: 'image/jpeg' });
    const invalidFile = new File(['x'], 'notes.txt', { type: 'text/plain' });
    Object.defineProperty(invalidFile, 'size', { value: MAX_IMAGE_SIZE_BYTES + 1 });

    const result = validateImageFiles([validFile, invalidFile]);
    expect(result.validFiles).toHaveLength(1);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('validates previous report attachments', () => {
    const tooLargePdf = new File(['x'], 'previous.pdf', { type: 'application/pdf' });
    Object.defineProperty(tooLargePdf, 'size', { value: MAX_PREVIOUS_REPORT_SIZE_BYTES + 1 });

    expect(validatePreviousReportFile(tooLargePdf)).toContain('Previous report attachments must be 20MB or smaller.');
  });
});
