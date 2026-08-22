import {
  calculateInspectionReadiness,
  maintenanceSlaDueAt,
  rankInspectorAssignments,
  type AgencyOperationalSettings,
  type InspectionRequest,
  type InspectionServiceMapping,
  type InspectorCapabilityProfile,
  type MaintenancePolicySettings,
  type PropertyRecord,
  type QuoteApprovalPolicy,
} from '@pcr/domain';
import type { OperationalRepository, Page, StoredRecord } from '../backend/types.js';

const TERMINAL_JOB_STATUSES = new Set(['finalised', 'archived', 'cancelled']);

function record<T>(value: StoredRecord | undefined): T | undefined {
  return value as unknown as T | undefined;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function repositoryConflict(code: string, message: string): Error {
  return Object.assign(new Error(message), { status: 409, code });
}

async function listAll(
  repository: OperationalRepository,
  collection: string,
  agencyId: string,
): Promise<StoredRecord[]> {
  const items: StoredRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await repository.list(collection, agencyId, 100, cursor);
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

function maintenanceSlaKey(
  data: Record<string, unknown>,
): 'emergency' | 'urgent' | 'routine' | 'planned' {
  const safety = text(data.safetyClassification);
  if (safety === 'emergency') return 'emergency';
  const priority = text(data.priority);
  if (priority === 'urgent' || priority === 'high') return 'urgent';
  if (priority === 'monitor') return 'planned';
  return 'routine';
}

function mappedMaintenancePriority(value: unknown): 'urgent' | 'high' | 'routine' | 'monitor' {
  return value === 'urgent' || value === 'high' || value === 'monitor' ? value : 'routine';
}

function syntheticApprovalPolicy(
  agencyId: string,
  settings: StoredRecord & MaintenancePolicySettings,
): StoredRecord {
  const now = settings.updatedAt || settings.createdAt || new Date().toISOString();
  const policy: QuoteApprovalPolicy = {
    id: `agency-settings-maintenance-v${settings.version}`,
    agencyId,
    name: 'Agency maintenance policy',
    active: settings.status !== 'retired',
    propertyUses: [],
    ...(positiveNumber(settings.delegatedAuthorityLimit) !== undefined
      ? { propertyManagerDelegatedLimit: settings.delegatedAuthorityLimit }
      : {}),
    landlordApprovalThreshold:
      positiveNumber(settings.landlordApprovalThreshold) ??
      positiveNumber(settings.delegatedAuthorityLimit) ??
      0,
    ...(positiveNumber(settings.emergencyAuthorityLimit) !== undefined
      ? { emergencyAuthorisationLimit: settings.emergencyAuthorityLimit }
      : {}),
    mandatoryReplacementApproval: true,
    mandatoryCapitalApproval: true,
    mandatoryCosmeticApproval: true,
    autoApprovePreauthorisedServices: false,
    approvalLinkExpiryHours: Math.max(24, (positiveNumber(settings.quoteValidityDays) ?? 7) * 24),
    reminderHours: [24, 72, 120],
    createdBy: text(settings.createdBy) || 'system:agency-settings',
    createdAt: settings.createdAt || now,
    updatedAt: now,
    version: settings.version,
  };
  return policy as unknown as StoredRecord;
}

/**
 * Makes agency Settings operational instead of merely descriptive.
 *
 * Specialist workflows remain the source of truth for their own commands. This
 * decorator supplies agency policy where those workflows otherwise use generic
 * defaults, and records the exact Settings version applied to new records.
 */
export class SettingsAwareOperationalRepository implements OperationalRepository {
  constructor(private readonly delegate: OperationalRepository) {}

  private async operationalSettings(
    agencyId: string,
  ): Promise<(StoredRecord & AgencyOperationalSettings) | undefined> {
    return record<StoredRecord & AgencyOperationalSettings>(
      await this.delegate.get('agencySettings', agencyId, 'operational'),
    );
  }

  private async maintenanceSettings(
    agencyId: string,
  ): Promise<(StoredRecord & MaintenancePolicySettings) | undefined> {
    return record<StoredRecord & MaintenancePolicySettings>(
      await this.delegate.get('agencySettings', agencyId, 'maintenance'),
    );
  }

  private async serviceMappingFor(
    agencyId: string,
    request: InspectionRequest | undefined,
  ): Promise<InspectionServiceMapping | undefined> {
    if (!request?.serviceCode) return undefined;
    const mappings = await listAll(this.delegate, 'inspectionServiceMappings', agencyId);
    return mappings
      .map((item) => record<InspectionServiceMapping>(item))
      .find((item) => item?.active && item.serviceCode === request.serviceCode);
  }

  private async enrichInspectionJob(
    agencyId: string,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const settings = await this.operationalSettings(agencyId);
    if (!settings || settings.status === 'retired') return data;

    const reportType = text(data.reportType);
    const defaults = settings.inspectionDefaults?.find((item) => item.reportType === reportType);
    const request = text(data.inspectionRequestId)
      ? record<InspectionRequest>(
          await this.delegate.get('inspectionRequests', agencyId, text(data.inspectionRequestId)),
        )
      : undefined;
    const mapping = await this.serviceMappingFor(agencyId, request);

    const durationMinutes =
      positiveNumber(data.durationMinutes) ??
      positiveNumber(mapping?.defaultDurationMinutes) ??
      positiveNumber(defaults?.defaultDurationMinutes);
    const next: Record<string, unknown> = {
      ...data,
      operationalSettingsVersion: settings.version,
      ...(defaults
        ? {
            inspectionPolicySnapshot: {
              reportType: defaults.reportType,
              defaultDurationMinutes: defaults.defaultDurationMinutes,
              bookingBufferBeforeMinutes: defaults.bookingBufferBeforeMinutes,
              bookingBufferAfterMinutes: defaults.bookingBufferAfterMinutes,
              minimumNoticeHours: defaults.minimumNoticeHours,
              requirePayment: mapping?.paymentRequired ?? defaults.requirePayment,
              requireAccessConfirmation: defaults.requireAccessConfirmation,
              requireAnalystReview: defaults.requireAnalystReview,
              requireReviewerApproval: defaults.requireReviewerApproval,
              automaticAiAnalysis: defaults.automaticAiAnalysis,
              automaticPdfGeneration: defaults.automaticPdfGeneration,
              automaticIssueAfterApproval: defaults.automaticIssueAfterApproval,
              ...(defaults.reportCompletionSlaHours !== undefined
                ? { reportCompletionSlaHours: defaults.reportCompletionSlaHours }
                : {}),
              ...(defaults.reviewSlaHours !== undefined
                ? { reviewSlaHours: defaults.reviewSlaHours }
                : {}),
            },
          }
        : {}),
      ...(durationMinutes ? { durationMinutes } : {}),
      ...(!data.templateId && (mapping?.templateId || defaults?.templateId)
        ? { templateId: mapping?.templateId || defaults?.templateId }
        : {}),
    };

    if (durationMinutes && text(next.scheduledAt) && !text(next.scheduledEndAt)) {
      const start = Date.parse(text(next.scheduledAt));
      if (Number.isFinite(start)) {
        next.scheduledEndAt = new Date(start + durationMinutes * 60_000).toISOString();
      }
    }

    if (
      settings.automaticAssignmentEnabled &&
      settings.assignmentStrategy !== 'manual' &&
      !text(next.assignedInspectorId) &&
      !TERMINAL_JOB_STATUSES.has(text(next.status))
    ) {
      const [profiles, jobs, property] = await Promise.all([
        listAll(this.delegate, 'inspectorCapabilityProfiles', agencyId),
        listAll(this.delegate, 'inspectionJobs', agencyId),
        text(next.propertyId)
          ? this.delegate.get('properties', agencyId, text(next.propertyId))
          : Promise.resolve(undefined),
      ]);
      let candidates = rankInspectorAssignments(
        profiles
          .map((item) => record<InspectorCapabilityProfile>(item))
          .filter((item): item is InspectorCapabilityProfile => Boolean(item)),
        {
          reportType: reportType as never,
          propertyUse: record<PropertyRecord>(property)?.propertyUse,
          suburbOrPostcode: [
            record<PropertyRecord>(property)?.suburb,
            record<PropertyRecord>(property)?.postcode,
          ]
            .filter(Boolean)
            .join(' '),
          scheduledAt: text(next.scheduledAt) || undefined,
          jobs: jobs as never,
        },
      ).filter(
        (candidate) => candidate.capacityRemaining === undefined || candidate.capacityRemaining > 0,
      );

      if (settings.assignmentStrategy === 'workload' || settings.assignmentStrategy === 'round_robin') {
        candidates = [...candidates].sort(
          (left, right) =>
            left.currentDayJobs - right.currentDayJobs ||
            right.score - left.score ||
            left.userId.localeCompare(right.userId),
        );
      }
      const selected = candidates[0];
      if (selected && selected.score > 0) {
        next.assignedInspectorId = selected.userId;
        next.assignmentPolicy = {
          strategy: settings.assignmentStrategy,
          score: selected.score,
          reasons: selected.reasons,
          settingsVersion: settings.version,
          assignedAt: new Date().toISOString(),
        };
      }
    }

    const property = text(next.propertyId)
      ? record<PropertyRecord>(
          await this.delegate.get('properties', agencyId, text(next.propertyId)),
        )
      : undefined;
    const reviewerRequired = defaults?.requireReviewerApproval ?? true;
    const paymentRequired =
      mapping?.paymentRequired ?? defaults?.requirePayment ?? request?.source === 'shopify';
    const existingReadiness =
      next.readiness && typeof next.readiness === 'object'
        ? (next.readiness as Record<string, unknown>)
        : undefined;
    const existingGates =
      existingReadiness?.gates && typeof existingReadiness.gates === 'object'
        ? (existingReadiness.gates as Record<string, unknown>)
        : undefined;
    next.readiness = calculateInspectionReadiness({
      request,
      job: next as never,
      property,
      paymentRequired,
      bookingRequired: true,
      reviewerRequired,
      baselineRequired: reportType === 'Exit Inspection',
      entryBaselineAvailable:
        reportType !== 'Exit Inspection' || existingGates?.entryBaselineAvailable === true,
    });

    return next;
  }

  private async enrichMaintenanceItem(
    agencyId: string,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const settings = await this.maintenanceSettings(agencyId);
    if (!settings || settings.status === 'retired') return data;
    if (text(data.slaDueAt)) {
      return { ...data, maintenancePolicyVersion: settings.version };
    }
    const key = maintenanceSlaKey(data);
    const hours = positiveNumber(settings.responseSlaHours?.[key]);
    return {
      ...data,
      maintenancePolicyVersion: settings.version,
      slaDueAt: hours
        ? new Date(Date.now() + hours * 60 * 60_000).toISOString()
        : maintenanceSlaDueAt(mappedMaintenancePriority(data.priority)),
    };
  }

  async list(
    collection: string,
    agencyId: string,
    limit: number,
    cursor?: string,
  ): Promise<Page<StoredRecord>> {
    const page = await this.delegate.list(collection, agencyId, limit, cursor);
    if (collection !== 'quoteApprovalPolicies' || cursor || page.items.length > 0) return page;
    const settings = await this.maintenanceSettings(agencyId);
    if (!settings || settings.status === 'retired') return page;
    return { items: [syntheticApprovalPolicy(agencyId, settings)] };
  }

  async get(collection: string, agencyId: string, id: string): Promise<StoredRecord | undefined> {
    const existing = await this.delegate.get(collection, agencyId, id);
    if (
      existing ||
      collection !== 'quoteApprovalPolicies' ||
      !id.startsWith('agency-settings-maintenance-v')
    ) {
      return existing;
    }
    const settings = await this.maintenanceSettings(agencyId);
    return settings && settings.status !== 'retired'
      ? syntheticApprovalPolicy(agencyId, settings)
      : undefined;
  }

  async create(
    collection: string,
    agencyId: string,
    id: string,
    data: Record<string, unknown>,
    actorId: string,
  ): Promise<StoredRecord> {
    let next = data;
    if (collection === 'inspectionJobs') next = await this.enrichInspectionJob(agencyId, next);
    if (collection === 'maintenanceItems') next = await this.enrichMaintenanceItem(agencyId, next);
    if (
      collection === 'reportPresentationTemplateVersions' &&
      text(next.status) !== 'draft'
    ) {
      throw repositoryConflict(
        'PRESENTATION_TEMPLATE_DRAFT_REQUIRED',
        'New report presentation templates must be created as drafts and published through the lifecycle command.',
      );
    }
    return this.delegate.create(collection, agencyId, id, next, actorId);
  }

  async update(
    collection: string,
    agencyId: string,
    id: string,
    data: Record<string, unknown>,
    expectedVersion: number,
    actorId: string,
  ): Promise<StoredRecord> {
    let next = data;
    if (collection === 'maintenanceItems') {
      const current = await this.delegate.get(collection, agencyId, id);
      next = await this.enrichMaintenanceItem(agencyId, { ...(current || {}), ...data });
      for (const key of [
        'id',
        'agencyId',
        'version',
        'createdAt',
        'updatedAt',
        'createdBy',
        'updatedBy',
      ]) {
        delete next[key];
      }
    }
    if (collection === 'reportPresentationTemplateVersions') {
      const current = await this.delegate.get(collection, agencyId, id);
      if (!current) {
        throw Object.assign(new Error('Report presentation template was not found.'), {
          status: 404,
          code: 'PRESENTATION_TEMPLATE_NOT_FOUND',
        });
      }
      const currentStatus = text(current.status);
      const nextStatus = text(next.status) || currentStatus;
      const publishing = currentStatus === 'draft' && nextStatus === 'published';
      const retiring = currentStatus === 'published' && nextStatus === 'retired';
      if (currentStatus === 'retired') {
        throw repositoryConflict(
          'PRESENTATION_TEMPLATE_IMMUTABLE',
          'Retired report presentation template versions are immutable. Create a new draft version instead.',
        );
      }
      if (currentStatus === 'published' && !retiring) {
        throw repositoryConflict(
          'PRESENTATION_TEMPLATE_IMMUTABLE',
          'Published report presentation template versions are immutable. Create a new draft version instead.',
        );
      }
      if (nextStatus !== currentStatus && !publishing && !retiring) {
        throw repositoryConflict(
          'PRESENTATION_TEMPLATE_LIFECYCLE_INVALID',
          'Report presentation lifecycle changes must use draft to published or published to retired transitions.',
        );
      }
    }
    return this.delegate.update(collection, agencyId, id, next, expectedVersion, actorId);
  }
}
