import { createHash } from 'node:crypto';
import { loadRuntimeConfig } from '@pcr/config';
import type { RenderInput } from './renderer.js';

export { pdfSafeText, renderReportPdf, wrapText } from './rendererV2.js';
export type { RenderAsset, RenderInput } from './renderer.js';

const config = loadRuntimeConfig();

export const DEFAULT_PRESENTATION_TEMPLATE_ID = 'system-standard-report';
export const DEFAULT_PRESENTATION_TEMPLATE_VERSION = 1;
export const REPORT_RENDERER_VERSION = 'shared-document-layout-v2';
export const REPORT_FONT_BUNDLE_VERSION = 'standard14-v1';

export interface RenderPresentationIdentity {
  presentationTemplateId: string;
  presentationTemplateVersion: number;
  brandingSnapshotHash: string;
  rendererVersion: string;
  fontBundleVersion: string;
}

export type VersionedRenderInput = RenderInput & Partial<RenderPresentationIdentity>;

export interface RenderPackage extends RenderPresentationIdentity {
  renderId: string;
  reportId: string;
  reportVersionId: string;
  templateId: string;
  templateVersion: number;
  canonicalInputHash: string;
  outputObjectPath: string;
  createdAt: string;
}

export interface RenderManifest extends RenderPresentationIdentity {
  renderId: string;
  reportId: string;
  reportVersionId: string;
  templateId: string;
  templateVersion: number;
  canonicalInputHash: string;
  pdf: { objectPath: string; generation: string; sha256: string };
  assets: RenderInput['assets'];
  generatedAt: string;
  generatedBy: string;
  manifestHash: string;
  immutable: true;
}

export interface ArchiveManifest extends RenderPresentationIdentity {
  archiveId: string;
  reportId: string;
  reportVersionId: string;
  templateId: string;
  templateVersion: number;
  pdf: { objectPath: string; generation: string; sha256: string };
  assets: Array<{ photoId: string; objectPath: string; generation: string; sha256: string }>;
  canonicalInputHash: string;
  manifestHash: string;
  finalisedAt: string;
  finalisedBy: string;
  immutable: true;
}

export interface TenantResponseItem {
  componentId: string;
  response: 'agree' | 'disagree' | 'comment';
  comment?: string;
  photoIds: string[];
}

