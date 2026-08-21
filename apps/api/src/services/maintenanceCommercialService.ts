import { createHash, randomUUID } from 'node:crypto';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_PRIORITIES,
  calculateEstimateLine,
  canTransitionMaintenanceQuote,
  estimateOptionFromMatch,
  inferMaintenanceIssueType,
  maintenanceFingerprint,
  maintenanceSlaDueAt,
  maintenanceSlaStatus,
  matchPriceBookEntries,
  quoteLineFromEstimate,
  quoteTotals,
  resolveQuoteApproval,
  sanitizeProhibitedCausation,
  type ApprovalRequirement,
  type Client,
  type ClientApproval,
  type ExternalAccessGrant,
  type MaintenanceCandidate,
  type MaintenanceCategory,
  type MaintenanceEstimate,
  type MaintenanceEstimateOption,
  type MaintenanceFinancialReconciliation,
  type MaintenanceIssueType,
  type MaintenanceItem,
  type MaintenancePriority,
  type MaintenanceQuote,
  type MaintenanceQuoteStatus,
  type MaintenanceQuoteVersion,
  type MaintenanceSafetyClassification,
  type MaintenanceWorkOrder,
  type PreventiveMaintenanceSchedule,
  type PriceBook,
  type PriceBookEntry,
  type PriceBookImport,
  type PriceBookImportRow,
  type PriceBookUnit,
  type PriceBookVersion,
  type PropertyRecord,
  type QuoteApprovalPolicy,
  type ReportAggregate,
  type ReportComponentRecord,
} from '@pcr/domain';
import type { ApiDependencies, StoredRecord } from '../backend/types.js';

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

function timestamp(): string {
  return new Date().toISOString();
}

function asRecord<T>(value: StoredRecord): T {
  return value as unknown as T;
}

function number(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[$,%\s,]/gu, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function boolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    if (/^(true|yes|y|1|active)$/iu.test(value.trim())) return true;
    if (/^(false|no|n|0|inactive)$/iu.test(value.trim())) return false;
  }
  return fallback;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value).trim();
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return [...new Set(value.map(text).filter(Boolean))];
  return text(value)
    .split(/[|;,\n]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 64);
}

export async function listAllOperationalRecords(
  dependencies: ApiDependencies,
  collection: string,
  agencyId: string,
): Promise<StoredRecord[]> {
  const results: StoredRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await dependencies.repository.list(collection, agencyId, 100, cursor);
    results.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return results;
}

function categoryFor(componentName: string, description: string): MaintenanceCategory {
  const value = `${componentName} ${description}`.toLowerCase();
  if (/tap|sink|basin|toilet|shower|drain|pipe|plumb|leak/u.test(value)) return 'Plumbing';
  if (/light|power|switch|electrical|socket|rcd|smoke alarm/u.test(value)) return 'Electrical';
  if (/oven|cooktop|dishwasher|rangehood|appliance|fridge|dryer|washing machine/u.test(value)) return 'Appliance';
  if (/door|lock|handle|hinge|latch/u.test(value)) return 'Doors / Locks';
  if (/paint|peel|flak/u.test(value)) return 'Painting';
  if (/floor|carpet|vinyl|timber/u.test(value)) return 'Flooring';
  if (/tile|grout/u.test(value)) return 'Tiling';
  if (/glass|window|glaz/u.test(value)) return 'Glazing';
  if (/air.?condition|split system|hvac/u.test(value)) return 'Air Conditioning';
  if (/roof|gutter|downpipe/u.test(value)) return 'Roof / Gutters';
  if (/garden|lawn|landscap|retic/u.test(value)) return 'Garden / Landscaping';
  if (/clean|stain|mould|soiled/u.test(value)) return 'Cleaning';
  if (/pest|termite|rodent|cockroach/u.test(value)) return 'Pest';
  if (/safety|hazard|alarm|exposed/u.test(value)) return 'Safety';
  return 'General Maintenance';
}

function priorityFor(component: ReportComponentRecord, safety: MaintenanceSafetyClassification): MaintenancePriority {
  if (safety === 'emergency' || safety === 'urgent_hazard') return 'urgent';
  if (
    safety === 'potential_hazard' ||
    component.conditionCategory === 'replacement_recommended' ||
    component.workingStatus === 'not_working' ||
    component.testStatus === 'tested_failed'
  ) {
    return 'high';
  }
  return component.maintenanceRequired ? 'routine' : 'monitor';
}

function safetyFor(component: ReportComponentRecord): MaintenanceSafetyClassification {
  const value = `${component.component} ${component.commentary} ${component.defects.join(' ')}`.toLowerCase();
  if (/active fire|gas leak|live wire|electrical arcing|ceiling collapse|major water escape/u.test(value)) {
    return 'emergency';
  }
  if (/exposed wire|smoke alarm.*not working|unsafe|immediate hazard|structural movement/u.test(value)) {
    return 'urgent_hazard';
  }
  if (/safety|hazard|loose balustrade|trip hazard|cracked glass/u.test(value)) return 'potential_hazard';
  return 'none';
}

function recommendedActionFor(component: ReportComponentRecord, issueType: MaintenanceIssueType): string {
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
  const database = getFirestore(adminApp());
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
      for (const field of ['agencyId', 'reportId', 'areaId', 'createdAt', 'updatedAt', 'version', 'versionId']) {
        delete copy[field];
      }
      return copy as ReportAggregate['areas'][number]['components'][number];
    });
    areas.push({
      id: String(area.id || areaDocument.id),
      name: String(area.name || areaDocument.id),
      sequence: Number(area.sequence || areas.length + 1),
      overallCommentary: typeof area.overallCommentary === 'string' ? area.overallCommentary : '',
      photoReferences: Array.isArray(area.photoReferences) ? area.photoReferences as never[] : [],
      components,
    });
  }
  return { report: { ...report, currentVersionId: versionId }, areas };
}

