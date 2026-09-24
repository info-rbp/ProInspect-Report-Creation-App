import { createHash } from 'node:crypto';
import { InputFile } from 'node-appwrite/file';
import { workerDatabase } from './workerRepository.js';
import type { AppwriteServerServices } from './client.js';
export const workerDigest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export async function downloadWorkerEvidence(agencyId: string, evidenceId: string, services = workerDatabase().services): Promise<{ bytes: Uint8Array; metadata: Record<string, unknown> }> {
  const row = await services.tables.getRow({ databaseId: services.databaseId, tableId: 'evidence_files', rowId: evidenceId });
  if (row.agencyId !== agencyId) throw new Error('Evidence agency scope mismatch');
  if (!/^[a-f0-9]{64}$/u.test(String(row.checksum)) || !row.storageVersion) throw new Error('Evidence immutable provenance is incomplete');
  const metadata = await services.storage.getFile({ bucketId: String(row.bucketId), fileId: String(row.fileId) });
  if (metadata.$updatedAt !== row.storageVersion) throw new Error('Evidence storage version mismatch');
  const bytes = new Uint8Array(await services.storage.getFileDownload({ bucketId: String(row.bucketId), fileId: String(row.fileId) }));
  if (workerDigest(bytes) !== row.checksum) throw new Error('Evidence SHA-256 mismatch');
  return { bytes, metadata: row };
}
export async function saveWorkerArtifact(services: AppwriteServerServices, input: { bucketId: string; path: string; bytes: Uint8Array; sha256: string; contentType: string }): Promise<{ fileId: string; generation: string }> {
  if (!['reports', 'property-documents', 'report-artifacts'].includes(input.bucketId)) throw new Error('Unapproved artifact bucket');
  if (workerDigest(input.bytes) !== input.sha256) throw new Error('Output SHA-256 mismatch');
  const fileId = createHash('sha256').update(`${input.bucketId}\0${input.path}`).digest('hex').slice(0, 36);
  const args = { bucketId: input.bucketId, fileId };
  try { await services.storage.createFile({ ...args, file: InputFile.fromBuffer(Buffer.from(input.bytes), `${fileId}.${input.contentType === 'application/pdf' ? 'pdf' : 'json'}`), permissions: [] }); }
  catch (error) { if (Number((error as { code?: number }).code) !== 409) throw error; }
  const metadata = await services.storage.getFile(args);
  const actual = new Uint8Array(await services.storage.getFileDownload(args));
  if (workerDigest(actual) !== input.sha256) throw new Error('Immutable artifact conflict');
  return { fileId, generation: metadata.$createdAt };
}
