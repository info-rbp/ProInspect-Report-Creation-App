import { buildAuditEvent } from '../services/platform/auditService';

describe('auditService', () => {
  it('creates audit events with ids and timestamps', () => {
    const event = buildAuditEvent({
      entityType: 'property',
      entityId: 'property-1',
      eventType: 'property_created',
    });

    expect(event.id).toBeTruthy();
    expect(event.timestamp).toBeTruthy();
    expect(event.entityType).toBe('property');
  });
});