export async function extractMaintenanceForReport(
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
  if (!live) {
    throw Object.assign(new Error('Report not found.'), { code: 'REPORT_NOT_FOUND', status: 404 });
  }
  const sourceVersionId = live.report.currentVersionId;
  if (!input.preliminary && !sourceVersionId) {
    throw Object.assign(new Error('An immutable report version is required for authoritative maintenance extraction.'), {
      code: 'IMMUTABLE_REPORT_VERSION_REQUIRED',
      status: 422,
    });
  }
  const aggregate = sourceVersionId
    ? await immutableAggregate(input.agencyId, input.reportId, sourceVersionId, live.report)
    : live;
  const existingCandidates = await listAllOperationalRecords(dependencies, 'maintenanceCandidates', input.agencyId);
  const existingItems = await listAllOperationalRecords(dependencies, 'maintenanceItems', input.agencyId);
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
        component.defects.length,
      );
      if (!maintenanceRequired) continue;
      const description = sanitizeProhibitedCausation(
        component.commentary || component.defects.join('; ') || 'Inspection assessment requires maintenance review.',
      );
      const issueType = inferMaintenanceIssueType({
        title: component.component,
        description,
        recommendedAction:
          component.conditionCategory === 'replacement_recommended' ? 'replace' : 'repair',
      });
      const safetyClassification = safetyFor(component);
      const fingerprintSource = maintenanceFingerprint({
        propertyId: aggregate.report.propertyId || '',
        reportId: aggregate.report.id,
        reportVersionId: sourceVersionId,
        areaId: area.id,
        componentId: component.id,
        issueType,
        description,
      });
      const fingerprint = createHash('sha256').update(fingerprintSource).digest('hex');
      const candidateId = `maintenance-candidate-${fingerprint.slice(0, 32)}`;
      const duplicateCandidate = existingCandidates.some(
        (candidate) => candidate.id === candidateId || candidate.extractionFingerprint === fingerprint,
      );
      const duplicateItem = existingItems.some(
        (item) =>
          item.sourceReportId === aggregate.report.id &&
          item.sourceReportVersionId === sourceVersionId &&
          item.sourceAreaId === area.id &&
          item.sourceComponentId === component.id &&
          !['closed', 'cancelled', 'dismissed', 'duplicate', 'not_actionable'].includes(String(item.status)),
      );
      if (duplicateCandidate || duplicateItem) {
        existing += 1;
        continue;
      }
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
        title: `${component.component} in ${area.name} requires maintenance review`,
        description,
        category: categoryFor(component.component, description),
        suggestedPriority: priority,
        evidencePhotoIds: component.photoReferences.map((reference) => reference.photoId),
        source:
          component.reviewStatus === 'reviewer_approved'
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
        'maintenanceCandidates',
        input.agencyId,
        candidateId,
        candidate as unknown as Record<string, unknown>,
        input.actorId,
      );
      created.push(asRecord<MaintenanceCandidate>(stored));
      await dependencies.audit.append({
        id: randomUUID(),
        timestamp: timestamp(),
        actorId: input.actorId,
        actorRole: input.actorRole,
        agencyId: input.agencyId,
        capability: 'maintenance.triage',
        outcome: 'allowed',
        reason: input.preliminary ? 'maintenance.preliminary_candidate_extracted' : 'maintenance.candidate_extracted',
        target: {
          agencyId: input.agencyId,
          propertyId: candidate.propertyId,
          reportId: input.reportId,
        },
        correlationId: input.correlationId,
        entityType: 'maintenance_candidate',
        entityId: candidateId,
        eventType: input.preliminary ? 'maintenance.preliminary_candidate_extracted' : 'maintenance.candidate_extracted',
        metadata: { areaId: area.id, componentId: component.id, fingerprint, sourceVersionId },
      });
    }
  }
  return { created, existing, ...(sourceVersionId ? { sourceVersionId } : {}) };
}

const aliases: Record<string, keyof PriceBookEntry> = {
  code: 'code',
  pricecode: 'code',
  sku: 'code',
  active: 'active',
  trade: 'trade',
  category: 'category',
  component: 'componentPattern',
  componentpattern: 'componentPattern',
  issuetype: 'issueType',
  action: 'recommendedAction',
  recommendedaction: 'recommendedAction',
  keywords: 'keywords',
  propertyuse: 'propertyUses',
  propertyuses: 'propertyUses',
  propertytype: 'physicalPropertyTypes',
  region: 'regions',
  postcode: 'postcodes',
  unit: 'unit',
  quantity: 'defaultQuantity',
  defaultquantity: 'defaultQuantity',
  minimumquantity: 'minimumQuantity',
  maximumquantity: 'maximumQuantity',
  labourhours: 'labourHours',
  laborhours: 'labourHours',
  labourrate: 'labourRate',
  laborrate: 'labourRate',
  materialcost: 'materialCost',
  callout: 'calloutCost',
  calloutcost: 'calloutCost',
  travelcost: 'travelCost',
  disposalcost: 'disposalCost',
  subcontractorcost: 'subcontractorCost',
  contractorcost: 'contractorCost',
  markup: 'markupPercent',
  markuppercent: 'markupPercent',
  fixedmargin: 'fixedMargin',
  administrationfee: 'administrationFee',
  adminfee: 'administrationFee',
  minimumsellprice: 'minimumSellPrice',
  gstrate: 'gstRate',
  taxable: 'taxable',
  urgentmultiplier: 'urgentMultiplier',
  afterhoursmultiplier: 'afterHoursMultiplier',
  saturdaymultiplier: 'saturdayMultiplier',
  sundaymultiplier: 'sundayMultiplier',
  publicholidaymultiplier: 'publicHolidayMultiplier',
  description: 'clientDescription',
  clientdescription: 'clientDescription',
  inclusions: 'inclusions',
  exclusions: 'exclusions',
  warrantydays: 'warrantyDays',
  siteassessmentrequired: 'siteAssessmentRequired',
  confidence: 'automationConfidenceThreshold',
  automationconfidencethreshold: 'automationConfidenceThreshold',
  xeroitemcode: 'xeroItemCode',
  xerosalesaccountcode: 'xeroSalesAccountCode',
  xeropurchaseaccountcode: 'xeroPurchaseAccountCode',
  xerotaxtype: 'xeroTaxType',
  effectivefrom: 'effectiveFrom',
  effectiveto: 'effectiveTo',
};

function normalHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, '');
}

function rowValue(row: Record<string, unknown>, field: keyof PriceBookEntry): unknown {
  const key = Object.keys(row).find((candidate) => aliases[normalHeader(candidate)] === field);
  return key ? row[key] : undefined;
}

function category(value: unknown): MaintenanceCategory {
  const candidate = text(value);
  return (MAINTENANCE_CATEGORIES as readonly string[]).includes(candidate)
    ? (candidate as MaintenanceCategory)
    : 'General Maintenance';
}

function issue(value: unknown): MaintenanceIssueType | undefined {
  const candidate = text(value).toLowerCase().replace(/[\s-]+/gu, '_') as MaintenanceIssueType;
  return candidate ? candidate : undefined;
}

function unit(value: unknown): PriceBookUnit {
  const candidate = text(value).toLowerCase().replace(/[\s-]+/gu, '_') as PriceBookUnit;
  return ['each', 'hour', 'metre', 'square_metre', 'linear_metre', 'room', 'visit', 'fixed', 'day', 'item'].includes(candidate)
    ? candidate
    : 'each';
}