export interface TenantResponseSubmission {
  id: string;
  reportId: string;
  tenancyId: string;
  tenantUid: string;
  reportVersionId: string;
  items: TenantResponseItem[];
  submittedAt: string;
  contentHash: string;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function presentationIdentity(input: VersionedRenderInput): RenderPresentationIdentity {
  const presentationTemplateId = input.presentationTemplateId?.trim() || DEFAULT_PRESENTATION_TEMPLATE_ID;
  const presentationTemplateVersion = input.presentationTemplateVersion && input.presentationTemplateVersion > 0
    ? input.presentationTemplateVersion
    : DEFAULT_PRESENTATION_TEMPLATE_VERSION;
  const brandingSnapshotHash = input.brandingSnapshotHash?.trim().toLowerCase() || sha256(canonicalJson({
    agencyName: input.report.agentCompany ?? 'ProInspect',
    address: input.report.agentAddress ?? '',
    phone: input.report.agentPhone ?? '',
    email: input.report.agentEmail ?? '',
  }));
  return {
    presentationTemplateId,
    presentationTemplateVersion,
    brandingSnapshotHash,
    rendererVersion: input.rendererVersion?.trim() || REPORT_RENDERER_VERSION,
    fontBundleVersion: input.fontBundleVersion?.trim() || REPORT_FONT_BUNDLE_VERSION,
  };
}

export function buildRenderPackage(input: VersionedRenderInput, createdAt = new Date().toISOString()): RenderPackage {
  if (!input.reportId.trim() || !input.reportVersionId.trim()) {
    throw new Error('Report and report version are required.');
  }
  if (!input.templateId.trim() || input.templateVersion < 1) {
    throw new Error('Published template identity is required.');
  }
  const presentation = presentationIdentity(input);
  if (!/^[a-f0-9]{64}$/u.test(presentation.brandingSnapshotHash)) {
    throw new Error('Branding snapshot SHA-256 is required.');
  }
  const canonicalInputHash = sha256(canonicalJson({ ...input, ...presentation }));
  const renderId = sha256(
    [
      input.reportId,
      input.reportVersionId,
      input.templateId,
      input.templateVersion,
      presentation.presentationTemplateId,
      presentation.presentationTemplateVersion,
      presentation.brandingSnapshotHash,
      presentation.rendererVersion,
      presentation.fontBundleVersion,
      canonicalInputHash,
    ].join('|'),
  );
  return {
    renderId,
    reportId: input.reportId,
    reportVersionId: input.reportVersionId,
    templateId: input.templateId,
    templateVersion: input.templateVersion,
    ...presentation,
    canonicalInputHash,
    outputObjectPath: `final-report-assets/reports/${input.reportId}/${input.reportVersionId}/${renderId}.pdf`,
    createdAt,
  };
}

export function buildRenderManifest(input: {
  render: RenderPackage;
  pdf: { objectPath: string; generation: string; sha256: string };
  assets: RenderInput['assets'];
  generatedAt?: string;
  generatedBy: string;
}): RenderManifest {
  if (!/^[a-f0-9]{64}$/.test(input.pdf.sha256)) throw new Error('PDF SHA-256 is required.');
  for (const asset of input.assets) {
    if (!/^[a-f0-9]{64}$/.test(asset.sha256)) {
      throw new Error(`Asset SHA-256 is invalid for ${asset.photoId}.`);
    }
  }
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const base = {
    renderId: input.render.renderId,
    reportId: input.render.reportId,
    reportVersionId: input.render.reportVersionId,
    templateId: input.render.templateId,
    templateVersion: input.render.templateVersion,
    presentationTemplateId: input.render.presentationTemplateId,
    presentationTemplateVersion: input.render.presentationTemplateVersion,
    brandingSnapshotHash: input.render.brandingSnapshotHash,
    rendererVersion: input.render.rendererVersion,
    fontBundleVersion: input.render.fontBundleVersion,
    canonicalInputHash: input.render.canonicalInputHash,
    pdf: input.pdf,
    assets: [...input.assets].sort((left, right) => left.photoId.localeCompare(right.photoId)),
    generatedAt,
    generatedBy: input.generatedBy,
  };
  const manifestHash = sha256(canonicalJson(base));
  return { ...base, manifestHash, immutable: true };
}

export function verifyRenderManifest(manifest: RenderManifest): boolean {
  const base = { ...manifest } as Partial<RenderManifest>;
  delete base.manifestHash;
  delete base.immutable;
  const expected = sha256(canonicalJson(base as Record<string, unknown>));
  return manifest.immutable === true && manifest.manifestHash === expected;
}

export function buildArchiveManifest(input: {
  render: RenderPackage;
  pdf: { objectPath: string; generation: string; sha256: string };
  assets: RenderInput['assets'];
  finalisedAt?: string;
  finalisedBy: string;
}): ArchiveManifest {
  if (!/^[a-f0-9]{64}$/.test(input.pdf.sha256)) throw new Error('PDF SHA-256 is required.');
  for (const asset of input.assets) {
    if (!/^[a-f0-9]{64}$/.test(asset.sha256)) {
      throw new Error(`Asset SHA-256 is invalid for ${asset.photoId}.`);
    }
  }
  const finalisedAt = input.finalisedAt ?? new Date().toISOString();
  const base = {
    reportId: input.render.reportId,
    reportVersionId: input.render.reportVersionId,
    templateId: input.render.templateId,
    templateVersion: input.render.templateVersion,
    presentationTemplateId: input.render.presentationTemplateId,
    presentationTemplateVersion: input.render.presentationTemplateVersion,
    brandingSnapshotHash: input.render.brandingSnapshotHash,
    rendererVersion: input.render.rendererVersion,
    fontBundleVersion: input.render.fontBundleVersion,
    pdf: input.pdf,
    assets: [...input.assets].sort((left, right) => left.photoId.localeCompare(right.photoId)),
    canonicalInputHash: input.render.canonicalInputHash,
    finalisedAt,
    finalisedBy: input.finalisedBy,
  };
  const manifestHash = sha256(canonicalJson(base));
  return {
    archiveId: manifestHash,
    ...base,
    manifestHash,
    immutable: true,
  };
}

export function verifyArchiveManifest(manifest: ArchiveManifest): boolean {
  const base = { ...manifest } as Partial<ArchiveManifest>;
  delete base.archiveId;
  delete base.manifestHash;
  delete base.immutable;
  const expected = sha256(canonicalJson(base as Record<string, unknown>));
  return manifest.immutable === true && manifest.archiveId === expected && manifest.manifestHash === expected;
}

export function submitTenantResponse(
  input: Omit<TenantResponseSubmission, 'id' | 'contentHash'>,
): TenantResponseSubmission {
  if (
    !input.reportId.trim() ||
    !input.reportVersionId.trim() ||
    !input.tenancyId.trim() ||
    !input.tenantUid.trim()
  ) {
    throw new Error('Tenant response identity is incomplete.');
  }
  if (!input.items.length) throw new Error('Tenant response must contain at least one item.');
  for (const item of input.items) {
    if (!item.componentId.trim()) throw new Error('Tenant response component is required.');
    if ((item.response === 'disagree' || item.response === 'comment') && !item.comment?.trim()) {
      throw new Error('Disagreement and comment responses require commentary.');
    }
  }
  const contentHash = sha256(canonicalJson(input));
  return { id: contentHash, ...structuredClone(input), contentHash };
}

export async function handlePdfTask(reportId: string): Promise<{ reportId: string; status: 'accepted' }> {
  console.log(JSON.stringify({ level: config.logLevel, message: 'pdf.accepted', reportId }));
  return { reportId, status: 'accepted' };
}
