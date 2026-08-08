import { describe, expect, it } from 'vitest';
import { originalObjectPath, PHOTO_STORAGE_AREAS } from '../src/photoEvidence.js';

describe('photo evidence paths', () => {
  it('uses an immutable originals path with the job, session and digest', () => {
    const path = originalObjectPath({
      agencyId: 'agency-1',
      inspectionJobId: 'job-1',
      uploadSessionId: 'upload-1',
      sha256: 'a'.repeat(64),
      extension: '.JPG',
    });
    expect(path).toBe(`${PHOTO_STORAGE_AREAS.originals}/agencies/agency-1/jobs/job-1/upload-1/${'a'.repeat(64)}.jpg`);
  });

  it('sanitises unsafe extensions', () => {
    const path = originalObjectPath({
      agencyId: 'agency-1',
      inspectionJobId: 'job-1',
      uploadSessionId: 'upload-1',
      sha256: 'b'.repeat(64),
      extension: '../png',
    });
    expect(path.endsWith('.png')).toBe(true);
    expect(path).not.toContain('..');
  });
});
