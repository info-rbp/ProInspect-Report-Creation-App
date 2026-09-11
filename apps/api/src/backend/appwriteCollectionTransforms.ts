import type { StoredRecord } from './types.js';

function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function definedEntries(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function integrationConnectionWrite(input: Record<string, unknown>): Record<string, unknown> {
  const {
    externalAccountLabel,
    permissions,
    configuration,
    lastSuccessfulSyncAt,
    lastAttemptedSyncAt,
    lastErrorCode,
    lastErrorMessage,
    syncRequestedAt,
    ...rest
  } = input;
  const configurationProvided = configuration !== undefined || externalAccountLabel !== undefined || permissions !== undefined || syncRequestedAt !== undefined;
  const metadata = configurationProvided
    ? {
        ...(configuration && typeof configuration === 'object' && !Array.isArray(configuration)
          ? configuration as Record<string, unknown>
          : {}),
        ...(externalAccountLabel !== undefined ? { __externalAccountLabel: externalAccountLabel } : {}),
        ...(permissions !== undefined ? { __permissions: permissions } : {}),
        ...(syncRequestedAt !== undefined ? { __syncRequestedAt: syncRequestedAt } : {}),
      }
    : undefined;
  const errorProvided = lastErrorCode !== undefined || lastErrorMessage !== undefined;
  return definedEntries({
    ...rest,
    ...(configurationProvided ? { configuration: JSON.stringify(metadata) } : {}),
    ...(lastSuccessfulSyncAt !== undefined ? { lastSuccessfulAt: lastSuccessfulSyncAt } : {}),
    ...(lastAttemptedSyncAt !== undefined || syncRequestedAt !== undefined
      ? { lastAttemptedAt: lastAttemptedSyncAt ?? syncRequestedAt }
      : {}),
    ...(errorProvided
      ? { lastError: lastErrorCode === null && lastErrorMessage === null ? null : JSON.stringify({ code: lastErrorCode, message: lastErrorMessage }) }
      : {}),
  });
}

function integrationConnectionRead(value: StoredRecord): StoredRecord {
  const metadata = parseObject(value.configuration);
  const error = parseObject(value.lastError);
  const { __externalAccountLabel, __permissions, __syncRequestedAt, ...configuration } = metadata;
  return {
    ...value,
    configuration,
    ...(__externalAccountLabel !== undefined ? { externalAccountLabel: __externalAccountLabel } : {}),
    permissions: Array.isArray(__permissions) ? __permissions : [],
    ...(value.lastSuccessfulAt ? { lastSuccessfulSyncAt: value.lastSuccessfulAt } : {}),
    ...(value.lastAttemptedAt ? { lastAttemptedSyncAt: value.lastAttemptedAt } : {}),
    ...(__syncRequestedAt ? { syncRequestedAt: __syncRequestedAt } : {}),
    ...(error.code !== undefined ? { lastErrorCode: error.code } : {}),
    ...(error.message !== undefined ? { lastErrorMessage: error.message } : {}),
  };
}

function inspectionRequestWrite(input: Record<string, unknown>): Record<string, unknown> {
  const {
    sourceExternalId,
    bookingStatus,
    reportType,
    shopifyOrder,
    googleCalendar,
    ...rest
  } = input;
  const allowed = new Set([
    'serviceRequestId', 'propertyId', 'inspectionType', 'source', 'sourceReference',
    'paymentStatus', 'schedulingStatus', 'priority', 'shopifyReference', 'calendarReference',
    'status', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'legacySystem', 'legacyId',
  ]);
  const compact = Object.fromEntries(Object.entries(rest).filter(([key]) => allowed.has(key)));
  const domainSnapshot = definedEntries({ ...input, shopifyOrder, googleCalendar });
  return definedEntries({
    ...compact,
    sourceReference: sourceExternalId ?? input.sourceReference,
    schedulingStatus: bookingStatus ?? input.schedulingStatus,
    inspectionType: reportType ?? input.inspectionType,
    ...(shopifyOrder || input.source === 'shopify' ? { shopifyReference: JSON.stringify(domainSnapshot) } : {}),
    ...(googleCalendar || input.source === 'google_calendar' ? { calendarReference: JSON.stringify(domainSnapshot) } : {}),
  });
}

function inspectionRequestRead(value: StoredRecord): StoredRecord {
  const snapshot = value.source === 'shopify'
    ? parseObject(value.shopifyReference)
    : value.source === 'google_calendar'
      ? parseObject(value.calendarReference)
      : {};
  return {
    ...value,
    ...snapshot,
    sourceExternalId: snapshot.sourceExternalId ?? value.sourceReference,
    bookingStatus: snapshot.bookingStatus ?? value.schedulingStatus,
    reportType: snapshot.reportType ?? value.inspectionType,
  };
}

function integrationDeliveryWrite(input: Record<string, unknown>): Record<string, unknown> {
  const metadata = definedEntries({
    topic: input.topic,
    payloadHash: input.payloadHash,
    inspectionRequestId: input.inspectionRequestId,
    inspectionJobId: input.inspectionJobId,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    receivedAt: input.receivedAt,
    processedAt: input.processedAt,
  });
  const status = input.status ?? input.deliveryStatus;
  const attemptedAt = input.processedAt ?? input.receivedAt ?? input.lastAttemptedAt;
  return definedEntries({
    provider: input.provider,
    eventId: input.externalEventId ?? input.eventId,
    externalDeliveryId: input.externalDeliveryId,
    deliveryStatus: status,
    attempts: input.attempts ?? 1,
    lastAttemptedAt: attemptedAt,
    deliveredAt: ['processed', 'ignored', 'duplicate'].includes(String(status)) ? input.processedAt ?? attemptedAt : input.deliveredAt,
    errorState: JSON.stringify(metadata),
    status: input.status === 'active' ? 'active' : undefined,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    createdBy: input.createdBy,
    updatedBy: input.updatedBy,
  });
}

function integrationDeliveryRead(value: StoredRecord): StoredRecord {
  const metadata = parseObject(value.errorState);
  return {
    ...value,
    ...metadata,
    externalEventId: metadata.externalEventId ?? value.eventId,
    status: value.deliveryStatus ?? value.status,
    processedAt: metadata.processedAt ?? value.deliveredAt,
    receivedAt: metadata.receivedAt ?? value.createdAt,
  };
}

function serviceMappingWrite(input: Record<string, unknown>): Record<string, unknown> {
  const config = definedEntries({
    provider: input.provider ?? 'shopify',
    serviceCode: input.serviceCode,
    label: input.label,
    productId: input.productId,
    variantId: input.variantId,
    productHandle: input.productHandle,
    sku: input.sku,
    reportType: input.reportType,
    propertyUse: input.propertyUse,
    defaultDurationMinutes: input.defaultDurationMinutes,
    paymentRequired: input.paymentRequired,
    manualApprovalRequired: input.manualApprovalRequired,
    defaultPriority: input.defaultPriority,
    defaultInspectorId: input.defaultInspectorId,
    defaultReviewerId: input.defaultReviewerId,
    templateId: input.templateId,
  });
  return definedEntries({
    shopDomain: input.shopDomain,
    shopifyProductId: input.shopifyProductId ?? input.productId,
    shopifyVariantId: input.shopifyVariantId ?? input.variantId,
    serviceDefinitionId: input.serviceDefinitionId,
    active: input.active,
    mappingConfiguration: JSON.stringify(config),
    status: input.status,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    createdBy: input.createdBy,
    updatedBy: input.updatedBy,
  });
}

function serviceMappingRead(value: StoredRecord): StoredRecord {
  const config = parseObject(value.mappingConfiguration);
  return {
    ...value,
    ...config,
    provider: config.provider ?? 'shopify',
    productId: config.productId ?? value.shopifyProductId,
    variantId: config.variantId ?? value.shopifyVariantId,
  };
}

export function appwriteCollectionWriteData(
  collection: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (collection === 'integrationConnections') return integrationConnectionWrite(input);
  if (collection === 'integrationDeliveries') return integrationDeliveryWrite(input);
  if (collection === 'inspectionRequests') return inspectionRequestWrite(input);
  if (collection === 'inspectionServiceMappings' || collection === 'shopifyServiceMappings') return serviceMappingWrite(input);
  return input;
}

export function appwriteCollectionReadData(
  collection: string,
  value: StoredRecord,
): StoredRecord {
  if (collection === 'integrationConnections') return integrationConnectionRead(value);
  if (collection === 'integrationDeliveries') return integrationDeliveryRead(value);
  if (collection === 'inspectionRequests') return inspectionRequestRead(value);
  if (collection === 'inspectionServiceMappings' || collection === 'shopifyServiceMappings') return serviceMappingRead(value);
  return value;
}
