import { createHash } from 'node:crypto';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import type { AgencyBrandingProfile, AgencyOrganisationSettings } from '@pcr/domain';
import type { ReportBrandingSnapshot, ReportPresentationTemplate } from '@pcr/report-presentation';
import { presentationTemplateForReportType } from '@pcr/report-presentation/presets';
import { firestoreDb } from './firestoreDatabase.js';
import type { PdfGenerationTask } from './pdfGenerationService.js';
import { PdfWorkerError } from './pdfGenerationService.js';

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function inspectionType(reportType: string): 'entry' | 'routine' | 'exit' | 'comparison' | 'maintenance' {
  const value = reportType.toLowerCase();
  if (value.includes('routine')) return 'routine';
  if (value.includes('exit')) return 'exit';
  if (value.includes('comparison')) return 'comparison';
  if (value.includes('maintenance') || value.includes('follow')) return 'maintenance';
  return 'entry';
}

async function publishedTemplate(
  agencyId: string,
  reportType: string,
): Promise<{ recordId: string; template: ReportPresentationTemplate }> {
  const database = firestoreDb(adminApp());
  const kind = inspectionType(reportType);
  const snapshot = await database.collection(`agencies/${agencyId}/reportPresentationTemplateVersions`).get();
  const candidates = snapshot.docs
    .map((document) => ({
      recordId: document.id,
      template: { ...document.data(), id: text(document.data().id) || document.id } as unknown as ReportPresentationTemplate,
      updatedAt: text(document.get('updatedAt')) || text(document.get('publishedAt')),
    }))
    .filter(({ template }) => template.status === 'published' && template.supportedInspectionTypes?.includes(kind))
    .sort((left, right) => {
      const leftSystem = left.template.id.startsWith('system-') ? 1 : 0;
      const rightSystem = right.template.id.startsWith('system-') ? 1 : 0;
      return leftSystem - rightSystem || right.template.version - left.template.version || right.updatedAt.localeCompare(left.updatedAt);
    });
  if (candidates[0]) return { recordId: candidates[0].recordId, template: structuredClone(candidates[0].template) };

  const now = new Date().toISOString();
  const preset = presentationTemplateForReportType(reportType, now);
  const recordId = `${preset.id}-v1`;
  const template: ReportPresentationTemplate = {
    ...preset,
    id: recordId,
    version: 1,
    status: 'published',
    supportedInspectionTypes: [kind],
    publishedAt: now,
  };
  const reference = database.doc(`agencies/${agencyId}/reportPresentationTemplateVersions/${recordId}`);
  try {
    await reference.create({ ...template, agencyId, systemDefault: true, immutable: true, createdAt: now, updatedAt: now });
  } catch (error) {
    const existing = await reference.get();
    if (!existing.exists) throw error;
    return {
      recordId,
      template: { ...existing.data(), id: text(existing.get('id')) || recordId } as unknown as ReportPresentationTemplate,
    };
  }
  return { recordId, template };
}

