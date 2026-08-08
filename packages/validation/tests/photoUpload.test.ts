import { describe, expect, it } from 'vitest';
import { evidenceUploadSessionSchema } from '../src/photoUpload.js';

const validUpload = {
  fileName: 'kitchen.jpg',
  contentType: 'image/jpeg',
  size: 1_024_000,
  sha256: 'a'.repeat(64),
  propertyId: 'property-1',
  inspectionJobId: 'job-1',
  reportId: 'report-1',
  areaId: 'kitchen',
  componentIds: ['walls', 'flooring'],
};

describe('evidence upload validation', () => {
  it('accepts a fully linked image upload', () => {
    const result = evidenceUploadSessionSchema.parse(validUpload);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sha256).toBe('a'.repeat(64));
  });

  it('rejects a missing cryptographic hash', () => {
    const result = evidenceUploadSessionSchema.parse({ ...validUpload, sha256: undefined });
    expect(result.ok).toBe(false);
  });

  it('rejects PDFs and unsupported image formats as original photo evidence', () => {
    expect(evidenceUploadSessionSchema.parse({ ...validUpload, contentType: 'application/pdf' }).ok).toBe(false);
    expect(evidenceUploadSessionSchema.parse({ ...validUpload, contentType: 'image/svg+xml' }).ok).toBe(false);
  });

  it('requires property and inspection job linkage', () => {
    expect(evidenceUploadSessionSchema.parse({ ...validUpload, propertyId: '' }).ok).toBe(false);
    expect(evidenceUploadSessionSchema.parse({ ...validUpload, inspectionJobId: '' }).ok).toBe(false);
  });
});
