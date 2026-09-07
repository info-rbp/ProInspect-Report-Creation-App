import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

const businessFiles = [
  'src/backend/propertyHistoryRoutes.ts',
  'src/backend/inspectionReportRoutes.ts',
  'src/backend/maintenanceReportRoutes.ts',
  'src/backend/reportOperationsRoutes.ts',
  'src/backend/notificationCallbackRoutes.ts',
  'src/services/canonicalMaintenanceExtractionService.ts',
  'src/services/maintenanceCommercialService.ts',
];

describe('Stage 2C provider boundary', () => {
  it.each(businessFiles)(
    '%s has no direct Firestore runtime dependency',
    (file) => {
      const source = readFileSync(
        resolve(root, file),
        'utf8',
      );

      expect(source).not.toMatch(
        /firebase-admin\/firestore/u,
      );

      expect(source).not.toMatch(
        /firestoreDb\s*\(/u,
      );

      expect(source).not.toMatch(
        /getFirestore\s*\(/u,
      );
    },
  );

  it(
    'wires report-version providers by backend mode',
    () => {
      const source = readFileSync(
        resolve(
          root,
          'src/security/defaultDependencies.ts',
        ),
        'utf8',
      );

      expect(source).toContain(
        'new FirestoreReportVersionReader()',
      );

      expect(source).toContain(
        'new AppwriteReportVersionReader(appwrite)',
      );
    },
  );

  it(
    'wires notification delivery providers by backend mode',
    () => {
      const source = readFileSync(
        resolve(
          root,
          'src/security/defaultDependencies.ts',
        ),
        'utf8',
      );

      expect(source).toContain(
        'new FirestoreNotificationDeliveryStore()',
      );

      expect(source).toContain(
        'new AppwriteNotificationDeliveryStore(appwrite)',
      );
    },
  );

});
