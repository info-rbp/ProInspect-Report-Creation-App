import type {
  AccessDeviceCustodyEvent,
  AccessDeviceRegisterItem,
  CommunicationMessage,
  CommunicationThread,
  ComplianceAssessment,
  ComplianceObligation,
  DocumentPacket,
  InspectionRoutePlan,
  JurisdictionPolicyVersion,
  PmsConnection,
  RemoteInspectionAssignment,
} from '@pcr/domain';
import { apiRequest } from '../apiClient';

type ApiInit = { method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown; idempotencyKey?: string };
function agencyId(): string | undefined { if (typeof window === 'undefined') return 'agency-1'; return window.localStorage.getItem('pcr_agency_id') || window.localStorage.getItem('agencyId') || 'agency-1'; }
const call = <T>(path: string, init: ApiInit = {}) => apiRequest<T>(agencyId(), path, init);

export const listJurisdictionPolicies = () => call<JurisdictionPolicyVersion[]>('/api/v1/jurisdiction-policies');
export const createJurisdictionPolicy = (input: Partial<JurisdictionPolicyVersion>) => call<JurisdictionPolicyVersion>('/api/v1/jurisdiction-policies', { method: 'POST', body: input });
export const listDocumentPackets = () => call<DocumentPacket[]>('/api/v1/document-packets');
export const createDocumentPacket = (input: Partial<DocumentPacket>) => call<DocumentPacket>('/api/v1/document-packets', { method: 'POST', body: input });
export const renderDocumentPacket = (packet: DocumentPacket, renderRequests: Array<Record<string, unknown>>) => call<DocumentPacket>(`/api/v1/document-packets/${encodeURIComponent(packet.id)}/render`, { method: 'POST', body: { renderRequests } });
export const validateDocumentPacket = (packet: DocumentPacket) => call<DocumentPacket>(`/api/v1/document-packets/${encodeURIComponent(packet.id)}/validate`, { method: 'POST', body: {} });
export const approveDocumentPacket = (packet: DocumentPacket) => call<DocumentPacket>(`/api/v1/document-packets/${encodeURIComponent(packet.id)}/approve`, { method: 'POST', body: { expectedVersion: packet.version } });
export const issueDocumentPacket = (packet: DocumentPacket) => call<DocumentPacket>(`/api/v1/document-packets/${encodeURIComponent(packet.id)}/issue`, { method: 'POST', body: { expectedVersion: packet.version } });
export const listRoutePlans = () => call<InspectionRoutePlan[]>('/api/v1/inspection-route-plans');
export const createRoutePlan = (input: Partial<InspectionRoutePlan>) => call<InspectionRoutePlan>('/api/v1/inspection-route-plans', { method: 'POST', body: input });
export const optimiseRoutePlan = (plan: InspectionRoutePlan) => call<InspectionRoutePlan>(`/api/v1/inspection-route-plans/${encodeURIComponent(plan.id)}/optimise`, { method: 'POST', body: {} });
export const publishRoutePlan = (plan: InspectionRoutePlan) => call<InspectionRoutePlan>(`/api/v1/inspection-route-plans/${encodeURIComponent(plan.id)}/publish`, { method: 'POST', body: { expectedVersion: plan.version } });
export const listCommunicationThreads = () => call<CommunicationThread[]>('/api/v1/communication-threads');
export const createCommunicationThread = (input: Partial<CommunicationThread>) => call<CommunicationThread>('/api/v1/communication-threads', { method: 'POST', body: input });
export const listCommunicationMessages = () => call<CommunicationMessage[]>('/api/v1/communication-messages');
export const sendThreadMessage = (threadId: string, input: { channel: 'email' | 'sms' | 'portal'; recipients: string[]; subject?: string; body: string }) => call<CommunicationMessage>(`/api/v1/communication-threads/${encodeURIComponent(threadId)}/messages`, { method: 'POST', body: input });
export const listComplianceObligations = () => call<ComplianceObligation[]>('/api/v1/compliance-obligations');
export const assessCompliance = (entityType: string, entityId: string) => call<ComplianceAssessment>(`/api/v1/compliance-assessments/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`);
export const listKeyRegister = () => call<AccessDeviceRegisterItem[]>('/api/v1/key-register');
export const createKeyRegisterItem = (input: Partial<AccessDeviceRegisterItem>) => call<AccessDeviceRegisterItem>('/api/v1/key-register', { method: 'POST', body: input });
export const createKeyEvent = (itemId: string, input: { eventType: string; inspectionJobId?: string; toHolderId?: string; notes?: string }) => call<{ item: AccessDeviceRegisterItem; event: AccessDeviceCustodyEvent }>(`/api/v1/key-register/${encodeURIComponent(itemId)}/events`, { method: 'POST', body: input });
export const listPmsConnections = () => call<PmsConnection[]>('/api/v1/pms-connections');
export const createPmsConnection = (input: Partial<PmsConnection>) => call<PmsConnection>('/api/v1/pms-connections', { method: 'POST', body: input });
export const runPmsSync = (connectionId: string, input: { direction: 'import' | 'publish'; resource: string; entityId?: string }) => call<Record<string, unknown>>(`/api/v1/pms-connections/${encodeURIComponent(connectionId)}/sync`, { method: 'POST', body: input });
export const listRemoteInspectionAssignments = () => call<RemoteInspectionAssignment[]>('/api/v1/remote-inspection-assignments');
export const createRemoteInspectionAssignment = (input: Partial<RemoteInspectionAssignment>) => call<RemoteInspectionAssignment>('/api/v1/remote-inspection-assignments', { method: 'POST', body: input });