export function parsePriceBookRows(
  rows: Array<Record<string, unknown>>,
): PriceBookImportRow[] {
  return rows.map((row, index) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const code = text(rowValue(row, 'code'));
    const clientDescription = text(rowValue(row, 'clientDescription'));
    if (!code) errors.push('Price code is required.');
    if (!clientDescription) errors.push('Client description is required.');
    const labourHours = number(rowValue(row, 'labourHours'));
    const labourRate = number(rowValue(row, 'labourRate'));
    const materialCost = number(rowValue(row, 'materialCost'));
    if (labourHours < 0 || labourRate < 0 || materialCost < 0) {
      errors.push('Cost values cannot be negative.');
    }
    const automationConfidenceThreshold = Math.max(
      0,
      Math.min(1, number(rowValue(row, 'automationConfidenceThreshold'), 0.8)),
    );
    const gstRaw = number(rowValue(row, 'gstRate'), 0.1);
    const gstRate = gstRaw > 1 ? gstRaw / 100 : gstRaw;
    if (!rowValue(row, 'issueType')) warnings.push('Issue type is blank; matching will rely on category and keywords.');
    if (!rowValue(row, 'componentPattern')) warnings.push('Component pattern is blank.');
    const entry: PriceBookEntry = {
      id: `price-entry-${slug(code || `row-${index + 2}`)}-${index + 2}`,
      code,
      active: boolean(rowValue(row, 'active'), true),
      trade: text(rowValue(row, 'trade')) || 'General Maintenance',
      category: category(rowValue(row, 'category')),
      ...(text(rowValue(row, 'componentPattern')) ? { componentPattern: text(rowValue(row, 'componentPattern')) } : {}),
      ...(issue(rowValue(row, 'issueType')) ? { issueType: issue(rowValue(row, 'issueType')) } : {}),
      ...(text(rowValue(row, 'recommendedAction')) ? { recommendedAction: text(rowValue(row, 'recommendedAction')) } : {}),
      keywords: list(rowValue(row, 'keywords')),
      propertyUses: list(rowValue(row, 'propertyUses')) as PriceBookEntry['propertyUses'],
      physicalPropertyTypes: list(rowValue(row, 'physicalPropertyTypes')),
      regions: list(rowValue(row, 'regions')),
      postcodes: list(rowValue(row, 'postcodes')),
      unit: unit(rowValue(row, 'unit')),
      defaultQuantity: Math.max(0.01, number(rowValue(row, 'defaultQuantity'), 1)),
      ...(rowValue(row, 'minimumQuantity') !== undefined ? { minimumQuantity: number(rowValue(row, 'minimumQuantity')) } : {}),
      ...(rowValue(row, 'maximumQuantity') !== undefined ? { maximumQuantity: number(rowValue(row, 'maximumQuantity')) } : {}),
      labourHours,
      labourRate,
      materialCost,
      calloutCost: number(rowValue(row, 'calloutCost')),
      travelCost: number(rowValue(row, 'travelCost')),
      disposalCost: number(rowValue(row, 'disposalCost')),
      subcontractorCost: number(rowValue(row, 'subcontractorCost')),
      ...(rowValue(row, 'contractorCost') !== undefined ? { contractorCost: number(rowValue(row, 'contractorCost')) } : {}),
      markupPercent: number(rowValue(row, 'markupPercent')),
      fixedMargin: number(rowValue(row, 'fixedMargin')),
      administrationFee: number(rowValue(row, 'administrationFee')),
      ...(rowValue(row, 'minimumSellPrice') !== undefined ? { minimumSellPrice: number(rowValue(row, 'minimumSellPrice')) } : {}),
      gstRate,
      taxable: boolean(rowValue(row, 'taxable'), true),
      ...(rowValue(row, 'urgentMultiplier') !== undefined ? { urgentMultiplier: number(rowValue(row, 'urgentMultiplier'), 1) } : {}),
      ...(rowValue(row, 'afterHoursMultiplier') !== undefined ? { afterHoursMultiplier: number(rowValue(row, 'afterHoursMultiplier'), 1) } : {}),
      ...(rowValue(row, 'saturdayMultiplier') !== undefined ? { saturdayMultiplier: number(rowValue(row, 'saturdayMultiplier'), 1) } : {}),
      ...(rowValue(row, 'sundayMultiplier') !== undefined ? { sundayMultiplier: number(rowValue(row, 'sundayMultiplier'), 1) } : {}),
      ...(rowValue(row, 'publicHolidayMultiplier') !== undefined ? { publicHolidayMultiplier: number(rowValue(row, 'publicHolidayMultiplier'), 1) } : {}),
      clientDescription,
      inclusions: list(rowValue(row, 'inclusions')),
      exclusions: list(rowValue(row, 'exclusions')),
      ...(rowValue(row, 'warrantyDays') !== undefined ? { warrantyDays: Math.max(0, Math.floor(number(rowValue(row, 'warrantyDays')))) } : {}),
      siteAssessmentRequired: boolean(rowValue(row, 'siteAssessmentRequired')),
      automationConfidenceThreshold,
      ...(text(rowValue(row, 'xeroItemCode')) ? { xeroItemCode: text(rowValue(row, 'xeroItemCode')) } : {}),
      ...(text(rowValue(row, 'xeroSalesAccountCode')) ? { xeroSalesAccountCode: text(rowValue(row, 'xeroSalesAccountCode')) } : {}),
      ...(text(rowValue(row, 'xeroPurchaseAccountCode')) ? { xeroPurchaseAccountCode: text(rowValue(row, 'xeroPurchaseAccountCode')) } : {}),
      ...(text(rowValue(row, 'xeroTaxType')) ? { xeroTaxType: text(rowValue(row, 'xeroTaxType')) } : {}),
      ...(text(rowValue(row, 'effectiveFrom')) ? { effectiveFrom: text(rowValue(row, 'effectiveFrom')) } : {}),
      ...(text(rowValue(row, 'effectiveTo')) ? { effectiveTo: text(rowValue(row, 'effectiveTo')) } : {}),
      sourceRowNumber: index + 2,
    };
    return {
      rowNumber: index + 2,
      rawValues: row as PriceBookImportRow['rawValues'],
      ...(errors.length ? {} : { parsedEntry: entry }),
      errors,
      warnings,
    };
  });
}

export async function createPriceBookImport(
  dependencies: ApiDependencies,
  input: {
    agencyId: string;
    actorId: string;
    fileName: string;
    contentType: string;
    fileSize: number;
    sha256: string;
    sheetName?: string;
    proposedPriceBookName?: string;
    rows: Array<Record<string, unknown>>;
  },
): Promise<PriceBookImport> {
  const parsedRows = parsePriceBookRows(input.rows);
  const id = randomUUID();
  const now = timestamp();
  const record: Omit<PriceBookImport, 'version'> = {
    id,
    agencyId: input.agencyId,
    status: parsedRows.some((row) => row.errors.length) ? 'review_required' : 'validated',
    source: {
      fileName: input.fileName,
      contentType: input.contentType,
      fileSize: input.fileSize,
      sha256: input.sha256,
      uploadedBy: input.actorId,
      uploadedAt: now,
    },
    ...(input.sheetName ? { sheetName: input.sheetName } : {}),
    columnMappings: [],
    rows: parsedRows,
    validRowCount: parsedRows.filter((row) => !row.errors.length).length,
    warningRowCount: parsedRows.filter((row) => row.warnings.length > 0).length,
    rejectedRowCount: parsedRows.filter((row) => row.errors.length > 0).length,
    ...(input.proposedPriceBookName ? { proposedPriceBookName: input.proposedPriceBookName } : {}),
    createdBy: input.actorId,
    createdAt: now,
    updatedAt: now,
  };
  const stored = await dependencies.repository.create(
    'priceBookImports',
    input.agencyId,
    id,
    record as unknown as Record<string, unknown>,
    input.actorId,
  );
  return asRecord<PriceBookImport>(stored);
}

