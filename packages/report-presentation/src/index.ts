import type { InspectionType } from '@pcr/domain';

export const REPORT_PRESENTATION_TEMPLATE_STATUSES = ['draft', 'published', 'retired'] as const;
export type ReportPresentationTemplateStatus = (typeof REPORT_PRESENTATION_TEMPLATE_STATUSES)[number];

export const REPORT_PRESENTATION_SECTION_TYPES = [
  'cover',
  'executive_summary',
  'property_details',
  'inspection_details',
  'key_findings',
  'area_findings',
  'comparison_summary',
  'maintenance_summary',
  'tenant_response',
  'approval_record',
  'disclaimer',
  'photo_appendix',
  'attachments',
  'audit_reference',
] as const;
export type ReportPresentationSectionType = (typeof REPORT_PRESENTATION_SECTION_TYPES)[number];

export interface ReportBrandingProfile {
  id: string;
  version: number;
  status: ReportPresentationTemplateStatus;
  agencyName: string;
  tradingName?: string;
  logoDocumentId?: string;
  secondaryLogoDocumentId?: string;
  abn?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  primaryColour: string;
  secondaryColour: string;
  accentColour: string;
  headingFont: string;
  bodyFont: string;
  footerText?: string;
  disclaimerId?: string;
  disclaimerVersion?: number;
  createdAt: string;
  publishedAt?: string;
  retiredAt?: string;
}

export interface ReportBrandingSnapshot {
  profileId: string;
  profileVersion: number;
  agencyName: string;
  tradingName?: string;
  logoDocumentId?: string;
  secondaryLogoDocumentId?: string;
  abn?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  primaryColour: string;
  secondaryColour: string;
  accentColour: string;
  headingFont: string;
  bodyFont: string;
  footerText?: string;
  disclaimerId?: string;
  disclaimerVersion?: number;
  capturedAt: string;
}

export interface ReportPresentationSection {
  id: string;
  type: ReportPresentationSectionType;
  visible: boolean;
  pageBreakBefore?: boolean;
  style?: 'standard' | 'compact' | 'detailed' | 'comparison' | 'exception_first';
  showOrdinaryItems?: boolean;
  maxPhotosPerComponent?: number;
}

export interface ReportPresentationTemplate {
  id: string;
  version: number;
  status: ReportPresentationTemplateStatus;
  name: string;
  supportedInspectionTypes: InspectionType[];
  page: {
    size: 'A4';
    marginMm: number;
    showPageNumbers: boolean;
    showRunningHeader: boolean;
  };
  typography: {
    headingFont: string;
    bodyFont: string;
    baseFontSizePt: number;
  };
  cover: {
    style: 'hero' | 'minimal' | 'corporate';
    showHeroPhoto: boolean;
    showClientName: boolean;
    showInspectorName: boolean;
  };
  sections: ReportPresentationSection[];
  createdAt: string;
  publishedAt?: string;
  retiredAt?: string;
}

export interface ReportPresentationSnapshot {
  presentationTemplateId: string;
  presentationTemplateVersion: number;
  brandingProfileId: string;
  brandingProfileVersion: number;
  branding: ReportBrandingSnapshot;
  rendererVersion: string;
  fontBundleVersion: string;
  capturedAt: string;
}

const HEX_COLOUR = /^#[0-9a-f]{6}$/iu;

function requireText(value: string, field: string): void {
  if (!value.trim()) throw new Error(`${field} is required.`);
}

function validateStatus(status: ReportPresentationTemplateStatus): void {
  if (!REPORT_PRESENTATION_TEMPLATE_STATUSES.includes(status)) throw new Error('Unsupported presentation lifecycle status.');
}

export function validateBrandingProfile(profile: ReportBrandingProfile): void {
  requireText(profile.id, 'Branding profile id');
  requireText(profile.agencyName, 'Agency name');
  if (!Number.isInteger(profile.version) || profile.version < 1) throw new Error('Branding profile version must be a positive integer.');
  validateStatus(profile.status);
  for (const [field, value] of [
    ['primaryColour', profile.primaryColour],
    ['secondaryColour', profile.secondaryColour],
    ['accentColour', profile.accentColour],
  ] as const) {
    if (!HEX_COLOUR.test(value)) throw new Error(`${field} must be a six-digit hexadecimal colour.`);
  }
  requireText(profile.headingFont, 'Heading font');
  requireText(profile.bodyFont, 'Body font');
}

