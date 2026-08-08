import type { ReportAggregate } from '@pcr/domain';

interface LegacyPhoto { id?: unknown; objectPath?: unknown; downloadUrl?: unknown; thumbnailObjectPath?: unknown }
interface LegacyItem { id?: unknown; name?: unknown; isClean?: unknown; isUndamaged?: unknown; isWorking?: unknown; comment?: unknown }
interface LegacyRoom { id?: unknown; name?: unknown; status?: unknown; overallComment?: unknown; items?: unknown; photos?: unknown }

export interface LegacyMigrationPlan {
  aggregate: ReportAggregate;
  sourceReportId: string;
  sourcePath: string;
  destinationPath: string;
  warnings: string[];
  counts: { areas: number; components: number; photoReferences: number };
}

function text(value: unknown, fallback = ''): string { return typeof value === 'string' ? value.trim() : fallback; }
function boolean(value: unknown, fallback: boolean): boolean { return typeof value === 'boolean' ? value : fallback; }
function array<T>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : []; }
function safeId(value: unknown, fallback: string): string {
  const candidate = text(value, fallback).replace(/[^a-zA-Z0-9_-]/gu, '-').replace(/-+/gu, '-');
  return candidate || fallback;
}

export function planLegacyReportMigration(sourceReportId: string, value: Record<string, unknown>): LegacyMigrationPlan {
  const agencyId = text(value.agencyId);
  if (!agencyId) throw Object.assign(new Error('Legacy report has no agencyId.'), { code: 'MIGRATION_AGENCY_REQUIRED', status: 400 });
  const reportId = text(value.id, sourceReportId);
  const warnings: string[] = [];
  const rooms = array<LegacyRoom>(value.rooms);
  if (!Array.isArray(value.rooms)) warnings.push('Legacy report did not contain a rooms array.');

  let photoReferenceCount = 0;
  const areas = rooms.map((room, areaIndex) => {
    const areaId = safeId(room.id, `area-${areaIndex + 1}`);
    const photoReferences = array<LegacyPhoto>(room.photos).flatMap((photo, photoIndex) => {
      const objectPath = text(photo.objectPath) || text(photo.downloadUrl);
      if (!objectPath || objectPath.startsWith('data:')) {
        warnings.push(`Skipped inline or missing photo reference at ${areaId}[${photoIndex}].`);
        return [];
      }
      photoReferenceCount += 1;
      const thumbnailObjectPath = text(photo.thumbnailObjectPath);
      return [{ photoId: safeId(photo.id, `${areaId}-photo-${photoIndex + 1}`), objectPath, ...(thumbnailObjectPath ? { thumbnailObjectPath } : {}) }];
    });
    return {
      id: areaId,
      name: text(room.name, `Area ${areaIndex + 1}`),
      sequence: areaIndex + 1,
      ...(text(room.overallComment) ? { overallCommentary: text(room.overallComment) } : {}),
      components: array<LegacyItem>(room.items).map((item, componentIndex) => {
        const isClean = boolean(item.isClean, false);
        const isUndamaged = boolean(item.isUndamaged, false);
        const isWorking = boolean(item.isWorking, false);
        return {
          id: safeId(item.id, `${areaId}-component-${componentIndex + 1}`),
          component: text(item.name, `Component ${componentIndex + 1}`),
          conditionCategory: isUndamaged ? 'intact' as const : 'repair_required' as const,
          cleanlinessCategory: isClean ? 'clean' as const : 'requires_cleaning' as const,
          workingStatus: isWorking ? 'operation_confirmed' as const : 'untested' as const,
          testStatus: isWorking ? 'tested_passed' as const : 'untested' as const,
          defects: isUndamaged ? [] : [text(item.comment, 'Legacy condition issue recorded.')],
          maintenanceRequired: !isUndamaged,
          commentary: text(item.comment, `${text(item.name, 'Component')} migrated from the legacy report.`),
          photoReferences,
          reviewStatus: room.status === 'complete' ? 'reviewer_approved' as const : 'draft' as const,
          comparisonStatus: 'not_compared' as const,
        };
      }),
    };
  });

  const optional = (key: string): Record<string, string> => {
    const valueText = text(value[key]);
    return valueText ? { [key]: valueText } : {};
  };
  const aggregate: ReportAggregate = {
    report: {
      id: reportId,
      agencyId,
      ...optional('propertyId'),
      ...optional('tenancyId'),
      ...optional('inspectionJobId'),
      reportType: text(value.reportType, 'Property Condition Report'),
      propertyAddress: text(value.propertyAddress, 'Address not recorded'),
      ...optional('clientName'),
      ...optional('tenantName'),
      ...optional('inspectionDate'),
      lifecycleStatus: text(value.lifecycleStatus, 'draft') as ReportAggregate['report']['lifecycleStatus'],
      ...optional('currentVersionId'),
      ...optional('finalisedAt'),
      ...optional('createdAt'),
      ...optional('updatedAt'),
      ...(typeof value.version === 'number' ? { version: value.version } : {}),
    },
    areas,
  };
  const componentCount = areas.reduce((count, area) => count + area.components.length, 0);
  return {
    aggregate,
    sourceReportId,
    sourcePath: `reports/${sourceReportId}`,
    destinationPath: `agencies/${agencyId}/reports/${reportId}`,
    warnings,
    counts: { areas: areas.length, components: componentCount, photoReferences: photoReferenceCount },
  };
}
