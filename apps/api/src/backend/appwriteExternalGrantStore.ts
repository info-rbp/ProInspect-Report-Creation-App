import { createHash } from 'node:crypto';
import {
  Query,
  type AppwriteServerServices,
} from '@pcr/appwrite-server';
import type {
  ExternalGrantIssueInput,
  ExternalGrantRecord,
  ExternalGrantResourceType,
  ExternalGrantStore,
} from './types.js';

function hashToken(value: string): string {
  return createHash('sha256')
    .update(value.trim())
    .digest('hex');
}

function errorCode(
  error: unknown,
): number | undefined {
  return (
    error
    && typeof error === 'object'
    && 'code' in error
  )
    ? Number(
        (error as { code?: unknown }).code,
      )
    : undefined;
}

function record(
  row: Record<string, unknown>,
): ExternalGrantRecord {
  const createdAt = String(
    row.createdAt
    ?? row.$createdAt
    ?? new Date(0).toISOString(),
  );

  const updatedAt = String(
    row.updatedAt
    ?? row.$updatedAt
    ?? createdAt,
  );

  return {
    id: String(row.$id ?? row.id ?? ''),
    agencyId: String(row.agencyId ?? ''),
    resourceType: String(
      row.resourceType ?? '',
    ) as ExternalGrantResourceType,
    resourceId: String(row.resourceId ?? ''),
    tokenHash: String(row.tokenHash ?? ''),
    expiresAt: String(row.expiresAt ?? ''),
    version: Number(row.version ?? 1),
    createdAt,
    updatedAt,
    ...(typeof row.recipientEmail === 'string'
      ? { recipientEmail: row.recipientEmail }
      : {}),
    ...(typeof row.tenantId === 'string'
      ? { tenantId: row.tenantId }
      : {}),
    ...(typeof row.tenancyId === 'string'
      ? { tenancyId: row.tenancyId }
      : {}),
    ...(typeof row.externalContactId === 'string'
      ? {
          externalContactId:
            row.externalContactId,
        }
      : {}),
    ...(typeof row.purpose === 'string'
      ? { purpose: row.purpose }
      : {}),
    ...(typeof row.revokedAt === 'string'
      ? { revokedAt: row.revokedAt }
      : {}),
    ...(typeof row.revokedBy === 'string'
      ? { revokedBy: row.revokedBy }
      : {}),
    ...(typeof row.lastAccessedAt === 'string'
      ? { lastAccessedAt: row.lastAccessedAt }
      : {}),
    ...(typeof row.replacedByGrantId === 'string'
      ? {
          replacedByGrantId:
            row.replacedByGrantId,
        }
      : {}),
    ...(typeof row.createdBy === 'string'
      ? { createdBy: row.createdBy }
      : {}),
    ...(typeof row.updatedBy === 'string'
      ? { updatedBy: row.updatedBy }
      : {}),
  };
}

