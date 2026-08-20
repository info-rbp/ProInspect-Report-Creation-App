import type { OwnershipStructure, PhysicalPropertyType, PropertyRecord, PropertyUse } from '../../types/platform';
import { createProperty, type CreatePropertyInput } from './propertyService';
import { applyLayoutTemplate, PROPERTY_LAYOUT_TEMPLATES } from './propertyLayoutService';

export interface PropertyImportCandidate {
  row: number;
  address: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  propertyUse: PropertyUse;
  physicalPropertyType: PhysicalPropertyType;
  ownershipStructure: OwnershipStructure;
  bedrooms?: number;
  bathrooms?: number;
  parking?: number;
  ownerName?: string;
  tenantName?: string;
  tenantEmail?: string;
  leaseStartDate?: string;
  leaseEndDate?: string;
  errors: string[];
}

const USES = new Set<PropertyUse>(['residential', 'commercial', 'industrial', 'retail', 'mixed_use', 'strata_common_property', 'other']);
const OWNERSHIP = new Set<OwnershipStructure>(['freehold', 'strata', 'survey_strata', 'community_title', 'company_title', 'common_property', 'unknown', 'other']);

function cells(line: string): string[] {
  const result: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; } else quoted = !quoted;
    } else if (character === ',' && !quoted) { result.push(value.trim()); value = ''; }
    else value += character;
  }
  result.push(value.trim());
  return result;
}

function numberValue(value?: string): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function normalisedType(value?: string): PhysicalPropertyType {
  const candidate = (value || 'house').trim().toLowerCase().replace(/[ /-]+/gu, '_') as PhysicalPropertyType;
  return candidate;
}

export function parsePropertyCsv(csv: string): PropertyImportCandidate[] {
  const lines = csv.split(/\r?\n/u).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = cells(lines[0]).map((header) => header.trim().toLowerCase().replace(/[ /-]+/gu, '_'));
  const index = (name: string) => headers.indexOf(name);
  const value = (row: string[], name: string) => { const position = index(name); return position >= 0 ? row[position]?.trim() : undefined; };

  return lines.slice(1).map((line, offset) => {
    const row = cells(line);
    const errors: string[] = [];
    const address = value(row, 'address') || '';
    if (!address) errors.push('Address is required.');
    const rawUse = (value(row, 'property_use') || 'residential').toLowerCase().replace(/[ /-]+/gu, '_') as PropertyUse;
    const propertyUse = USES.has(rawUse) ? rawUse : 'other';
    const rawOwnership = (value(row, 'ownership_structure') || 'unknown').toLowerCase().replace(/[ /-]+/gu, '_') as OwnershipStructure;
    const ownershipStructure = OWNERSHIP.has(rawOwnership) ? rawOwnership : 'unknown';
    return {
      row: offset + 2,
      address,
      suburb: value(row, 'suburb'),
      state: value(row, 'state') || 'WA',
      postcode: value(row, 'postcode'),
      propertyUse,
      physicalPropertyType: normalisedType(value(row, 'physical_property_type') || value(row, 'property_type')),
      ownershipStructure,
      bedrooms: numberValue(value(row, 'bedrooms')),
      bathrooms: numberValue(value(row, 'bathrooms')),
      parking: numberValue(value(row, 'parking')),
      ownerName: value(row, 'owner_name'),
      tenantName: value(row, 'tenant_name'),
      tenantEmail: value(row, 'tenant_email'),
      leaseStartDate: value(row, 'lease_start_date'),
      leaseEndDate: value(row, 'lease_end_date'),
      errors,
    };
  });
}

function legacyType(type: PhysicalPropertyType): PropertyRecord['propertyType'] {
  if (['house', 'apartment', 'unit', 'townhouse', 'villa', 'duplex'].includes(type)) return type as PropertyRecord['propertyType'];
  if (['office', 'retail_shop', 'warehouse', 'industrial_unit', 'showroom', 'medical_consulting', 'hospitality', 'restaurant_cafe', 'childcare', 'mixed_commercial'].includes(type)) return 'commercial';
  return 'other';
}

function chooseTemplate(candidate: PropertyImportCandidate) {
  return PROPERTY_LAYOUT_TEMPLATES.find((template) => template.propertyUse === candidate.propertyUse && template.physicalPropertyTypes.includes(candidate.physicalPropertyType))
    || PROPERTY_LAYOUT_TEMPLATES.find((template) => template.propertyUse === candidate.propertyUse);
}

export async function importPropertyCandidates(agencyId: string, candidates: PropertyImportCandidate[]): Promise<PropertyRecord[]> {
  const invalid = candidates.filter((candidate) => candidate.errors.length);
  if (invalid.length) throw new Error(`Resolve ${invalid.length} invalid CSV row(s) before import.`);
  const created: PropertyRecord[] = [];
  for (const candidate of candidates) {
    const now = new Date().toISOString();
    const draft = {
      id: 'bulk-preview',
      agencyId,
      address: candidate.address,
      suburb: candidate.suburb,
      state: candidate.state,
      postcode: candidate.postcode,
      propertyType: legacyType(candidate.physicalPropertyType),
      propertyUse: candidate.propertyUse,
      physicalPropertyType: candidate.physicalPropertyType,
      ownershipStructure: candidate.ownershipStructure,
      bedrooms: candidate.bedrooms,
      bathrooms: candidate.bathrooms,
      parking: candidate.parking,
      livingAreas: candidate.propertyUse === 'residential' ? 1 : 0,
      landlordDetails: { name: candidate.ownerName || '' },
      tenantDetails: { primaryTenantName: candidate.tenantName || '', primaryTenantEmail: candidate.tenantEmail || '', leaseStartDate: candidate.leaseStartDate, leaseEndDate: candidate.leaseEndDate, occupancyStatus: candidate.tenantName ? 'tenanted' as const : 'vacant' as const },
      ownershipHistory: candidate.ownerName ? [{ id: `owner-${candidate.row}`, ownerName: candidate.ownerName, isCurrent: true }] : [],
      tenancyHistory: candidate.tenantName ? [{ id: `tenant-${candidate.row}`, tenantNames: [candidate.tenantName], tenantEmails: candidate.tenantEmail ? [candidate.tenantEmail] : [], leaseStartDate: candidate.leaseStartDate, leaseEndDate: candidate.leaseEndDate, status: 'current' as const }] : [],
      clientIds: [],
      status: 'active' as const,
      onboarding: { status: 'ready_for_inspection' as const, completedSteps: ['Identity', 'Classification', 'Layout', 'Configuration'], historicalImportStatus: 'not_started' as const, updatedAt: now },
      createdAt: now,
      updatedAt: now,
    } satisfies PropertyRecord;
    const template = chooseTemplate(candidate);
    const layout = template ? applyLayoutTemplate(draft, template, 'Created from reviewed portfolio CSV import') : {};
    const input: CreatePropertyInput = { ...draft, ...layout };
    created.push(await createProperty(input));
  }
  return created;
}

export const PROPERTY_CSV_TEMPLATE = 'address,suburb,state,postcode,property_use,physical_property_type,ownership_structure,bedrooms,bathrooms,parking,owner_name,tenant_name,tenant_email,lease_start_date,lease_end_date\n';