export async function publishPriceBookImport(
  dependencies: ApiDependencies,
  input: {
    agencyId: string;
    importId: string;
    actorId: string;
    name?: string;
    currency?: string;
    effectiveFrom?: string;
  },
): Promise<{ priceBook: PriceBook; version: PriceBookVersion }> {
  const importRecord = await dependencies.repository.get('priceBookImports', input.agencyId, input.importId);
  if (!importRecord) throw Object.assign(new Error('Price-book import not found.'), { status: 404, code: 'PRICE_BOOK_IMPORT_NOT_FOUND' });
  const imported = asRecord<PriceBookImport>(importRecord);
  const entries = imported.rows.flatMap((row) => (row.parsedEntry && !row.errors.length ? [row.parsedEntry] : []));
  if (!entries.length) throw Object.assign(new Error('The import does not contain publishable price entries.'), { status: 422, code: 'PRICE_BOOK_EMPTY' });
  if (imported.rejectedRowCount > 0) {
    throw Object.assign(new Error('Resolve or remove invalid price-book rows before publishing.'), { status: 422, code: 'PRICE_BOOK_IMPORT_INVALID' });
  }
  const existingBooks = await listAllOperationalRecords(dependencies, 'priceBooks', input.agencyId);
  const name = input.name || imported.proposedPriceBookName || imported.source.fileName.replace(/\.[^.]+$/u, '');
  const existing = existingBooks.find((book) => String(book.name).toLowerCase() === name.toLowerCase());
  const now = timestamp();
  const priceBookId = existing?.id || `price-book-${slug(name)}-${randomUUID().slice(0, 8)}`;
  const previousVersion = existing ? Number(existing.currentPublishedVersionNumber || 0) : 0;
  const versionNumber = previousVersion + 1;
  const versionId = `${priceBookId}-v${versionNumber}`;
  const contentHash = createHash('sha256').update(JSON.stringify(entries)).digest('hex');
  const versionRecord: Omit<PriceBookVersion, 'version'> = {
    id: versionId,
    agencyId: input.agencyId,
    priceBookId,
    versionNumber,
    status: 'published',
    effectiveFrom: input.effectiveFrom || now.slice(0, 10),
    sourceImportId: imported.id,
    contentHash,
    entries,
    publishedBy: input.actorId,
    publishedAt: now,
    createdBy: input.actorId,
    createdAt: now,
    updatedAt: now,
  };
  const versionStored = await dependencies.repository.create(
    'priceBookVersions',
    input.agencyId,
    versionId,
    versionRecord as unknown as Record<string, unknown>,
    input.actorId,
  );
  let priceBookStored: StoredRecord;
  if (existing) {
    priceBookStored = await dependencies.repository.update(
      'priceBooks',
      input.agencyId,
      priceBookId,
      {
        currentPublishedVersionId: versionId,
        currentPublishedVersionNumber: versionNumber,
        currency: input.currency || existing.currency || 'AUD',
        status: 'active',
      },
      Number(existing.version),
      input.actorId,
    );
  } else {
    priceBookStored = await dependencies.repository.create(
      'priceBooks',
      input.agencyId,
      priceBookId,
      {
        name,
        currency: input.currency || 'AUD',
        status: 'active',
        currentPublishedVersionId: versionId,
        currentPublishedVersionNumber: versionNumber,
        defaultForPropertyUses: [],
        createdBy: input.actorId,
      },
      input.actorId,
    );
  }
  await dependencies.repository.update(
    'priceBookImports',
    input.agencyId,
    imported.id,
    { status: 'published', publishedPriceBookId: priceBookId, publishedVersionId: versionId },
    Number(importRecord.version),
    input.actorId,
  );
  return {
    priceBook: asRecord<PriceBook>(priceBookStored),
    version: asRecord<PriceBookVersion>(versionStored),
  };
}

async function publishedPriceBookVersion(
  dependencies: ApiDependencies,
  agencyId: string,
  preferredPriceBookId?: string,
): Promise<{ book: PriceBook; version: PriceBookVersion } | undefined> {
  const books = (await listAllOperationalRecords(dependencies, 'priceBooks', agencyId))
    .map(asRecord<PriceBook>)
    .filter((book) => book.status === 'active' && book.currentPublishedVersionId);
  const book = preferredPriceBookId
    ? books.find((candidate) => candidate.id === preferredPriceBookId)
    : books[0];
  if (!book?.currentPublishedVersionId) return undefined;
  const version = await dependencies.repository.get('priceBookVersions', agencyId, book.currentPublishedVersionId);
  return version ? { book, version: asRecord<PriceBookVersion>(version) } : undefined;
}

export async function generateMaintenanceEstimate(
  dependencies: ApiDependencies,
  input: {
    agencyId: string;
    maintenanceItemId: string;
    actorId: string;
    preferredPriceBookId?: string;
    quantity?: number;
    afterHours?: boolean;
    saturday?: boolean;
    sunday?: boolean;
    publicHoliday?: boolean;
  },
): Promise<MaintenanceEstimate> {
  const itemRecord = await dependencies.repository.get('maintenanceItems', input.agencyId, input.maintenanceItemId);
  if (!itemRecord) throw Object.assign(new Error('Maintenance item not found.'), { status: 404, code: 'MAINTENANCE_ITEM_NOT_FOUND' });
  const item = asRecord<MaintenanceItem>(itemRecord);
  const propertyRecord = await dependencies.repository.get('properties', input.agencyId, item.propertyId);
  const property = propertyRecord ? asRecord<PropertyRecord>(propertyRecord) : undefined;
  const published = await publishedPriceBookVersion(dependencies, input.agencyId, input.preferredPriceBookId);
  const now = timestamp();
  const sourceFingerprint = createHash('sha256')
    .update(`${item.id}|${item.version}|${published?.version.id || 'no-price-book'}`)
    .digest('hex');
  const matches = published
    ? matchPriceBookEntries(
        item,
        published.version.entries,
        {
          propertyUse: property?.propertyUse,
          physicalPropertyType: property?.physicalPropertyType,
          region: property?.state,
          postcode: property?.postcode,
          quantity: input.quantity,
          urgent: item.priority === 'urgent',
          afterHours: input.afterHours,
          saturday: input.saturday,
          sunday: input.sunday,
          publicHoliday: input.publicHoliday,
        },
      )
    : [];
  const options: MaintenanceEstimateOption[] = matches.slice(0, 3).map((match, index) => ({
    ...estimateOptionFromMatch(match, {
      propertyUse: property?.propertyUse,
      physicalPropertyType: property?.physicalPropertyType,
      region: property?.state,
      postcode: property?.postcode,
      quantity: input.quantity,
      urgent: item.priority === 'urgent',
      afterHours: input.afterHours,
      saturday: input.saturday,
      sunday: input.sunday,
      publicHoliday: input.publicHoliday,
    }),
    recommended: index === 0,
    type: /replace/iu.test(match.entry.recommendedAction || '')
      ? 'replace'
      : match.entry.siteAssessmentRequired
        ? 'site_assessment'
        : 'repair',
  }));
  const reviewReasons: string[] = [];
  if (!published) reviewReasons.push('No published price book is available.');
  if (!matches.length) reviewReasons.push('No price-book entry matched the maintenance issue.');
  if (matches[0]?.entry.siteAssessmentRequired) reviewReasons.push('The selected price rule requires a site assessment.');
  if (matches[0] && matches[0].score < matches[0].entry.automationConfidenceThreshold) {
    reviewReasons.push('Price-match confidence is below the automation threshold.');
  }
  const estimateId = randomUUID();
  const estimateRecord: Omit<MaintenanceEstimate, 'version'> = {
    id: estimateId,
    agencyId: input.agencyId,
    maintenanceItemId: item.id,
    ...(published ? { priceBookId: published.book.id, priceBookVersionId: published.version.id } : {}),
    status: reviewReasons.length ? 'review_required' : 'suggested',
    currency: published?.book.currency || 'AUD',
    options,
    ...(options[0] ? { selectedOptionId: options[0].id } : {}),
    confidence: matches[0]?.score || 0,
    reviewReasons,
    sourceFingerprint,
    calculatedAt: now,
    calculatedBy: input.actorId,
    createdAt: now,
    updatedAt: now,
  };
  const stored = await dependencies.repository.create(
    'maintenanceEstimates',
    input.agencyId,
    estimateId,
    estimateRecord as unknown as Record<string, unknown>,
    input.actorId,
  );
  await dependencies.repository.update(
    'maintenanceItems',
    input.agencyId,
    item.id,
    {
      estimateId,
      pricingStatus: options.length
        ? reviewReasons.length
          ? 'review_required'
          : 'estimate_generated'
        : 'contractor_quote_required',
      issueType: item.issueType || inferMaintenanceIssueType(item),
      slaDueAt: item.slaDueAt || maintenanceSlaDueAt(item.priority),
      slaStatus: maintenanceSlaStatus(item.slaDueAt || maintenanceSlaDueAt(item.priority), item.status),
    },
    Number(itemRecord.version),
    input.actorId,
  );
  return asRecord<MaintenanceEstimate>(stored);
}

