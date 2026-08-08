import { afterAll, beforeAll, describe, it } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';

let environment: RulesTestEnvironment;

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-pcr',
    firestore: {
      host: '127.0.0.1',
      port: 8081,
      rules: readFileSync('infrastructure/firebase/firestore.rules', 'utf8'),
    },
  });
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'agencies/agency-a/memberships/user-a'), { status: 'active', role: 'operations' });
    await setDoc(doc(db, 'agencies/agency-b/memberships/user-b'), { status: 'active', role: 'operations' });
    await setDoc(doc(db, 'properties/property-a'), { agencyId: 'agency-a', address: 'A' });
    await setDoc(doc(db, 'properties/property-b'), { agencyId: 'agency-b', address: 'B' });
    await setDoc(doc(db, 'agencies/agency-a/auditEvents/event-1'), { agencyId: 'agency-a' });
    await setDoc(doc(db, 'agencies/agency-a/reports/report-1'), { agencyId: 'agency-a', lifecycleStatus: 'draft' });
    await setDoc(doc(db, 'agencies/agency-a/reports/report-1/areas/entry'), { agencyId: 'agency-a', reportId: 'report-1', name: 'Entry' });
    await setDoc(doc(db, 'agencies/agency-a/reports/report-1/areas/entry/components/front-door'), {
      agencyId: 'agency-a', reportId: 'report-1', areaId: 'entry', component: 'Front Door',
    });
  });
});

afterAll(async () => environment.cleanup());

describe('agency isolation rules', () => {
  it('allows an active same-agency operator to read', async () => {
    const db = environment.authenticatedContext('user-a', { agencyId: 'agency-a', role: 'operations' }).firestore();
    await assertSucceeds(getDoc(doc(db, 'properties/property-a')));
  });

  it('rejects cross-agency reads', async () => {
    const db = environment.authenticatedContext('user-a', { agencyId: 'agency-a', role: 'operations' }).firestore();
    await assertFails(getDoc(doc(db, 'properties/property-b')));
  });

  it('allows same-agency reads of decomposed report components', async () => {
    const db = environment.authenticatedContext('user-a', { agencyId: 'agency-a', role: 'operations' }).firestore();
    await assertSucceeds(getDoc(doc(db, 'agencies/agency-a/reports/report-1/areas/entry/components/front-door')));
  });

  it('rejects direct writes to report metadata and nested content', async () => {
    const db = environment.authenticatedContext('admin-a', { agencyId: 'agency-a', role: 'proinspect_admin' }).firestore();
    await assertFails(setDoc(doc(db, 'agencies/agency-a/reports/report-1'), { lifecycleStatus: 'finalised' }));
    await assertFails(setDoc(doc(db, 'agencies/agency-a/reports/report-1/areas/entry/components/new'), { component: 'New' }));
  });

  it('rejects direct property writes even for administrators', async () => {
    const db = environment.authenticatedContext('admin-a', { agencyId: 'agency-a', role: 'proinspect_admin' }).firestore();
    await assertFails(setDoc(doc(db, 'properties/new'), { agencyId: 'agency-a' }));
  });

  it('rejects audit mutation', async () => {
    const db = environment.authenticatedContext('user-a', { agencyId: 'agency-a', role: 'operations' }).firestore();
    await assertFails(setDoc(doc(db, 'agencies/agency-a/auditEvents/event-1'), { changed: true }));
  });
});
