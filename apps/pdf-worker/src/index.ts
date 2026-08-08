import { createHash } from 'node:crypto';
import { loadRuntimeConfig } from '@pcr/config';

const config = loadRuntimeConfig();

export interface RenderInput {
  reportId: string;
  reportVersionId: string;
  templateId: string;
  templateVersion: number;
  approvedAt: string;
  approvedBy: string;
  report: Record<string, unknown>;
  areas: Array<Record<string, unknown>>;
  assets: Array<{ photoId: string; objectPath: string; generation: string; sha256: string }>;
}

export interface RenderPackage {
  renderId: string;
  reportId: string;
  reportVersionId: string;
  templateId: string;
  templateVersion: number;
  canonicalInputHash: string;
  outputObjectPath: string;
  createdAt: string;
}

export interface ArchiveManifest {
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
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortValue(item)]));
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function buildRenderPackage(input: RenderInput, createdAt = new Date().toISOString()): RenderPackage {
  if (!input.reportId.trim() || !input.reportVersionId.trim()) throw new Error('Report and report version are required.');
  if (!input.templateId.trim() || input.templateVersion < 1) throw new Error('Published template identity is required.');
  const canonicalInputHash = sha256(canonicalJson(input));
  const renderId = sha256(`${input.reportId}|${input.reportVersionId}|${input.templateId}|${input.templateVersion}|${canonicalInputHash}`);
  return {
    renderId,
    reportId: input.reportId,
    reportVersionId: input.reportVersionId,
    templateId: input.templateId,
    templateVersion: input.templateVersion,
    canonicalInputHash,
    outputObjectPath: `final-report-assets/reports/${input.reportId}/${input.reportVersionId}/${renderId}.pdf`,
    createdAt,
  };
}

export function buildArchiveManifest(input: {
  render: RenderPackage;
  pdf: { objectPath: string; generation: string; sha256: string };
  assets: RenderInput['assets'];
  finalisedAt?: string;
  finalisedBy: string;
}): ArchiveManifest {
  if (!/^[a-f0-9]{64}$/.test(input.pdf.sha256)) throw new Error('PDF SHA-256 is required.');
  for (const asset of input.assets) if (!/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error(`Asset SHA-256 is invalid for ${asset.photoId}.`);
  const finalisedAt = input.finalisedAt ?? new Date().toISOString();
  const base = {
    reportId: input.render.reportId,
    reportVersionId: input.render.reportVersionId,
    templateId: input.render.templateId,
    templateVersion: input.render.templateVersion,
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

export function submitTenantResponse(input: Omit<TenantResponseSubmission, 'id' | 'contentHash'>): TenantResponseSubmission {
  if (!input.reportId.trim() || !input.reportVersionId.trim() || !input.tenancyId.trim() || !input.tenantUid.trim()) throw new Error('Tenant response identity is incomplete.');
  if (!input.items.length) throw new Error('Tenant response must contain at least one item.');
  for (const item of input.items) {
    if (!item.componentId.trim()) throw new Error('Tenant response component is required.');
    if ((item.response === 'disagree' || item.response === 'comment') && !item.comment?.trim()) throw new Error('Disagreement and comment responses require commentary.');
  }
  const contentHash = sha256(canonicalJson(input));
  return { id: contentHash, ...structuredClone(input), contentHash };
}

export async function handlePdfTask(reportId: string): Promise<{ reportId: string; status: 'accepted' }> {
  console.log(JSON.stringify({ level: config.logLevel, message: 'pdf.accepted', reportId }));
  return { reportId, status: 'accepted' };
}
