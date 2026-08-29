import { checksum, deterministicTargetId } from './framework.mjs';

export const FIRST_BOUNDED_DOMAIN = Object.freeze([
  'agencies',
  'clients',
  'managed_sites',
  'properties',
  'property_client_relationships',
  'client_contacts',
]);

const required = (value, field, source) => {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(`${source}.${field} is required`);
  }
  return String(value).trim();
};

const optional = (value) => value === undefined || value === null || String(value).trim() === '' ? undefined : String(value).trim();
const timestamp = (value, fallback) => optional(value) ?? fallback;

function addRow(plan, index, { sourceSystem, sourceEntity, source, targetTable, target }) {
  const sourceId = required(source.id ?? source.$id, 'id', `${sourceSystem}.${sourceEntity}`);
  const key = `${sourceSystem}:${sourceEntity}:${sourceId}`;
  const targetId = deterministicTargetId(sourceSystem, sourceEntity, sourceId);
  const row = Object.fromEntries(Object.entries(target).filter(([, value]) => value !== undefined));
  index.set(key, targetId);
  plan.rows.push({ sourceSystem, sourceEntity, sourceId, sourceChecksum: checksum(source), targetTable, targetId, targetChecksum: checksum(row), row });
  return targetId;
}

function resolve(index, sourceSystem, sourceEntity, sourceId, owner) {
  const id = index.get(`${sourceSystem}:${sourceEntity}:${required(sourceId, `${sourceEntity}Id`, owner)}`);
  if (!id) throw new Error(`${owner} references an unplanned ${sourceSystem}.${sourceEntity} row`);
  return id;
}

/**
 * Builds a deterministic, side-effect-free migration plan. Inputs are bounded
 * exports selected by an operator; no source or Appwrite connection is opened.
 * This is intentionally dry-run preparation, not a production importer.
 */
