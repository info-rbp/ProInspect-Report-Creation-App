import { createHash } from 'node:crypto';
import { loadRuntimeConfig } from '@pcr/config';
import { taskCreationSchema, type TaskCreationInput } from '@pcr/validation';

const config = loadRuntimeConfig();

export type AnalysisTaskStatus = 'queued' | 'running' | 'succeeded' | 'retryable_failure' | 'dead_lettered';

export interface AnalysisEvidence {
  photoId: string;
  objectGeneration: string;
  areaId?: string;
  componentIds: string[];
}

export interface AnalysisTask {
  id: string;
  agencyId: string;
  reportId: string;
  reportVersionId: string;
  templateId: string;
  templateVersion: number;
  promptVersion: string;
  model: string;
  evidence: AnalysisEvidence[];
  attempt: number;
  maxAttempts: number;
  status: AnalysisTaskStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisClaim {
  areaId: string;
  componentId: string;
  observation: string;
  confidence: number;
  evidencePhotoIds: string[];
  uncertainty?: string;
}

export interface AnalysisResult {
  taskId: string;
  reportId: string;
  reportVersionId: string;
  promptVersion: string;
  model: string;
  claims: AnalysisClaim[];
  usage?: { inputTokens?: number; outputTokens?: number };
  completedAt: string;
}

export interface ModelGateway {
  analyse(task: AnalysisTask): Promise<Omit<AnalysisResult, 'taskId' | 'reportId' | 'reportVersionId' | 'promptVersion' | 'model' | 'completedAt'>>;
}

export interface AnalysisTaskStore {
  get(taskId: string): Promise<AnalysisTask | undefined>;
  save(task: AnalysisTask): Promise<void>;
  getResult(taskId: string): Promise<AnalysisResult | undefined>;
  saveResult(result: AnalysisResult): Promise<void>;
}

export class InMemoryAnalysisTaskStore implements AnalysisTaskStore {
  private readonly tasks = new Map<string, AnalysisTask>();
  private readonly results = new Map<string, AnalysisResult>();

  async get(taskId: string): Promise<AnalysisTask | undefined> {
    const task = this.tasks.get(taskId);
    return task ? structuredClone(task) : undefined;
  }
  async save(task: AnalysisTask): Promise<void> {
    this.tasks.set(task.id, structuredClone(task));
  }
  async getResult(taskId: string): Promise<AnalysisResult | undefined> {
    const result = this.results.get(taskId);
    return result ? structuredClone(result) : undefined;
  }
  async saveResult(result: AnalysisResult): Promise<void> {
    this.results.set(result.taskId, structuredClone(result));
  }
}

export function validateAnalysisTask(input: unknown): TaskCreationInput {
  const result = taskCreationSchema.parse(input);
  if (!result.ok) throw Object.assign(new Error(result.error.message), result.error);
  return result.value;
}

export function analysisTaskId(input: Pick<AnalysisTask, 'agencyId' | 'reportId' | 'reportVersionId' | 'templateId' | 'templateVersion' | 'promptVersion' | 'model' | 'evidence'>): string {
  const evidence = [...input.evidence]
    .map((item) => ({ ...item, componentIds: [...item.componentIds].sort() }))
    .sort((left, right) => left.photoId.localeCompare(right.photoId));
  return createHash('sha256').update(JSON.stringify({ ...input, evidence })).digest('hex');
}

export function validateAnalysisClaims(task: AnalysisTask, claims: AnalysisClaim[]): void {
  const evidenceIds = new Set(task.evidence.map((item) => item.photoId));
  for (const claim of claims) {
    if (!claim.areaId.trim() || !claim.componentId.trim() || !claim.observation.trim()) throw new Error('Analysis claims require area, component and observation.');
    if (!Number.isFinite(claim.confidence) || claim.confidence < 0 || claim.confidence > 1) throw new Error('Analysis confidence must be between zero and one.');
    if (!claim.evidencePhotoIds.length) throw new Error('Every analysis claim must cite source photo evidence.');
    if (claim.evidencePhotoIds.some((photoId) => !evidenceIds.has(photoId))) throw new Error('Analysis claim references evidence outside the task.');
    if (/\b(tenant caused|tenant damage|misuse|neglected)\b/i.test(claim.observation)) throw new Error('Analysis cannot infer liability or causation from photos.');
    if (claim.confidence < 0.7 && !claim.uncertainty?.trim()) throw new Error('Low-confidence claims require an uncertainty explanation.');
  }
}

export class DurableAnalysisProcessor {
  constructor(private readonly store: AnalysisTaskStore, private readonly gateway: ModelGateway) {}

  async process(taskId: string, now = new Date().toISOString()): Promise<{ status: AnalysisTaskStatus; result?: AnalysisResult }> {
    const task = await this.store.get(taskId);
    if (!task) throw new Error(`Analysis task not found: ${taskId}`);
    const existing = await this.store.getResult(taskId);
    if (existing) return { status: 'succeeded', result: existing };
    if (task.status === 'dead_lettered') return { status: 'dead_lettered' };

    const running: AnalysisTask = { ...task, status: 'running', attempt: task.attempt + 1, updatedAt: now };
    await this.store.save(running);
    try {
      const modelResult = await this.gateway.analyse(running);
      validateAnalysisClaims(running, modelResult.claims);
      const result: AnalysisResult = {
        taskId: running.id,
        reportId: running.reportId,
        reportVersionId: running.reportVersionId,
        promptVersion: running.promptVersion,
        model: running.model,
        claims: modelResult.claims,
        ...(modelResult.usage ? { usage: modelResult.usage } : {}),
        completedAt: now,
      };
      await this.store.saveResult(result);
      await this.store.save({ ...running, status: 'succeeded', updatedAt: now });
      return { status: 'succeeded', result };
    } catch (error) {
      const exhausted = running.attempt >= running.maxAttempts;
      await this.store.save({ ...running, status: exhausted ? 'dead_lettered' : 'retryable_failure', updatedAt: now });
      if (exhausted) return { status: 'dead_lettered' };
      throw error;
    }
  }
}

export async function handleAnalysisTask(taskId: string, input: unknown = { reportId: taskId }): Promise<{ taskId: string; status: 'accepted' }> {
  const task = validateAnalysisTask(input);
  console.log(JSON.stringify({
    level: config.logLevel,
    message: 'analysis.accepted',
    taskId,
    reportId: task.reportId,
    reportVersionId: task.reportVersionId,
  }));
  return { taskId, status: 'accepted' };
}
