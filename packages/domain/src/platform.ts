export type UserRole =
  | 'super_admin'
  | 'proinspect_admin'
  | 'operations'
  | 'inspector'
  | 'analyst'
  | 'reviewer'
  | 'tenant'
  | 'landlord'
  | 'shopify_customer';

export type EntityStatus = 'active' | 'inactive' | 'archived';

/**
 * The five report types supported by the shared inspection product model.
 */
export const INSPECTION_REPORT_TYPES = [
  'Property Condition Report',
  'Routine Inspection',
  'Exit Inspection',
  'Inspection Comparison Report',
  'Maintenance and Follow-Up Report',
] as const;

export type InspectionReportType = (typeof INSPECTION_REPORT_TYPES)[number];

export type InspectionJobStatus =
  | 'draft'
  | 'booked'
  | 'assigned'
  | 'inspection_started'
  | 'photos_uploading'
  | 'photos_uploaded'
  | 'inspection_submitted'
  | 'analysis_queued'
  | 'analysis_running'
  | 'analysis_failed'
  | 'analysis_complete'
  | 'analyst_review_in_progress'
  | 'review_required'
  | 'reviewer_review_in_progress'
  | 'changes_requested'
  | 'reviewer_approved'
  | 'ready_to_issue'
  | 'issued_to_tenant'
  | 'tenant_viewed'
  | 'tenant_response_in_progress'
  | 'tenant_submitted'
  | 'agent_response_required'
  | 'finalisation_ready'
  | 'finalised'
  | 'archived'
  | 'on_hold'
  | 'cancelled';

export type ReportLifecycleStatus =
  | 'draft'
  | 'internal_review'
  | 'photos_uploaded'
  | 'analysis_queued'
  | 'analysis_running'
  | 'analysis_complete'
  | 'review_required'
  | 'changes_requested'
  | 'approved_for_issue'
  | 'issued_to_tenant'
  | 'tenant_response_in_progress'
  | 'tenant_submitted'
  | 'agent_response_required'
  | 'finalisation_ready'
  | 'finalised'
  | 'archived'
  | 'cancelled';

export type WorkflowExceptionCode =
  | 'evidence_upload_failed'
  | 'analysis_failed'
  | 'issue_failed'
  | 'notification_failed'
  | 'finalisation_failed'
  | 'archive_failed';

