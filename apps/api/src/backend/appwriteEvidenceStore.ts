import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  InputFile,
  type AppwriteServerServices,
} from '@pcr/appwrite-server';
import type {
  EvidenceFileRecord,
  EvidenceStore,
  EvidenceStoreCompletionInput,
  EvidenceStoreUploadInput,
  EvidenceUploadSessionRecord,
} from './types.js';

function failure(
  code: string,
  status: number,
  message: string,
  details?: Record<string, unknown>,
): Error {
  return Object.assign(
    new Error(message),
    {
      code,
      status,
      ...(details ? { details } : {}),
    },
  );
}

function code(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'code' in error
    ? Number((error as { code?: unknown }).code)
    : undefined;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sessionFromRow(
  row: Record<string, unknown>,
): EvidenceUploadSessionRecord {
  return {
    id: String(row.$id ?? row.id ?? ''),
    agencyId: String(row.agencyId ?? ''),
    userId: String(row.userId ?? ''),
    bucketId: String(row.bucketId ?? ''),
    fileId: String(row.fileId ?? ''),
    originalFilename: String(row.originalFilename ?? ''),
    mimeType: String(row.mimeType ?? ''),
    size: Number(row.size ?? 0),
    checksum: String(row.checksum ?? ''),
    expiresAt: String(row.expiresAt ?? ''),
    status: String(row.status ?? ''),
    ...(typeof row.propertyId === 'string'
      ? { propertyId: row.propertyId }
      : {}),
    ...(typeof row.managedSiteId === 'string'
      ? { managedSiteId: row.managedSiteId }
      : {}),
    ...(typeof row.inspectionJobId === 'string'
      ? { inspectionJobId: row.inspectionJobId }
      : {}),
    ...(typeof row.reportId === 'string'
      ? { reportId: row.reportId }
      : {}),
    ...(typeof row.entityType === 'string'
      ? { entityType: row.entityType }
      : {}),
    ...(typeof row.entityId === 'string'
      ? { entityId: row.entityId }
      : {}),
    ...(typeof row.completedAt === 'string'
      ? { completedAt: row.completedAt }
      : {}),
  };
}

function evidenceFromRow(
  row: Record<string, unknown>,
): EvidenceFileRecord {
  return {
    id: String(row.$id ?? row.id ?? ''),
    agencyId: String(row.agencyId ?? ''),
    bucketId: String(row.bucketId ?? ''),
    fileId: String(row.fileId ?? ''),
    entityType: String(row.entityType ?? ''),
    entityId: String(row.entityId ?? ''),
    mimeType: String(row.mimeType ?? ''),
    originalFilename: String(row.originalFilename ?? ''),
    size: Number(row.size ?? 0),
    checksum: String(row.checksum ?? ''),
    uploadedBy: String(row.uploadedBy ?? ''),
    createdAt: String(row.createdAt ?? row.$createdAt ?? ''),
    updatedAt: String(row.updatedAt ?? row.$updatedAt ?? ''),
    generation: String(row.storageVersion ?? row.$updatedAt ?? row.fileId ?? ''),
    ...(typeof row.propertyId === 'string'
      ? { propertyId: row.propertyId }
      : {}),
    ...(typeof row.managedSiteId === 'string'
      ? { managedSiteId: row.managedSiteId }
      : {}),
  };
}

function assertScope(
  session: EvidenceUploadSessionRecord,
  input: {
    actorId: string;
    entityType: string;
    entityId: string;
  },
): void {
  if (session.userId !== input.actorId) {
    throw failure(
      'UPLOAD_SESSION_ACTOR_MISMATCH',
      403,
      'Evidence upload session does not belong to this access principal.',
    );
  }

  if (
    session.entityType !== input.entityType
    || session.entityId !== input.entityId
  ) {
    throw failure(
      'UPLOAD_SESSION_SCOPE_MISMATCH',
      403,
      'Evidence upload session does not belong to this resource.',
    );
  }

  if (
    !session.expiresAt
    || Date.parse(session.expiresAt) <= Date.now()
  ) {
    throw failure(
      'UPLOAD_SESSION_EXPIRED',
      409,
      'Evidence upload session has expired.',
    );
  }
}

export class AppwriteEvidenceStore
implements EvidenceStore {
  constructor(
    private readonly services: AppwriteServerServices,
  ) {}

  async getSession(
    agencyId: string,
    uploadId: string,
  ): Promise<EvidenceUploadSessionRecord> {
    let row;
    try {
      row = await this.services.tables.getRow({
        databaseId: this.services.databaseId,
        tableId: 'upload_sessions',
        rowId: uploadId,
      });
    } catch (error) {
      if (code(error) === 404) {
        throw failure(
          'UPLOAD_SESSION_NOT_FOUND',
          404,
          'Evidence upload session was not found.',
        );
      }
      throw error;
    }

    const session = sessionFromRow(
      row as unknown as Record<string, unknown>,
    );

    if (session.agencyId !== agencyId) {
      throw failure(
        'UPLOAD_SESSION_NOT_FOUND',
        404,
        'Evidence upload session was not found.',
      );
    }

    return session;
  }

  private async bytes(
    bucketId: string,
    fileId: string,
  ): Promise<Buffer> {
    const downloaded =
      await this.services.storage.getFileDownload({
        bucketId,
        fileId,
      });

    return Buffer.from(downloaded);
  }

  async uploadBinary(
    input: EvidenceStoreUploadInput,
  ): Promise<EvidenceUploadSessionRecord> {
    const session = await this.getSession(
      input.agencyId,
      input.uploadId,
    );

    assertScope(session, input);

    if (session.status === 'completed') {
      return session;
    }

    if (input.bytes.byteLength !== session.size) {
      throw failure(
        'EVIDENCE_SIZE_MISMATCH',
        422,
        'Uploaded evidence size does not match the issued session.',
        {
          expectedSize: session.size,
          actualSize: input.bytes.byteLength,
        },
      );
    }

    if (
      input.contentType
      && session.mimeType
      && input.contentType !== session.mimeType
    ) {
      throw failure(
        'EVIDENCE_CONTENT_TYPE_MISMATCH',
        422,
        'Uploaded evidence content type does not match the issued session.',
      );
    }

    const digest = sha256(input.bytes);
    if (digest !== session.checksum) {
      throw failure(
        'EVIDENCE_HASH_MISMATCH',
        422,
        'Uploaded evidence does not match its declared SHA-256.',
        {
          expectedSha256: session.checksum,
          actualSha256: digest,
        },
      );
    }

    let existing = false;
    try {
      await this.services.storage.getFile({
        bucketId: session.bucketId,
        fileId: session.fileId,
      });
      existing = true;
    } catch (error) {
      if (code(error) !== 404) throw error;
    }

    if (existing) {
      const existingBytes = await this.bytes(
        session.bucketId,
        session.fileId,
      );
      if (
        existingBytes.byteLength !== session.size
        || sha256(existingBytes) !== session.checksum
      ) {
        throw failure(
          'EVIDENCE_OBJECT_CONFLICT',
          409,
          'An Appwrite Storage object already exists for this upload session with different content.',
        );
      }
    } else {
      await this.services.storage.createFile({
        bucketId: session.bucketId,
        fileId: session.fileId,
        file: InputFile.fromBuffer(
          Buffer.from(input.bytes),
          session.originalFilename,
        ),
        permissions: [],
      });
    }

    const updatedAt = new Date().toISOString();
    const row = await this.services.tables.updateRow({
      databaseId: this.services.databaseId,
      tableId: 'upload_sessions',
      rowId: session.id,
      data: {
        status: 'uploaded',
        updatedAt,
        updatedBy: input.actorId,
      },
    });

    return sessionFromRow(
      row as unknown as Record<string, unknown>,
    );
  }

  async complete(
    input: EvidenceStoreCompletionInput,
  ): Promise<EvidenceFileRecord> {
    const session = await this.getSession(
      input.agencyId,
      input.uploadId,
    );

    assertScope(session, input);

    if (session.status === 'completed') {
      try {
        const existing = await this.services.tables.getRow({
          databaseId: this.services.databaseId,
          tableId: 'evidence_files',
          rowId: session.id,
        });
        return evidenceFromRow(
          existing as unknown as Record<string, unknown>,
        );
      } catch (error) {
        if (code(error) !== 404) throw error;
        throw failure(
          'EVIDENCE_METADATA_MISSING',
          409,
          'Completed upload metadata is missing.',
        );
      }
    }

    let file;
    try {
      file = await this.services.storage.getFile({
        bucketId: session.bucketId,
        fileId: session.fileId,
      });
    } catch (error) {
      if (code(error) === 404) {
        throw failure(
          'EVIDENCE_OBJECT_NOT_FOUND',
          422,
          'Uploaded evidence object could not be verified.',
        );
      }
      throw error;
    }

    const bytes = await this.bytes(
      session.bucketId,
      session.fileId,
    );

    const actualSize = Number(
      (file as unknown as { sizeOriginal?: number }).sizeOriginal
      ?? bytes.byteLength,
    );
    const actualHash = sha256(bytes);

    if (actualSize !== session.size) {
      throw failure(
        'EVIDENCE_SIZE_MISMATCH',
        422,
        'Uploaded evidence size does not match the issued session.',
        {
          expectedSize: session.size,
          actualSize,
        },
      );
    }

    if (actualHash !== session.checksum) {
      throw failure(
        'EVIDENCE_HASH_MISMATCH',
        422,
        'Uploaded evidence does not match its declared SHA-256.',
        {
          expectedSha256: session.checksum,
          actualSha256: actualHash,
        },
      );
    }

    const now = new Date().toISOString();
    const storageVersion = String(
      (file as unknown as { $updatedAt?: string }).$updatedAt
      ?? session.fileId,
    );
    const outboxId = createHash('sha256')
      .update(`evidence:${session.id}`)
      .digest('hex')
      .slice(0, 36);

    const transaction =
      await this.services.tables.createTransaction({ ttl: 60 });

    try {
      const evidence = await this.services.tables.createRow({
        databaseId: this.services.databaseId,
        tableId: 'evidence_files',
        rowId: session.id,
        transactionId: transaction.$id,
        permissions: [],
        data: {
          agencyId: session.agencyId,
          status: 'active',
          bucketId: session.bucketId,
          fileId: session.fileId,
          ...(session.managedSiteId
            ? { managedSiteId: session.managedSiteId }
            : {}),
          ...(session.propertyId
            ? { propertyId: session.propertyId }
            : {}),
          entityType: input.entityType,
          entityId: input.entityId,
          category: input.category ?? 'evidence',
          mimeType: session.mimeType,
          originalFilename: session.originalFilename,
          size: actualSize,
          checksum: actualHash,
          uploadedBy: input.actorId,
          capturedAt: now,
          storageVersion,
          createdAt: now,
          updatedAt: now,
          createdBy: input.actorId,
          updatedBy: input.actorId,
        },
      });

      await this.services.tables.updateRow({
        databaseId: this.services.databaseId,
        tableId: 'upload_sessions',
        rowId: session.id,
        transactionId: transaction.$id,
        data: {
          status: 'completed',
          completedAt: now,
          updatedAt: now,
          updatedBy: input.actorId,
        },
      });

      await this.services.tables.createRow({
        databaseId: this.services.databaseId,
        tableId: 'integration_outbox',
        rowId: outboxId,
        transactionId: transaction.$id,
        permissions: [],
        data: {
          agencyId: session.agencyId,
          status: 'active',
          eventType: 'evidence.processing.requested',
          entityType: input.entityType,
          entityId: input.entityId,
          payload: JSON.stringify({
            evidenceFileId: session.id,
            bucketId: session.bucketId,
            fileId: session.fileId,
            checksum: actualHash,
            source: input.source,
          }),
          deliveryStatus: 'pending',
          attempts: 0,
          availableAt: now,
          createdAt: now,
          updatedAt: now,
          createdBy: input.actorId,
          updatedBy: input.actorId,
        },
      });

      await this.services.tables.updateTransaction({
        transactionId: transaction.$id,
        commit: true,
      });

      return evidenceFromRow({
        ...(evidence as unknown as Record<string, unknown>),
        storageVersion,
      });
    } catch (error) {
      await this.services.tables.updateTransaction({
        transactionId: transaction.$id,
        rollback: true,
      }).catch(() => undefined);
      throw error;
    }
  }
}
