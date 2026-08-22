import type { InspectionReportType, PropertyUse } from './platform.js';

export type SettingsRecordStatus = 'draft' | 'active' | 'retired';
export type SettingsSection =
  | 'organisation'
  | 'branding'
  | 'inspection'
  | 'communications'
  | 'integrations'
  | 'maintenance'
  | 'security';

export interface VersionedAgencySettingsRecord {
  id: string;
  agencyId: string;
  version?: number;
  status: SettingsRecordStatus;
  effectiveFrom?: string;
  effectiveTo?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PostalAddress {
  line1?: string;
  line2?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  countryCode?: string;
}

export interface AgencyOrganisationSettings extends VersionedAgencySettingsRecord {
  id: 'organisation';
  registeredName: string;
  tradingName?: string;
  abn?: string;
  website?: string;
  contactEmail?: string;
  contactPhone?: string;
  businessAddress?: PostalAddress;
  postalAddress?: PostalAddress;
  timezone: string;
  locale: string;
  currency: string;
  countryCode: string;
  financialYearStartMonth: number;
  taxLabel: string;
  defaultTaxRate: number;
  taxRegistrationNumber?: string;
  defaultReplyToEmail?: string;
  supportEmail?: string;
  privacyEmail?: string;
}

export type BrandingAssetKind = 'logo' | 'dark_logo' | 'favicon' | 'portal_logo' | 'email_header' | 'other';

export interface BrandingAsset extends VersionedAgencySettingsRecord {
  kind: BrandingAssetKind;
  name: string;
  contentType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';
  objectPath?: string;
  publicUrl?: string;
  sha256?: string;
  fileSize?: number;
  altText?: string;
}

export interface PublicAgencyBranding {
  profileId: string;
  profileVersion?: number;
  name: string;
  logoUrl?: string;
  portalLogoUrl?: string;
  primaryColour?: string;
  secondaryColour?: string;
  accentColour?: string;
  reportHeaderText?: string;
  reportFooterText?: string;
  portalWelcomeText?: string;
  legalFooter?: string;
  privacyNoticeUrl?: string;
}

export interface AgencyBrandingProfile extends VersionedAgencySettingsRecord {
  id: string;
  name: string;
  logoAssetId?: string;
  darkLogoAssetId?: string;
  faviconAssetId?: string;
  portalLogoAssetId?: string;
  emailHeaderAssetId?: string;
  primaryColour?: string;
  secondaryColour?: string;
  accentColour?: string;
  reportHeaderText?: string;
  reportFooterText?: string;
  portalWelcomeText?: string;
  emailFooterHtml?: string;
  legalFooter?: string;
  privacyNoticeUrl?: string;
}

export type InspectionAssignmentStrategy = 'manual' | 'workload' | 'service_area' | 'round_robin' | 'qualification';

export interface InspectionTypeDefaults {
  reportType: InspectionReportType;
  defaultDurationMinutes: number;
  bookingBufferBeforeMinutes: number;
  bookingBufferAfterMinutes: number;
  minimumNoticeHours: number;
  reportCompletionSlaHours?: number;
  reviewSlaHours?: number;
  templateId?: string;
  requirePayment: boolean;
  requireAccessConfirmation: boolean;
  requireAnalystReview: boolean;
  requireReviewerApproval: boolean;
  automaticAiAnalysis: boolean;
  automaticPdfGeneration: boolean;
  automaticIssueAfterApproval: boolean;
}

export interface AgencyOperationalSettings extends VersionedAgencySettingsRecord {
  id: 'operational';
  assignmentStrategy: InspectionAssignmentStrategy;
  automaticAssignmentEnabled: boolean;
  maximumTravelDistanceKm?: number;
  operatingDays: number[];
  operatingStartTime: string;
  operatingEndTime: string;
  propertyUses?: PropertyUse[];
  inspectionDefaults: InspectionTypeDefaults[];
}

export type CommunicationChannel = 'email' | 'sms';
export type CommunicationProviderKind = 'sendgrid' | 'twilio' | 'custom';

export interface CommunicationProviderSettings {
  channel: CommunicationChannel;
  provider: CommunicationProviderKind;
  senderName?: string;
  senderAddress?: string;
  replyToAddress?: string;
  originatingNumber?: string;
  connectionId?: string;
  enabled: boolean;
}

export interface CommunicationPolicy extends VersionedAgencySettingsRecord {
  id: 'communications';
  quietHoursStart?: string;
  quietHoursEnd?: string;
  timezone?: string;
  providers: CommunicationProviderSettings[];
}

export interface CommunicationTemplate extends VersionedAgencySettingsRecord {
  eventType: string;
  channel: CommunicationChannel;
  name: string;
  subject?: string;
  body: string;
  allowedVariables: string[];
}

export interface NotificationRule extends VersionedAgencySettingsRecord {
  eventType: string;
  channel: CommunicationChannel;
  templateId: string;
  delayMinutes: number;
  retryCount: number;
  escalationAfterMinutes?: number;
  escalationTarget?: string;
  enabled: boolean;
}

export interface MaintenancePolicySettings extends VersionedAgencySettingsRecord {
  id: 'maintenance';
  defaultTaxRate: number;
  defaultMarkupPercent: number;
  minimumCharge?: number;
  quoteValidityDays: number;
  delegatedAuthorityLimit?: number;
  emergencyAuthorityLimit?: number;
  landlordApprovalThreshold?: number;
  multiQuoteThreshold?: number;
  minimumContractorQuoteCount: number;
  completionEvidenceRequired: boolean;
  costVarianceReviewRequired: boolean;
  responseSlaHours: Partial<Record<'emergency' | 'urgent' | 'routine' | 'planned', number>>;
}

export interface SettingsChangeRecord {
  id: string;
  agencyId: string;
  section: SettingsSection;
  entityId: string;
  versionBefore?: number;
  versionAfter: number;
  fieldsChanged: string[];
  changedBy: string;
  changedAt: string;
  reason?: string;
  correlationId?: string;
}

export type IntegrationHealthStatus = 'healthy' | 'warning' | 'error' | 'not_configured';

export interface IntegrationHealth {
  provider: string;
  status: IntegrationHealthStatus;
  accountLabel?: string;
  connectedAt?: string;
  lastSuccessfulSyncAt?: string;
  lastAttemptedSyncAt?: string;
  openExceptionCount: number;
  lastError?: string;
}

export interface SettingsHealthItem {
  key: string;
  label: string;
  status: IntegrationHealthStatus;
  detail?: string;
  checkedAt: string;
}

export interface SettingsOverview {
  completionPercent: number;
  missingItems: string[];
  health: SettingsHealthItem[];
  integrations: IntegrationHealth[];
}

export const DEFAULT_ORGANISATION_SETTINGS: Omit<AgencyOrganisationSettings, 'agencyId' | 'registeredName'> = {
  id: 'organisation',
  status: 'active',
  timezone: 'Australia/Perth',
  locale: 'en-AU',
  currency: 'AUD',
  countryCode: 'AU',
  financialYearStartMonth: 7,
  taxLabel: 'GST',
  defaultTaxRate: 10,
};
