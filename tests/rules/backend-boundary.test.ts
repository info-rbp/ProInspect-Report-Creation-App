import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const operationalServices = [
  'apps/web/services/platform/propertyService.ts',
  'apps/web/services/platform/clientService.ts',
  'apps/web/services/platform/inspectionJobService.ts',
  'apps/web/services/platform/reportIndexService.ts',
  'apps/web/services/storageService.ts',
  'apps/web/services/platform/auditService.ts',
];

describe('Cloud Run operational boundary', () => {
  it.each(operationalServices)('%s does not perform direct Firestore writes', (path) => {
    const source = readFileSync(path, 'utf8');
    expect(source).not.toMatch(/\b(setDoc|updateDoc|addDoc|deleteDoc|writeBatch)\s*\(/u);
  });

  it('requires material writes to use the idempotency executor', () => {
    const source = readFileSync('apps/api/src/backend/router.ts', 'utf8');
    expect(source).toContain('Idempotency-Key is required for material writes.');
    expect(source).toContain('dependencies.idempotency.execute');
  });

  it('generates API documentation from the route catalog', () => {
    const source = readFileSync('apps/api/src/backend/openapi.ts', 'utf8');
    expect(source).toContain('API_ROUTE_NAMES');
    expect(source).toContain("openapi: '3.1.0'");
  });
});
