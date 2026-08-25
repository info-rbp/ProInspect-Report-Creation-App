import type {
  CatalogueAreaVersionView,
  CatalogueComponentVersionView,
  CatalogueUsageImpact,
  ManagedAreaComponentRule,
  ManagedAreaDefinition,
  ManagedComponentDefinition,
  NewAreaDraftInput,
  NewComponentDraftInput,
} from '@pcr/templates/catalogueAdmin';
import { apiRequest } from './apiClient';

const CATALOGUE_READ_TIMEOUT_MS = 15_000;
let catalogueReadQueue: Promise<void> = Promise.resolve();

function versionPath(kind: 'areas' | 'components', id: string, version: number): string {
  return `/api/v1/catalogue/${kind}/${encodeURIComponent(id)}/versions/${version}`;
}

function withTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label} took longer than 15 seconds. Retry the request; if it persists, review the catalogue API logs.`)), CATALOGUE_READ_TIMEOUT_MS);
    operation.then((value) => { window.clearTimeout(timer); resolve(value); }, (error) => { window.clearTimeout(timer); reject(error); });
  });
}

function serialCatalogueRead<T>(operation: () => Promise<T>, label: string): Promise<T> {
  const result = catalogueReadQueue.then(() => withTimeout(operation(), label));
  catalogueReadQueue = result.then(() => undefined, () => undefined);
  return result;
}

export async function getCatalogueAreas(
  filters: { q?: string; status?: string; category?: string } = {},
): Promise<CatalogueAreaVersionView[]> {
  const params = new URLSearchParams();
  if (filters.q?.trim()) params.set('q', filters.q.trim());
  if (filters.status && filters.status !== 'all') params.set('status', filters.status);
  if (filters.category && filters.category !== 'all') params.set('category', filters.category);
  const suffix = params.size ? `?${params.toString()}` : '';
  return serialCatalogueRead(
    () => apiRequest<CatalogueAreaVersionView[]>(undefined, `/api/v1/catalogue/areas${suffix}`),
    'Loading canonical Areas',
  );
}

export async function getCatalogueComponents(
  filters: { q?: string; status?: string; category?: string } = {},
): Promise<CatalogueComponentVersionView[]> {
  const params = new URLSearchParams();
  if (filters.q?.trim()) params.set('q', filters.q.trim());
  if (filters.status && filters.status !== 'all') params.set('status', filters.status);
  if (filters.category && filters.category !== 'all') params.set('category', filters.category);
  const suffix = params.size ? `?${params.toString()}` : '';
  return serialCatalogueRead(
    () => apiRequest<CatalogueComponentVersionView[]>(undefined, `/api/v1/catalogue/components${suffix}`),
    'Loading canonical Components',
  );
}

export async function createCatalogueAreaDraft(input: NewAreaDraftInput): Promise<CatalogueAreaVersionView> {
  return apiRequest<CatalogueAreaVersionView>(undefined, '/api/v1/catalogue/areas/drafts', { method: 'POST', body: { input } });
}

export async function createCatalogueComponentDraft(input: NewComponentDraftInput): Promise<CatalogueComponentVersionView> {
  return apiRequest<CatalogueComponentVersionView>(undefined, '/api/v1/catalogue/components/drafts', { method: 'POST', body: { input } });
}

export async function updateCatalogueAreaDraft(view: CatalogueAreaVersionView, definition: ManagedAreaDefinition, componentRules: ManagedAreaComponentRule[]): Promise<CatalogueAreaVersionView> {
  return apiRequest<CatalogueAreaVersionView>(undefined, versionPath('areas', view.definition.id, view.definition.version), {
    method: 'PUT', body: { expectedRecordVersion: view.recordVersion, definition, componentRules },
  });
}

export async function updateCatalogueComponentDraft(view: CatalogueComponentVersionView, definition: ManagedComponentDefinition): Promise<CatalogueComponentVersionView> {
  return apiRequest<CatalogueComponentVersionView>(undefined, versionPath('components', view.definition.id, view.definition.version), {
    method: 'PUT', body: { expectedRecordVersion: view.recordVersion, definition },
  });
}

async function action<T extends CatalogueAreaVersionView | CatalogueComponentVersionView>(kind: 'areas' | 'components', view: T, name: 'duplicate' | 'publish' | 'retire', extra: Record<string, unknown> = {}): Promise<T> {
  return apiRequest<T>(undefined, `${versionPath(kind, view.definition.id, view.definition.version)}/actions/${name}`, {
    method: 'POST', body: { expectedRecordVersion: view.recordVersion, ...extra },
  });
}

export function duplicateCatalogueArea(view: CatalogueAreaVersionView): Promise<CatalogueAreaVersionView> { return action('areas', view, 'duplicate'); }
export function publishCatalogueArea(view: CatalogueAreaVersionView): Promise<CatalogueAreaVersionView> { return action('areas', view, 'publish'); }
export function retireCatalogueArea(view: CatalogueAreaVersionView, acknowledgeUsageImpact = false): Promise<CatalogueAreaVersionView> { return action('areas', view, 'retire', { acknowledgeUsageImpact }); }
export function duplicateCatalogueComponent(view: CatalogueComponentVersionView): Promise<CatalogueComponentVersionView> { return action('components', view, 'duplicate'); }
export function publishCatalogueComponent(view: CatalogueComponentVersionView): Promise<CatalogueComponentVersionView> { return action('components', view, 'publish'); }
export function retireCatalogueComponent(view: CatalogueComponentVersionView, acknowledgeUsageImpact = false): Promise<CatalogueComponentVersionView> { return action('components', view, 'retire', { acknowledgeUsageImpact }); }

export function getCatalogueAreaUsage(view: CatalogueAreaVersionView): Promise<CatalogueUsageImpact> {
  return apiRequest<CatalogueUsageImpact>(undefined, `${versionPath('areas', view.definition.id, view.definition.version)}/usage`);
}
export function getCatalogueComponentUsage(view: CatalogueComponentVersionView): Promise<CatalogueUsageImpact> {
  return apiRequest<CatalogueUsageImpact>(undefined, `${versionPath('components', view.definition.id, view.definition.version)}/usage`);
}