export class AppwriteExternalGrantStore
implements ExternalGrantStore {
  constructor(
    private readonly services:
      AppwriteServerServices,
  ) {}

  async issue(
    input: ExternalGrantIssueInput,
  ): Promise<ExternalGrantRecord> {
    if (!/^[a-f0-9]{64}$/u.test(input.tokenHash)) {
      throw Object.assign(
        new Error(
          'External grant tokenHash must be SHA-256.',
        ),
        {
          code: 'INVALID_GRANT_TOKEN_HASH',
          status: 400,
        },
      );
    }

    const now = new Date().toISOString();

    const row =
      await this.services.tables.createRow({
        databaseId: this.services.databaseId,
        tableId: 'external_access_grants',
        rowId: input.id,
        permissions: [],
        data: {
          agencyId: input.agencyId,
          status: 'active',
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
          version: 1,
          createdAt: now,
          updatedAt: now,
          createdBy: input.actorId,
          updatedBy: input.actorId,
          ...(input.recipientEmail
            ? {
                recipientEmail:
                  input.recipientEmail,
              }
            : {}),
          ...(input.tenantId
            ? { tenantId: input.tenantId }
            : {}),
          ...(input.tenancyId
            ? { tenancyId: input.tenancyId }
            : {}),
          ...(input.externalContactId
            ? {
                externalContactId:
                  input.externalContactId,
              }
            : {}),
          ...(input.purpose
            ? { purpose: input.purpose }
            : {}),
        },
      });

    return record(
      row as unknown as Record<string, unknown>,
    );
  }

  async resolve(
    rawToken: string,
    allowedResourceTypes:
      readonly ExternalGrantResourceType[],
  ): Promise<ExternalGrantRecord> {
    const result =
      await this.services.tables.listRows({
        databaseId: this.services.databaseId,
        tableId: 'external_access_grants',
        queries: [
          Query.equal(
            'tokenHash',
            [hashToken(rawToken)],
          ),
          Query.limit(2),
        ],
      });

    if (result.rows.length === 0) {
      throw Object.assign(
        new Error(
          'Access link is invalid or expired.',
        ),
        {
          code: 'INVALID_GRANT_TOKEN',
          status: 401,
        },
      );
    }

    if (result.rows.length !== 1) {
      throw Object.assign(
        new Error(
          'Access link cannot be resolved safely.',
        ),
        {
          code: 'AMBIGUOUS_GRANT_TOKEN',
          status: 401,
        },
      );
    }

    const grant = record(
      result.rows[0] as unknown as Record<string, unknown>,
    );

    if (
      !allowedResourceTypes.includes(
        grant.resourceType,
      )
    ) {
      throw Object.assign(
        new Error(
          'Access link is not valid for this resource.',
        ),
        {
          code: 'GRANT_SCOPE_MISMATCH',
          status: 403,
        },
      );
    }

    const resolvedRow =
      result.rows[0] as unknown as Record<string, unknown>;

    if (
      grant.revokedAt
      || resolvedRow.status === 'revoked'
    ) {
      throw Object.assign(
        new Error(
          'Access link has been revoked.',
        ),
        {
          code: 'GRANT_TOKEN_REVOKED',
          status: 401,
        },
      );
    }

    if (
      Date.parse(grant.expiresAt)
      <= Date.now()
    ) {
      throw Object.assign(
        new Error(
          'Access link has expired.',
        ),
        {
          code: 'GRANT_TOKEN_EXPIRED',
          status: 401,
        },
      );
    }

    const accessedAt =
      new Date().toISOString();

    await this.services.tables.updateRow({
      databaseId: this.services.databaseId,
      tableId: 'external_access_grants',
      rowId: grant.id,
      data: {
        lastAccessedAt: accessedAt,
        updatedAt: accessedAt,
      },
    });

    return {
      ...grant,
      lastAccessedAt: accessedAt,
      updatedAt: accessedAt,
    };
  }

  async get(
    agencyId: string,
    resourceType: ExternalGrantResourceType,
    id: string,
  ): Promise<ExternalGrantRecord | undefined> {
    try {
      const row =
        await this.services.tables.getRow({
          databaseId: this.services.databaseId,
          tableId: 'external_access_grants',
          rowId: id,
        });

      const grant = record(
        row as unknown as Record<string, unknown>,
      );

      return (
        grant.agencyId === agencyId
        && grant.resourceType === resourceType
      )
        ? grant
        : undefined;
    } catch (error) {
      if (errorCode(error) === 404) {
        return undefined;
      }

      throw error;
    }
  }

  async list(
    agencyId: string,
    resourceType: ExternalGrantResourceType,
  ): Promise<ExternalGrantRecord[]> {
    const values: ExternalGrantRecord[] = [];

    let cursor: string | undefined;

    do {
      const result =
        await this.services.tables.listRows({
          databaseId: this.services.databaseId,
          tableId: 'external_access_grants',
          queries: [
            Query.equal('agencyId', [agencyId]),
            Query.equal(
              'resourceType',
              [resourceType],
            ),
            Query.limit(100),
            ...(cursor
              ? [Query.cursorAfter(cursor)]
              : []),
          ],
        });

      const rows = result.rows as unknown as
        Record<string, unknown>[];

      values.push(...rows.map(record));

      cursor = rows.length === 100
        ? String(rows.at(-1)?.$id ?? '')
        : undefined;
    } while (cursor);

    return values;
  }

  async revoke(
    agencyId: string,
    resourceType: ExternalGrantResourceType,
    id: string,
    expectedVersion: number,
    actorId: string,
  ): Promise<ExternalGrantRecord> {
    const current = await this.get(
      agencyId,
      resourceType,
      id,
    );

    if (!current) {
      throw Object.assign(
        new Error('External grant not found.'),
        {
          code: 'NOT_FOUND',
          status: 404,
        },
      );
    }

    if (current.version !== expectedVersion) {
      throw Object.assign(
        new Error(
          'External grant changed. Reload and retry.',
        ),
        {
          code: 'VERSION_CONFLICT',
          status: 409,
        },
      );
    }

    const revokedAt =
      new Date().toISOString();

    const row =
      await this.services.tables.updateRow({
        databaseId: this.services.databaseId,
        tableId: 'external_access_grants',
        rowId: id,
        data: {
          status: 'revoked',
          revokedAt,
          revokedBy: actorId,
          version: current.version + 1,
          updatedAt: revokedAt,
          updatedBy: actorId,
        },
      });

    return record(
      row as unknown as Record<string, unknown>,
    );
  }
}
