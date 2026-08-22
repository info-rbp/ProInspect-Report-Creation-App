import type { InspectionReportType } from './platform.js';

export const CLIENT_ACCOUNT_TYPES = [
  'private_landlord',
  'property_management_firm',
  'commercial_property_owner',
  'strata_owners_corporation',
  'strata_manager',
  'corporate_client',
  'other',
] as const;
export type ClientAccountType = (typeof CLIENT_ACCOUNT_TYPES)[number];

export const CLIENT_ENTITY_TYPES = [
  'individual',
  'joint_owners',
  'company',
  'trust',
  'partnership',
  'property_management_agency',
  'strata_owners_corporation',
  'other',
] as const;
export type ClientEntityType = (typeof CLIENT_ENTITY_TYPES)[number];

export const CLIENT_ACCOUNT_STATUSES = [
  'prospect',
  'onboarding',
  'active',
  'on_hold',
  'offboarding',
  'inactive',
  'archived',
] as const;
export type ClientAccountStatus = (typeof CLIENT_ACCOUNT_STATUSES)[number];

export type ClientBillingMethod =
  | 'shopify_prepaid'
  | 'account'
  | 'invoice_per_inspection'
  | 'monthly_consolidated_invoice'
  | 'other';

export interface ClientBillingProfile {
  method: ClientBillingMethod;
  invoiceRecipientEmail?: string;
  paymentTermsDays?: number;
  purchaseOrderRequired?: boolean;
  defaultPurchaseOrderReference?: string;
  pricingProfile?: 'standard' | 'contract' | 'custom';
  gstTreatment?: string;
}

export interface ClientReportRecipientRule {
  reportType: InspectionReportType;
  contactRoles: ClientContactRole[];
  includeOwner: boolean;
  includePropertyManager: boolean;
}

export interface ClientInspectionPreferences {
  preferredInspectorId?: string;
  preferredReviewerId?: string;
  preferredTimeWindow?: 'morning' | 'afternoon' | 'business_hours' | 'any';
  minimumBookingNoticeHours?: number;
  defaultAppointmentDurationMinutes?: number;
  directBookingAllowed?: boolean;
  tenantNotificationRequired?: boolean;
  defaultTemplateIds?: Partial<Record<InspectionReportType, string>>;
  reportRecipientRules?: ClientReportRecipientRule[];
  routineFrequencyMonths?: number;
  autoScheduleRecurringInspections?: boolean;
  bookingNotes?: string;
}

export interface ClientMaintenancePolicy {
  propertyManagerApprovalLimit?: number;
  landlordApprovalThreshold?: number;
  emergencyAuthorisationLimit?: number;
  secondApprovalThreshold?: number;
  replacementAlwaysRequiresOwnerApproval?: boolean;
  capitalWorksAlwaysRequireOwnerApproval?: boolean;
  cosmeticWorksAlwaysRequireOwnerApproval?: boolean;
  preauthorisedServiceCodes?: string[];
  quoteContactId?: string;
  maintenanceContactId?: string;
  escalationContactId?: string;
  ownerApprovalContactId?: string;
  accountsContactId?: string;
}

export interface ClientExternalReferences {
  shopifyCustomerIds?: string[];
  propertyManagementSystemIds?: Record<string, string>;
}

export interface ClientAccount {
  id: string;
  agencyId: string;
  legalName: string;
  tradingName?: string;
  clientType: ClientAccountType;
  entityType: ClientEntityType;
  abn?: string;
  acn?: string;
  website?: string;
  businessAddress?: string;
  postalAddress?: string;
  timezone?: string;
  mainPhone?: string;
  generalEmail?: string;
  accountsEmail?: string;
  maintenanceEmail?: string;
  emergencyPhone?: string;
  primaryContactId?: string;
  internalAccountManagerUserId?: string;
  billingProfile?: ClientBillingProfile;
  inspectionPreferences?: ClientInspectionPreferences;
  maintenancePolicy?: ClientMaintenancePolicy;
  externalReferences?: ClientExternalReferences;
  tags?: string[];
  notes?: string;
  onboardingCompletedSteps?: string[];
  onboardingBlockers?: string[];
  activatedAt?: string;
  offboardedAt?: string;
  mergedIntoClientId?: string;
  status: ClientAccountStatus;