export function planFirstBoundedMigration(input, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const plan = { dryRun: true, domain: FIRST_BOUNDED_DOMAIN, rows: [], counts: {}, errors: [] };
  const index = new Map();

  try {
    for (const source of input.agencies ?? []) {
      const sourceId = required(source.id ?? source.$id, 'id', 'firestore.agencies');
      addRow(plan, index, {
        sourceSystem: 'firestore', sourceEntity: 'agencies', source, targetTable: 'agencies',
        target: { name: required(source.name, 'name', `agency ${sourceId}`), code: required(source.code, 'code', `agency ${sourceId}`), status: source.status ?? 'active', timezone: source.timezone ?? 'Australia/Perth', createdAt: timestamp(source.createdAt, now), updatedAt: timestamp(source.updatedAt, now) },
      });
    }
    for (const source of input.clients ?? []) {
      const owner = `client ${source.id ?? source.$id}`;
      addRow(plan, index, {
        sourceSystem: 'firestore', sourceEntity: 'clients', source, targetTable: 'clients',
        target: { agencyId: resolve(index, 'firestore', 'agencies', source.agencyId, owner), name: required(source.name ?? source.legalName, 'name', owner), legalName: optional(source.legalName), tradingName: optional(source.tradingName), abn: optional(source.abn), clientType: optional(source.clientType), accountType: optional(source.accountType), shopifyCustomerId: optional(source.shopifyCustomerId), status: source.status ?? 'active', createdAt: timestamp(source.createdAt, now), updatedAt: timestamp(source.updatedAt, now), legacySystem: 'firestore', legacyId: required(source.id ?? source.$id, 'id', owner) },
      });
    }
    for (const source of input.managedSites ?? []) {
      const owner = `managed site ${source.id ?? source.$id}`;
      addRow(plan, index, {
        sourceSystem: source.sourceSystem ?? 'strata_d1', sourceEntity: source.sourceEntity ?? 'properties', source, targetTable: 'managed_sites',
        target: { agencyId: resolve(index, 'firestore', 'agencies', source.agencyId, owner), name: required(source.name, 'name', owner), siteType: source.siteType ?? 'strata', timezone: source.timezone ?? 'Australia/Perth', streetAddress: optional(source.address ?? source.streetAddress), strataPlanNumber: optional(source.strataPlan ?? source.strataPlanNumber), status: source.status ?? 'active', createdAt: timestamp(source.createdAt, now), updatedAt: timestamp(source.updatedAt, now), legacySystem: source.sourceSystem ?? 'strata_d1', legacyId: required(source.id ?? source.$id, 'id', owner) },
      });
    }
    for (const source of input.properties ?? []) {
      const owner = `property ${source.id ?? source.$id}`;
      const siteSourceSystem = source.siteSourceSystem ?? 'strata_d1';
      const siteSourceEntity = source.siteSourceEntity ?? 'properties';
      addRow(plan, index, {
        sourceSystem: 'firestore', sourceEntity: 'properties', source, targetTable: 'properties',
        target: { agencyId: resolve(index, 'firestore', 'agencies', source.agencyId, owner), managedSiteId: source.managedSiteSourceId ? resolve(index, siteSourceSystem, siteSourceEntity, source.managedSiteSourceId, owner) : undefined, propertyType: required(source.propertyType, 'propertyType', owner), propertyUse: required(source.propertyUse, 'propertyUse', owner), ownershipStructure: required(source.ownershipStructure, 'ownershipStructure', owner), streetAddress: required(source.streetAddress, 'streetAddress', owner), suburb: optional(source.suburb), state: optional(source.state), postcode: optional(source.postcode), country: source.country ?? 'Australia', lotNumber: optional(source.lotNumber), unitNumber: optional(source.unitNumber), strataPlanNumber: optional(source.strataPlanNumber), status: source.status ?? 'active', createdAt: timestamp(source.createdAt, now), updatedAt: timestamp(source.updatedAt, now), legacySystem: 'firestore', legacyId: required(source.id ?? source.$id, 'id', owner) },
      });
    }
    for (const source of input.propertyClientRelationships ?? []) {
      const owner = `property-client relationship ${source.id ?? source.$id}`;
      addRow(plan, index, {
        sourceSystem: 'firestore', sourceEntity: 'propertyClientRelationships', source, targetTable: 'property_client_relationships',
        target: { agencyId: resolve(index, 'firestore', 'agencies', source.agencyId, owner), propertyId: resolve(index, 'firestore', 'properties', source.propertyId, owner), clientId: resolve(index, 'firestore', 'clients', source.clientId, owner), relationshipType: required(source.relationshipType, 'relationshipType', owner), primary: Boolean(source.primary), startDate: optional(source.startDate), endDate: optional(source.endDate), serviceScope: source.serviceScope ? JSON.stringify(source.serviceScope) : undefined, status: source.status ?? 'active', createdAt: timestamp(source.createdAt, now), updatedAt: timestamp(source.updatedAt, now), legacySystem: 'firestore', legacyId: required(source.id ?? source.$id, 'id', owner) },
      });
    }
    for (const source of input.clientContacts ?? []) {
      const owner = `client contact ${source.id ?? source.$id}`;
      addRow(plan, index, {
        sourceSystem: 'firestore', sourceEntity: 'clientContacts', source, targetTable: 'client_contacts',
        target: { agencyId: resolve(index, 'firestore', 'agencies', source.agencyId, owner), clientId: resolve(index, 'firestore', 'clients', source.clientId ?? source.clientAccountId, owner), name: required(source.name ?? source.fullName, 'name', owner), email: optional(source.email), phone: optional(source.phone), role: optional(source.role ?? source.roles?.[0]), roles: source.roles ? JSON.stringify(source.roles) : undefined, primary: Boolean(source.primary), receivesReports: Boolean(source.receivesReports), receivesAccounts: Boolean(source.receivesAccounts), receivesMaintenance: Boolean(source.receivesMaintenance), status: source.status ?? 'active', createdAt: timestamp(source.createdAt, now), updatedAt: timestamp(source.updatedAt, now), legacySystem: 'firestore', legacyId: required(source.id ?? source.$id, 'id', owner) },
      });
    }
  } catch (error) {
    plan.errors.push({ code: 'RELATIONSHIP_OR_FIELD_INVALID', message: error instanceof Error ? error.message : 'Unknown planning error' });
  }

  for (const table of FIRST_BOUNDED_DOMAIN) plan.counts[table] = plan.rows.filter((row) => row.targetTable === table).length;
  plan.valid = plan.errors.length === 0;
  return plan;
}
