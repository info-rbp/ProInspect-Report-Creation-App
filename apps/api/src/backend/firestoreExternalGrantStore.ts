import { createHash } from 'node:crypto';
import {
  applicationDefault,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { firestoreDb } from '../firestoreDatabase.js';
import type {
  ExternalGrantIssueInput,
  ExternalGrantRecord,
  ExternalGrantResourceType,
  ExternalGrantStore,
} from './types.js';

type LegacyGrantCollection =
  | 'externalAccessGrants'
  | 'contractorQuoteAccessGrants'
  | 'tenantPortalGrants';

function adminApp() {
  return getApps()[0]
    ?? initializeApp({
      credential: applicationDefault(),
    });
}

function hashToken(value: string): string {
  return createHash('sha256')
    .update(value.trim())
    .digest('hex');
}

function collectionFor(
  resourceType: ExternalGrantResourceType,
): LegacyGrantCollection {
  if (resourceType === 'contractor_quote_request') {
    return 'contractorQuoteAccessGrants';
  }

  if (
    resourceType === 'tenant_portal'
    || resourceType === 'remote_inspection'
  ) {
    return 'tenantPortalGrants';
  }

  return 'externalAccessGrants';
}

function normalize(
  collection: LegacyGrantCollection,
  id: string,
  value: Record<string, unknown>,
): ExternalGrantRecord {
  let resourceType: ExternalGrantResourceType;
  let resourceId: string;

  if (collection === 'contractorQuoteAccessGrants') {
    resourceType = 'contractor_quote_request';
    resourceId = String(
      value.contractorQuoteRequestId ?? '',
    );
  } else if (collection === 'tenantPortalGrants') {
    const remoteInspection =
      value.purpose === 'remote_inspection';

    resourceType = remoteInspection
      ? 'remote_inspection'
      : 'tenant_portal';

    resourceId = remoteInspection
      ? String(value.assignmentId ?? '')
      : String(value.tenancyId ?? '');
  } else {
    resourceType = String(
      value.resourceType ?? '',
    ) as ExternalGrantResourceType;

    resourceId = String(value.resourceId ?? '');
  }

  return {
    id,
    agencyId: String(value.agencyId ?? ''),
    resourceType,
    resourceId,
    tokenHash: String(value.tokenHash ?? ''),
    expiresAt: String(value.expiresAt ?? ''),
    version: Number(value.version ?? 1),
    createdAt: String(
      value.createdAt
      ?? new Date(0).toISOString(),
    ),
    updatedAt: String(
      value.updatedAt
      ?? value.createdAt
      ?? new Date(0).toISOString(),
    ),
    ...(typeof value.recipientEmail === 'string'
      ? { recipientEmail: value.recipientEmail }
      : {}),
    ...(typeof value.tenantId === 'string'
      ? { tenantId: value.tenantId }
      : {}),
    ...(typeof value.tenancyId === 'string'
      ? { tenancyId: value.tenancyId }
      : {}),
    ...(typeof value.externalContactId === 'string'
      ? {
          externalContactId:
            value.externalContactId,
        }
      : {}),
    ...(typeof value.purpose === 'string'
      ? { purpose: value.purpose }
      : {}),
    ...(typeof value.revokedAt === 'string'
      ? { revokedAt: value.revokedAt }
      : {}),
    ...(typeof value.revokedBy === 'string'
      ? { revokedBy: value.revokedBy }
      : {}),
    ...(typeof value.lastAccessedAt === 'string'
      ? { lastAccessedAt: value.lastAccessedAt }
      : {}),
    ...(typeof value.replacedByGrantId === 'string'
      ? {
          replacedByGrantId:
            value.replacedByGrantId,
        }
      : {}),
    ...(typeof value.createdBy === 'string'
      ? { createdBy: value.createdBy }
      : {}),
    ...(typeof value.updatedBy === 'string'
      ? { updatedBy: value.updatedBy }
      : {}),
  };
}

function groupsFor(
  allowed:
    readonly ExternalGrantResourceType[],
): LegacyGrantCollection[] {
  const groups =
    new Set<LegacyGrantCollection>();

  for (const resourceType of allowed) {
    groups.add(collectionFor(resourceType));
  }

  return [...groups];
}

export class FirestoreExternalGrantStore
implements ExternalGrantStore {
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

    const collection =
      collectionFor(input.resourceType);

    const now = new Date().toISOString();

    const base: Record<string, unknown> = {
      id: input.id,
      agencyId: input.agencyId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      createdBy: input.actorId,
      updatedBy: input.actorId,
      createdAt: now,
      updatedAt: now,
      version: 1,
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
    };

    if (
      collection
      === 'contractorQuoteAccessGrants'
    ) {
      base.contractorQuoteRequestId =
        input.resourceId;
    } else if (
      collection === 'tenantPortalGrants'
    ) {
      base.tenancyId =
        input.tenancyId ?? input.resourceId;

      if (
        input.resourceType === 'remote_inspection'
      ) {
        base.assignmentId = input.resourceId;
      }
    } else {
      base.resourceType = input.resourceType;
      base.resourceId = input.resourceId;
    }

    await firestoreDb(adminApp())
      .doc(
        `agencies/${input.agencyId}/`
        + `${collection}/${input.id}`,
      )
      .create(base);

    return normalize(
      collection,
      input.id,
      base,
    );
  }

  async resolve(
    rawToken: string,
    allowedResourceTypes:
      readonly ExternalGrantResourceType[],
  ): Promise<ExternalGrantRecord> {
    const tokenHash = hashToken(rawToken);
    const database = firestoreDb(adminApp());

    const results = await Promise.all(
      groupsFor(allowedResourceTypes).map(
        async (collection) => {
          const snapshot = await database
            .collectionGroup(collection)
            .where(
              'tokenHash',
              '==',
              tokenHash,
            )
            .limit(2)
            .get();

          return snapshot.docs.map(
            (document) => ({
              collection,
              document,
            }),
          );
        },
      ),
    );

    const matches = results.flat();

    if (matches.length === 0) {
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

    if (matches.length !== 1) {
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

    const match = matches[0];

    const grant = normalize(
      match.collection,
      match.document.id,
      match.document.data() as Record<string, unknown>,
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

    if (grant.revokedAt) {
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

    await match.document.ref.update({
      lastAccessedAt: accessedAt,
      updatedAt: accessedAt,
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
    const collection =
      collectionFor(resourceType);

    const snapshot = await firestoreDb(
      adminApp(),
    )
      .doc(
        `agencies/${agencyId}/`
        + `${collection}/${id}`,
      )
      .get();

    if (!snapshot.exists) {
      return undefined;
    }

    const grant = normalize(
      collection,
      snapshot.id,
      snapshot.data() as Record<string, unknown>,
    );

    return grant.resourceType === resourceType
      ? grant
      : undefined;
  }

  async list(
    agencyId: string,
    resourceType: ExternalGrantResourceType,
  ): Promise<ExternalGrantRecord[]> {
    const collection =
      collectionFor(resourceType);

    const snapshot = await firestoreDb(
      adminApp(),
    )
      .collection(
        `agencies/${agencyId}/${collection}`,
      )
      .get();

    return snapshot.docs
      .map((document) =>
        normalize(
          collection,
          document.id,
          document.data() as Record<string, unknown>,
        ),
      )
      .filter(
        (grant) =>
          grant.resourceType
          === resourceType,
      );
  }

  async revoke(
    agencyId: string,
    resourceType: ExternalGrantResourceType,
    id: string,
    expectedVersion: number,
    actorId: string,
  ): Promise<ExternalGrantRecord> {
    const collection =
      collectionFor(resourceType);

    const reference = firestoreDb(
      adminApp(),
    ).doc(
      `agencies/${agencyId}/`
      + `${collection}/${id}`,
    );

    const snapshot = await reference.get();

    if (!snapshot.exists) {
      throw Object.assign(
        new Error('External grant not found.'),
        {
          code: 'NOT_FOUND',
          status: 404,
        },
      );
    }

    const current = normalize(
      collection,
      snapshot.id,
      snapshot.data() as Record<string, unknown>,
    );

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

    const nextVersion =
      current.version + 1;

    await reference.update({
      status: 'revoked',
      revokedAt,
      revokedBy: actorId,
      updatedAt: revokedAt,
      updatedBy: actorId,
      version: nextVersion,
    });

    return {
      ...current,
      revokedAt,
      revokedBy: actorId,
      updatedAt: revokedAt,
      updatedBy: actorId,
      version: nextVersion,
    };
  }
}
