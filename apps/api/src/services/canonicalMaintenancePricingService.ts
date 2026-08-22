import { createHash, randomUUID } from 'node:crypto';
import {
  estimateOptionFromMatch,
  inferMaintenanceIssueType,
  maintenanceSlaDueAt,
  maintenanceSlaStatus,
  matchCanonicalPriceBookEntries,
  type MaintenanceEstimate,
  type MaintenanceEstimateOption,
  type MaintenanceItem,
  type PriceBook,
  type PriceBookEntry,
  type PriceBookImport,
  type PriceBookVersion,
  type PropertyRecord,
} from '@pcr/domain';
import type { ApiDependencies, StoredRecord } from '../backend/types.js';

function asRecord<T>(record: StoredRecord): T {
  return record as unknown as T;
}

function timestamp(): string {
  return new Date().toISOString();
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
  } while (cursor && records.length < 10_000);
  return records;
}

async function publishedPriceBookVersion(
  dependencies: ApiDependencies,
  agencyId: string,
  preferredPriceBookId?: string,
): Promise<{ book: PriceBook; version: PriceBookVersion } | undefined> {
  const books = (await listAll(dependencies, 'priceBooks', agencyId))
    .map(asRecord<PriceBook>)
    .filter((book) => book.status === 'active' && book.currentPublishedVersionId);
  const book = preferredPriceBookId
    ? books.find((candidate) => candidate.id === preferredPriceBookId)
    : books[0];
  if (!book?.currentPublishedVersionId) return undefined;
  const version = await dependencies.repository.get('priceBookVersions', agencyId, book.currentPublishedVersionId);
  return version ? { book, version: asRecord<PriceBookVersion>(version) } : undefined;
}

export async function generateCanonicalMaintenanceEstimate(
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
    .update([
      item.id,
      item.version,
      item.sourceCanonicalAreaDefinitionId || item.sourceAreaId || '',
      item.sourceCanonicalComponentDefinitionId || item.sourceComponentId || '',
      published?.version.id || 'no-price-book',
    ].join('|'))
    .digest('hex');
  const context = {
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
  };
  const matches = published
    ? matchCanonicalPriceBookEntries(item, published.version.entries, context)
    : [];
  const options: MaintenanceEstimateOption[] = matches.slice(0, 3).map((match, index) => ({
    ...estimateOptionFromMatch(match, context),
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
  if (item.sourceCanonicalComponentDefinitionId && matches[0] && !matches[0].entry.canonicalComponentDefinitionIds?.length) {
    reviewReasons.push('Best price rule is legacy/unbound; review before automatic issue.');
  }
  if (matches[0]?.entry.siteAssessmentRequired) reviewReasons.push('The selected price rule requires a site assessment.');
  if (matches[0] && matches[0].score < matches[0].entry.automationConfidenceThreshold) {
    reviewReasons.push('Price-match confidence is below the automation threshold.');
  }

  const estimateId = randomUUID();
  const estimateRecord: Omit<MaintenanceEstimate, 'version'> & { canonicalPricingVersion: number } = {
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
    canonicalPricingVersion: 1,
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
  const dueAt = item.slaDueAt || maintenanceSlaDueAt(item.priority);
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
      slaDueAt: dueAt,
      slaStatus: maintenanceSlaStatus(dueAt, item.status),
    },
    Number(itemRecord.version),
    input.actorId,
  );
  return asRecord<MaintenanceEstimate>(stored);
}

function normaliseColumn(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, '');
}

function listValue(value: unknown): string[] {
  if (Array.isArray(value)) return [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))];
  if (typeof value !== 'string') return [];
  return [...new Set(value.split(/[;,|\n]/u).map((item) => item.trim()).filter(Boolean))];
}

function canonicalValues(raw: Record<string, string | number | boolean | null>, aliases: string[]): string[] {
  const aliasSet = new Set(aliases.map(normaliseColumn));
  for (const [column, value] of Object.entries(raw)) {
    if (aliasSet.has(normaliseColumn(column))) return listValue(value);
  }
  return [];
}

/**
 * Preserves existing spreadsheet compatibility while recognizing optional canonical binding columns.
 * This runs within the publish command immediately after the version is created, before the endpoint
 * returns the published version to the caller.
 */
export async function enrichPublishedPriceBookCanonicalBindings(
  dependencies: ApiDependencies,
  input: {
    agencyId: string;
    importId: string;
    version: PriceBookVersion;
    actorId: string;
  },
): Promise<PriceBookVersion> {
  const importStored = await dependencies.repository.get('priceBookImports', input.agencyId, input.importId);
  const versionStored = await dependencies.repository.get('priceBookVersions', input.agencyId, input.version.id);
  if (!importStored || !versionStored) return input.version;
  const imported = asRecord<PriceBookImport>(importStored);
  const rawByRow = new Map(imported.rows.map((row) => [row.rowNumber, row.rawValues]));
  let bindingCount = 0;
  const entries: PriceBookEntry[] = input.version.entries.map((entry) => {
    const raw = entry.sourceRowNumber ? rawByRow.get(entry.sourceRowNumber) : undefined;
    if (!raw) return entry;
    const canonicalAreaDefinitionIds = canonicalValues(raw, [
      'canonicalAreaDefinitionId', 'canonicalAreaDefinitionIds', 'canonical_area_definition_id',
      'canonical area id', 'area definition id',
    ]);
    const canonicalComponentDefinitionIds = canonicalValues(raw, [
      'canonicalComponentDefinitionId', 'canonicalComponentDefinitionIds', 'canonical_component_definition_id',
      'canonical component id', 'component definition id',
    ]);
    if (canonicalAreaDefinitionIds.length || canonicalComponentDefinitionIds.length) bindingCount += 1;
    return {
      ...entry,
      ...(canonicalAreaDefinitionIds.length ? { canonicalAreaDefinitionIds } : {}),
      ...(canonicalComponentDefinitionIds.length ? { canonicalComponentDefinitionIds } : {}),
    };
  });
  if (!bindingCount) return input.version;
  const contentHash = createHash('sha256').update(JSON.stringify(entries)).digest('hex');
  const updated = await dependencies.repository.update(
    'priceBookVersions',
    input.agencyId,
    input.version.id,
    { entries, contentHash, canonicalBindingVersion: 1, canonicalBindingCount: bindingCount },
    Number(versionStored.version),
    input.actorId,
  );
  return asRecord<PriceBookVersion>(updated);
}
