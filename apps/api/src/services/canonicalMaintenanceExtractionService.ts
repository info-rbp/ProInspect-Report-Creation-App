import { createHash, randomUUID } from 'node:crypto';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import {
  inferMaintenanceIssueType,
  sanitizeProhibitedCausation,
  type MaintenanceCandidate,
  type MaintenanceCategory,
  type MaintenancePriority,
  type MaintenanceSafetyClassification,
  type ReportAggregate,
  type ReportComponentRecord,
} from '@pcr/domain';
import type { ApiDependencies, StoredRecord } from '../backend/types.js';
import { firestoreDb } from '../firestoreDatabase.js';

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

function timestamp(): string {
  return new Date().toISOString();
}

function asRecord<T>(value: StoredRecord): T {
  return value as unknown as T;
}

async function listAll(
  dependencies: ApiDependencies,
  collection: string,
  agencyId: string,
): Promise<StoredRecord[]> {
  const records: StoredRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await dependencies.repository.list(collection, agencyId, 100, cursor);
    records.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor && records.length < 20_000);
  return records;
}

function categoryFor(componentName: string, canonicalComponentId: string | undefined, description: string): MaintenanceCategory {
  const value = `${canonicalComponentId || ''} ${componentName} ${description}`.toLowerCase();
  if (/tap|sink|basin|toilet|shower|drain|pipe|plumb|leak/u.test(value)) return 'Plumbing';
  if (/light|power|switch|electrical|socket|rcd|smoke-alarm|smoke alarm/u.test(value)) return 'Electrical';
  if (/oven|cooktop|dishwasher|rangehood|appliance|fridge|dryer|washing-machine|washing machine/u.test(value)) return 'Appliance';
  if (/door|lock|handle|hinge|latch/u.test(value)) return 'Doors / Locks';
  if (/paint|peel|flak/u.test(value)) return 'Painting';
  if (/floor|carpet|vinyl|timber/u.test(value)) return 'Flooring';
  if (/tile|grout/u.test(value)) return 'Tiling';
  if (/glass|window|glaz/u.test(value)) return 'Glazing';
  if (/air.?condition|split-system|split system|hvac/u.test(value)) return 'Air Conditioning';
  if (/roof|gutter|downpipe/u.test(value)) return 'Roof / Gutters';
  if (/garden|lawn|landscap|retic/u.test(value)) return 'Garden / Landscaping';
  if (/clean|stain|mould|soiled/u.test(value)) return 'Cleaning';
  if (/pest|termite|rodent|cockroach/u.test(value)) return 'Pest';
  if (/safety|hazard|alarm|exposed/u.test(value)) return 'Safety';
  return 'General Maintenance';
}

function safetyFor(component: ReportComponentRecord): MaintenanceSafetyClassification {
  const value = `${component.component} ${component.commentary} ${(component.defects || []).join(' ')}`.toLowerCase();
  if (/active fire|gas leak|live wire|electrical arcing|ceiling collapse|major water escape/u.test(value)) return 'emergency';
  if (/exposed wire|smoke alarm.*not working|unsafe|immediate hazard|structural movement/u.test(value)) return 'urgent_hazard';
  if (/safety|hazard|loose balustrade|trip hazard|cracked glass/u.test(value)) return 'potential_hazard';
  return 'none';
}

function priorityFor(component: ReportComponentRecord, safety: MaintenanceSafetyClassification): MaintenancePriority {
  if (safety === 'emergency' || safety === 'urgent_hazard') return 'urgent';
  if (
    safety === 'potential_hazard' ||
    component.conditionCategory === 'replacement_recommended' ||
    component.workingStatus === 'not_working' ||
    component.testStatus === 'tested_failed'
  ) return 'high';
  return component.maintenanceRequired ? 'routine' : 'monitor';
}

function recommendedActionFor(component: ReportComponentRecord, issueType: ReturnType<typeof inferMaintenanceIssueType>): string {
  if (component.conditionCategory === 'replacement_recommended' || issueType === 'replacement_recommended') {
    return `Replace ${component.component} following confirmation of scope and dimensions.`;
  }
  if (issueType === 'site_assessment_required') return `Arrange a qualified trade assessment of ${component.component}.`;
  if (issueType === 'cleaning_required') return `Arrange cleaning of ${component.component} and verify presentation.`;
  if (issueType === 'safety_hazard') return `Arrange urgent qualified assessment and make safe where required.`;
  return `Inspect and repair ${component.component} as required, then provide completion evidence.`;
}

