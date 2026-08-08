import { describe, expect, it } from 'vitest';
import {
  analysisTaskId,
  DurableAnalysisProcessor,
  InMemoryAnalysisTaskStore,
  type AnalysisTask,
  type ModelGateway,
} from './index.js';

const task = (): AnalysisTask => ({
  id: 'task-1',
  agencyId: 'agency-1',
  reportId: 'report-1',
  reportVersionId: 'report-version-1',
  templateId: 'wa-entry',
  templateVersion: 1,
  promptVersion: 'photo-analysis-v1',
  model: 'gemini-model',
  evidence: [{ photoId: 'photo-1', objectGeneration: '1', areaId: 'entry', componentIds: ['front-door'] }],
  attempt: 0,
  maxAttempts: 2,
  status: 'queued',
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
});

describe('durable analysis processing', () => {
  it('generates a deterministic id independent of evidence ordering', () => {
    const base = task();
    const first = analysisTaskId(base);
    const second = analysisTaskId({
      ...base,
      evidence: [{ ...base.evidence[0]!, componentIds: ['front-door'] }],
    });
    expect(first).toBe(second);
  });

  it('stores one successful result and returns it for duplicate delivery', async () => {
    const store = new InMemoryAnalysisTaskStore();
    await store.save(task());
    let calls = 0;
    const gateway: ModelGateway = {
      async analyse() {
        calls += 1;
        return {
          claims: [
            {
              areaId: 'entry',
              componentId: 'front-door',
              observation: 'Minor marks visible near the handle.',
              confidence: 0.9,
              evidencePhotoIds: ['photo-1'],
            },
          ],
        };
      },
    };
    const processor = new DurableAnalysisProcessor(store, gateway);
    expect((await processor.process('task-1')).status).toBe('succeeded');
    expect((await processor.process('task-1')).status).toBe('succeeded');
    expect(calls).toBe(1);
  });

  it('marks retryable failures and dead-letters exhausted tasks', async () => {
    const store = new InMemoryAnalysisTaskStore();
    await store.save(task());
    const processor = new DurableAnalysisProcessor(store, { async analyse() { throw new Error('model unavailable'); } });
    await expect(processor.process('task-1')).rejects.toThrow('model unavailable');
    expect((await store.get('task-1'))?.status).toBe('retryable_failure');
    expect((await processor.process('task-1')).status).toBe('dead_lettered');
  });

  it('rejects unsupported evidence and causation claims', async () => {
    const store = new InMemoryAnalysisTaskStore();
    await store.save(task());
    const processor = new DurableAnalysisProcessor(store, {
      async analyse() {
        return {
          claims: [
            {
              areaId: 'entry',
              componentId: 'front-door',
              observation: 'Tenant caused damage by misuse.',
              confidence: 0.95,
              evidencePhotoIds: ['photo-2'],
            },
          ],
        };
      },
    });
    await expect(processor.process('task-1')).rejects.toThrow();
  });

  it('requires uncertainty context for low-confidence observations', async () => {
    const store = new InMemoryAnalysisTaskStore();
    await store.save(task());
    const processor = new DurableAnalysisProcessor(store, {
      async analyse() {
        return {
          claims: [
            {
              areaId: 'entry',
              componentId: 'front-door',
              observation: 'Possible light scuffing.',
              confidence: 0.55,
              evidencePhotoIds: ['photo-1'],
            },
          ],
        };
      },
    });
    await expect(processor.process('task-1')).rejects.toThrow('uncertainty');
  });
});
