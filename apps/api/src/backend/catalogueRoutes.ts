import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import {
  MANAGED_SYSTEM_AREA_VERSIONS,
  MANAGED_SYSTEM_COMPONENT_VERSIONS,
  catalogueMachineCode,
  createAreaDraftDefinition,
  createComponentDraftDefinition,
  defaultAssessmentDefaults,
  defaultEvidenceDefaults,
  normaliseAreaComponentRuleOrder,
  validateManagedArea,
  validateManagedComponent,
  withCatalogueLifecycle,
  type CatalogueAreaVersionView,
  type CatalogueComponentVersionView,
  type CatalogueUsageImpact,
  type ManagedAreaComponentRule,
  type ManagedAreaDefinition,
  type ManagedComponentDefinition,
  type NewAreaDraftInput,
  type NewComponentDraftInput,
} from '@pcr/templates/catalogueAdmin';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, IdempotencyResult, StoredRecord } from './types.js';

const AREA_VERSION_COLLECTION = 'catalogueAreaVersions';
const AREA_POINTER_COLLECTION = 'catalogueAreas';
const COMPONENT_VERSION_COLLECTION = 'catalogueComponentVersions';
const COMPONENT_POINTER_COLLECTION = 'catalogueComponents';

interface StoredAreaVersion extends StoredRecord {
  definition: ManagedAreaDefinition;
  componentRules: ManagedAreaComponentRule[];
  immutable: boolean;
  systemDefault?: boolean;
}

interface StoredComponentVersion extends StoredRecord {
  definition: ManagedComponentDefinition;
  immutable: boolean;
  systemDefault?: boolean;
}

function agencyHeader(req: IncomingMessage): string {
  const agencyId = req.headers['x-agency-id']?.toString().trim();
  if (!agencyId) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return agencyId;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 5_000_000) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Catalogue payload exceeds 5 MB.');
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
    return value as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
}

function storageId(id: string, version: number): string {
  const logicalId = id.trim();
  if (!logicalId || logicalId.includes('/')) throw new ApiError(400, 'INVALID_CATALOGUE_ID', 'Catalogue IDs must be non-empty and cannot contain a slash.');
  if (!Number.isInteger(version) || version < 1) throw new ApiError(400, 'INVALID_CATALOGUE_VERSION', 'Catalogue version must be a positive integer.');
  return `${logicalId}--v${version}`;
}

function expectedRecordVersion(body: Record<string, unknown>): number {
  const value = body.expectedRecordVersion;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ApiError(400, 'EXPECTED_VERSION_REQUIRED', 'expectedRecordVersion must be a positive integer.');
  }
  return value;
}

function idempotencyKey(req: IncomingMessage): string {
  const key = req.headers['idempotency-key']?.toString().trim();
  if (!key || key.length < 8 || key.length > 200) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key is required.');
  return key;
}

function hash(body: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

async function idempotent(
  dependencies: ApiDependencies,
  req: IncomingMessage,
  agencyId: string,
  operation: string,
  body: Record<string, unknown>,
  action: () => Promise<IdempotencyResult>,
): Promise<ApiResponse> {
  const execution = await dependencies.idempotency.execute(
    agencyId,
    operation,
    idempotencyKey(req),
    hash(body),
    action,
  );
  return {
    status: execution.result.status,
    body: execution.result.body,
    headers: { 'idempotency-replayed': String(execution.replayed) },
  };
}

async function appendAudit(
  dependencies: ApiDependencies,
  principal: { uid: string; role: string; agencyId: string },
  eventType: string,
  entityType: 'catalogue_area' | 'catalogue_component',
  entityId: string,
  correlationId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await dependencies.audit.append({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    actorId: principal.uid,
    actorRole: principal.role,
    agencyId: principal.agencyId,
    capability: 'template.manage',
    outcome: 'allowed',
    reason: eventType,
    target: { agencyId: principal.agencyId },
    correlationId,
    entityType,
    entityId,
    eventType,
    metadata,
  });
}

async function listAll(
  dependencies: ApiDependencies,
  collection: string,
  agencyId: string,
): Promise<StoredRecord[]> {
  const records: StoredRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await dependencies.repository.list(collection, agencyId, 200, cursor);
    records.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor && records.length < 10_000);
  return records;
}

function areaView(record: StoredAreaVersion): CatalogueAreaVersionView {
  return {
    definition: structuredClone(record.definition),
    componentRules: structuredClone(record.componentRules),
    recordVersion: record.version,
    immutable: record.immutable,
    ...(record.systemDefault ? { systemDefault: true } : {}),
  };
}

function componentView(record: StoredComponentVersion): CatalogueComponentVersionView {
  return {
    definition: structuredClone(record.definition),
    recordVersion: record.version,
    immutable: record.immutable,
    ...(record.systemDefault ? { systemDefault: true } : {}),
  };
}

function areaRecordData(view: CatalogueAreaVersionView): Record<string, unknown> {
  return {
    definition: structuredClone(view.definition),
    componentRules: structuredClone(view.componentRules),
    immutable: view.immutable,
    ...(view.systemDefault ? { systemDefault: true } : {}),
  };
}

function componentRecordData(view: CatalogueComponentVersionView): Record<string, unknown> {
  return {
    definition: structuredClone(view.definition),
    immutable: view.immutable,
    ...(view.systemDefault ? { systemDefault: true } : {}),
  };
}

