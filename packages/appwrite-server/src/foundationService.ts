import { randomUUID } from 'node:crypto';
import { apiManagedRowPermissions, assertNoClientWritePermission, type ReadScope } from './permissions.js';
import { APPWRITE_TABLES } from './repositories.js';
import type { StoredRow, TablesGateway } from './types.js';

export interface CreateServiceRequestCommand {
  agencyId: string;
  serviceDefinitionId: string;
  source: string;
  sourceReference: string;
  requestedByUserId: string;
  propertyId?: string;
  managedSiteId?: string;
  clientId?: string;
  notes?: string;
  correlationId: string;
  readScope: ReadScope;
}

export interface ServiceRequestRow extends StoredRow {
  agencyId: string;
  serviceDefinitionId: string;
  source: string;
  sourceReference: string;
  requestedByUserId: string;
  status: string;
  paymentStatus: string;
  schedulingStatus: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
}

export class AppwriteFoundationService {
  constructor(private readonly gateway: TablesGateway, private readonly now = () => new Date()) {}

  async createServiceRequest(command: CreateServiceRequestCommand): Promise<ServiceRequestRow> {
    const requestId = randomUUID();
    const auditId = randomUUID();
    const transactionId = await this.gateway.createTransaction();
    const permissions = apiManagedRowPermissions(command.readScope);
    assertNoClientWritePermission(permissions);
    const timestamp = this.now().toISOString();
    try {
      const request = await this.gateway.createRow<ServiceRequestRow>({
        tableId: APPWRITE_TABLES.serviceRequests,
        rowId: requestId,
        transactionId,
        permissions,
        data: {
          agencyId: command.agencyId,
          serviceDefinitionId: command.serviceDefinitionId,
          source: command.source,
          sourceReference: command.sourceReference,
          requestedByUserId: command.requestedByUserId,
          ...(command.propertyId ? { propertyId: command.propertyId } : {}),
          ...(command.managedSiteId ? { managedSiteId: command.managedSiteId } : {}),
          ...(command.clientId ? { clientId: command.clientId } : {}),
          ...(command.notes ? { notes: command.notes } : {}),
          status: 'received',
          paymentStatus: 'not_required',
          schedulingStatus: 'not_required',
          priority: 'normal',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      });
      await this.gateway.createRow({
        tableId: APPWRITE_TABLES.auditEvents,
        rowId: auditId,
        transactionId,
        permissions,
        data: {
          agencyId: command.agencyId,
          actorUserId: command.requestedByUserId,
          actorType: 'user',
          action: 'service_request.created',
          entityType: 'service_request',
          entityId: requestId,
          source: 'proinspect_api',
          status: 'recorded',
          newState: JSON.stringify({ status: request.status }),
          correlationId: command.correlationId,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      });
      await this.gateway.commitTransaction(transactionId);
      return request;
    } catch (error) {
      await this.gateway.rollbackTransaction(transactionId).catch(() => undefined);
      throw error;
    }
  }
}