export function validatePresentationTemplate(template: ReportPresentationTemplate): void {
  requireText(template.id, 'Presentation template id');
  requireText(template.name, 'Presentation template name');
  if (!Number.isInteger(template.version) || template.version < 1) throw new Error('Presentation template version must be a positive integer.');
  validateStatus(template.status);
  if (!template.supportedInspectionTypes.length) throw new Error('At least one inspection type is required.');
  if (template.page.size !== 'A4' || template.page.marginMm < 5 || template.page.marginMm > 40) {
    throw new Error('Presentation page settings are invalid.');
  }
  if (template.typography.baseFontSizePt < 7 || template.typography.baseFontSizePt > 14) {
    throw new Error('Base font size must be between 7pt and 14pt.');
  }
  const sectionIds = new Set<string>();
  for (const section of template.sections) {
    requireText(section.id, 'Presentation section id');
    if (sectionIds.has(section.id)) throw new Error(`Duplicate presentation section id: ${section.id}`);
    sectionIds.add(section.id);
    if (!REPORT_PRESENTATION_SECTION_TYPES.includes(section.type)) throw new Error(`Unsupported presentation section type: ${section.type}`);
    if (section.maxPhotosPerComponent !== undefined && (!Number.isInteger(section.maxPhotosPerComponent) || section.maxPhotosPerComponent < 0 || section.maxPhotosPerComponent > 12)) {
      throw new Error('maxPhotosPerComponent must be between 0 and 12.');
    }
  }
}

export function publishPresentationTemplate(template: ReportPresentationTemplate, publishedAt = new Date().toISOString()): ReportPresentationTemplate {
  if (template.status !== 'draft') throw new Error('Only draft presentation templates can be published.');
  validatePresentationTemplate(template);
  return structuredClone({ ...template, status: 'published', publishedAt });
}

export function publishBrandingProfile(profile: ReportBrandingProfile, publishedAt = new Date().toISOString()): ReportBrandingProfile {
  if (profile.status !== 'draft') throw new Error('Only draft branding profiles can be published.');
  validateBrandingProfile(profile);
  return structuredClone({ ...profile, status: 'published', publishedAt });
}

export function captureBrandingSnapshot(profile: ReportBrandingProfile, capturedAt = new Date().toISOString()): ReportBrandingSnapshot {
  if (profile.status !== 'published') throw new Error('Only a published branding profile can be captured.');
  validateBrandingProfile(profile);
  const { id: profileId, version: profileVersion, status: _status, createdAt: _createdAt, publishedAt: _publishedAt, retiredAt: _retiredAt, ...branding } = profile;
  void _status;
  void _createdAt;
  void _publishedAt;
  void _retiredAt;
  return { profileId, profileVersion, ...structuredClone(branding), capturedAt };
}

export function defaultPresentationTemplate(now = new Date().toISOString()): ReportPresentationTemplate {
  return {
    id: 'system-standard-report',
    version: 1,
    status: 'draft',
    name: 'Standard ProInspect Report',
    supportedInspectionTypes: ['entry', 'routine', 'exit', 'comparison', 'maintenance'],
    page: { size: 'A4', marginMm: 12, showPageNumbers: true, showRunningHeader: true },
    typography: { headingFont: 'Inter', bodyFont: 'Inter', baseFontSizePt: 9 },
    cover: { style: 'hero', showHeroPhoto: true, showClientName: true, showInspectorName: true },
    sections: [
      { id: 'cover', type: 'cover', visible: true },
      { id: 'summary', type: 'executive_summary', visible: true, pageBreakBefore: true },
      { id: 'key-findings', type: 'key_findings', visible: true },
      { id: 'areas', type: 'area_findings', visible: true, pageBreakBefore: true, style: 'detailed', maxPhotosPerComponent: 3 },
      { id: 'comparison', type: 'comparison_summary', visible: true, style: 'comparison' },
      { id: 'maintenance', type: 'maintenance_summary', visible: true, style: 'exception_first' },
      { id: 'tenant-response', type: 'tenant_response', visible: true, pageBreakBefore: true },
      { id: 'approval', type: 'approval_record', visible: true },
      { id: 'disclaimer', type: 'disclaimer', visible: true },
      { id: 'photos', type: 'photo_appendix', visible: true, pageBreakBefore: true },
    ],
    createdAt: now,
  };
}