function pointerData(
  kind: 'area' | 'component',
  id: string,
  version: number,
  status: string,
  versionRecordId: string,
  systemDefault = false,
): Record<string, unknown> {
  return {
    definitionId: id,
    definitionVersion: version,
    kind,
    status,
    versionRecordId,
    immutable: true,
    ...(systemDefault ? { systemDefault: true } : {}),
  };
}

async function upsertPointer(
  dependencies: ApiDependencies,
  collection: string,
  agencyId: string,
  kind: 'area' | 'component',
  id: string,
  version: number,
  status: string,
  versionRecordId: string,
  actorId: string,
  systemDefault = false,
): Promise<void> {
  const existing = await dependencies.repository.get(collection, agencyId, id);
  const data = pointerData(kind, id, version, status, versionRecordId, systemDefault);
  if (existing) {
    await dependencies.repository.update(collection, agencyId, id, data, existing.version, actorId);
  } else {
    await dependencies.repository.create(collection, agencyId, id, data, actorId);
  }
}

function shouldAdvanceSystemPointer(pointer: StoredRecord | undefined, targetVersion: number): boolean {
  if (!pointer) return true;
  if (pointer.systemDefault !== true) return false;
  const currentVersion = typeof pointer.definitionVersion === 'number' ? pointer.definitionVersion : 0;
  return targetVersion > currentVersion;
}

async function ensureCatalogueSeeded(
  dependencies: ApiDependencies,
  agencyId: string,
  actorId: string,
): Promise<void> {
  for (const canonical of MANAGED_SYSTEM_COMPONENT_VERSIONS) {
    const id = storageId(canonical.definition.id, canonical.definition.version);
    const existing = await dependencies.repository.get(COMPONENT_VERSION_COLLECTION, agencyId, id);
    if (!existing) {
      await dependencies.repository.create(
        COMPONENT_VERSION_COLLECTION,
        agencyId,
        id,
        componentRecordData(canonical),
        actorId,
      );
    }
    const pointer = await dependencies.repository.get(
      COMPONENT_POINTER_COLLECTION,
      agencyId,
      canonical.definition.id,
    );
    if (shouldAdvanceSystemPointer(pointer, canonical.definition.version)) {
      await upsertPointer(
        dependencies,
        COMPONENT_POINTER_COLLECTION,
        agencyId,
        'component',
        canonical.definition.id,
        canonical.definition.version,
        canonical.definition.status,
        id,
        actorId,
        true,
      );
    }
  }

  for (const canonical of MANAGED_SYSTEM_AREA_VERSIONS) {
    const id = storageId(canonical.definition.id, canonical.definition.version);
    const existing = await dependencies.repository.get(AREA_VERSION_COLLECTION, agencyId, id);
    if (!existing) {
      await dependencies.repository.create(
        AREA_VERSION_COLLECTION,
        agencyId,
        id,
        areaRecordData(canonical),
        actorId,
      );
    }
    const pointer = await dependencies.repository.get(
      AREA_POINTER_COLLECTION,
      agencyId,
      canonical.definition.id,
    );
    if (shouldAdvanceSystemPointer(pointer, canonical.definition.version)) {
      await upsertPointer(
        dependencies,
        AREA_POINTER_COLLECTION,
        agencyId,
        'area',
        canonical.definition.id,
        canonical.definition.version,
        canonical.definition.status,
        id,
        actorId,
        true,
      );
    }
  }
}

async function loadArea(
  dependencies: ApiDependencies,
  agencyId: string,
  id: string,
  version: number,
): Promise<StoredAreaVersion> {
  const record = await dependencies.repository.get(
    AREA_VERSION_COLLECTION,
    agencyId,
    storageId(id, version),
  );
  if (!record) throw new ApiError(404, 'CATALOGUE_AREA_NOT_FOUND', 'Catalogue Area version not found.');
  return record as StoredAreaVersion;
}

async function loadComponent(
  dependencies: ApiDependencies,
  agencyId: string,
  id: string,
  version: number,
): Promise<StoredComponentVersion> {
  const record = await dependencies.repository.get(
    COMPONENT_VERSION_COLLECTION,
    agencyId,
    storageId(id, version),
  );
  if (!record) throw new ApiError(404, 'CATALOGUE_COMPONENT_NOT_FOUND', 'Catalogue Component version not found.');
  return record as StoredComponentVersion;
}

function queryMatches(
  value: { definition: { id: string; code: string; name: string; category: string; status: string; aliases: string[] } },
  url: URL,
): boolean {
  const q = url.searchParams.get('q')?.trim().toLowerCase() ?? '';
  const status = url.searchParams.get('status')?.trim() ?? '';
  const category = url.searchParams.get('category')?.trim() ?? '';
  if (status && status !== 'all' && value.definition.status !== status) return false;
  if (category && category !== 'all' && value.definition.category !== category) return false;
  if (!q) return true;
  return [
    value.definition.id,
    value.definition.code,
    value.definition.name,
    ...value.definition.aliases,
  ].some((candidate) => candidate.toLowerCase().includes(q));
}

async function listAreas(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  agencyId: string,
  url: URL,
): Promise<ApiResponse> {
  const principal = await authenticateAndAuthorise(req, dependencies, 'template.manage', { agencyId }, correlationId);
  await ensureCatalogueSeeded(dependencies, agencyId, principal.uid);
  const areas = (await listAll(dependencies, AREA_VERSION_COLLECTION, agencyId))
    .map((record) => areaView(record as StoredAreaVersion))
    .filter((record) => queryMatches(record, url))
    .sort((left, right) => left.definition.name.localeCompare(right.definition.name) || right.definition.version - left.definition.version);
  return { status: 200, body: { data: areas, meta: { correlationId } } };
}