async function brandingSnapshot(
  agencyId: string,
  template: ReportPresentationTemplate,
  capturedAt: string,
): Promise<{ snapshot: ReportBrandingSnapshot; hash: string }> {
  const database = firestoreDb(adminApp());
  const [profileSnapshot, organisationSnapshot] = await Promise.all([
    database.collection(`agencies/${agencyId}/brandingProfiles`).get(),
    database.doc(`agencies/${agencyId}/agencySettings/organisation`).get(),
  ]);
  const profile = profileSnapshot.docs
    .map((document) => ({ ...document.data(), id: document.id }) as unknown as AgencyBrandingProfile)
    .filter((candidate) => candidate.status === 'active')
    .sort((left, right) => text(right.updatedAt).localeCompare(text(left.updatedAt)))[0];
  const organisation = organisationSnapshot.exists
    ? organisationSnapshot.data() as AgencyOrganisationSettings
    : undefined;
  const agencyName = organisation?.tradingName || organisation?.registeredName || profile?.name || 'ProInspect';
  const address = organisation?.businessAddress
    ? [
        organisation.businessAddress.line1,
        organisation.businessAddress.line2,
        organisation.businessAddress.suburb,
        organisation.businessAddress.state,
        organisation.businessAddress.postcode,
      ].filter(Boolean).join(', ')
    : undefined;
  const snapshot: ReportBrandingSnapshot = {
    profileId: profile?.id || 'system-organisation-branding',
    profileVersion: positiveInteger(profile?.version) || positiveInteger(organisation?.version) || 1,
    agencyName,
    ...(organisation?.registeredName && organisation.registeredName !== agencyName
      ? { tradingName: organisation.registeredName }
      : {}),
    ...(profile?.logoAssetId ? { logoDocumentId: profile.logoAssetId } : {}),
    ...(organisation?.abn ? { abn: organisation.abn } : {}),
    ...(organisation?.contactPhone ? { phone: organisation.contactPhone } : {}),
    ...(organisation?.contactEmail ? { email: organisation.contactEmail } : {}),
    ...(organisation?.website ? { website: organisation.website } : {}),
    ...(address ? { address } : {}),
    primaryColour: profile?.primaryColour || '#1D4ED8',
    secondaryColour: profile?.secondaryColour || '#0F172A',
    accentColour: profile?.accentColour || '#0284C7',
    headingFont: template.typography.headingFont,
    bodyFont: template.typography.bodyFont,
    ...(profile?.reportFooterText || profile?.legalFooter
      ? { footerText: profile.reportFooterText || profile.legalFooter }
      : {}),
    capturedAt,
  };
  return { snapshot, hash: hash(snapshot) };
}

export async function ensureReportPresentationIdentity(task: PdfGenerationTask): Promise<void> {
  const database = firestoreDb(adminApp());
  const reportRef = database.doc(`agencies/${task.agencyId}/reports/${task.reportId}`);
  await database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reportRef);
    if (!snapshot.exists) throw new PdfWorkerError('REPORT_NOT_FOUND', 'Report not found.');
    const report = snapshot.data() as Record<string, unknown>;
    if (text(report.lifecycleStatus) !== 'finalisation_ready') {
      throw new PdfWorkerError('REPORT_NOT_FINALISATION_READY', 'Report presentation can only be pinned at finalisation readiness.');
    }
    if (
      report.presentationTemplateSnapshot &&
      report.brandingSnapshot &&
      text(report.presentationTemplateId) &&
      positiveInteger(report.presentationTemplateVersion) &&
      /^[a-f0-9]{64}$/u.test(text(report.brandingSnapshotHash))
    ) {
      return;
    }
  });

  const current = await reportRef.get();
  if (!current.exists) throw new PdfWorkerError('REPORT_NOT_FOUND', 'Report not found.');
  const report = current.data() as Record<string, unknown>;
  const reportType = text(report.reportType) || 'Property Condition Report';
  const selected = await publishedTemplate(task.agencyId, reportType);
  const capturedAt = new Date().toISOString();
  const branding = await brandingSnapshot(task.agencyId, selected.template, capturedAt);

  await database.runTransaction(async (transaction) => {
    const latest = await transaction.get(reportRef);
    if (!latest.exists) throw new PdfWorkerError('REPORT_NOT_FOUND', 'Report not found.');
    const latestReport = latest.data() as Record<string, unknown>;
    if (text(latestReport.lifecycleStatus) !== 'finalisation_ready') {
      throw new PdfWorkerError('REPORT_NOT_FINALISATION_READY', 'Report changed state while presentation identity was being resolved.');
    }
    if (latestReport.presentationTemplateSnapshot && latestReport.brandingSnapshot) return;
    transaction.update(reportRef, {
      presentationTemplateId: selected.template.id,
      presentationTemplateVersion: selected.template.version,
      presentationTemplateRecordId: selected.recordId,
      presentationTemplateSnapshot: selected.template,
      brandingProfileId: branding.snapshot.profileId,
      brandingProfileVersion: branding.snapshot.profileVersion,
      brandingSnapshot: branding.snapshot,
      brandingSnapshotHash: branding.hash,
      presentationPinnedAt: capturedAt,
      updatedAt: capturedAt,
    });
  });
}
