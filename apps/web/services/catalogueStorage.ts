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

const CATALOGUE_READ_TIMEOUT_MS = 10_000;

function versionPath(kind: 'areas' | 'components', id: string, version: number): string {
  return `/api/v1/catalogue/${kind}/${encodeURIComponent(id)}/versions/${version}`;
}

async function boundedCatalogueRead<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = globalThis.setTimeout(() => reject(Object.assign(
          new Error(`${label} did not respond within ${CATALOGUE_READ_TIMEOUT_MS / 1000} seconds. Use Refresh to retry.`),
          { code: 'CATALOGUE_TIMEOUT' },
        )), CATALOGUE_READ_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout !== undefined) globalThis.clearTimeout(timeout);
  }
}

export async function getCatalogueAreas(
  filters: { q?: string; status?: string; category?: string } = {},
): Promise<CatalogueAreaVersionView[]> {
  const params = new URLSearchParams();
  if (filters.q?.trim()) params.set('q', filters.q.trim());
  if (filters.status && filters.status !== 'all') params.set('status', filters.status);
  if (filters.category && filters.category !== 'all') params.set('category', filters.category);
  const suffix = params.size ? `?${params.toString()}` : '';
  return boundedCatalogueRead(
    apiRequest<CatalogueAreaVersionView[]>(undefined, `/api/v1/catalogue/areas${suffix}`),
    'Canonical Areas catalogue',
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
  return boundedCatalogueRead(
    apiRequest<CatalogueComponentVersionView[]>(undefined, `/api/v1/catalogue/components${suffix}`),
    'Canonical Components catalogue',
  );
}

export async function createCatalogueAreaDraft(
  input: NewAreaDraftInput,
): Promise<CatalogueAreaVersionView> {
  return apiRequest<CatalogueAreaVersionView>(undefined, '/api/v1/catalogue/areas/drafts', {
    method: 'POST',
    body: { input },
  });
}

export async function createCatalogueComponentDraft(
  input: NewComponentDraftInput,
): Promise<CatalogueComponentVersionView> {
  return apiRequest<CatalogueComponentVersionView>(undefined, '/api/v1/catalogue/components/drafts', {
    method: 'POST',
    body: { input },
  });
}

export async function updateCatalogueAreaDraft(
  view: CatalogueAreaVersionView,
  definition: ManagedAreaDefinition,
  componentRules: ManagedAreaComponentRule[],
): Promise<CatalogueAreaVersionView> {
  return apiRequest<CatalogueAreaVersionView>(
    undefined,
    versionPath('areas', view.definition.id, view.definition.version),
    {
      method: 'PUT',
      body: {
        expectedRecordVersion: view.recordVersion,
        definition,
        componentRules,
      },
    },
  );
}

export async function updateCatalogueComponentDraft(
  view: CatalogueComponentVersionView,
  definition: ManagedComponentDefinition,
): Promise<CatalogueComponentVersionView> {
  return apiRequest<CatalogueComponentVersionView>(
    undefined,
    versionPath('components', view.definition.id, view.definition.version),
    {
      method: 'PUT',
      body: {
        expectedRecordVersion: view.recordVersion,
        definition,
      },
    },
  );
}

async function action<T extends CatalogueAreaVersionView | CatalogueComponentVersionView>(
  kind: 'areas' | 'components',
  view: T,
  name: 'duplicate' | 'publish' | 'retire',
  extra: Record<string, unknown> = {},
): Promise<T> {
  return apiRequest<T>(
    undefined,
    `${versionPath(kind, view.definition.id, view.definition.version)}/actions/${name}`,
    {
      method: 'POST',
      body: {
        expectedRecordVersion: view.recordVersion,
        ...extra,
      },
    },
  );
}

export function duplicateCatalogueArea(view: CatalogueAreaVersionView): Promise<CatalogueAreaVersionView> {
  return action('areas', view, 'duplicate');
}

export function publishCatalogueArea(view: CatalogueAreaVersionView): Promise<CatalogueAreaVersionView> {
  return action('areas', view, 'publish');
}

export function retireCatalogueArea(
  view: CatalogueAreaVersionView,
  acknowledgeUsageImpact = false,
): Promise<CatalogueAreaVersionView> {
  return action('areas', view, 'retire', { acknowledgeUsageImpact });
}

export function duplicateCatalogueComponent(view: CatalogueComponentVersionView): Promise<CatalogueComponentVersionView> {
  return action('components', view, 'duplicate');
}

export function publishCatalogueComponent(view: CatalogueComponentVersionView): Promise<CatalogueComponentVersionView> {
  return action('components', view, 'publish');
}

export function retireCatalogueComponent(
  view: CatalogueComponentVersionView,
  acknowledgeUsageImpact = false,
): Promise<CatalogueComponentVersionView> {
  return action('components', view, 'retire', { acknowledgeUsageImpact });
}

export function getCatalogueAreaUsage(view: CatalogueAreaVersionView): Promise<CatalogueUsageImpact> {
  return apiRequest<CatalogueUsageImpact>(
    undefined,
    `${versionPath('areas', view.definition.id, view.definition.version)}/usage`,
  );
}

export function getCatalogueComponentUsage(view: CatalogueComponentVersionView): Promise<CatalogueUsageImpact> {
  return apiRequest<CatalogueUsageImpact>(
    undefined,
    `${versionPath('components', view.definition.id, view.definition.version)}/usage`,
  );
}