async function listComponents(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  agencyId: string,
  url: URL,
): Promise<ApiResponse> {
  const principal = await authenticateAndAuthorise(req, dependencies, 'template.manage', { agencyId }, correlationId);
  await ensureCatalogueSeeded(dependencies, agencyId, principal.uid);
  const components = (await listAll(dependencies, COMPONENT_VERSION_COLLECTION, agencyId))
    .map((record) => componentView(record as StoredComponentVersion))
    .filter((record) => queryMatches(record, url))
    .sort((left, right) => left.definition.name.localeCompare(right.definition.name) || right.definition.version - left.definition.version);
  return { status: 200, body: { data: components, meta: { correlationId } } };
}

function asObject(value: unknown, code: string, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, code, message);
  return value as Record<string, unknown>;
}

function sanitiseAreaDefinition(
  value: unknown,
  mode: { id: string; version: number; status: 'draft'; source: 'agency_custom' | 'duplicated'; createdAt: string },
): ManagedAreaDefinition {
  const candidate = structuredClone(asObject(value, 'AREA_DEFINITION_REQUIRED', 'An Area definition is required.')) as unknown as ManagedAreaDefinition;
  const definition: ManagedAreaDefinition = {
    ...candidate,
    id: mode.id,
    version: mode.version,
    status: mode.status,
    source: mode.source,
    createdAt: mode.createdAt,
    code: candidate.code?.trim() || catalogueMachineCode('AREA', mode.id),
    name: candidate.name?.trim() || '',
    description: candidate.description?.trim() || '',
    aliases: Array.isArray(candidate.aliases) ? candidate.aliases.filter((item): item is string => typeof item === 'string') : [],
    legacyIds: Array.isArray(candidate.legacyIds) ? candidate.legacyIds.filter((item): item is string => typeof item === 'string') : [],
    legacyOrder: Number.isInteger(candidate.legacyOrder) ? candidate.legacyOrder : 0,
    publishedAt: undefined,
    retiredAt: undefined,
    updatedAt: new Date().toISOString(),
  };
  return definition;
}

function sanitiseComponentDefinition(
  value: unknown,
  mode: { id: string; version: number; status: 'draft'; source: 'agency_custom' | 'duplicated'; createdAt: string },
): ManagedComponentDefinition {
  const candidate = structuredClone(asObject(value, 'COMPONENT_DEFINITION_REQUIRED', 'A Component definition is required.')) as unknown as ManagedComponentDefinition;
  const definition: ManagedComponentDefinition = {
    ...candidate,
    id: mode.id,
    version: mode.version,
    status: mode.status,
    source: mode.source,
    createdAt: mode.createdAt,
    code: candidate.code?.trim() || catalogueMachineCode('COMPONENT', mode.id),
    name: candidate.name?.trim() || '',
    description: candidate.description?.trim() || '',
    aliases: Array.isArray(candidate.aliases) ? candidate.aliases.filter((item): item is string => typeof item === 'string') : [],
    legacyIds: Array.isArray(candidate.legacyIds) ? candidate.legacyIds.filter((item): item is string => typeof item === 'string') : [],
    publishedAt: undefined,
    retiredAt: undefined,
    updatedAt: new Date().toISOString(),
  };
  return definition;
}

async function normaliseAreaRules(
  dependencies: ApiDependencies,
  agencyId: string,
  definition: ManagedAreaDefinition,
  value: unknown,
): Promise<ManagedAreaComponentRule[]> {
  if (!Array.isArray(value)) throw new ApiError(400, 'COMPONENT_RULES_REQUIRED', 'componentRules must be an array.');
  const rules: ManagedAreaComponentRule[] = [];
  const seen = new Set<string>();
  for (const [index, rawValue] of value.entries()) {
    const raw = asObject(rawValue, 'INVALID_COMPONENT_RULE', `Component assignment ${index + 1} is invalid.`);
    const componentDefinitionId = typeof raw.componentDefinitionId === 'string' ? raw.componentDefinitionId.trim() : '';
    const componentDefinitionVersion = typeof raw.componentDefinitionVersion === 'number' && Number.isInteger(raw.componentDefinitionVersion)
      ? raw.componentDefinitionVersion
      : 0;
    if (!componentDefinitionId || componentDefinitionVersion < 1) throw new ApiError(400, 'COMPONENT_REFERENCE_REQUIRED', `Component assignment ${index + 1} requires an exact Component ID and version.`);
    if (seen.has(componentDefinitionId)) throw new ApiError(400, 'DUPLICATE_COMPONENT_ASSIGNMENT', `Component ${componentDefinitionId} is assigned more than once.`);
    seen.add(componentDefinitionId);
    const componentRecord = await loadComponent(dependencies, agencyId, componentDefinitionId, componentDefinitionVersion);
    if (componentRecord.definition.status !== 'published') throw new ApiError(409, 'COMPONENT_NOT_PUBLISHED', `Component ${componentDefinitionId} v${componentDefinitionVersion} must be published before it can be assigned to an Area.`);
    const candidate = raw as unknown as Partial<ManagedAreaComponentRule>;
    const inclusion = candidate.inclusion ?? 'default';
    const assessmentDefaults = candidate.assessmentDefaults ?? defaultAssessmentDefaults(componentRecord.definition);
    const evidenceDefaults = candidate.evidenceDefaults ?? defaultEvidenceDefaults(Boolean(candidate.photoRequired));
    const id = `${definition.id}:${componentDefinitionId}`;
    rules.push({
      id,
      code: catalogueMachineCode('RULE', id),
      areaDefinitionId: definition.id,
      componentDefinitionId,
      componentDefinitionVersion,
      inclusion,
      order: typeof candidate.order === 'number' && Number.isInteger(candidate.order) ? candidate.order : index + 1,
      photoRequired: evidenceDefaults.componentPhotoRequired,
      applicability: structuredClone(definition.applicability),
      legacyAreaId: candidate.legacyAreaId || definition.id,
      legacyAreaName: candidate.legacyAreaName || definition.name,
      legacyComponentId: candidate.legacyComponentId || componentDefinitionId,
      legacyComponentName: candidate.legacyComponentName || componentRecord.definition.name,
      version: definition.version,
      status: definition.status,
      createdAt: candidate.createdAt || definition.createdAt,
      source: definition.source,
      assessmentDefaults,
      evidenceDefaults,
    });
  }
  return normaliseAreaComponentRuleOrder(rules);
}