  /** Compatibility fields consumed by earlier Properties and Maintenance code. */
  name?: string;
  email?: string;
  phone?: string;
  type?: 'landlord' | 'agency' | 'owner' | 'other';
  shopifyCustomerId?: string;
  defaultApprovalEmail?: string;

  createdAt: string;
  updatedAt: string;
  version?: number;
}

export const CLIENT_CONTACT_ROLES = [
  'principal',
  'property_manager',
  'assistant_property_manager',
  'portfolio_manager',
  'maintenance_manager',
  'accounts',
  'operations',
  'owner_landlord',
  'owner_representative',
  'strata_manager',
  'other',
] as const;
export type ClientContactRole = (typeof CLIENT_CONTACT_ROLES)[number];

export interface ClientContact {
  id: string;
  agencyId: string;
  clientAccountId: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  department?: string;
  branch?: string;
  email?: string;
  mobile?: string;
  phone?: string;
  roles: ClientContactRole[];
  preferredContactMethod?: 'email' | 'phone' | 'sms';
  isPrimary: boolean;
  isEmergencyContact?: boolean;
  receivesReports?: boolean;
  receivesMaintenance?: boolean;
  receivesAccounts?: boolean;
  canApproveMaintenance?: boolean;
  approvalLimit?: number;
  portalUserId?: string;
  status: 'active' | 'inactive';
  notes?: string;
  createdAt: string;
  updatedAt: string;
  version?: number;
}

export type ClientServiceCode =
  | 'entry_inspection'
  | 'routine_inspection'
  | 'exit_inspection'
  | 'comparison_report'
  | 'maintenance_follow_up'
  | 'maintenance_identification'
  | 'automatic_pricing'
  | 'maintenance_quoting'
  | 'contractor_coordination'
  | 'completion_verification'
  | 'other';

export interface ClientServiceAgreementItem {
  serviceCode: ClientServiceCode;
  active: boolean;
  priceCode?: string;
  contractedPrice?: number;
  currency?: string;
  defaultTemplateId?: string;
  notes?: string;
}

export interface ClientEngagement {
  id: string;
  agencyId: string;
  clientAccountId: string;
  name: string;
  status: 'draft' | 'active' | 'on_hold' | 'ended';
  effectiveFrom?: string;
  effectiveTo?: string;
  services: ClientServiceAgreementItem[];
  billingMethod?: ClientBillingMethod;
  paymentTermsDays?: number;
  serviceLevelNotes?: string;
  agreementDocumentId?: string;
  renewalDate?: string;
  createdAt: string;
  updatedAt: string;
  version?: number;
}

export const PROPERTY_CLIENT_RELATIONSHIP_TYPES = [
  'owner',
  'managing_agent',
  'engaging_client',
  'billing_party',
  'report_recipient',
  'maintenance_authority',
  'strata_manager',
  'owner_representative',
] as const;
export type PropertyClientRelationshipType = (typeof PROPERTY_CLIENT_RELATIONSHIP_TYPES)[number];