async function approvalPolicy(
  dependencies: ApiDependencies,
  agencyId: string,
  propertyUse?: string,
): Promise<QuoteApprovalPolicy> {
  const policies = (await listAllOperationalRecords(dependencies, 'quoteApprovalPolicies', agencyId))
    .map(asRecord<QuoteApprovalPolicy>)
    .filter((policy) => policy.active);
  const matched = policies.find(
    (policy) => !policy.propertyUses.length || (propertyUse && policy.propertyUses.includes(propertyUse as never)),
  );
  if (matched) return matched;
  return {
    id: 'system-default-approval-policy',
    agencyId,
    name: 'Default maintenance approval policy',
    active: true,
    propertyUses: [],
    landlordApprovalThreshold: 0,
    mandatoryReplacementApproval: true,
    mandatoryCapitalApproval: true,
    mandatoryCosmeticApproval: true,
    autoApprovePreauthorisedServices: false,
    approvalLinkExpiryHours: 168,
    reminderHours: [24, 72, 120],
    createdBy: 'system',
    createdAt: timestamp(),
    updatedAt: timestamp(),
    version: 1,
  };
}

async function quoteRecipient(
  dependencies: ApiDependencies,
  agencyId: string,
  item: MaintenanceItem,
): Promise<{ client?: Client; email?: string }> {
  const property = await dependencies.repository.get('properties', agencyId, item.propertyId);
  if (!property) return {};
  const clientIds = Array.isArray(property.clientIds)
    ? property.clientIds.filter((id): id is string => typeof id === 'string')
    : [];
  if (clientIds[0]) {
    const client = await dependencies.repository.get('clients', agencyId, clientIds[0]);
    if (client) {
      const typed = asRecord<Client>(client);
      return { client: typed, email: typed.defaultApprovalEmail || typed.email };
    }
  }
  const ownership = Array.isArray(property.ownershipHistory)
    ? property.ownershipHistory.find((record) => record && typeof record === 'object' && (record as Record<string, unknown>).isCurrent === true) as Record<string, unknown> | undefined
    : undefined;
  return ownership ? { email: text(ownership.ownerEmail) || undefined } : {};
}