async function createAreaDraft(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  agencyId: string,
  body: Record<string, unknown>,
): Promise<ApiResponse> {
  const principal = await authenticateAndAuthorise(req, dependencies, 'template.manage', { agencyId }, correlationId);
  await ensureCatalogueSeeded(dependencies, agencyId, principal.uid);
  return idempotent(dependencies, req, agencyId, 'catalogue:area:create', body, async () => {
    const input = asObject(body.input ?? body.definition, 'AREA_DEFINITION_REQUIRED', 'An Area draft input or definition is required.') as unknown as NewAreaDraftInput;
    const base = createAreaDraftDefinition(input);
    const definition = body.definition
      ? sanitiseAreaDefinition(body.definition, { id: base.id, version: 1, status: 'draft', source: 'agency_custom', createdAt: base.createdAt })
      : base;
    const existing = (await listAll(dependencies, AREA_VERSION_COLLECTION, agencyId)).some((record) => (record as StoredAreaVersion).definition?.id === definition.id);
    if (existing) throw new ApiError(409, 'CATALOGUE_AREA_EXISTS', 'An Area with this ID already exists. Duplicate an existing Area to create another version.');
    const componentRules = await normaliseAreaRules(dependencies, agencyId, definition, body.componentRules ?? []);
    try { validateManagedArea(definition, componentRules); } catch (error) { throw new ApiError(400, 'CATALOGUE_AREA_INVALID', error instanceof Error ? error.message : 'Area definition is invalid.'); }
    const view: CatalogueAreaVersionView = { definition, componentRules, recordVersion: 1, immutable: false };
    const id = storageId(definition.id, definition.version);
    const created = await dependencies.repository.create(AREA_VERSION_COLLECTION, agencyId, id, areaRecordData(view), principal.uid) as StoredAreaVersion;
    await appendAudit(dependencies, principal, 'catalogue.area.created', 'catalogue_area', definition.id, correlationId, { version: definition.version });
    return { status: 201, body: { data: areaView(created), meta: { correlationId } } };
  });
}

async function createComponentDraft(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  agencyId: string,
  body: Record<string, unknown>,
): Promise<ApiResponse> {
  const principal = await authenticateAndAuthorise(req, dependencies, 'template.manage', { agencyId }, correlationId);
  await ensureCatalogueSeeded(dependencies, agencyId, principal.uid);
  return idempotent(dependencies, req, agencyId, 'catalogue:component:create', body, async () => {
    const input = asObject(body.input ?? body.definition, 'COMPONENT_DEFINITION_REQUIRED', 'A Component draft input or definition is required.') as unknown as NewComponentDraftInput;
    const base = createComponentDraftDefinition(input);
    const definition = body.definition
      ? sanitiseComponentDefinition(body.definition, { id: base.id, version: 1, status: 'draft', source: 'agency_custom', createdAt: base.createdAt })
      : base;
    const existing = (await listAll(dependencies, COMPONENT_VERSION_COLLECTION, agencyId)).some((record) => (record as StoredComponentVersion).definition?.id === definition.id);
    if (existing) throw new ApiError(409, 'CATALOGUE_COMPONENT_EXISTS', 'A Component with this ID already exists. Duplicate an existing Component to create another version.');
    try { validateManagedComponent(definition); } catch (error) { throw new ApiError(400, 'CATALOGUE_COMPONENT_INVALID', error instanceof Error ? error.message : 'Component definition is invalid.'); }
    const view: CatalogueComponentVersionView = { definition, recordVersion: 1, immutable: false };
    const id = storageId(definition.id, definition.version);
    const created = await dependencies.repository.create(COMPONENT_VERSION_COLLECTION, agencyId, id, componentRecordData(view), principal.uid) as StoredComponentVersion;
    await appendAudit(dependencies, principal, 'catalogue.component.created', 'catalogue_component', definition.id, correlationId, { version: definition.version });
    return { status: 201, body: { data: componentView(created), meta: { correlationId } } };
  });
}

