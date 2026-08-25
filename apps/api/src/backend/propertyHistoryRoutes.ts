import type { IncomingMessage } from 'node:http';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { canonicalComponentOccurrenceIdentity, canonicalSemanticComponentIdentity } from '@pcr/domain';
import { firestoreDb } from '../firestoreDatabase.js';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies } from './types.js';

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

function agencyHeader(req: IncomingMessage): string {
  const agencyId = req.headers['x-agency-id']?.toString().trim();
  if (!agencyId) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return agencyId;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function numberValue(value: unknown): number {
  return optionalNumber(value) ?? 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function photoIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => item && typeof item === 'object' && !Array.isArray(item) ? text((item as Record<string, unknown>).photoId) : '').filter(Boolean)
    : [];
}

interface ComponentHistoryPoint {
  reportId: string;
  reportVersionId: string;
  reportType: string;
  inspectionDate?: string;
  lifecycleStatus: string;
  areaId: string;
  areaName: string;
  canonicalAreaDefinitionId?: string;
  canonicalAreaDefinitionVersion?: number;
  componentId: string;
  componentName: string;
  canonicalComponentDefinitionId?: string;
  canonicalComponentDefinitionVersion?: number;
  canonicalAreaComponentRuleId?: string;
  canonicalAreaComponentRuleVersion?: number;
  conditionCategory: string;
  cleanlinessCategory: string;
  workingStatus: string;
  testStatus: string;
  commentary: string;
  defects: string[];
  evidencePhotoIds: string[];
  versionCreatedAt?: string;
}

interface ComponentHistoryGroup {
  stableKey: string;
  identityMode: 'canonical_occurrence' | 'canonical_semantic' | 'legacy_instance';
  areaId: string;
  areaName: string;
  canonicalAreaDefinitionId?: string;
  componentId: string;
  componentName: string;
  canonicalComponentDefinitionId?: string;
  observations: ComponentHistoryPoint[];
}

function stableComponentKey(input: {
  areaId: string;
  canonicalAreaDefinitionId?: string;
  componentId: string;
  canonicalComponentDefinitionId?: string;
}): { key: string; mode: ComponentHistoryGroup['identityMode'] } {
  const occurrence = canonicalComponentOccurrenceIdentity({
    id: input.areaId,
    canonicalAreaDefinitionId: input.canonicalAreaDefinitionId,
  }, {
    id: input.componentId,
    canonicalComponentDefinitionId: input.canonicalComponentDefinitionId,
  });
  if (occurrence && input.canonicalComponentDefinitionId) return { key: occurrence, mode: 'canonical_occurrence' };
  const semantic = canonicalSemanticComponentIdentity({ canonicalAreaDefinitionId: input.canonicalAreaDefinitionId }, {
    canonicalComponentDefinitionId: input.canonicalComponentDefinitionId,
  });
  if (semantic) return { key: semantic, mode: 'canonical_semantic' };
  return { key: `legacy:${input.areaId}::${input.componentId}`, mode: 'legacy_instance' };
}

