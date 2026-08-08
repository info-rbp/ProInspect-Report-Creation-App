import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldPath, getFirestore } from 'firebase-admin/firestore';
import { FirestoreReportAggregateStore } from '../backend/reportAggregateStore.js';
import { planLegacyReportMigration } from './legacyReport.js';

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

async function run(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const limit = Math.min(Math.max(Number(process.env.MIGRATION_LIMIT ?? 100), 1), 500);
  const after = process.env.MIGRATION_AFTER?.trim();
  const database = getFirestore(adminApp());
  let query = database.collection('reports').orderBy(FieldPath.documentId()).limit(limit);
  if (after) query = query.startAfter(after);
  const snapshot = await query.get();
  const store = new FirestoreReportAggregateStore();
  const results: Array<Record<string, unknown>> = [];

  for (const document of snapshot.docs) {
    try {
      const plan = planLegacyReportMigration(document.id, document.data());
      if (apply) {
        const existing = await store.load(plan.aggregate.report.agencyId, plan.aggregate.report.id);
        await store.saveDraft(plan.aggregate, existing?.report.version, 'phase6-migration');
        await database.doc(`agencies/${plan.aggregate.report.agencyId}/migrationRuns/phase6-${plan.aggregate.report.id}`).set({
          sourcePath: plan.sourcePath,
          destinationPath: plan.destinationPath,
          sourceReportId: plan.sourceReportId,
          reportId: plan.aggregate.report.id,
          counts: plan.counts,
          warnings: plan.warnings,
          appliedAt: new Date().toISOString(),
          sourceRetained: true,
        });
      }
      results.push({ reportId: plan.aggregate.report.id, status: apply ? 'applied' : 'planned', ...plan.counts, warnings: plan.warnings });
    } catch (migrationError) {
      results.push({ reportId: document.id, status: 'failed', error: migrationError instanceof Error ? migrationError.message : String(migrationError) });
    }
  }

  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    sourceCollection: 'reports',
    scanned: snapshot.size,
    succeeded: results.filter((result) => result.status !== 'failed').length,
    failed: results.filter((result) => result.status === 'failed').length,
    nextCursor: snapshot.docs.at(-1)?.id ?? null,
    results,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed) process.exitCode = 1;
}

void run();