async function updateAreaDraft(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  agencyId: string,
  id: string,
  version: number,
  body: Record<string, unknown>,
): Promise<ApiResponse> {
  const principal = await authenticateAndAuthorise(req, dependencies, 'template.manage', { agencyId }, correlationId);
  return idempotent(dependencies, req, agencyId, `catalogue:area:${id}:${version}:update`, body, async () => {
    const existing = await loadArea(dependencies, agencyId, id, version);
    if (existing.definition.status !== 'draft' || existing.immutable) throw new ApiError(409, 'CATALOGUE_AREA_IMMUTABLE', 'Published and retired Area versions cannot be edited. Duplicate to a new draft first.');
    if (expectedRecordVersion(body) !== existing.version) throw new ApiError(409, 'VERSION_CONFLICT', 'Area changed. Reload and retry.');
    const definition = sanitiseAreaDefinition(body.definition, { id, version, status: 'draft', source: existing.definition.source === 'agency_custom' ? 'agency_custom' : 'duplicated', createdAt: existing.definition.createdAt });
    const componentRules = await normaliseAreaRules(dependencies, agencyId, definition, body.componentRules);
    try { validateManagedArea(definition, componentRules); } catch (error) { throw new ApiError(400, 'CATALOGUE_AREA_INVALID', error instanceof Error ? error.message : 'Area definition is invalid.'); }
    const updated = await dependencies.repository.update(AREA_VERSION_COLLECTION, agencyId, existing.id, areaRecordData({ definition, componentRules, recordVersion: existing.version, immutable: false, ...(existing.systemDefault ? { systemDefault: true } : {}) }), existing.version, principal.uid) as StoredAreaVersion;
    await appendAudit(dependencies, principal, 'catalogue.area.updated', 'catalogue_area', id, correlationId, { version });
    return { status: 200, body: { data: areaView(updated), meta: { correlationId } } };
  });
}

async function updateComponentDraft(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  agencyId: string,
  id: string,
  version: number,
  body: Record<string, unknown>,
): Promise<ApiResponse> {
  const principal = await authenticateAndAuthorise(req, dependencies, 'template.manage', { agencyId }, correlationId);
  return idempotent(dependencies, req, agencyId, `catalogue:component:${id}:${version}:update`, body, async () => {
    const existing = await loadComponent(dependencies, agencyId, id, version);
    if (existing.definition.status !== 'draft' || existing.immutable) throw new ApiError(409, 'CATALOGUE_COMPONENT_IMMUTABLE', 'Published and retired Component versions cannot be edited. Duplicate to a new draft first.');
    if (expectedRecordVersion(body) !== existing.version) throw new ApiError(409, 'VERSION_CONFLICT', 'Component changed. Reload and retry.');
    const definition = sanitiseComponentDefinition(body.definition, { id, version, status: 'draft', source: existing.definition.source === 'agency_custom' ? 'agency_custom' : 'duplicated', createdAt: existing.definition.createdAt });
    try { validateManagedComponent(definition); } catch (error) { throw new ApiError(400, 'CATALOGUE_COMPONENT_INVALID', error instanceof Error ? error.message : 'Component definition is invalid.'); }
    const updated = await dependencies.repository.update(COMPONENT_VERSION_COLLECTION, agencyId, existing.id, componentRecordData({ definition, recordVersion: existing.version, immutable: false, ...(existing.systemDefault ? { systemDefault: true } : {}) }), existing.version, principal.uid) as StoredComponentVersion;
    await appendAudit(dependencies, principal, 'catalogue.component.updated', 'catalogue_component', id, correlationId, { version });
    return { status: 200, body: { data: componentView(updated), meta: { correlationId } } };
  });
}

async function nextVersion(
  dependencies: ApiDependencies,
  collection: string,
  agencyId: string,
  logicalId: string,
  kind: 'area' | 'component',
): Promise<number> {
  const records = await listAll(dependencies, collection, agencyId);
  const versions = records
    .map((record) => kind === 'area' ? (record as StoredAreaVersion).definition : (record as StoredComponentVersion).definition)
    .filter((definition) => definition?.id === logicalId)
    .map((definition) => Number(definition.version));
  return Math.max(0, ...versions) + 1;
}

async function duplicateArea(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  agencyId: string,
  id: string,
  version: number,
  body: Record<string, unknown>,
): Promise<ApiResponse> {
  const principal = await authenticateAndAuthorise(req, dependencies, 'template.manage', { agencyId }, correlationId);
  return idempotent(dependencies, req, agencyId, `catalogue:area:${id}:${version}:duplicate`, body, async () => {
    const source = await loadArea(dependencies, agencyId, id, version);
    const newVersion = await nextVersion(dependencies, AREA_VERSION_COLLECTION, agencyId, id, 'area');
    const now = new Date().toISOString();
    const definition: ManagedAreaDefinition = {
      ...structuredClone(source.definition),
      version: newVersion,
      status: 'draft',
      source: 'duplicated',
      createdAt: now,
      updatedAt: now,
      publishedAt: undefined,
      retiredAt: undefined,
    };
    const componentRules = source.componentRules.map((rule) => ({
      ...structuredClone(rule),
      id: `${id}:${rule.componentDefinitionId}`,
      code: catalogueMachineCode('RULE', `${id}:${rule.componentDefinitionId}`),
      version: newVersion,
      status: 'draft' as const,
      source: 'duplicated' as const,
      createdAt: now,
    }));
    validateManagedArea(definition, componentRules);
    const recordId = storageId(id, newVersion);
    const created = await dependencies.repository.create(AREA_VERSION_COLLECTION, agencyId, recordId, areaRecordData({ definition, componentRules, recordVersion: 1, immutable: false }), principal.uid) as StoredAreaVersion;
    await appendAudit(dependencies, principal, 'catalogue.area.duplicated', 'catalogue_area', id, correlationId, { sourceVersion: version, version: newVersion });
    return { status: 201, body: { data: areaView(created), meta: { correlationId } } };
  });
}

