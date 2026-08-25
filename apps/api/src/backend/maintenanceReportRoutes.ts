import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import type {
  BaselineComponentSnapshot,
  MaintenanceItem,
  ReportAggregate,
  ReportPhotoReference,
} from '@pcr/domain';
import { firestoreDb } from '../firestoreDatabase.js';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies } from './types.js';

type Versioned<T> = T & { version: number };
type ReportArea = ReportAggregate['areas'][number];

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Object required');
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
}

function agencyHeader(req: IncomingMessage): string {
  const agencyId = req.headers['x-agency-id']?.toString().trim();
  if (!agencyId) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return agencyId;
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value)) throw new ApiError(400, 'MAINTENANCE_ITEMS_REQUIRED', 'maintenanceItemIds must be an array.');
  const result = [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))];
  if (!result.length || result.length > 50) throw new ApiError(400, 'MAINTENANCE_ITEMS_REQUIRED', 'Select between 1 and 50 maintenance items.');
  return result;
}

async function loadItems(dependencies: ApiDependencies, agencyId: string, itemIds: string[]): Promise<Array<Versioned<MaintenanceItem>>> {
  const values = await Promise.all(itemIds.map((id) => dependencies.repository.get('maintenanceItems', agencyId, id)));
  if (values.some((value) => !value)) throw new ApiError(404, 'MAINTENANCE_ITEM_NOT_FOUND', 'One or more maintenance items could not be loaded.');
  return values as unknown as Array<Versioned<MaintenanceItem>>;
}

function address(property: Record<string, unknown>): string {
  return [property.address, property.suburb, property.state, property.postcode]
    .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
    .map(String)
    .filter((value) => value.trim())
    .join(', ') || 'Property';
}

async function sourceComponent(
  agencyId: string,
  item: MaintenanceItem,
): Promise<{ areaId: string; areaName: string; componentId: string; componentName: string; baseline: BaselineComponentSnapshot } | undefined> {
  if (!item.sourceReportId || !item.sourceReportVersionId || !item.sourceAreaId || !item.sourceComponentId) return undefined;
  const versionRef = firestoreDb(adminApp()).doc(`agencies/${agencyId}/reports/${item.sourceReportId}/versions/${item.sourceReportVersionId}`);
  const version = await versionRef.get();
  if (!version.exists || version.get('immutable') !== true) throw new ApiError(409, 'SOURCE_REPORT_VERSION_INVALID', `Maintenance item ${item.id} does not reference an immutable source report version.`);
  const areaRef = versionRef.collection('areas').doc(item.sourceAreaId);
  const [area, component] = await Promise.all([areaRef.get(), areaRef.collection('components').doc(item.sourceComponentId).get()]);
  if (!area.exists || !component.exists) throw new ApiError(409, 'SOURCE_COMPONENT_NOT_FOUND', `Maintenance item ${item.id} source component is not present in its immutable report version.`);
  const data = component.data() as Record<string, unknown>;
  return {
    areaId: item.sourceAreaId,
    areaName: String(area.get('name') ?? item.sourceAreaId),
    componentId: item.sourceComponentId,
    componentName: String(data.component ?? item.title),
    baseline: {
      id: item.sourceComponentId,
      conditionCategory: (data.conditionCategory ?? 'unable_to_confirm') as BaselineComponentSnapshot['conditionCategory'],
      cleanlinessCategory: (data.cleanlinessCategory ?? 'unable_to_confirm') as BaselineComponentSnapshot['cleanlinessCategory'],
      workingStatus: (data.workingStatus ?? 'not_applicable') as BaselineComponentSnapshot['workingStatus'],
      testStatus: (data.testStatus ?? 'not_applicable') as BaselineComponentSnapshot['testStatus'],
      commentary: typeof data.commentary === 'string' ? data.commentary : '',
      defects: Array.isArray(data.defects) ? data.defects.filter((defect): defect is string => typeof defect === 'string') : [],
      photoReferences: Array.isArray(data.photoReferences) ? data.photoReferences as ReportPhotoReference[] : [],
    },
  };
}

async function targetAreas(agencyId: string, items: Array<Versioned<MaintenanceItem>>): Promise<ReportAggregate['areas']> {
  const sourceValues = await Promise.all(items.map((item) => sourceComponent(agencyId, item)));
  const areaMap = new Map<string, ReportArea>();
  items.forEach((item, index) => {
    const source = sourceValues[index];
    const areaId = source?.areaId ?? `maintenance-${item.id}`;
    const areaName = source?.areaName ?? 'Maintenance Follow-Up';
    const baseline: BaselineComponentSnapshot = source?.baseline ?? {
      conditionCategory: 'unable_to_confirm', cleanlinessCategory: 'unable_to_confirm', workingStatus: 'not_applicable', testStatus: 'not_applicable', commentary: item.description, defects: [], photoReferences: [],
    };
    const existing: ReportArea = areaMap.get(areaId) ?? {
      id: areaId,
      name: areaName,
      sequence: areaMap.size + 1,
      overallCommentary: '',
      photoReferences: [],
      components: [],
    };
    const operational = baseline.workingStatus !== 'not_applicable' || baseline.testStatus !== 'not_applicable';
    existing.components.push({
      id: source?.componentId ?? `maintenance-item-${item.id}`,
      component: source?.componentName ?? item.title,
      conditionCategory: 'unable_to_confirm',
      cleanlinessCategory: 'unable_to_confirm',
      workingStatus: operational ? 'untested' : 'not_applicable',
      testStatus: operational ? 'untested' : 'not_applicable',
      defects: [],
      maintenanceRequired: false,
      commentary: '',
      photoReferences: [],
      reviewStatus: 'draft',
      comparisonStatus: source ? 'not_compared' : 'unable_to_compare',
      baselineComponentId: source?.componentId ?? `maintenance:${item.id}`,
      baselineComponentData: baseline,
      baselineEvidencePhotoIds: [...new Set([...(baseline.photoReferences?.map((reference) => reference.photoId) ?? []), ...item.sourceEvidenceIds])],
      currentEvidencePhotoIds: [],
      comparisonMethod: source ? 'stable_id' : 'manual',
      comparisonConfidence: source ? 1 : 0,
      comparisonReviewStatus: 'suggested',
      ...(source ? {} : { comparisonUncertainty: 'Maintenance item has no immutable source report component; current condition requires manual follow-up assessment.' }),
    });
    areaMap.set(areaId, existing);
  });
  return [...areaMap.values()];
}

