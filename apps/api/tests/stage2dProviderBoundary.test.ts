import {
  existsSync,
  readFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import {
  describe,
  expect,
  it,
} from 'vitest';

const root = resolve(
  import.meta.dirname,
  '..',
);

function source(path: string): string {
  return readFileSync(
    resolve(root, path),
    'utf8',
  );
}

const grantRuntimeFiles = [
  'src/backend/contractorQuoteRoutes.ts',
  'src/backend/externalEvidenceRoutes.ts',
  'src/backend/externalEvidenceCompletionRoutes.ts',
  'src/backend/maintenanceCommercialRoutes.ts',
  'src/backend/maintenanceRoutes.ts',
  'src/backend/remoteInspectionAdminRoutes.ts',
  'src/backend/remoteInspectionPortalRoutes.ts',
  'src/backend/reportOperationsRoutes.ts',
  'src/backend/tenantDocumentRoutes.ts',
  'src/backend/tenantInstructionGrantRoutes.ts',
  'src/backend/tenantPortalRoutes.ts',
  'src/services/maintenanceCommercialService.ts',
];

const legacyGrantNames =
  /externalAccessGrants|contractorQuoteAccessGrants|tenantPortalGrants/u;

describe(
  'Stage 2D external grant provider boundary',
  () => {
    it.each(grantRuntimeFiles)(
      '%s has no direct legacy grant collection authority',
      (file) => {
        expect(
          source(file),
        ).not.toMatch(
          legacyGrantNames,
        );
      },
    );

    it(
      'wires external grant providers by backend mode',
      () => {
        const dependencies = source(
          'src/security/defaultDependencies.ts',
        );

        expect(
          dependencies,
        ).toContain(
          'new FirestoreExternalGrantStore',
        );

        expect(
          dependencies,
        ).toContain(
          'new AppwriteExternalGrantStore',
        );
      },
    );

    it(
      'uses the canonical Appwrite external grant table',
      () => {
        const provider = source(
          'src/backend/appwriteExternalGrantStore.ts',
        );

        expect(
          provider,
        ).toContain(
          "'external_access_grants'",
        );

        expect(
          provider,
        ).toContain(
          'tokenHash',
        );

        const issueStart =
          provider.indexOf('async issue(');

        const resolveStart =
          provider.indexOf('async resolve(');

        expect(issueStart).toBeGreaterThanOrEqual(0);
        expect(resolveStart).toBeGreaterThan(issueStart);

        const issueSource =
          provider.slice(
            issueStart,
            resolveStart,
          );

        expect(
          issueSource,
        ).toContain(
          'tokenHash: input.tokenHash',
        );

        expect(
          issueSource,
        ).not.toContain(
          'rawToken',
        );

        const getStart =
          provider.indexOf(
            'async get(',
            resolveStart,
          );

        const resolveSource =
          provider.slice(
            resolveStart,
            getStart,
          );

        expect(
          resolveSource,
        ).toContain(
          'hashToken(rawToken)',
        );
      },
    );

    it(
      'keeps legacy grant collections isolated to the fallback adapter',
      () => {
        const fallback = source(
          'src/backend/firestoreExternalGrantStore.ts',
        );

        expect(
          fallback,
        ).toMatch(
          /externalAccessGrants/u,
        );

        expect(
          fallback,
        ).toMatch(
          /contractorQuoteAccessGrants/u,
        );

        expect(
          fallback,
        ).toMatch(
          /tenantPortalGrants/u,
        );
      },
    );

    it(
      'keeps remote inspection separate from tenant portal scope',
      () => {
        const remote = source(
          'src/backend/remoteInspectionPortalRoutes.ts',
        );

        const tenant = source(
          'src/backend/tenantPortalRoutes.ts',
        );

        expect(
          remote,
        ).toMatch(
          /remote_inspection/u,
        );

        expect(
          tenant,
        ).toMatch(
          /tenant_portal/u,
        );

        expect(
          remote,
        ).not.toMatch(
          /tenantPortalGrants/u,
        );
      },
    );

    it(
      'preserves contractor quote request and contact scope',
      () => {
        const contractor = source(
          'src/backend/contractorQuoteRoutes.ts',
        );

        expect(
          contractor,
        ).toMatch(
          /contractor_quote_request/u,
        );

        expect(
          contractor,
        ).toContain(
          'externalContactId',
        );
      },
    );

    it(
      'uses provider authorization for external evidence',
      () => {
        for (
          const file of [
            'src/backend/externalEvidenceRoutes.ts',
            'src/backend/externalEvidenceCompletionRoutes.ts',
          ]
        ) {
          const value = source(file);

          expect(
            value,
          ).toContain(
            'requireExternalGrantStore',
          );

          expect(
            value,
          ).toMatch(
            /work_request/u,
          );

          expect(
            value,
          ).toMatch(
            /tenant_instruction/u,
          );

          expect(
            value,
          ).toMatch(
            /report_distribution/u,
          );
        }
      },
    );

    it(
      'has retired the temporary report grant resolver',
      () => {
        expect(
          existsSync(
            resolve(
              root,
              'src/backend/firestoreReportGrantResolver.ts',
            ),
          ),
        ).toBe(false);
      },
    );
  },
);
