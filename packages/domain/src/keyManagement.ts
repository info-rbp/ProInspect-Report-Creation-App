export type KeyCustodyEventType = 'created' | 'checked_out' | 'transferred' | 'returned' | 'lost' | 'replaced' | 'deactivated';

export interface AccessDeviceCustodyEvent {
  id: string;
  agencyId: string;
  accessDeviceId: string;
  propertyId: string;
  inspectionJobId?: string;
  eventType: KeyCustodyEventType;
  fromHolderId?: string;
  toHolderId?: string;
  notes?: string;
  occurredAt: string;
  actorId: string;
  createdAt: string;
}

export interface AccessDeviceRegisterItem {
  id: string;
  agencyId: string;
  propertyId: string;
  label: string;
  kind: 'key' | 'fob' | 'remote' | 'access_card' | 'other';
  status: 'available' | 'checked_out' | 'lost' | 'replaced' | 'deactivated';
  currentHolderId?: string;
  currentInspectionJobId?: string;
  lastEventAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}