async function duplicateComponent(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  agencyId: string,
  id: string,
  version: number,
  body: Record<string, unknown>,
): Promise<ApiResponse> {
  const principal = await authenticateAndAuthorise(req, dependencies, 'template.manage', { agencyId }, correlationId);
  return idempotent(dependencies, req, agencyId, `catalogue:component:${id}:${version}:duplicate`, body, async () => {
    const source = await loadComponent(dependencies, agencyId, id, version);
    const newVersion = await nextVersion(dependencies, COMPONENT_VERSION_COLLECTION, agencyId, id, 'component');
    const now = new Date().toISOString();
    const definition: ManagedComponentDefinition = {
      ...structuredClone(source.definition),
      version: newVersion,
      status: 'draft',
      source: 'duplicated',
      createdAt: now,
      updatedAt: now,
      publishedAt: undefined,
      retiredAt: undefined,
    };
    validateManagedComponent(definition);
    const recordId = storageId(id, newVersion);
    const created = await dependencies.repository.create(COMPONENT_VERSION_COLLECTION, agencyId, recordId, componentRecordData({ definition, recordVersion: 1, immutable: false }), principal.uid) as StoredComponentVersion;
    await appendAudit(dependencies, principal, 'catalogue.component.duplicated', 'catalogue_component', id, correlationId, { sourceVersion: version, version: newVersion });
    return { status: 201, body: { data: componentView(created), meta: { correlationId } } };
  });
}

async function publishArea(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  agencyId: string,
  id: string,
  version: number,
  body: Record<string, unknown>,
): Promise<ApiResponse> {
  const principal = await authenticateAndAuthorise(req, dependencies, 'template.manage', { agencyId }, correlationId);
  return idempotent(dependencies, req, agencyId, `catalogue:area:${id}:${version}:publish`, body, async () => {
    const existing = await loadArea(dependencies, agencyId, id, version);
    if (existing.definition.status !== 'draft' || existing.immutable) throw new ApiError(409, 'CATALOGUE_AREA_NOT_DRAFT', 'Only editable Area drafts can be published.');
    if (expectedRecordVersion(body) !== existing.version) throw new ApiError(409, 'VERSION_CONFLICT', 'Area changed. Reload and retry.');
    for (const rule of existing.componentRules) {
      const component = await loadComponent(dependencies, agencyId, rule.componentDefinitionId, rule.componentDefinitionVersion);
      if (component.definition.status !== 'published') throw new ApiError(409, 'COMPONENT_NOT_PUBLISHED', `Component ${rule.componentDefinitionId} v${rule.componentDefinitionVersion} is not published.`);
    }
    const now = new Date().toISOString();
    const definition = withCatalogueLifecycle(existing.definition, 'published', now);
    const componentRules = existing.componentRules.map((rule) => withCatalogueLifecycle(rule, 'published', now));
    validateManagedArea(definition, componentRules);
    const updated = await dependencies.repository.update(AREA_VERSION_COLLECTION, agencyId, existing.id, areaRecordData({ definition, componentRules, recordVersion: existing.version, immutable: true, ...(existing.systemDefault ? { systemDefault: true } : {}) }), existing.version, principal.uid) as StoredAreaVersion;
    await upsertPointer(dependencies, AREA_POINTER_COLLECTION, agencyId, 'area', id, version, 'published', existing.id, principal.uid, Boolean(existing.systemDefault));
    await appendAudit(dependencies, principal, 'catalogue.area.published', 'catalogue_area', id, correlationId, { version });
    return { status: 200, body: { data: areaView(updated), meta: { correlationId } } };
  });
}

async function publishComponent(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  agencyId: string,
  id: string,
  version: number,
  body: Record<string, unknown>,
): Promise<ApiResponse> {
  const principal = await authenticateAndAuthorise(req, dependencies, 'template.manage', { agencyId }, correlationId);
  return idempotent(dependencies, req, agencyId, `catalogue:component:${id}:${version}:publish`, body, async () => {
    const existing = await loadComponent(dependencies, agencyId, id, version);
    if (existing.definition.status !== 'draft' || existing.immutable) throw new ApiError(409, 'CATALOGUE_COMPONENT_NOT_DRAFT', 'Only editable Component drafts can be published.');
    if (expectedRecordVersion(body) !== existing.version) throw new ApiError(409, 'VERSION_CONFLICT', 'Component changed. Reload and retry.');
    const definition = withCatalogueLifecycle(existing.definition, 'published');
    validateManagedComponent(definition);
    const updated = await dependencies.repository.update(COMPONENT_VERSION_COLLECTION, agencyId, existing.id, componentRecordData({ definition, recordVersion: existing.version, immutable: true, ...(existing.systemDefault ? { systemDefault: true } : {}) }), existing.version, principal.uid) as StoredComponentVersion;
    await upsertPointer(dependencies, COMPONENT_POINTER_COLLECTION, agencyId, 'component', id, version, 'published', existing.id, principal.uid, Boolean(existing.systemDefault));
    await appendAudit(dependencies, principal, 'catalogue.component.published', 'catalogue_component', id, correlationId, { version });
    return { status: 200, body: { data: componentView(updated), meta: { correlationId } } };
  });
}

function scalarReferences(value: unknown, tokens: Set<string>): boolean {
  if (typeof value === 'string') return tokens.has(value);
  if (Array.isArray(value)) return value.some((item) => scalarReferences(item, tokens));
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).some((item) => scalarReferences(item, tokens));
  return false;
}

