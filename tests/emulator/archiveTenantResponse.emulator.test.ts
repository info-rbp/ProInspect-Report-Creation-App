import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { createArchiveArtifact } from '../../apps/api/src/backend/archiveArtifactService.js';

function sha256(value: Buffer | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

beforeAll(() => {
  process.env.GOOGLE_CLOUD_PROJECT = 'demo-pcr';
  process.env.GCLOUD_PROJECT = 'demo-pcr';
  process.env.REPORT_BUCKET = 'demo-pcr-reports';
  process.env.UPLOAD_BUCKET = 'demo-pcr-uploads';
  if (!getApps().length) initializeApp({ projectId: 'demo-pcr', storageBucket: 'demo-pcr-uploads' });
});

afterAll(async () => {
  await Promise.all(getApps().map((app) => deleteApp(app)));
});

describe('archive tenant-response provenance', () => {
  it('binds canonical tenant responses and exact tenant evidence provenance into the immutable archive manifest', async () => {
    const agencyId = 'archive-agency';
    const reportId = 'archive-report';
    const versionId = 'immutable-version-1';
    const photoId = 'tenant-photo-1';
    const database = getFirestore();
    const storage = getStorage();
    const reportBucket = storage.bucket('demo-pcr-reports');

    const pdfBytes = Buffer.from('final-pdf-bytes');
    const pdfSha = sha256(pdfBytes);
    const pdfPath = `final-report-assets/reports/${reportId}/${versionId}/final.pdf`;
    const pdfFile = reportBucket.file(pdfPath);
    await pdfFile.save(pdfBytes, { resumable: false, metadata: { contentType: 'application/pdf', metadata: { sha256: pdfSha } } });
    const [pdfMetadata] = await pdfFile.getMetadata();
    const pdfGeneration = String(pdfMetadata.generation ?? '');

    const renderBytes = Buffer.from('{"render":"manifest"}\n');
    const renderSha = sha256(renderBytes);
    const renderPath = `final-report-assets/reports/${reportId}/${versionId}/final.manifest.json`;
    await reportBucket.file(renderPath).save(renderBytes, { resumable: false, metadata: { contentType: 'application/json', metadata: { sha256: renderSha } } });

    await database.doc(`agencies/${agencyId}/reports/${reportId}`).set({
      id: reportId,
      agencyId,
      propertyId: 'property-1',
      tenancyId: 'tenancy-1',
      inspectionJobId: 'job-1',
      reportType: 'Property Condition Report',
      propertyAddress: '1 Archive Street',
      templateId: 'system-entry-v1',
      templateVersion: 1,
      lifecycleStatus: 'finalised',
      currentVersionId: versionId,
      finalisedAt: '2026-08-17T10:00:00.000Z',
      finalPdfReportVersionId: versionId,
      finalPdfObjectPath: pdfPath,
      finalPdfGeneration: pdfGeneration,
      finalPdfSha256: pdfSha,
      renderManifestObjectPath: renderPath,
      renderManifestSha256: renderSha,
      version: 7,
    });
    const versionRef = database.doc(`agencies/${agencyId}/reports/${reportId}/versions/${versionId}`);
    await versionRef.set({ id: versionId, reportId, agencyId, immutable: true, contentHash: 'content-hash', createdAt: '2026-08-17T09:00:00.000Z' });
    const areaRef = versionRef.collection('areas').doc('entry');
    await areaRef.set({ id: 'entry', name: 'Entry', sequence: 1, photoReferences: [] });
    await areaRef.collection('components').doc('front-door').set({
      id: 'front-door', component: 'Front Door', conditionCategory: 'intact', cleanlinessCategory: 'clean', workingStatus: 'not_applicable', testStatus: 'not_applicable', commentary: 'Recorded Entry observation.', defects: [], photoReferences: [],
    });

    const evidencePath = `agencies/${agencyId}/properties/property-1/jobs/job-1/evidence/${photoId}/original/tenant.jpg`;
    const evidenceBytes = Buffer.from('tenant-evidence-bytes');
    const evidenceSha = sha256(evidenceBytes);
    const evidenceFile = storage.bucket('demo-pcr-uploads').file(evidencePath);
    await evidenceFile.save(evidenceBytes, { resumable: false, metadata: { contentType: 'image/jpeg' } });
    const [evidenceMetadata] = await evidenceFile.getMetadata();
    const evidenceGeneration = String(evidenceMetadata.generation ?? '');
    await database.doc(`agencies/${agencyId}/photoEvidence/${photoId}`).set({
      id: photoId,
      agencyId,
      propertyId: 'property-1',
      inspectionJobId: 'job-1',
      reportId,
      objectPath: evidencePath,
      generation: evidenceGeneration,
      sha256: evidenceSha,
      contentType: 'image/jpeg',
      status: 'uploaded',
    });
    await database.doc(`agencies/${agencyId}/reports/${reportId}/tenantResponses/response-1`).set({
      id: 'response-1',
      reportId,
      reportVersionId: versionId,
      tenancyId: 'tenancy-1',
      tenantUid: 'tenant-1',
      submittedAt: '2026-08-17T11:00:00.000Z',
      items: [{ componentId: 'front-door', response: 'comment', comment: 'Tenant records an additional observation.', photoIds: [photoId] }],
    });

    const result = await createArchiveArtifact({
      agencyId,
      reportId,
      expectedVersion: 7,
      actorId: 'reviewer-1',
      actorRole: 'reviewer',
      correlationId: 'archive-tenant-response-test',
    });
    expect(result.reportVersionId).toBe(versionId);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/u);

    const [archiveBytes] = await reportBucket.file(result.objectPath).download({ validation: false });
    expect(sha256(archiveBytes)).toBe(result.sha256);
    const manifest = JSON.parse(archiveBytes.toString('utf8')) as {
      tenantResponses: Array<Record<string, unknown>>;
      evidence: Array<Record<string, unknown>>;
    };
    expect(manifest.tenantResponses).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'response-1', items: [expect.objectContaining({ componentId: 'front-door', photoIds: [photoId] })] }),
    ]));
    expect(manifest.evidence).toContainEqual(expect.objectContaining({
      photoId,
      objectPath: evidencePath,
      generation: evidenceGeneration,
      sha256: evidenceSha,
    }));
  });
});