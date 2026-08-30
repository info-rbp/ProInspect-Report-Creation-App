const str = (key, size = 255, required = false, format) => ({ key, type: 'string', size, required, ...(format ? { format } : {}) });
const text = (key, required = false) => ({ key, type: 'longtext', required });
const datetime = (key, required = false) => ({ key, type: 'datetime', required });
const integer = (key, required = false) => ({ key, type: 'integer', required });
const number = (key, required = false) => ({ key, type: 'double', required });
const boolean = (key, required = false) => ({ key, type: 'boolean', required });
const index = (key, columns, orders) => ({ key, type: 'key', columns, ...(orders ? { orders } : {}) });
const unique = (key, columns) => ({ key, type: 'unique', columns });
const timestamps = [datetime('createdAt', true), datetime('updatedAt', true)];
const auditActors = [str('createdBy', 36), str('updatedBy', 36)];
const legacy = [str('legacySystem', 32), str('legacyId', 128)];
const agencyBase = [str('agencyId', 36, true), str('status', 64, true), ...timestamps, ...auditActors, ...legacy];
function table(id, columns, indexes = []) {
  return {
    $id: id,
    databaseId: 'proinspect_core',
    name: id.split('_').map((part) => part[0].toUpperCase() + part.slice(1)).join(' '),
    $permissions: [], rowSecurity: true, enabled: true,
    columns: [...new Map(columns.map((column) => [column.key, column])).values()],
    indexes,
  };
}
function agencyEntity(id, columns = [], indexes = []) {
  return table(id, [...agencyBase, ...columns], [index('agency_status', ['agencyId', 'status']), ...indexes]);
}