async function usageImpact(
  dependencies: ApiDependencies,
  agencyId: string,
  kind: 'area' | 'component',
  definition: ManagedAreaDefinition | ManagedComponentDefinition,
): Promise<CatalogueUsageImpact> {
  const tokens = new Set<string>([definition.id, definition.code, ...definition.legacyIds]);
  const catalogueAreaRecords = kind === 'component' ? await listAll(dependencies, AREA_VERSION_COLLECTION, agencyId) : [];
  const templates = await listAll(dependencies, 'templateVersions', agencyId);
  const properties = await listAll(dependencies, 'properties', agencyId);
  const reports = await listAll(dependencies, 'reports', agencyId);
  const maintenanceItems = await listAll(dependencies, 'maintenanceItems', agencyId);
  const count = (records: StoredRecord[]) => records.filter((record) => scalarReferences(record, tokens)).length;
  const catalogueAreas = count(catalogueAreaRecords);
  const templateCount = count(templates);
  const propertyCount = count(properties);
  const reportCount = count(reports);
  const maintenanceCount = count(maintenanceItems);
  const publishedAreaDependency = catalogueAreaRecords.some((record) => {
    const area = record as StoredAreaVersion;
    return area.definition?.status === 'published' && scalarReferences(area.componentRules, tokens);
  });
  const publishedTemplateDependency = templates.some((record) => record.status === 'published' && scalarReferences(record, tokens));
  return {
    catalogueAreas,
    templates: templateCount,
    properties: propertyCount,
    reports: reportCount,
    maintenanceItems: maintenanceCount,
    totalRecords: catalogueAreas + templateCount + propertyCount + reportCount + maintenanceCount,
    hasPublishedDependencies: publishedAreaDependency || publishedTemplateDependency,
    sampledAt: new Date().toISOString(),
  };
}

async function retireArea(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  agencyId: string,
  id: string,
  version: number,
  body: Record<string, unknown>,
): Promise<ApiResponse> {
  const principal = await authenticateAndAuthorise(req, dependencies, 'template.manage', { agencyId }, correlationId);
  return idempotent(dependencies, req, agencyId, `catalogue:area:${id}:${version}:retire`, body, async () => {
    const existing = await loadArea(dependencies, agencyId, id, version);
    if (existing.definition.status !== 'published') throw new ApiError(409, 'CATALOGUE_AREA_NOT_PUBLISHED', 'Only published Area versions can be retired.');
    if (expectedRecordVersion(body) !== existing.version) throw new ApiError(409, 'VERSION_CONFLICT', 'Area changed. Reload and retry.');
    const impact = await usageImpact(dependencies, agencyId, 'area', existing.definition);
    if (impact.totalRecords > 0 && body.acknowledgeUsageImpact !== true) {
      throw new ApiError(409, 'CATALOGUE_USAGE_ACK_REQUIRED', 'This Area is referenced by existing records. Review the usage impact and explicitly acknowledge retirement.', { impact });
    }
    const now = new Date().toISOString();
    const definition = withCatalogueLifecycle(existing.definition, 'retired', now);
    const componentRules = existing.componentRules.map((rule) => withCatalogueLifecycle(rule, 'retired', now));
    const updated = await dependencies.repository.update(AREA_VERSION_COLLECTION, agencyId, existing.id, areaRecordData({ definition, componentRules, recordVersion: existing.version, immutable: true, ...(existing.systemDefault ? { systemDefault: true } : {}) }), existing.version, principal.uid) as StoredAreaVersion;
    const candidates = (await listAll(dependencies, AREA_VERSION_COLLECTION, agencyId))
      .map((record) => record as StoredAreaVersion)
      .filter((record) => record.definition.id === id && record.definition.status === 'published' && record.definition.version !== version)
      .sort((left, right) => right.definition.version - left.definition.version);
    const fallback = candidates[0];
    if (fallback) {
      await upsertPointer(dependencies, AREA_POINTER_COLLECTION, agencyId, 'area', id, fallback.definition.version, 'published', fallback.id, principal.uid, Boolean(fallback.systemDefault));
    } else {
      await upsertPointer(dependencies, AREA_POINTER_COLLECTION, agencyId, 'area', id, version, 'retired', existing.id, principal.uid, Boolean(existing.systemDefault));
    }
    await appendAudit(dependencies, principal, 'catalogue.area.retired', 'catalogue_area', id, correlationId, { version, impact });
    return { status: 200, body: { data: areaView(updated), meta: { correlationId, impact } } };
  });
}

