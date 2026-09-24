import { workerDatabase, type AppwriteWorkerDatabase } from '@pcr/appwrite-server';
const topics: Record<string, string> = { analysis: 'analysis-requests', pdf: 'pdf-generation-requests', notification: 'notification-requests', document: 'document-generation-requests', integration: 'integration-sync-requests' };
export async function publishOutboxTask(topic: string, payload: Record<string, unknown>): Promise<string> {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  if (!project || !Object.values(topics).includes(topic)) throw new Error('Invalid outbox publish target');
  const auth = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5000) });
  if (!auth.ok) throw new Error('Worker identity unavailable');
  const { access_token: token } = await auth.json() as { access_token: string };
  if (!token) throw new Error('Worker identity token missing');
  const response = await fetch(`https://pubsub.googleapis.com/v1/projects/${encodeURIComponent(project)}/topics/${topic}:publish`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ data: Buffer.from(JSON.stringify(payload)).toString('base64') }] }), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Outbox publish failed: HTTP ${response.status}`);
  const value = await response.json() as { messageIds?: string[] }; if (!value.messageIds?.[0]) throw new Error('Outbox publish receipt missing'); return value.messageIds[0];
}
/** Scheduler invokes this after commits. At-least-once Pub/Sub requires worker task idempotency. */
export async function dispatchOutbox(db: AppwriteWorkerDatabase = workerDatabase(), publish = publishOutboxTask) {
  let dispatched = 0; let failed = 0;
  const agencies = await db.collection('agencies').get();
  for (const agency of agencies.docs) {
    const pending = await db.collection(`agencies/${agency.id}/taskOutbox`).get();
    for (const job of pending.docs) {
      const kind = String(job.get('eventType')).replace(/\.requested$/u, ''); const topic = topics[kind];
      if (!topic || !['pending', 'dispatching', 'dispatch_failed'].includes(String(job.get('deliveryStatus')))) continue;
      if (Date.parse(String(job.get('availableAt'))) > Date.now()) continue;
      const claimed = await db.runTransaction(async (tx) => {
        const current = await tx.get(job.ref);
        if (!['pending', 'dispatching', 'dispatch_failed'].includes(String(current.get('deliveryStatus')))) return false;
        if (current.get('deliveryStatus') === 'dispatching' && Date.parse(String(current.get('lastAttemptedAt'))) > Date.now() - 300000) return false;
        tx.update(job.ref, { deliveryStatus: 'dispatching', lastAttemptedAt: new Date().toISOString(), attempts: Number(current.get('attempts') ?? 0) + 1 }); return true;
      });
      if (!claimed) continue;
      try {
        const payload = job.get('payload'); if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid authoritative outbox payload');
        const messageId = await publish(topic, { ...payload, taskId: job.id, agencyId: agency.id, kind });
        await job.ref.update({ deliveryStatus: 'dispatched', pubsubMessageId: messageId }); dispatched++;
      } catch {
        const attempts = Number(job.get('attempts') ?? 0) + 1;
        await job.ref.update({ deliveryStatus: attempts >= 10 ? 'dead_letter' : 'dispatch_failed', availableAt: new Date(Date.now() + Math.min(3600000, 1000 * 2 ** attempts)).toISOString() }); failed++;
      }
    }
  }
  return { dispatched, failed };
}
