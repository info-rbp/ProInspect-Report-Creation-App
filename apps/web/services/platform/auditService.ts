import type { AuditEvent } from '../../types/platform';
import { apiRequest } from '../apiClient';
import { auth, isFirebaseConfigured } from '../storageService';
import { localList, localPut } from './localPlatformStore';

const generateAuditId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Math.random().toString(36).slice(2, 11);
};

export const buildAuditEvent = (event: Omit<AuditEvent, 'id' | 'timestamp'>): AuditEvent => ({
  ...event,
  id: generateAuditId(),
  actorId: event.actorId || auth?.currentUser?.uid,
  timestamp: new Date().toISOString(),
});

export const logAuditEvent = async (event: Omit<AuditEvent, 'id' | 'timestamp'>): Promise<AuditEvent> => {
  const auditEvent = buildAuditEvent(event);
  if (isFirebaseConfigured()) {
    console.debug('[client-diagnostic]', auditEvent.eventType, auditEvent.entityType, auditEvent.entityId);
    return auditEvent;
  }
  console.info('[audit-local]', auditEvent);
  return localPut('auditEvents', auditEvent);
};

export const listAuditEventsForEntity = async (
  entityType: AuditEvent['entityType'],
  entityId: string,
): Promise<AuditEvent[]> => {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      const events = await apiRequest<AuditEvent[]>(undefined, '/api/v1/audit-history?limit=100');
      return events
        .filter((event) => event.entityType === entityType && event.entityId === entityId)
        .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());
    } catch (err) {
      console.warn('API listAuditEventsForEntity failed, getting from local store:', err);
    }
  }
  const events = await localList<AuditEvent>('auditEvents');
  return events
    .filter((event) => event.entityType === entityType && event.entityId === entityId)
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());
};