async function maintenanceTemplate(dependencies: ApiDependencies, agencyId: string, actorId: string): Promise<{ id: string; version: number }> {
  const page = await dependencies.repository.list('templates', agencyId, 100);
  const candidates = page.items.filter((record) => record.status === 'published' && String(record.inspectionType ?? record.reportType ?? '').toLowerCase().includes('maintenance'));
  const chosen = candidates.sort((left, right) => Number(right.templateVersion ?? 0) - Number(left.templateVersion ?? 0))[0];
  if (chosen) return { id: String(chosen.templateId ?? chosen.id), version: Number(chosen.templateVersion ?? 1) };
  const id = 'system-maintenance-v1';
  if (!await dependencies.repository.get('templates', agencyId, id)) {
    await dependencies.repository.create('templates', agencyId, id, { templateId: id, templateVersion: 1, inspectionType: 'maintenance', reportType: 'Maintenance and Follow-Up Report', status: 'published', systemDefault: true, publishedAt: new Date().toISOString() }, actorId);
  }
  return { id, version: 1 };
}

export async function routeMaintenanceReportRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const parts = new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'maintenance-reports' || parts[3] !== 'create') return undefined;
  if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Maintenance follow-up report creation requires POST.');
  const agencyId = agencyHeader(req);
  const body = await readJson(req);
  const itemIds = ids(body.maintenanceItemIds);
  const items = await loadItems(dependencies, agencyId, itemIds);
  const propertyId = items[0].propertyId;
  const tenancyId = items[0].tenancyId;
  if (items.some((item) => item.propertyId !== propertyId || item.tenancyId !== tenancyId)) throw new ApiError(409, 'MAINTENANCE_CONTEXT_MISMATCH', 'All selected maintenance items must belong to the same property and tenancy context.');
  const principal = await authenticateAndAuthorise(req, dependencies, 'maintenance.manage', { agencyId, propertyId, ...(tenancyId ? { tenancyId } : {}) }, correlationId);
  const property = await dependencies.repository.get('properties', agencyId, propertyId);
  if (!property) throw new ApiError(404, 'PROPERTY_NOT_FOUND', 'Maintenance property not found.');

  const identity = createHash('sha256').update([...itemIds].sort().join('|')).digest('hex').slice(0, 20);
  const reportId = `maintenance-report-${identity}`;
  const jobId = `maintenance-followup-${identity}`;
  const existing = await dependencies.reports.load(agencyId, reportId);
  if (existing) return { status: 200, body: { data: existing, meta: { correlationId, existing: true } } };

  const template = await maintenanceTemplate(dependencies, agencyId, principal.uid);
  if (!await dependencies.repository.get('inspectionJobs', agencyId, jobId)) {
    await dependencies.repository.create('inspectionJobs', agencyId, jobId, {
      propertyId,
      ...(tenancyId ? { tenancyId } : {}),
      reportType: 'Maintenance and Follow-Up Report',
      status: 'assigned',
      assignedInspectorId: principal.uid,
      reportId,
      templateId: template.id,
      templateVersion: template.version,
      sourceMaintenanceItemIds: itemIds,
    }, principal.uid);
  }

  const sourceSetId = `maintenance-source-set-${identity}`;
  const aggregate: ReportAggregate = {
    report: {
      id: reportId,
      agencyId,
      propertyId,
      ...(tenancyId ? { tenancyId } : {}),
      inspectionJobId: jobId,
      reportType: 'Maintenance and Follow-Up Report',
      propertyAddress: address(property),
      inspectionDate: typeof body.inspectionDate === 'string' ? body.inspectionDate : new Date().toISOString().slice(0, 10),
      lifecycleStatus: 'draft',
      templateId: template.id,
      templateVersion: template.version,
      baselineReportId: sourceSetId,
      baselineReportVersionId: sourceSetId,
      baselineQuality: 'structured',
      sourceMaintenanceItemIds: itemIds,
    },
    areas: await targetAreas(agencyId, items),
  };
  const stored = await dependencies.reports.saveDraft(aggregate, undefined, principal.uid);
  await dependencies.audit.append({
    id: randomUUID(), timestamp: new Date().toISOString(), actorId: principal.uid, actorRole: principal.role, agencyId,
    capability: 'maintenance.manage', outcome: 'allowed', reason: 'maintenance_followup_report_created',
    target: { agencyId, propertyId, ...(tenancyId ? { tenancyId } : {}), inspectionJobId: jobId, reportId }, correlationId,
    entityType: 'report', entityId: reportId, eventType: 'maintenance.followup_report_created', metadata: { maintenanceItemIds: itemIds },
  });
  return { status: 201, body: { data: stored, meta: { correlationId, inspectionJobId: jobId, maintenanceItemIds: itemIds } } };
}