export interface Agency {
  id: string;
  name: string;
  tradingName?: string;
  abn?: string;
  contactEmail?: string;
  contactPhone?: string;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  id: string;
  agencyId?: string;
  displayName?: string;
  email: string;
  role: UserRole;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Client {
  id: string;
  agencyId: string;
  name: string;
  email?: string;
  phone?: string;
  type: 'landlord' | 'agency' | 'owner' | 'other';
  shopifyCustomerId?: string;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

/** Property identity is deliberately multi-dimensional. An apartment can be residential + apartment + strata. */
export type PropertyUse =
  | 'residential'
  | 'commercial'
  | 'industrial'
  | 'retail'
  | 'mixed_use'
  | 'strata_common_property'
  | 'other';

export type PhysicalPropertyType =
  | 'house'
  | 'apartment'
  | 'unit'
  | 'townhouse'
  | 'villa'
  | 'duplex'
  | 'studio'
  | 'ancillary_dwelling'
  | 'retirement_supported'
  | 'office'
  | 'retail_shop'
  | 'warehouse'
  | 'industrial_unit'
  | 'showroom'
  | 'medical_consulting'
  | 'hospitality'
  | 'restaurant_cafe'
  | 'childcare'
  | 'mixed_commercial'
  | 'common_property'
  | 'other';

export type OwnershipStructure =
  | 'freehold'
  | 'strata'
  | 'survey_strata'
  | 'community_title'
  | 'company_title'
  | 'common_property'
  | 'unknown'
  | 'other';

/** Legacy room types remain supported because report seeding consumes them. */
export type RoomType =
  | 'bedroom'
  | 'bathroom'
  | 'living'
  | 'kitchen'
  | 'dining'
  | 'outdoor'
  | 'laundry'
  | 'garage'
  | 'study'
  | 'hallway'
  | 'storage'
  | 'office'
  | 'retail'
  | 'warehouse'
  | 'amenities'
  | 'plant'
  | 'safety'
  | 'other';

export interface RoomConfigItem {
  id: string;
  name: string;
  roomType: RoomType;
  floorLevel?: string;
  buildingName?: string;
  parentAreaId?: string;
  responsibility?: 'lot' | 'common_property' | 'exclusive_use' | 'shared' | 'unknown';
  notes?: string;
  itemsPreset?: string[];
}

export type PropertyLayoutNodeKind = 'site' | 'building' | 'level' | 'area';

export interface PropertyLayoutNode {
  id: string;
  name: string;
  kind: PropertyLayoutNodeKind;
  parentId?: string;
  roomType?: RoomType;
  floorLevel?: string;
  responsibility?: 'lot' | 'common_property' | 'exclusive_use' | 'shared' | 'unknown';
  notes?: string;
  itemsPreset?: string[];
  order: number;
}

export interface PropertyLayoutVersion {
  id: string;
  version: number;
  label: string;
  effectiveFrom: string;
  effectiveTo?: string;
  changeReason?: string;
  templateId?: string;
  nodes: PropertyLayoutNode[];
  roomsConfig: RoomConfigItem[];
  createdBy?: string;
  createdAt: string;
}

export interface StrataDetails {
  schemeName?: string;
  strataPlanNumber?: string;
  lotNumber?: string;
  unitNumber?: string;
  buildingName?: string;
  strataCompany?: string;
  strataManagerName?: string;
  strataManagerEmail?: string;
  strataManagerPhone?: string;
  commonPropertyResponsibility?: string;
  exclusiveUseAreas?: string[];
  allocatedParkingBay?: string;
  storageLot?: string;
  byLawNotes?: string;
  accessArrangements?: string;
}

export interface LandlordDetails {
  name?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  address?: string;
  contactPreference?: 'email' | 'phone' | 'sms';
  notes?: string;
}

export interface TenantDetails {
  primaryTenantName?: string;
  primaryTenantEmail?: string;
  primaryTenantPhone?: string;
  additionalTenants?: string[];
  leaseStartDate?: string;
  leaseEndDate?: string;
  rentAmount?: number;
  rentFrequency?: 'weekly' | 'fortnightly' | 'monthly';
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  occupancyStatus?: 'tenanted' | 'vacant' | 'notice_given';
  notes?: string;
}

export interface AccessDetails {
  keyNumbers?: string;
  lockboxCode?: string;
  alarmCode?: string;
  accessNotes?: string;
}

export interface PropertyFeatures {
  airConditioning?: boolean;
  heating?: boolean;
  pool?: boolean;
  furnished?: boolean;
  petsAllowed?: boolean;
  dishwasher?: boolean;
  solar?: boolean;
  courtyard?: boolean;
  balcony?: boolean;
  securitySystem?: boolean;
  lift?: boolean;
  loadingDock?: boolean;
  firePanel?: boolean;
  commercialKitchen?: boolean;
}

export type PropertyAssetCategory =
  | 'appliance'
  | 'hvac'
  | 'hot_water'
  | 'solar'
  | 'security'
  | 'pool'
  | 'fire_safety'
  | 'electrical'
  | 'plumbing'
  | 'fixture'
  | 'commercial_equipment'
  | 'other';

export interface PropertyAsset {
  id: string;
  name: string;
  category: PropertyAssetCategory;
  areaId?: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
  installedAt?: string;
  ownerSupplied?: boolean;
  warrantyExpiresAt?: string;
  manualDocumentId?: string;
  currentCondition?: string;
  lastWorkingConfirmationAt?: string;
  lastMaintenanceAt?: string;
  evidencePhotoIds?: string[];
  notes?: string;
  status: 'active' | 'removed' | 'replaced';
}

export type AccessDeviceType =
  | 'key'
  | 'garage_remote'
  | 'security_fob'
  | 'access_card'
  | 'lockbox'
  | 'alarm_code'
  | 'gate_remote'
  | 'other';

export interface PropertyAccessDevice {
  id: string;
  type: AccessDeviceType;
  name: string;
  quantity: number;
  identifier?: string;
  status: 'held' | 'supplied' | 'returned' | 'lost' | 'replaced' | 'inactive';
  tenancyId?: string;
  photoId?: string;
  suppliedAt?: string;
  returnedAt?: string;
  notes?: string;
}

export interface PropertyOwnershipRecord {
  id: string;
  clientId?: string;
  ownerName: string;
  ownerEmail?: string;
  ownerPhone?: string;
  companyName?: string;
  startDate?: string;
  endDate?: string;
  isCurrent: boolean;
  notes?: string;
}

export interface PropertyTenancyRecord {
  id: string;
  tenancyId?: string;
  tenantNames: string[];
  tenantEmails?: string[];
  leaseStartDate?: string;
  leaseEndDate?: string;
  status: 'current' | 'historical' | 'upcoming';
  notes?: string;
}

export type PropertyDocumentType =
  | 'entry_report'
  | 'routine_report'
  | 'exit_report'
  | 'maintenance_report'
  | 'comparison_report'
  | 'floor_plan'
  | 'building_plan'
  | 'property_photo'
  | 'owner_instruction'
  | 'furnishing_inventory'
  | 'appliance_schedule'
  | 'key_schedule'
  | 'contractor_report'
  | 'quote'
  | 'invoice'
  | 'completion_report'
  | 'warranty'
  | 'compliance_certificate'
  | 'appliance_manual'
  | 'strata_plan'
  | 'exclusive_use_plan'
  | 'strata_bylaw'
  | 'other';

export interface HistoricalMappingCandidate {
  id: string;
  sourceLabel: string;
  proposedAreaId?: string;
  proposedComponentId?: string;
  confidence?: number;
  status: 'suggested' | 'confirmed' | 'edited' | 'rejected';
  reviewerNote?: string;
}

export interface PropertyDocument {
  id: string;
  type: PropertyDocumentType;
  title: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  sha256?: string;
  objectPath?: string;
  generation?: string;
  source: 'proinspect' | 'legacy_upload' | 'external_system' | 'google_drive' | 'other';
  sourceSystem?: string;
  inspectionType?: InspectionReportType;
  inspectionDate?: string;
  tenancyId?: string;
  description?: string;
  uploadedBy?: string;
  uploadedAt: string;
  status: 'uploading' | 'active' | 'archived' | 'failed' | 'local_only';
  importStatus?: 'not_applicable' | 'uploaded' | 'analysis_pending' | 'review_required' | 'mapped' | 'rejected';
  mappingCandidates?: HistoricalMappingCandidate[];
  useAsBaseline?: boolean;
}

export interface PropertyAlert {
  id: string;
  type: 'access' | 'safety' | 'tenant' | 'strata' | 'maintenance' | 'general';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  active: boolean;
  createdAt: string;
}

export interface PropertyProfilePhoto {
  id: string;
  label: 'frontage' | 'street_view' | 'rear' | 'building_entry' | 'car_bay' | 'access_point' | 'other';
  documentId?: string;
  photoId?: string;
  caption?: string;
}

export interface PropertyOnboardingState {
  status: 'not_started' | 'in_progress' | 'ready_for_inspection';
  completedSteps: string[];
  missingItems?: string[];
  historicalImportStatus?: 'not_started' | 'in_progress' | 'complete' | 'not_required';
  updatedAt: string;
}

export interface PropertyRecord {
  id: string;
  agencyId: string;
  address: string;
  suburb?: string;
  state?: string;
  postcode?: string;

  /** Legacy propertyType remains for compatibility with existing reports and filters. */
  propertyType?:
    | 'house'
    | 'unit'
    | 'apartment'
    | 'townhouse'
    | 'villa'
    | 'commercial'
    | 'duplex'
    | 'other';
  propertyUse?: PropertyUse;
  physicalPropertyType?: PhysicalPropertyType;
  ownershipStructure?: OwnershipStructure;
  strataDetails?: StrataDetails;

  bedrooms?: number;
  bathrooms?: number;
  parking?: number;
  livingAreas?: number;

  roomsConfig?: RoomConfigItem[];
  layoutTemplateId?: string;
  layoutNodes?: PropertyLayoutNode[];
  currentLayoutVersionId?: string;
  layoutVersions?: PropertyLayoutVersion[];

  landlordDetails?: LandlordDetails;
  tenantDetails?: TenantDetails;
  ownershipHistory?: PropertyOwnershipRecord[];
  tenancyHistory?: PropertyTenancyRecord[];

  accessDetails?: AccessDetails;
  accessDevices?: PropertyAccessDevice[];
  features?: PropertyFeatures;
  assets?: PropertyAsset[];
  documents?: PropertyDocument[];
  profilePhotos?: PropertyProfilePhoto[];
  alerts?: PropertyAlert[];
  floorPlanDocumentIds?: string[];
  onboarding?: PropertyOnboardingState;

  notes?: string;
  clientIds: string[];
  googleDriveFolderId?: string;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Tenancy {
  id: string;
  agencyId: string;
  propertyId: string;
  tenantNames: string[];
  tenantEmails: string[];
  leaseStartDate?: string;
  leaseEndDate?: string;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface InspectionJob {
  id: string;
  agencyId: string;
  propertyId: string;
  tenancyId?: string;
  reportId?: string;
  reportType: InspectionReportType;
  scheduledAt?: string;
  assignedInspectorId?: string;
  assignedReviewerId?: string;
  status: InspectionJobStatus;
  workflowException?: WorkflowExceptionCode;
  googleDriveFolderId?: string;
  shopifyOrderId?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReportIndex {
  id: string;
  agencyId?: string;
  propertyId?: string;
  tenancyId?: string;
  inspectionJobId?: string;
  reportId: string;
  reportType: InspectionReportType | string;
  propertyAddress?: string;
  clientName?: string;
  tenantName?: string;
  inspectionDate?: string;
  lifecycleStatus: ReportLifecycleStatus;
  ownerUid?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  id: string;
  agencyId?: string;
  entityType:
    | 'agency'
    | 'user'
    | 'property'
    | 'property_layout'
    | 'property_document'
    | 'property_asset'
    | 'client'
    | 'tenancy'
    | 'inspection_job'
    | 'report'
    | 'area'
    | 'component'
    | 'photo'
    | 'template'
    | 'maintenance_candidate'
    | 'maintenance_item'
    | 'work_request'
    | 'tenant_instruction'
    | 'external_contact'
    | 'external_access_grant'
    | 'client_approval'
    | 'system';
  entityId: string;
  eventType: string;
  actorId?: string;
  actorRole?: UserRole;
  timestamp: string;
  metadata?: Record<string, unknown>;
}