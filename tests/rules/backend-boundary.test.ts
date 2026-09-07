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

  it('ensures web services do not instantiate Gemini SDK or access client-side Gemini API keys', () => {
    const geminiServiceSource = readFileSync('apps/web/services/geminiService.ts', 'utf8');
    expect(geminiServiceSource).not.toContain('@google/genai');
    expect(geminiServiceSource).not.toContain('GEMINI_API_KEY');
    expect(geminiServiceSource).not.toContain('VITE_GEMINI_API_KEY');

    const configServiceSource = readFileSync('apps/web/services/configService.ts', 'utf8');
    expect(configServiceSource).not.toContain('geminiApiKey:');
  });

  it('keeps the Appwrite People route free of direct Firebase or Firestore authority', () => {
    const source = readFileSync('apps/api/src/backend/peopleRoutes.ts', 'utf8');
    expect(source).not.toMatch(/firebase-admin|firestoreDb\s*\(|getFirestore\s*\(|getStorage\s*\(|getAuth\s*\(|FirebaseFirestore/u);
    expect(source).toContain('deps.peopleAdmin');
    expect(source).toContain('routeFirebasePeopleRequest');
  });

});