export async function routePropertyHistoryRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const parts = new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'properties' || !parts[3] || parts[4] !== 'history') return undefined;
  if (req.method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Property history is read-only.');

  const agencyId = agencyHeader(req);
  const propertyId = parts[3];
  const property = await dependencies.repository.get('properties', agencyId, propertyId);
  if (!property) throw new ApiError(404, 'PROPERTY_NOT_FOUND', 'Property not found.');
  await authenticateAndAuthorise(req, dependencies, 'property.read', { agencyId, propertyId }, correlationId);

  const database = firestoreDb(adminApp());
  const reportsPage = await dependencies.repository.list('reports', agencyId, 100);
  const reportRecords = reportsPage.items
    .filter((report) => report.propertyId === propertyId)
    .sort((left, right) => text(left.inspectionDate ?? left.updatedAt).localeCompare(text(right.inspectionDate ?? right.updatedAt)));

  const inspections: Array<Record<string, unknown>> = [];
  const componentMap = new Map<string, ComponentHistoryGroup>();

  for (const report of reportRecords) {
    const reportId = report.id;
    const versions = await database.collection(`agencies/${agencyId}/reports/${reportId}/versions`).get();
    const immutableVersions = versions.docs
      .filter((document) => document.get('immutable') === true)
      .sort((left, right) => numberValue(left.get('sequence')) - numberValue(right.get('sequence')) || text(left.get('createdAt')).localeCompare(text(right.get('createdAt'))));
    if (!immutableVersions.length) continue;

    inspections.push({
      reportId,
      reportType: text(report.reportType),
      inspectionDate: text(report.inspectionDate),
      lifecycleStatus: text(report.lifecycleStatus),
      currentVersionId: text(report.currentVersionId),
      templateId: text(report.templateId),
      templateVersion: numberValue(report.templateVersion),
      propertyLayoutVersionId: text(report.propertyLayoutVersionId),
      structureResolutionVersion: optionalNumber(report.structureResolutionVersion),
      canonicalCatalogueId: text(report.canonicalCatalogueId),
      canonicalCatalogueVersion: optionalNumber(report.canonicalCatalogueVersion),
      immutableVersionCount: immutableVersions.length,
      sourceMaintenanceItemIds: stringArray(report.sourceMaintenanceItemIds),
    });

    for (const versionDocument of immutableVersions) {
      const versionId = versionDocument.id;
      const areaSnapshot = await versionDocument.ref.collection('areas').get();
      for (const areaDocument of areaSnapshot.docs) {
        const area = areaDocument.data() as Record<string, unknown>;
        const areaId = text(area.id) || areaDocument.id;
        const areaName = text(area.name) || areaId;
        const canonicalAreaDefinitionId = text(area.canonicalAreaDefinitionId) || undefined;
        const canonicalAreaDefinitionVersion = optionalNumber(area.canonicalAreaDefinitionVersion);
        const componentSnapshot = await areaDocument.ref.collection('components').get();
        for (const componentDocument of componentSnapshot.docs) {
          const component = componentDocument.data() as Record<string, unknown>;
          const componentId = text(component.id) || componentDocument.id;
          const componentName = text(component.component) || componentId;
          const canonicalComponentDefinitionId = text(component.canonicalComponentDefinitionId) || undefined;
          const canonicalComponentDefinitionVersion = optionalNumber(component.canonicalComponentDefinitionVersion);
          const canonicalAreaComponentRuleId = text(component.canonicalAreaComponentRuleId) || undefined;
          const canonicalAreaComponentRuleVersion = optionalNumber(component.canonicalAreaComponentRuleVersion);
          const identity = stableComponentKey({ areaId, canonicalAreaDefinitionId, componentId, canonicalComponentDefinitionId });
          const group = componentMap.get(identity.key) ?? {
            stableKey: identity.key,
            identityMode: identity.mode,
            areaId,
            areaName,
            ...(canonicalAreaDefinitionId ? { canonicalAreaDefinitionId } : {}),
            componentId,
            componentName,
            ...(canonicalComponentDefinitionId ? { canonicalComponentDefinitionId } : {}),
            observations: [],
          };
          group.areaName = areaName;
          group.componentName = componentName;
          group.observations.push({
            reportId,
            reportVersionId: versionId,
            reportType: text(report.reportType),
            ...(text(report.inspectionDate) ? { inspectionDate: text(report.inspectionDate) } : {}),
            lifecycleStatus: text(versionDocument.get('lifecycleStatus') ?? report.lifecycleStatus),
            areaId,
            areaName,
            ...(canonicalAreaDefinitionId ? { canonicalAreaDefinitionId } : {}),
            ...(canonicalAreaDefinitionVersion ? { canonicalAreaDefinitionVersion } : {}),
            componentId,
            componentName,
            ...(canonicalComponentDefinitionId ? { canonicalComponentDefinitionId } : {}),
            ...(canonicalComponentDefinitionVersion ? { canonicalComponentDefinitionVersion } : {}),
            ...(canonicalAreaComponentRuleId ? { canonicalAreaComponentRuleId } : {}),
            ...(canonicalAreaComponentRuleVersion ? { canonicalAreaComponentRuleVersion } : {}),
            conditionCategory: text(component.conditionCategory),
            cleanlinessCategory: text(component.cleanlinessCategory),
            workingStatus: text(component.workingStatus),
            testStatus: text(component.testStatus),
            commentary: text(component.commentary),
            defects: stringArray(component.defects),
            evidencePhotoIds: photoIds(component.photoReferences),
            ...(text(versionDocument.get('createdAt')) ? { versionCreatedAt: text(versionDocument.get('createdAt')) } : {}),
          });
          componentMap.set(identity.key, group);
        }
      }
    }
  }

  const maintenancePage = await dependencies.repository.list('maintenanceItems', agencyId, 100);
  const maintenance = maintenancePage.items
    .filter((item) => item.propertyId === propertyId)
    .map((item) => ({
      id: item.id,
      title: text(item.title),
      category: text(item.category),
      priority: text(item.priority),
      status: text(item.status),
      sourceReportId: text(item.sourceReportId),
      sourceReportVersionId: text(item.sourceReportVersionId),
      sourceAreaId: text(item.sourceAreaId),
      sourceComponentId: text(item.sourceComponentId),
      sourceCanonicalAreaDefinitionId: text(item.sourceCanonicalAreaDefinitionId),
      sourceCanonicalAreaDefinitionVersion: optionalNumber(item.sourceCanonicalAreaDefinitionVersion),
      sourceCanonicalComponentDefinitionId: text(item.sourceCanonicalComponentDefinitionId),
      sourceCanonicalComponentDefinitionVersion: optionalNumber(item.sourceCanonicalComponentDefinitionVersion),
      sourceEvidenceIds: stringArray(item.sourceEvidenceIds),
      completionEvidenceIds: stringArray(item.completionEvidenceIds),
      createdAt: text(item.createdAt),
      updatedAt: text(item.updatedAt),
      closedAt: text(item.closedAt),
    }))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  const components = [...componentMap.values()]
    .map((group) => ({
      ...group,
      observations: group.observations.sort((left, right) => text(left.inspectionDate ?? left.versionCreatedAt).localeCompare(text(right.inspectionDate ?? right.versionCreatedAt))),
      maintenance: maintenance.filter((item) => {
        if (group.canonicalAreaDefinitionId && group.canonicalComponentDefinitionId && item.sourceCanonicalAreaDefinitionId && item.sourceCanonicalComponentDefinitionId) {
          if (item.sourceCanonicalAreaDefinitionId !== group.canonicalAreaDefinitionId || item.sourceCanonicalComponentDefinitionId !== group.canonicalComponentDefinitionId) return false;
          return !item.sourceAreaId || item.sourceAreaId === group.areaId;
        }
        return item.sourceAreaId === group.areaId && item.sourceComponentId === group.componentId;
      }),
    }))
    .sort((left, right) => left.areaName.localeCompare(right.areaName) || left.componentName.localeCompare(right.componentName));

  return {
    status: 200,
    body: {
      data: {
        propertyId,
        propertyAddress: text(property.address),
        inspections,
        components,
        maintenance,
        identityMode: 'canonical_first',
        generatedAt: new Date().toISOString(),
      },
      meta: { correlationId },
    },
  };
}