export async function createQuoteFromEstimate(
  dependencies: ApiDependencies,
  input: {
    agencyId: string;
    maintenanceItemId: string;
    estimateId: string;
    optionId?: string;
    actorId: string;
    validDays?: number;
  },
): Promise<{ quote: MaintenanceQuote; version: MaintenanceQuoteVersion; approval: ApprovalRequirement }> {
  const itemRecord = await dependencies.repository.get('maintenanceItems', input.agencyId, input.maintenanceItemId);
  const estimateRecord = await dependencies.repository.get('maintenanceEstimates', input.agencyId, input.estimateId);
  if (!itemRecord || !estimateRecord) throw Object.assign(new Error('Maintenance item or estimate was not found.'), { status: 404, code: 'ESTIMATE_CONTEXT_NOT_FOUND' });
  const item = asRecord<MaintenanceItem>(itemRecord);
  const estimate = asRecord<MaintenanceEstimate>(estimateRecord);
  if (estimate.maintenanceItemId !== item.id) throw Object.assign(new Error('Estimate does not belong to the maintenance item.'), { status: 409, code: 'ESTIMATE_CONTEXT_MISMATCH' });
  const option = estimate.options.find((candidate) => candidate.id === (input.optionId || estimate.selectedOptionId)) || estimate.options[0];
  if (!option) throw Object.assign(new Error('Select a priced estimate option before creating a quote.'), { status: 422, code: 'ESTIMATE_OPTION_REQUIRED' });
  const propertyRecord = await dependencies.repository.get('properties', input.agencyId, item.propertyId);
  const property = propertyRecord ? asRecord<PropertyRecord>(propertyRecord) : undefined;
  const policy = await approvalPolicy(dependencies, input.agencyId, property?.propertyUse);
  const lines = option.lineItems.map(quoteLineFromEstimate);
  const totals = quoteTotals(lines);
  const approval = resolveQuoteApproval(policy, {
    total: totals.total,
    replacement: option.type === 'replace',
    capital: option.type === 'replace' && totals.total >= 1000,
    cosmetic: item.category === 'Painting' || item.category === 'Cleaning',
    emergency: item.priority === 'urgent',
    preauthorised: false,
  });
  const recipient = await quoteRecipient(dependencies, input.agencyId, item);
  const now = timestamp();
  const quoteId = randomUUID();
  const quoteNumber = `MQ-${now.slice(0, 10).replaceAll('-', '')}-${quoteId.slice(0, 6).toUpperCase()}`;
  const versionId = `${quoteId}-v1`;
  const validUntil = new Date(Date.now() + Math.max(1, input.validDays || 14) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const versionData = {
    id: versionId,
    agencyId: input.agencyId,
    quoteId,
    versionNumber: 1,
    immutable: true as const,
    status: estimate.status === 'review_required' ? 'pricing_review_required' as const : 'draft' as const,
    optionType: option.type,
    title: `${item.title} - ${quoteNumber}`,
    summary: item.description,
    scope: option.description,
    lineItems: lines,
    ...totals,
    currency: estimate.currency,
    terms: 'Quote is subject to access, concealed conditions and the stated exclusions.',
    inclusions: option.lineItems.flatMap((line) => {
      const entry = estimate.priceBookVersionId ? line.priceBookEntryId : undefined;
      return entry ? [] : [];
    }),
    exclusions: option.exclusions,
    ...(option.warrantyDays ? { warrantyDays: option.warrantyDays } : {}),
    validUntil,
    sourceEstimateId: estimate.id,
    ...(estimate.priceBookVersionId ? { priceBookVersionId: estimate.priceBookVersionId } : {}),
    evidencePhotoIds: item.sourceEvidenceIds,
    contentHash: '',
    createdBy: input.actorId,
    createdAt: now,
  };
  versionData.contentHash = createHash('sha256').update(JSON.stringify(versionData)).digest('hex');
  const quoteData: Omit<MaintenanceQuote, 'version'> = {
    id: quoteId,
    agencyId: input.agencyId,
    maintenanceItemId: item.id,
    propertyId: item.propertyId,
    ...(recipient.client ? { clientId: recipient.client.id } : {}),
    ...(recipient.email ? { recipientEmail: recipient.email } : {}),
    quoteNumber,
    status: versionData.status,
    currentVersionId: versionId,
    currentVersionNumber: 1,
    selectedOptionType: option.type,
    currency: estimate.currency,
    ...totals,
    approvalRequired: approval.required,
    approvalPolicyId: policy.id,
    expiresAt: new Date(`${validUntil}T23:59:59.999Z`).toISOString(),
    xeroStatus: 'not_connected',
    createdBy: input.actorId,
    createdAt: now,
    updatedAt: now,
  };
  const versionStored = await dependencies.repository.create(
    'maintenanceQuoteVersions',
    input.agencyId,
    versionId,
    versionData as unknown as Record<string, unknown>,
    input.actorId,
  );
  const quoteStored = await dependencies.repository.create(
    'maintenanceQuotes',
    input.agencyId,
    quoteId,
    quoteData as unknown as Record<string, unknown>,
    input.actorId,
  );
  await dependencies.repository.update(
    'maintenanceItems',
    input.agencyId,
    item.id,
    {
      quoteIds: [...new Set([...(item.quoteIds || []), quoteId])],
      activeQuoteId: quoteId,
      approvalPolicyId: policy.id,
      pricingStatus: versionData.status === 'pricing_review_required' ? 'review_required' : 'quote_ready',
      approvalRequired: approval.required,
      approvalStatus: approval.required ? 'pending' : 'not_required',
    },
    Number(itemRecord.version),
    input.actorId,
  );
  return {
    quote: asRecord<MaintenanceQuote>(quoteStored),
    version: asRecord<MaintenanceQuoteVersion>(versionStored),
    approval,
  };
}

export async function transitionMaintenanceQuote(
  dependencies: ApiDependencies,
  input: {
    agencyId: string;
    quoteId: string;
    expectedVersion: number;
    nextStatus: MaintenanceQuoteStatus;
    actorId: string;
    reason?: string;
  },
): Promise<MaintenanceQuote> {
  const quoteRecord = await dependencies.repository.get('maintenanceQuotes', input.agencyId, input.quoteId);
  if (!quoteRecord) throw Object.assign(new Error('Maintenance quote not found.'), { status: 404, code: 'QUOTE_NOT_FOUND' });
  const quote = asRecord<MaintenanceQuote>(quoteRecord);
  if (Number(quoteRecord.version) !== input.expectedVersion) throw Object.assign(new Error('Quote changed. Reload and retry.'), { status: 409, code: 'VERSION_CONFLICT' });
  if (!canTransitionMaintenanceQuote(quote.status, input.nextStatus)) {
    throw Object.assign(new Error(`Cannot transition quote from ${quote.status} to ${input.nextStatus}.`), { status: 409, code: 'INVALID_QUOTE_TRANSITION' });
  }
  const now = timestamp();
  const patch: Record<string, unknown> = {
    status: input.nextStatus,
    ...(input.reason ? { transitionReason: sanitizeProhibitedCausation(input.reason) } : {}),
    ...(input.nextStatus === 'internally_approved' ? { internalApprovalBy: input.actorId, internalApprovedAt: now } : {}),
    ...(input.nextStatus === 'sent' ? { sentAt: now } : {}),
    ...(input.nextStatus === 'viewed' ? { viewedAt: now } : {}),
    ...(input.nextStatus === 'accepted' ? { acceptedAt: now } : {}),
    ...(input.nextStatus === 'declined' ? { declinedAt: now } : {}),
    ...(input.nextStatus === 'information_requested' ? { informationRequestedAt: now } : {}),
  };
  const stored = await dependencies.repository.update(
    'maintenanceQuotes',
    input.agencyId,
    quote.id,
    patch,
    input.expectedVersion,
    input.actorId,
  );
  return asRecord<MaintenanceQuote>(stored);
}

function grantHash(rawToken: string): string {
  return createHash('sha256').update(rawToken.trim()).digest('hex');
}

export async function sendMaintenanceQuoteForApproval(
  dependencies: ApiDependencies,
  input: {
    agencyId: string;
    quoteId: string;
    expectedVersion: number;
    actorId: string;
    actorRole: string;
    correlationId: string;
    recipientEmail?: string;
  },
): Promise<{ quote: MaintenanceQuote; approval: ClientApproval; accessUrl: string; expiresAt: string }> {
  const quoteRecord = await dependencies.repository.get('maintenanceQuotes', input.agencyId, input.quoteId);
  if (!quoteRecord) throw Object.assign(new Error('Maintenance quote not found.'), { status: 404, code: 'QUOTE_NOT_FOUND' });
  const quote = asRecord<MaintenanceQuote>(quoteRecord);
  if (!['internally_approved', 'ready_to_send', 'information_requested'].includes(quote.status)) {
    throw Object.assign(new Error('Quote must be internally approved before it can be sent.'), { status: 409, code: 'QUOTE_NOT_READY_TO_SEND' });
  }
  const quoteVersion = quote.currentVersionId
    ? await dependencies.repository.get('maintenanceQuoteVersions', input.agencyId, quote.currentVersionId)
    : undefined;
  if (!quoteVersion) throw Object.assign(new Error('Immutable quote version not found.'), { status: 409, code: 'QUOTE_VERSION_REQUIRED' });
  const itemRecord = await dependencies.repository.get('maintenanceItems', input.agencyId, quote.maintenanceItemId);
  if (!itemRecord) throw Object.assign(new Error('Maintenance item not found.'), { status: 404, code: 'MAINTENANCE_ITEM_NOT_FOUND' });
  const item = asRecord<MaintenanceItem>(itemRecord);
  const recipientEmail = (input.recipientEmail || quote.recipientEmail || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(recipientEmail)) {
    throw Object.assign(new Error('A valid approval recipient email is required.'), { status: 400, code: 'RECIPIENT_EMAIL_REQUIRED' });
  }
  const approvalId = randomUUID();
  const grantId = randomUUID();
  const rawToken = `${randomUUID()}${randomUUID().replaceAll('-', '')}`;
  const expiresAt = quote.expiresAt || new Date(Date.now() + 7 * 86_400_000).toISOString();
  const now = timestamp();
  const approval: Omit<ClientApproval, 'version'> = {
    id: approvalId,
    agencyId: input.agencyId,
    propertyId: quote.propertyId,
    maintenanceItemId: quote.maintenanceItemId,
    clientId: quote.clientId || 'unresolved-client',
    recipientEmail,
    summary: item.description,
    recommendedAction: item.recommendedAction || item.workInstruction || item.title,
    priority: item.priority,
    evidencePhotoIds: item.sourceEvidenceIds,
    status: 'pending',
    accessGrantId: grantId,
    quoteId: quote.id,
    quoteVersionId: quote.currentVersionId,
    quoteNumber: quote.quoteNumber,
    amount: quote.total,
    currency: quote.currency,
    quoteExpiresAt: expiresAt,
    createdAt: now,
    updatedAt: now,
  };
  const grant: ExternalAccessGrant = {
    id: grantId,
    agencyId: input.agencyId,
    resourceType: 'client_approval',
    resourceId: approvalId,
    recipientEmail,
    tokenHash: grantHash(rawToken),
    expiresAt,
    createdBy: input.actorId,
    createdAt: now,
  };
  await dependencies.repository.create(
    'clientApprovals',
    input.agencyId,
    approvalId,
    approval as unknown as Record<string, unknown>,
    input.actorId,
  );
  await dependencies.repository.create(
    'externalAccessGrants',
    input.agencyId,
    grantId,
    grant as unknown as Record<string, unknown>,
    input.actorId,
  );
  const quoteStored = await dependencies.repository.update(
    'maintenanceQuotes',
    input.agencyId,
    quote.id,
    { status: 'sent', sentAt: now, clientApprovalId: approvalId, recipientEmail },
    input.expectedVersion,
    input.actorId,
  );
  await dependencies.repository.update(
    'maintenanceItems',
    input.agencyId,
    item.id,
    { clientApprovalId: approvalId, approvalRequired: true, approvalStatus: 'pending', pricingStatus: 'quote_sent' },
    Number(itemRecord.version),
    input.actorId,
  );
  const webBase = process.env.WEB_APP_BASE_URL?.trim()?.replace(/\/$/u, '') || '';
  const accessUrl = `${webBase}/external/maintenance-quote/${rawToken}`;
  const notificationId = randomUUID();
  const notification = {
    recipientEmail,
    template: 'maintenance_quote_approval',
    status: 'queued',
    subject: `Maintenance quote ${quote.quoteNumber} requires approval`,
    data: {
      accessUrl,
      quoteNumber: quote.quoteNumber,
      amount: quote.total,
      currency: quote.currency,
      maintenanceTitle: item.title,
      propertyId: item.propertyId,
    },
    queuedAt: now,
  };
  await dependencies.repository.create('notificationJobs', input.agencyId, notificationId, notification, input.actorId);
  await dependencies.tasks.dispatch('notification', input.agencyId, notificationId, notification);
  await dependencies.audit.append({
    id: randomUUID(),
    timestamp: now,
    actorId: input.actorId,
    actorRole: input.actorRole,
    agencyId: input.agencyId,
    capability: 'maintenance.quote.send',
    outcome: 'allowed',
    reason: 'maintenance.quote_sent',
    target: { agencyId: input.agencyId, propertyId: item.propertyId, maintenanceItemId: item.id },
    correlationId: input.correlationId,
    entityType: 'maintenance_quote',
    entityId: quote.id,
    eventType: 'maintenance.quote_sent',
    metadata: { approvalId, quoteVersionId: quote.currentVersionId, total: quote.total },
  });
  return {
    quote: asRecord<MaintenanceQuote>(quoteStored),
    approval: { ...approval, version: 1 },
    accessUrl,
    expiresAt,
  };
}

export async function createMaintenanceWorkOrder(
  dependencies: ApiDependencies,
  input: {
    agencyId: string;
    quoteId: string;
    actorId: string;
    externalContactId?: string;
  },
): Promise<MaintenanceWorkOrder> {
  const quoteRecord = await dependencies.repository.get('maintenanceQuotes', input.agencyId, input.quoteId);
  if (!quoteRecord) throw Object.assign(new Error('Maintenance quote not found.'), { status: 404, code: 'QUOTE_NOT_FOUND' });
  const quote = asRecord<MaintenanceQuote>(quoteRecord);
  if (quote.status !== 'accepted') throw Object.assign(new Error('Only an accepted quote can become a work order.'), { status: 409, code: 'QUOTE_NOT_ACCEPTED' });
  if (!quote.currentVersionId) throw Object.assign(new Error('Accepted quote version is missing.'), { status: 409, code: 'QUOTE_VERSION_REQUIRED' });
  const itemRecord = await dependencies.repository.get('maintenanceItems', input.agencyId, quote.maintenanceItemId);
  if (!itemRecord) throw Object.assign(new Error('Maintenance item not found.'), { status: 404, code: 'MAINTENANCE_ITEM_NOT_FOUND' });
  const item = asRecord<MaintenanceItem>(itemRecord);
  const existing = quote.workOrderId
    ? await dependencies.repository.get('maintenanceWorkOrders', input.agencyId, quote.workOrderId)
    : undefined;
  if (existing) return asRecord<MaintenanceWorkOrder>(existing);
  const version = await dependencies.repository.get('maintenanceQuoteVersions', input.agencyId, quote.currentVersionId);
  const quoteVersion = version ? asRecord<MaintenanceQuoteVersion>(version) : undefined;
  if (!quoteVersion) throw Object.assign(new Error('Quote version not found.'), { status: 409, code: 'QUOTE_VERSION_REQUIRED' });
  const id = randomUUID();
  const now = timestamp();
  const workOrderData: Omit<MaintenanceWorkOrder, 'version'> = {
    id,
    agencyId: input.agencyId,
    maintenanceItemId: item.id,
    quoteId: quote.id,
    quoteVersionId: quote.currentVersionId,
    ...(input.externalContactId ? { externalContactId: input.externalContactId } : {}),
    workOrderNumber: `WO-${now.slice(0, 10).replaceAll('-', '')}-${id.slice(0, 6).toUpperCase()}`,
    status: 'draft',
    scope: quoteVersion.scope,
    approvedAmount: quote.total,
    currency: quote.currency,
    variationIds: [],
    createdBy: input.actorId,
    createdAt: now,
    updatedAt: now,
  };
  const stored = await dependencies.repository.create(
    'maintenanceWorkOrders',
    input.agencyId,
    id,
    workOrderData as unknown as Record<string, unknown>,
    input.actorId,
  );
  await dependencies.repository.update(
    'maintenanceQuotes',
    input.agencyId,
    quote.id,
    { status: 'converted_to_work_order', workOrderId: id },
    Number(quoteRecord.version),
    input.actorId,
  );
  await dependencies.repository.update(
    'maintenanceItems',
    input.agencyId,
    item.id,
    {
      workOrderId: id,
      approvedQuoteVersionId: quote.currentVersionId,
      status: 'approved',
      approvalStatus: 'approved',
      pricingStatus: 'quote_approved',
      workInstruction: quoteVersion.scope,
    },
    Number(itemRecord.version),
    input.actorId,
  );
  return asRecord<MaintenanceWorkOrder>(stored);
}

export async function reconcileMaintenanceFinancials(
  dependencies: ApiDependencies,
  input: {
    agencyId: string;
    maintenanceItemId: string;
    quoteId: string;
    actorId: string;
    actualContractorCost?: number;
    clientInvoiceTotal?: number;
  },
): Promise<MaintenanceFinancialReconciliation> {
  const quoteRecord = await dependencies.repository.get('maintenanceQuotes', input.agencyId, input.quoteId);
  if (!quoteRecord) throw Object.assign(new Error('Quote not found.'), { status: 404, code: 'QUOTE_NOT_FOUND' });
  const quote = asRecord<MaintenanceQuote>(quoteRecord);
  const variations = (await listAllOperationalRecords(dependencies, 'maintenanceVariations', input.agencyId))
    .filter((variation) => variation.maintenanceItemId === input.maintenanceItemId && variation.status === 'approved');
  const variationTotal = variations.reduce((sum, variation) => sum + number(variation.total), 0);
  const cost = input.actualContractorCost;
  const invoice = input.clientInvoiceTotal;
  const grossMarginAmount = cost !== undefined && invoice !== undefined ? invoice - cost : undefined;
  const grossMarginPercent = grossMarginAmount !== undefined && invoice ? (grossMarginAmount / invoice) * 100 : undefined;
  const varianceReasons: string[] = [];
  if (cost !== undefined && cost > quote.total + variationTotal) varianceReasons.push('Actual contractor cost exceeds the approved commercial amount.');
  if (invoice !== undefined && Math.abs(invoice - (quote.total + variationTotal)) > 0.01) varianceReasons.push('Client invoice differs from the accepted quote plus approved variations.');
  const existing = (await listAllOperationalRecords(dependencies, 'maintenanceFinancialReconciliations', input.agencyId))
    .find((record) => record.maintenanceItemId === input.maintenanceItemId && record.quoteId === input.quoteId);
  const now = timestamp();
  const data = {
    maintenanceItemId: input.maintenanceItemId,
    quoteId: input.quoteId,
    ...(quote.workOrderId ? { workOrderId: quote.workOrderId } : {}),
    approvedQuoteTotal: quote.total,
    variationTotal,
    ...(cost !== undefined ? { actualContractorCost: cost } : {}),
    ...(invoice !== undefined ? { clientInvoiceTotal: invoice } : {}),
    ...(grossMarginAmount !== undefined ? { grossMarginAmount } : {}),
    ...(grossMarginPercent !== undefined ? { grossMarginPercent } : {}),
    status: varianceReasons.length ? 'variance_review_required' : cost !== undefined && invoice !== undefined ? 'complete' : 'pending',
    varianceReasons,
    ...(cost !== undefined && invoice !== undefined && !varianceReasons.length ? { reconciledBy: input.actorId, reconciledAt: now } : {}),
  };
  if (existing) {
    return asRecord<MaintenanceFinancialReconciliation>(
      await dependencies.repository.update(
        'maintenanceFinancialReconciliations',
        input.agencyId,
        existing.id,
        data,
        Number(existing.version),
        input.actorId,
      ),
    );
  }
  const id = randomUUID();
  return asRecord<MaintenanceFinancialReconciliation>(
    await dependencies.repository.create(
      'maintenanceFinancialReconciliations',
      input.agencyId,
      id,
      { ...data, createdAt: now, updatedAt: now },
      input.actorId,
    ),
  );
}

export async function runMaintenanceAutomation(
  dependencies: ApiDependencies,
  input: {
    agencyId: string;
    actorId: string;
    actorRole: string;
    correlationId: string;
  },
): Promise<Record<string, number>> {
  const [reports, items, quotes, schedules] = await Promise.all([
    listAllOperationalRecords(dependencies, 'reports', input.agencyId),
    listAllOperationalRecords(dependencies, 'maintenanceItems', input.agencyId),
    listAllOperationalRecords(dependencies, 'maintenanceQuotes', input.agencyId),
    listAllOperationalRecords(dependencies, 'preventiveMaintenanceSchedules', input.agencyId),
  ]);
  let reportsScanned = 0;
  let candidatesCreated = 0;
  for (const report of reports) {
    if (
      !['approved_for_issue', 'issued_to_tenant', 'tenant_response_in_progress', 'tenant_submitted', 'agent_response_required', 'finalisation_ready', 'finalised', 'archived'].includes(String(report.lifecycleStatus)) ||
      !report.currentVersionId
    ) {
      continue;
    }
    reportsScanned += 1;
    const result = await extractMaintenanceForReport(dependencies, {
      agencyId: input.agencyId,
      reportId: report.id,
      actorId: input.actorId,
      actorRole: input.actorRole,
      correlationId: input.correlationId,
    });
    candidatesCreated += result.created.length;
  }
  let slaUpdated = 0;
  for (const item of items) {
    const typed = asRecord<MaintenanceItem>(item);
    const due = typed.slaDueAt || maintenanceSlaDueAt(typed.priority);
    const state = maintenanceSlaStatus(due, typed.status);
    if (typed.slaDueAt !== due || typed.slaStatus !== state) {
      await dependencies.repository.update(
        'maintenanceItems',
        input.agencyId,
        item.id,
        { slaDueAt: due, slaStatus: state },
        Number(item.version),
        input.actorId,
      );
      slaUpdated += 1;
    }
  }
  let quotesExpired = 0;
  for (const quote of quotes) {
    if (
      ['sent', 'viewed', 'information_requested'].includes(String(quote.status)) &&
      typeof quote.expiresAt === 'string' &&
      Date.parse(quote.expiresAt) < Date.now()
    ) {
      await dependencies.repository.update(
        'maintenanceQuotes',
        input.agencyId,
        quote.id,
        { status: 'expired' },
        Number(quote.version),
        input.actorId,
      );
      quotesExpired += 1;
    }
  }
  let preventiveCreated = 0;
  for (const scheduleRecord of schedules) {
    const schedule = asRecord<PreventiveMaintenanceSchedule>(scheduleRecord);
    if (schedule.paused || Date.parse(schedule.nextDueAt) > Date.now()) continue;
    const id = `preventive-${schedule.id}-${schedule.nextDueAt.slice(0, 10)}`;
    if (await dependencies.repository.get('maintenanceItems', input.agencyId, id)) continue;
    await dependencies.repository.create(
      'maintenanceItems',
      input.agencyId,
      id,
      {
        propertyId: schedule.propertyId,
        title: schedule.title,
        description: `Preventive maintenance generated from schedule ${schedule.id}.`,
        category: schedule.category,
        priority: 'routine',
        status: 'triage_required',
        sourceEvidenceIds: [],
        approvalRequired: true,
        approvalStatus: 'pending',
        verificationStatus: 'unverified',
        issueType: 'preventive_service',
        pricingStatus: schedule.priceCode ? 'price_match_found' : 'not_started',
        createdBy: input.actorId,
      },
      input.actorId,
    );
    preventiveCreated += 1;
  }
  return { reportsScanned, candidatesCreated, slaUpdated, quotesExpired, preventiveCreated };
}