export const unifiedPlatformExtensionTables = [
  agencyEntity('portal_entitlements', [
    str('userId', 36, true), str('portalId', 32, true), str('sourceRole', 64, true),
    str('managedSiteId', 36), str('clientAccountId', 36), str('propertyId', 36),
    str('unitId', 36), str('contractorId', 36), datetime('validFrom'), datetime('validUntil'),
    text('permissions'), boolean('primary', true),
  ], [
    index('user_status', ['userId', 'status']), index('user_portal', ['userId', 'portalId']),
    index('site_portal', ['managedSiteId', 'portalId']), index('client_portal', ['clientAccountId', 'portalId']),
  ]),
  agencyEntity('contractor_compliance', [
    str('contractorId', 36, true), str('complianceType', 64, true), str('reference', 128),
    datetime('issuedAt'), datetime('expiresAt'), str('evidenceFileId', 36), str('complianceState', 32, true),
    str('verifiedBy', 36), datetime('verifiedAt'), str('overrideBy', 36), datetime('overrideUntil'),
    text('overrideReason'), text('requirements'),
  ], [
    index('contractor_state', ['contractorId', 'complianceState']), index('contractor_status', ['contractorId', 'status']),
    index('expiry_state', ['expiresAt', 'complianceState']), unique('contractor_type_ref', ['contractorId', 'complianceType', 'reference']),
  ]),
  agencyEntity('offer_partners', [
    str('name', 255, true), str('logoFileId', 36), str('contactName', 255),
    str('contactEmail', 320, false, 'email'), str('contactPhone', 64), str('agreementStatus', 32, true),
    datetime('agreementStartsAt'), datetime('agreementEndsAt'), text('privacyConfiguration'), text('commercialConfiguration'),
  ], [index('agreement_status', ['agreementStatus', 'status']), index('agency_name', ['agencyId', 'name'])]),
  agencyEntity('offers', [
    str('partnerId', 36, true), str('title', 255, true), text('description', true), str('category', 64, true),
    text('terms'), datetime('validFrom', true), datetime('validUntil', true), text('audienceRules', true),
    text('locationRules', true), str('redemptionType', 32, true), str('externalUrl', 1024),
    str('promoCode', 128), str('shopifyDiscountReference', 128), integer('redemptionLimit'),
  ], [index('partner_status', ['partnerId', 'status']), index('validity_status', ['validFrom', 'validUntil', 'status']), index('category_status', ['category', 'status'])]),
  agencyEntity('offer_redemptions', [
    str('offerId', 36, true), str('userId', 36, true), str('managedSiteId', 36), str('unitId', 36),
    str('redemptionToken', 255), datetime('redeemedAt'), datetime('expiresAt'), str('externalReference', 255),
    text('consentSnapshot'),
  ], [
    unique('offer_user_token', ['offerId', 'userId', 'redemptionToken']), index('user_status', ['userId', 'status']),
    index('offer_status', ['offerId', 'status']), index('site_status', ['managedSiteId', 'status']),
  ]),
  agencyEntity('conversations', [
    str('subject', 255, true), str('linkedEntityType', 64, true), str('linkedEntityId', 36, true),
    str('managedSiteId', 36), str('propertyId', 36), str('clientAccountId', 36), str('assignedUserId', 36),
    str('conversationState', 32, true), datetime('lastMessageAt'), datetime('resolvedAt'), str('resolvedBy', 36),
  ], [
    index('entity_state', ['linkedEntityType', 'linkedEntityId', 'conversationState']),
    index('assignee_state', ['assignedUserId', 'conversationState']), index('site_last_message', ['managedSiteId', 'lastMessageAt']),
    index('client_state', ['clientAccountId', 'conversationState']),
  ]),
  agencyEntity('conversation_participants', [
    str('conversationId', 36, true), str('participantType', 32, true), str('participantId', 36, true),
    str('role', 64), datetime('joinedAt'), datetime('leftAt'), datetime('lastReadAt'), boolean('canReply', true),
  ], [unique('conversation_participant', ['conversationId', 'participantType', 'participantId']), index('participant_status', ['participantId', 'status'])]),
  agencyEntity('conversation_messages', [
    str('conversationId', 36, true), str('senderType', 32, true), str('senderId', 36, true),
    str('channel', 32, true), text('body', true), text('attachmentFileIds'), str('providerMessageId', 255),
    str('deliveryStatus', 32), datetime('sentAt', true), datetime('deliveredAt'), datetime('readAt'),
  ], [index('conversation_sent', ['conversationId', 'sentAt']), index('delivery_status', ['deliveryStatus', 'sentAt'])]),
  agencyEntity('notification_preferences', [
    str('userId', 36, true), boolean('emailEnabled', true), boolean('smsEnabled', true), boolean('pushEnabled', true),
    str('quietHoursStart', 8), str('quietHoursEnd', 8), str('timezone', 64), boolean('urgentOverride', true),
    text('eventPreferences'),
  ], [unique('user_preference', ['agencyId', 'userId']), index('user_status', ['userId', 'status'])]),
  agencyEntity('appointment_availability', [
    str('userId', 36), str('managedSiteId', 36), str('serviceDefinitionId', 36), datetime('startAt', true),
    datetime('endAt', true), integer('capacity', true), integer('reserved', true), text('constraints'),
  ], [index('service_start', ['serviceDefinitionId', 'startAt']), index('user_start', ['userId', 'startAt']), index('site_start', ['managedSiteId', 'startAt']), index('site_status', ['managedSiteId', 'status'])]),
  agencyEntity('appointment_bookings', [
    str('serviceRequestId', 36, true), str('availabilityId', 36), str('propertyId', 36), str('managedSiteId', 36),
    str('requestedByUserId', 36), str('assignedUserId', 36), datetime('startAt', true), datetime('endAt', true),
    str('bookingState', 32, true), text('accessInstructions'), text('rescheduleHistory'),
  ], [
    index('request_state', ['serviceRequestId', 'bookingState']), index('assignee_start', ['assignedUserId', 'startAt']),
    index('property_start', ['propertyId', 'startAt']), index('site_status', ['managedSiteId', 'status']),
    index('requester_status', ['requestedByUserId', 'status']),
  ]),
  agencyEntity('route_plans', [
    str('assignedUserId', 36, true), datetime('routeDate', true), str('routeState', 32, true),
    str('originAddress', 512), str('destinationAddress', 512), number('estimatedDistanceKm'), integer('estimatedDurationMinutes'),
    datetime('publishedAt'), str('publishedBy', 36), text('optimisationMetadata'),
  ], [unique('user_route_date', ['assignedUserId', 'routeDate']), index('date_state', ['routeDate', 'routeState']), index('user_status', ['assignedUserId', 'status'])]),
  agencyEntity('route_plan_stops', [
    str('routePlanId', 36, true), str('inspectionJobId', 36), str('appointmentBookingId', 36),
    str('propertyId', 36), integer('sequence', true), datetime('plannedArrivalAt'), integer('travelMinutes'),
    number('distanceKm'), str('stopState', 32), datetime('actualArrivalAt'), datetime('departedAt'),
  ], [unique('route_sequence', ['routePlanId', 'sequence']), index('job_route', ['inspectionJobId', 'routePlanId']), index('route_status', ['routePlanId', 'status'])]),
  agencyEntity('offline_sync_receipts', [
    str('userId', 36, true), str('deviceId', 128, true), str('clientSubmissionId', 128, true),
    str('entityType', 64, true), str('entityId', 36), str('payloadHash', 128, true), str('syncState', 32, true),
    integer('attempts', true), datetime('firstReceivedAt', true), datetime('lastAttemptedAt'), datetime('completedAt'),
    text('conflictDetail'), text('errorDetail'),
  ], [unique('device_submission', ['deviceId', 'clientSubmissionId']), index('user_state', ['userId', 'syncState']), index('user_status', ['userId', 'status']), index('entity_state', ['entityType', 'entityId', 'syncState'])]),
];