async function immutableAggregate(
  agencyId: string,
  reportId: string,
  versionId: string,
  report: ReportAggregate['report'],
): Promise<ReportAggregate> {
  const database = firestoreDb(adminApp());
  const versionRef = database.doc(`agencies/${agencyId}/reports/${reportId}/versions/${versionId}`);
  const version = await versionRef.get();
  if (!version.exists || version.get('immutable') !== true) {
    throw Object.assign(new Error('The report version is not an immutable extraction source.'), {
      code: 'REPORT_VERSION_NOT_IMMUTABLE',
      status: 409,
    });
  }
  const areasSnapshot = await versionRef.collection('areas').orderBy('sequence').get();
  const areas: ReportAggregate['areas'] = [];
  for (const areaDocument of areasSnapshot.docs) {
    const area = areaDocument.data() as Record<string, unknown>;
    const componentSnapshot = await areaDocument.ref.collection('components').get();
    const components = componentSnapshot.docs.map((document) => {
      const stored = document.data() as ReportComponentRecord;
      const copy = { ...stored } as Record<string, unknown>;
      for (const field of ['agencyId', 'reportId', 'areaId', 'createdAt', 'updatedAt', 'version', 'versionId']) delete copy[field];
      return copy as ReportAggregate['areas'][number]['components'][number];
    });
    areas.push({
      id: String(area.id || areaDocument.id),
      name: String(area.name || areaDocument.id),
      ...(typeof area.canonicalAreaDefinitionId === 'string' ? { canonicalAreaDefinitionId: area.canonicalAreaDefinitionId } : {}),
      ...(typeof area.canonicalAreaDefinitionVersion === 'number' ? { canonicalAreaDefinitionVersion: area.canonicalAreaDefinitionVersion } : {}),
      ...(typeof area.templateAreaReferenceId === 'string' ? { templateAreaReferenceId: area.templateAreaReferenceId } : {}),
      sequence: Number(area.sequence || areas.length + 1),
      overallCommentary: typeof area.overallCommentary === 'string' ? area.overallCommentary : '',
      photoReferences: Array.isArray(area.photoReferences) ? area.photoReferences as never[] : [],
      components,
    });
  }
  return { report: { ...report, currentVersionId: versionId }, areas };
}

function canonicalFingerprint(input: {
  propertyId: string;
  reportId: string;
  reportVersionId?: string;
  areaId: string;
  canonicalAreaDefinitionId?: string;
  componentId: string;
  canonicalComponentDefinitionId?: string;
  canonicalAreaComponentRuleId?: string;
  issueType?: string;
  description: string;
}): string {
  return createHash('sha256').update([
    input.propertyId,
    input.reportId,
    input.reportVersionId || 'preliminary',
    input.areaId,
    input.canonicalAreaDefinitionId || 'legacy-area',
    input.componentId,
    input.canonicalComponentDefinitionId || 'legacy-component',
    input.canonicalAreaComponentRuleId || 'legacy-rule',
    input.issueType || 'other',
    input.description.trim().toLowerCase(),
  ].join('|')).digest('hex');
}