async function retireComponent(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  agencyId: string,
  id: string,
  version: number,
  body: Record<string, unknown>,
): Promise<ApiResponse> {
  const principal = await authenticateAndAuthorise(req, dependencies, 'template.manage', { agencyId }, correlationId);
  return idempotent(dependencies, req, agencyId, `catalogue:component:${id}:${version}:retire`, body, async () => {
    const existing = await loadComponent(dependencies, agencyId, id, version);
    if (existing.definition.status !== 'published') throw new ApiError(409, 'CATALOGUE_COMPONENT_NOT_PUBLISHED', 'Only published Component versions can be retired.');
    if (expectedRecordVersion(body) !== existing.version) throw new ApiError(409, 'VERSION_CONFLICT', 'Component changed. Reload and retry.');
    const impact = await usageImpact(dependencies, agencyId, 'component', existing.definition);
    if (impact.totalRecords > 0 && body.acknowledgeUsageImpact !== true) {
      throw new ApiError(409, 'CATALOGUE_USAGE_ACK_REQUIRED', 'This Component is referenced by existing records. Review the usage impact and explicitly acknowledge retirement.', { impact });
    }
    const definition = withCatalogueLifecycle(existing.definition, 'retired');
    const updated = await dependencies.repository.update(COMPONENT_VERSION_COLLECTION, agencyId, existing.id, componentRecordData({ definition, recordVersion: existing.version, immutable: true, ...(existing.systemDefault ? { systemDefault: true } : {}) }), existing.version, principal.uid) as StoredComponentVersion;
    const candidates = (await listAll(dependencies, COMPONENT_VERSION_COLLECTION, agencyId))
      .map((record) => record as StoredComponentVersion)
      .filter((record) => record.definition.id === id && record.definition.status === 'published' && record.definition.version !== version)
      .sort((left, right) => right.definition.version - left.definition.version);
    const fallback = candidates[0];
    if (fallback) {
      await upsertPointer(dependencies, COMPONENT_POINTER_COLLECTION, agencyId, 'component', id, fallback.definition.version, 'published', fallback.id, principal.uid, Boolean(fallback.systemDefault));
    } else {
      await upsertPointer(dependencies, COMPONENT_POINTER_COLLECTION, agencyId, 'component', id, version, 'retired', existing.id, principal.uid, Boolean(existing.systemDefault));
    }
    await appendAudit(dependencies, principal, 'catalogue.component.retired', 'catalogue_component', id, correlationId, { version, impact });
    return { status: 200, body: { data: componentView(updated), meta: { correlationId, impact } } };
  });
}

async function executeAreaAction(
  action: string,
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  agencyId: string,
  id: string,
  version: number,
  body: Record<string, unknown>,
): Promise<ApiResponse> {
  if (action === 'duplicate') return duplicateArea(req, dependencies, correlationId, agencyId, id, version, body);
  if (action === 'publish') return publishArea(req, dependencies, correlationId, agencyId, id, version, body);
  if (action === 'retire') return retireArea(req, dependencies, correlationId, agencyId, id, version, body);
  throw new ApiError(404, 'UNKNOWN_CATALOGUE_ACTION', `Unknown Area action ${action}.`);
}

async function executeComponentAction(
  action: string,
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  agencyId: string,
  id: string,
  version: number,
  body: Record<string, unknown>,
): Promise<ApiResponse> {
  if (action === 'duplicate') return duplicateComponent(req, dependencies, correlationId, agencyId, id, version, body);
  if (action === 'publish') return publishComponent(req, dependencies, correlationId, agencyId, id, version, body);
  if (action === 'retire') return retireComponent(req, dependencies, correlationId, agencyId, id, version, body);
  throw new ApiError(404, 'UNKNOWN_CATALOGUE_ACTION', `Unknown Component action ${action}.`);
}

export async function routeCatalogueRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'catalogue') return undefined;
  if (parts[3] !== 'areas' && parts[3] !== 'components') return undefined;
  const kind = parts[3] as 'areas' | 'components';
  const agencyId = agencyHeader(req);

  if (parts.length === 4 && req.method === 'GET') {
    return kind === 'areas'
      ? listAreas(req, dependencies, correlationId, agencyId, url)
      : listComponents(req, dependencies, correlationId, agencyId, url);
  }
  if (parts.length === 5 && parts[4] === 'drafts' && req.method === 'POST') {
    const body = await readJson(req);
    return kind === 'areas'
      ? createAreaDraft(req, dependencies, correlationId, agencyId, body)
      : createComponentDraft(req, dependencies, correlationId, agencyId, body);
  }

  const id = parts[4] ? decodeURIComponent(parts[4]) : '';
  const version = parts[5] === 'versions' && parts[6] ? Number(parts[6]) : NaN;
  if (!id || !Number.isInteger(version) || version < 1) return undefined;

  if (parts.length === 7 && req.method === 'GET') {
    const principal = await authenticateAndAuthorise(req, dependencies, 'template.manage', { agencyId }, correlationId);
    await ensureCatalogueSeeded(dependencies, agencyId, principal.uid);
    const data = kind === 'areas'
      ? areaView(await loadArea(dependencies, agencyId, id, version))
      : componentView(await loadComponent(dependencies, agencyId, id, version));
    return { status: 200, body: { data, meta: { correlationId } } };
  }
  if (parts.length === 7 && req.method === 'PUT') {
    const body = await readJson(req);
    return kind === 'areas'
      ? updateAreaDraft(req, dependencies, correlationId, agencyId, id, version, body)
      : updateComponentDraft(req, dependencies, correlationId, agencyId, id, version, body);
  }
  if (parts.length === 8 && parts[7] === 'usage' && req.method === 'GET') {
    const principal = await authenticateAndAuthorise(req, dependencies, 'template.manage', { agencyId }, correlationId);
    await ensureCatalogueSeeded(dependencies, agencyId, principal.uid);
    const definition = kind === 'areas'
      ? (await loadArea(dependencies, agencyId, id, version)).definition
      : (await loadComponent(dependencies, agencyId, id, version)).definition;
    const impact = await usageImpact(dependencies, agencyId, kind === 'areas' ? 'area' : 'component', definition);
    return { status: 200, body: { data: impact, meta: { correlationId } } };
  }
  if (parts.length === 9 && parts[7] === 'actions' && parts[8] && req.method === 'POST') {
    const body = await readJson(req);
    return kind === 'areas'
      ? executeAreaAction(parts[8], req, dependencies, correlationId, agencyId, id, version, body)
      : executeComponentAction(parts[8], req, dependencies, correlationId, agencyId, id, version, body);
  }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method ?? '')) {
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Catalogue mutations must use draft/version action commands.');
  }
  return undefined;
}