export interface PropertyClientRelationship {
  id: string;
  agencyId: string;
  propertyId: string;
  clientAccountId: string;
  relationshipType: PropertyClientRelationshipType;
  primaryContactId?: string;
  engagementId?: string;
  startDate?: string;
  endDate?: string;
  isCurrent: boolean;
  propertyManagerApprovalLimit?: number;
  emergencyAuthorisationLimit?: number;
  reportRecipientContactIds?: string[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
  version?: number;
}

export const CLIENT_DOCUMENT_TYPES = [
  'engagement_agreement',
  'service_agreement',
  'fee_schedule',
  'terms_conditions',
  'privacy_consent',
  'authority_to_act',
  'maintenance_authority',
  'purchase_order',
  'insurance_compliance',
  'client_instructions',
  'pricing_agreement',
  'other',
] as const;
export type ClientDocumentType = (typeof CLIENT_DOCUMENT_TYPES)[number];

export interface ClientDocument {
  id: string;
  agencyId: string;
  clientAccountId: string;
  type: ClientDocumentType;
  title: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  objectPath: string;
  generation: string;
  sha256: string;
  effectiveFrom?: string;
  expiresAt?: string;
  signedStatus?: 'not_required' | 'pending' | 'signed' | 'expired';
  supersedesDocumentId?: string;
  supersededByDocumentId?: string;
  uploadedBy: string;
  uploadedAt: string;
  status: 'active' | 'superseded' | 'archived';
  createdAt: string;
  updatedAt: string;
  version?: number;
}

export const CLIENT_PORTAL_PERMISSIONS = [
  'client.properties.read',
  'client.inspections.create',
  'client.inspections.read',
  'client.reports.read',
  'client.maintenance.read',
  'client.maintenance.approve',
  'client.quotes.approve',
  'client.commercial.read',
  'client.documents.read',
  'client.users.manage',
] as const;
export type ClientPortalPermission = (typeof CLIENT_PORTAL_PERMISSIONS)[number];

export interface ClientPortalUser {
  id: string;
  agencyId: string;
  clientAccountId: string;
  contactId?: string;
  email: string;
  displayName: string;
  permissions: ClientPortalPermission[];
  propertyIds?: string[];
  status: 'invited' | 'active' | 'suspended' | 'revoked';
  identityUid?: string;
  invitationExpiresAt?: string;
  lastAccessedAt?: string;
  createdAt: string;
  updatedAt: string;
  version?: number;
}

export interface ClientTimelineEvent {
  id: string;
  agencyId: string;
  clientAccountId: string;
  type:
    | 'client_created'
    | 'client_activated'
    | 'client_on_hold'
    | 'client_offboarded'
    | 'client_merged'
    | 'contact_added'
    | 'relationship_added'
    | 'relationship_ended'
    | 'engagement_created'
    | 'document_uploaded'
    | 'portal_access_changed'
    | 'inspection_created'
    | 'report_issued'
    | 'maintenance_approval'
    | 'commercial_terms_updated'
    | 'general';
  summary: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  actorId?: string;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
  version?: number;
}

export interface ClientContactSnapshot {
  contactId?: string;
  name: string;
  email?: string;
  phone?: string;
  role?: ClientContactRole;
}

export interface ClientSnapshot {
  clientAccountId: string;
  engagementId?: string;
  clientName: string;
  clientType: ClientAccountType;
  primaryContact?: ClientContactSnapshot;
  propertyManager?: ClientContactSnapshot;
  billingParty?: ClientContactSnapshot;
  reportRecipients: ClientContactSnapshot[];
  maintenanceApprover?: ClientContactSnapshot;
  capturedAt: string;
}

export interface ClientOnboardingReadiness {
  readyForActivation: boolean;
  completedSteps: string[];
  blockers: string[];
  warnings: string[];
}

export interface ClientDuplicateCandidate {
  clientAccountId: string;
  score: number;
  reasons: string[];
}

function normalise(value?: string): string {
  return (value || '').toLowerCase().replace(/[^a-z0-9]+/gu, '').trim();
}

function normaliseEmail(value?: string): string {
  return (value || '').trim().toLowerCase();
}

export function clientDisplayName(account: Pick<ClientAccount, 'legalName' | 'tradingName'>): string {
  return account.tradingName?.trim() || account.legalName.trim();
}

export function legacyClientType(clientType: ClientAccountType): 'landlord' | 'agency' | 'owner' | 'other' {
  if (clientType === 'private_landlord') return 'landlord';
  if (clientType === 'property_management_firm' || clientType === 'strata_manager') return 'agency';
  if (clientType === 'commercial_property_owner' || clientType === 'strata_owners_corporation' || clientType === 'corporate_client') return 'owner';
  return 'other';
}

export function evaluateClientOnboarding(
  account: Partial<ClientAccount>,
  contacts: ClientContact[],
  engagements: ClientEngagement[],
): ClientOnboardingReadiness {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const completedSteps: string[] = [];
  if (account.legalName?.trim() && account.clientType && account.entityType) completedSteps.push('identity');
  else blockers.push('Complete the client legal identity, client type and entity type.');

  const activeContacts = contacts.filter((contact) => contact.status === 'active');
  const primary = activeContacts.find((contact) => contact.isPrimary) ||
    activeContacts.find((contact) => contact.id === account.primaryContactId);
  if (primary?.email || primary?.phone || primary?.mobile) completedSteps.push('contacts');
  else blockers.push('Add a primary client contact with an email address or telephone number.');

  if (engagements.some((engagement) => engagement.status === 'active' || engagement.status === 'draft')) completedSteps.push('engagement');
  else warnings.push('No service engagement has been configured.');

  if (account.billingProfile?.method) completedSteps.push('billing');
  else blockers.push('Select how this client is billed.');

  if (account.inspectionPreferences) completedSteps.push('inspection_preferences');
  else warnings.push('Inspection preferences will fall back to agency defaults.');

  if (account.maintenancePolicy) completedSteps.push('maintenance_approvals');
  else warnings.push('Maintenance approvals will fall back to agency defaults.');

  return {
    readyForActivation: blockers.length === 0,
    completedSteps,
    blockers,
    warnings,
  };
}

export function findClientDuplicateCandidates(
  candidate: Partial<ClientAccount> & { primaryEmail?: string },
  existing: ClientAccount[],
): ClientDuplicateCandidate[] {
  return existing
    .map((account) => {
      let score = 0;
      const reasons: string[] = [];
      if (candidate.abn && account.abn && normalise(candidate.abn) === normalise(account.abn)) {
        score += 0.65;
        reasons.push('ABN matches');
      }
      if (candidate.acn && account.acn && normalise(candidate.acn) === normalise(account.acn)) {
        score += 0.65;
        reasons.push('ACN matches');
      }
      const candidateShopify = candidate.externalReferences?.shopifyCustomerIds || [];
      const accountShopify = account.externalReferences?.shopifyCustomerIds || [];
      if (candidateShopify.some((id) => accountShopify.includes(id))) {
        score += 0.8;
        reasons.push('Shopify Customer ID matches');
      }
      if (candidate.primaryEmail && normaliseEmail(candidate.primaryEmail) && normaliseEmail(candidate.primaryEmail) === normaliseEmail(account.generalEmail)) {
        score += 0.5;
        reasons.push('Primary email matches');
      }
      if (candidate.legalName && normalise(candidate.legalName) === normalise(account.legalName)) {
        score += 0.35;
        reasons.push('Legal name matches');
      } else if (candidate.tradingName && normalise(candidate.tradingName) === normalise(account.tradingName)) {
        score += 0.3;
        reasons.push('Trading name matches');
      }
      return { clientAccountId: account.id, score: Math.min(1, score), reasons };
    })
    .filter((result) => result.score >= 0.3)
    .sort((left, right) => right.score - left.score);
}

export function activePropertyClientRelationships(
  relationships: PropertyClientRelationship[],
  at = new Date().toISOString(),
): PropertyClientRelationship[] {
  const point = Date.parse(at);
  return relationships.filter((relationship) => {
    if (!relationship.isCurrent) return false;
    if (relationship.startDate && Date.parse(relationship.startDate) > point) return false;
    if (relationship.endDate && Date.parse(relationship.endDate) < point) return false;
    return true;
  });
}

function contactSnapshot(contact?: ClientContact, fallbackRole?: ClientContactRole): ClientContactSnapshot | undefined {
  if (!contact) return undefined;
  return {
    contactId: contact.id,
    name: contact.displayName,
    ...(contact.email ? { email: contact.email } : {}),
    ...(contact.mobile || contact.phone ? { phone: contact.mobile || contact.phone } : {}),
    ...(contact.roles[0] || fallbackRole ? { role: contact.roles[0] || fallbackRole } : {}),
  };
}

function relationshipRank(type: PropertyClientRelationshipType): number {
  const order: PropertyClientRelationshipType[] = [
    'engaging_client',
    'managing_agent',
    'owner',
    'strata_manager',
    'owner_representative',
    'billing_party',
    'maintenance_authority',
    'report_recipient',
  ];
  return order.indexOf(type);
}

export function resolveClientSnapshot(input: {
  propertyId: string;
  accounts: ClientAccount[];
  contacts: ClientContact[];
  relationships: PropertyClientRelationship[];
  engagements?: ClientEngagement[];
  capturedAt?: string;
}): ClientSnapshot | undefined {
  const relationships = activePropertyClientRelationships(input.relationships)
    .filter((relationship) => relationship.propertyId === input.propertyId)
    .sort((left, right) => relationshipRank(left.relationshipType) - relationshipRank(right.relationshipType));
  const primaryRelationship = relationships.find((relationship) => relationship.relationshipType === 'engaging_client') ||
    relationships.find((relationship) => relationship.relationshipType === 'managing_agent') ||
    relationships.find((relationship) => relationship.relationshipType === 'owner') ||
    relationships[0];
  if (!primaryRelationship) return undefined;
  const account = input.accounts.find((candidate) => candidate.id === primaryRelationship.clientAccountId);
  if (!account) return undefined;
  const accountContacts = input.contacts.filter((contact) => contact.clientAccountId === account.id && contact.status === 'active');
  const primaryContact = accountContacts.find((contact) => contact.id === account.primaryContactId) || accountContacts.find((contact) => contact.isPrimary);
  const propertyManagerRelationship = relationships.find((relationship) => relationship.relationshipType === 'managing_agent');
  const propertyManager = input.contacts.find((contact) => contact.id === propertyManagerRelationship?.primaryContactId) ||
    accountContacts.find((contact) => contact.roles.includes('property_manager'));
  const billingRelationship = relationships.find((relationship) => relationship.relationshipType === 'billing_party');
  const billingAccountId = billingRelationship?.clientAccountId || account.id;
  const billingContacts = input.contacts.filter((contact) => contact.clientAccountId === billingAccountId && contact.status === 'active');
  const billingContact = input.contacts.find((contact) => contact.id === billingRelationship?.primaryContactId) ||
    billingContacts.find((contact) => contact.receivesAccounts || contact.roles.includes('accounts'));
  const maintenanceRelationship = relationships.find((relationship) => relationship.relationshipType === 'maintenance_authority');
  const maintenanceAccount = input.accounts.find((candidate) => candidate.id === maintenanceRelationship?.clientAccountId) || account;
  const maintenanceContacts = input.contacts.filter((contact) => contact.clientAccountId === maintenanceAccount.id && contact.status === 'active');
  const maintenanceContact = input.contacts.find((contact) => contact.id === maintenanceRelationship?.primaryContactId) ||
    maintenanceContacts.find((contact) => contact.id === maintenanceAccount.maintenancePolicy?.ownerApprovalContactId) ||
    maintenanceContacts.find((contact) => contact.id === maintenanceAccount.maintenancePolicy?.quoteContactId) ||
    maintenanceContacts.find((contact) => contact.canApproveMaintenance) || primaryContact;
  const explicitRecipientIds = relationships
    .filter((relationship) => relationship.relationshipType === 'report_recipient')
    .flatMap((relationship) => [relationship.primaryContactId, ...(relationship.reportRecipientContactIds || [])])
    .filter((value): value is string => Boolean(value));
  const recipientContacts = input.contacts.filter((contact) =>
    explicitRecipientIds.includes(contact.id) ||
    (contact.status === 'active' && contact.receivesReports && relationships.some((relationship) => relationship.clientAccountId === contact.clientAccountId)),
  );
  const fallbackRecipients = recipientContacts.length ? recipientContacts : [propertyManager || primaryContact].filter((value): value is ClientContact => Boolean(value));
  const activeEngagement = (input.engagements || [])
    .filter((engagement) => engagement.clientAccountId === account.id && engagement.status === 'active')
    .sort((left, right) => String(right.effectiveFrom || '').localeCompare(String(left.effectiveFrom || '')))[0];
  return {
    clientAccountId: account.id,
    ...(activeEngagement ? { engagementId: activeEngagement.id } : {}),
    clientName: clientDisplayName(account),
    clientType: account.clientType,
    ...(contactSnapshot(primaryContact) ? { primaryContact: contactSnapshot(primaryContact) } : {}),
    ...(contactSnapshot(propertyManager, 'property_manager') ? { propertyManager: contactSnapshot(propertyManager, 'property_manager') } : {}),
    ...(contactSnapshot(billingContact, 'accounts') ? { billingParty: contactSnapshot(billingContact, 'accounts') } : {}),
    reportRecipients: fallbackRecipients.map((contact) => contactSnapshot(contact)!).filter(Boolean),
    ...(contactSnapshot(maintenanceContact) ? { maintenanceApprover: contactSnapshot(maintenanceContact) } : {}),
    capturedAt: input.capturedAt || new Date().toISOString(),
  };
}

export function resolveMaintenanceApprovalRecipient(input: {
  snapshot: ClientSnapshot;
  account?: ClientAccount;
  amount: number;
  emergency?: boolean;
  relationshipApprovalLimit?: number;
  relationshipEmergencyLimit?: number;
}): { recipient?: ClientContactSnapshot; recipientType: 'property_manager' | 'landlord' | 'none'; reasons: string[] } {
  const policy = input.account?.maintenancePolicy;
  const managerLimit = input.relationshipApprovalLimit ?? policy?.propertyManagerApprovalLimit;
  const emergencyLimit = input.relationshipEmergencyLimit ?? policy?.emergencyAuthorisationLimit;
  const reasons: string[] = [];
  if (input.emergency && emergencyLimit !== undefined && input.amount <= emergencyLimit && input.snapshot.propertyManager) {
    reasons.push(`Emergency authority permits the property manager to approve up to ${emergencyLimit}.`);
    return { recipient: input.snapshot.propertyManager, recipientType: 'property_manager', reasons };
  }
  if (managerLimit !== undefined && input.amount <= managerLimit && input.snapshot.propertyManager) {
    reasons.push(`Property manager delegated authority covers amounts up to ${managerLimit}.`);
    return { recipient: input.snapshot.propertyManager, recipientType: 'property_manager', reasons };
  }
  if (policy?.landlordApprovalThreshold !== undefined && input.amount >= policy.landlordApprovalThreshold) {
    reasons.push(`Amount meets or exceeds the landlord approval threshold of ${policy.landlordApprovalThreshold}.`);
  } else if (managerLimit !== undefined && input.amount > managerLimit) {
    reasons.push(`Amount exceeds the property manager delegated authority of ${managerLimit}.`);
  } else {
    reasons.push('No delegated property-manager approval rule covers this amount.');
  }
  return {
    recipient: input.snapshot.maintenanceApprover || input.snapshot.primaryContact,
    recipientType: input.snapshot.maintenanceApprover || input.snapshot.primaryContact ? 'landlord' : 'none',
    reasons,
  };
}