export async function extractCanonicalMaintenanceForReport(
  dependencies: ApiDependencies,
  input: {
    agencyId: string;
    reportId: string;
    actorId: string;
    actorRole: string;
    correlationId: string;
    preliminary?: boolean;
  },
): Promise<{ created: MaintenanceCandidate[]; existing: number; sourceVersionId?: string }> {
  const live = await dependencies.reports.load(input.agencyId, input.reportId);
  if (!live) throw Object.assign(new Error('Report not found.'), { code: 'REPORT_NOT_FOUND', status: 404 });
  const sourceVersionId = live.report.currentVersionId;
  if (!input.preliminary && !sourceVersionId) {
    throw Object.assign(new Error('An immutable report version is required for authoritative maintenance extraction.'), {
      code: 'IMMUTABLE_REPORT_VERSION_REQUIRED', status: 422,
    });
  }
  const aggregate = sourceVersionId
    ? await immutableAggregate(input.agencyId, input.reportId, sourceVersionId, live.report)
    : live;
  const [existingCandidates, existingItems] = await Promise.all([
    listAll(dependencies, 'maintenanceCandidates', input.agencyId),
    listAll(dependencies, 'maintenanceItems', input.agencyId),
  ]);
  const created: MaintenanceCandidate[] = [];
  let existing = 0;

  for (const area of aggregate.areas) {
    for (const componentValue of area.components) {
      const component = componentValue as unknown as ReportComponentRecord;
      const maintenanceRequired = Boolean(
        component.maintenanceRequired ||
        component.conditionCategory === 'repair_required' ||
        component.conditionCategory === 'replacement_recommended' ||
        component.workingStatus === 'not_working' ||
        component.testStatus === 'tested_failed' ||
        component.defects?.length,
      );
      if (!maintenanceRequired) continue;

      const description = sanitizeProhibitedCausation(
        component.commentary || component.defects?.join('; ') || 'Inspection assessment requires maintenance review.',
      );
      const issueType = inferMaintenanceIssueType({
        title: component.component,
        description,
        recommendedAction: component.conditionCategory === 'replacement_recommended' ? 'replace' : 'repair',
      });
      const fingerprint = canonicalFingerprint({
        propertyId: aggregate.report.propertyId || '',
        reportId: aggregate.report.id,
        reportVersionId: sourceVersionId,
        areaId: area.id,
        canonicalAreaDefinitionId: area.canonicalAreaDefinitionId,
        componentId: component.id,
        canonicalComponentDefinitionId: component.canonicalComponentDefinitionId,
        canonicalAreaComponentRuleId: component.canonicalAreaComponentRuleId,
        issueType,
        description,
      });
      const candidateId = `maintenance-candidate-${fingerprint.slice(0, 32)}`;
      const duplicateCandidate = existingCandidates.some((candidate) => candidate.id === candidateId || candidate.extractionFingerprint === fingerprint);
      const duplicateItem = existingItems.some((item) => {
        if (item.sourceReportId !== aggregate.report.id || item.sourceReportVersionId !== sourceVersionId) return false;
        if (['closed', 'cancelled', 'dismissed', 'duplicate', 'not_actionable'].includes(String(item.status))) return false;
        if (area.canonicalAreaDefinitionId && component.canonicalComponentDefinitionId && item.sourceCanonicalAreaDefinitionId && item.sourceCanonicalComponentDefinitionId) {
          return item.sourceAreaId === area.id &&
            item.sourceCanonicalAreaDefinitionId === area.canonicalAreaDefinitionId &&
            item.sourceCanonicalComponentDefinitionId === component.canonicalComponentDefinitionId;
        }
        return item.sourceAreaId === area.id && item.sourceComponentId === component.id;
      });
      if (duplicateCandidate || duplicateItem) {
        existing += 1;
        continue;
      }

      const safetyClassification = safetyFor(component);
      const priority = priorityFor(component, safetyClassification);
      const recommendedAction = recommendedActionFor(component, issueType);
      const candidate: MaintenanceCandidate = {
        id: candidateId,
        agencyId: input.agencyId,
        propertyId: aggregate.report.propertyId || '',
        ...(aggregate.report.tenancyId ? { tenancyId: aggregate.report.tenancyId } : {}),
        ...(aggregate.report.inspectionJobId ? { inspectionJobId: aggregate.report.inspectionJobId } : {}),
        reportId: aggregate.report.id,
        ...(sourceVersionId ? { reportVersionId: sourceVersionId } : {}),
        areaId: area.id,
        componentId: component.id,
        ...(area.canonicalAreaDefinitionId ? {
          sourceCanonicalAreaDefinitionId: area.canonicalAreaDefinitionId,
          sourceCanonicalAreaDefinitionVersion: area.canonicalAreaDefinitionVersion,
        } : {}),
        ...(component.canonicalComponentDefinitionId ? {
          sourceCanonicalComponentDefinitionId: component.canonicalComponentDefinitionId,
          sourceCanonicalComponentDefinitionVersion: component.canonicalComponentDefinitionVersion,
        } : {}),
        ...(component.canonicalAreaComponentRuleId ? {
          sourceCanonicalAreaComponentRuleId: component.canonicalAreaComponentRuleId,
          sourceCanonicalAreaComponentRuleVersion: component.canonicalAreaComponentRuleVersion,
        } : {}),
        title: `${component.component} in ${area.name} requires maintenance review`,
        description,
        category: categoryFor(component.component, component.canonicalComponentDefinitionId, description),
        suggestedPriority: priority,
        evidencePhotoIds: (component.photoReferences || []).map((reference) => reference.photoId),
        source: component.reviewStatus === 'reviewer_approved'
          ? 'reviewer'
          : component.reviewStatus === 'analyst_reviewed'
            ? 'analyst'
            : component.reviewStatus === 'ai_generated'
              ? 'ai'
              : 'inspector',
        ...(typeof component.aiConfidence === 'number' ? { confidence: component.aiConfidence } : {}),
        reviewStatus: 'suggested',
        issueType,
        recommendedAction,
        safetyClassification,
        extractionFingerprint: fingerprint,
        preliminary: Boolean(input.preliminary || !sourceVersionId),
        pricingStatus: 'not_started',
        createdBy: input.actorId,
        createdAt: timestamp(),
        updatedAt: timestamp(),
      };
      const stored = await dependencies.repository.create(
        'maintenanceCandidates', input.agencyId, candidateId,
        candidate as unknown as Record<string, unknown>, input.actorId,
      );
      created.push(asRecord<MaintenanceCandidate>(stored));
      await dependencies.audit.append({
        id: randomUUID(), timestamp: timestamp(), actorId: input.actorId, actorRole: input.actorRole,
        agencyId: input.agencyId, capability: 'maintenance.triage', outcome: 'allowed',
        reason: input.preliminary ? 'maintenance.preliminary_candidate_extracted' : 'maintenance.candidate_extracted',
        target: { agencyId: input.agencyId, propertyId: candidate.propertyId, reportId: input.reportId },
        correlationId: input.correlationId, entityType: 'maintenance_candidate', entityId: candidateId,
        eventType: input.preliminary ? 'maintenance.preliminary_candidate_extracted' : 'maintenance.candidate_extracted',
        metadata: {
          areaId: area.id,
          canonicalAreaDefinitionId: area.canonicalAreaDefinitionId ?? null,
          componentId: component.id,
          canonicalComponentDefinitionId: component.canonicalComponentDefinitionId ?? null,
          canonicalAreaComponentRuleId: component.canonicalAreaComponentRuleId ?? null,
          fingerprint,
          sourceVersionId,
          identityMode: component.canonicalComponentDefinitionId ? 'canonical' : 'legacy_fallback',
        },
      });
    }
  }
  return { created, existing, ...(sourceVersionId ? { sourceVersionId } : {}) };
}
