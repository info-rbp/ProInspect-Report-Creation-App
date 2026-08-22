import { describe, expect, it } from 'vitest';
import {
  evaluateClientOnboarding,
  findClientDuplicateCandidates,
  resolveClientSnapshot,
  resolveMaintenanceApprovalRecipient,
  type ClientAccount,
  type ClientContact,
  type ClientEngagement,
  type PropertyClientRelationship,
} from '../src/index.js';

const now = '2026-08-22T00:00:00.000Z';

const agency: ClientAccount = {
  id: 'client-agency',
  agencyId: 'agency-a',
  legalName: 'Example Property Management Pty Ltd',
  tradingName: 'Example Property Management',
  clientType: 'property_management_firm',
  entityType: 'property_management_agency',
  abn: '12 345 678 901',
  generalEmail: 'office@examplepm.test',
  primaryContactId: 'contact-pm',
  billingProfile: { method: 'monthly_consolidated_invoice', invoiceRecipientEmail: 'accounts@examplepm.test' },
  maintenancePolicy: {
    propertyManagerApprovalLimit: 500,
    landlordApprovalThreshold: 500,
    emergencyAuthorisationLimit: 1500,
    quoteContactId: 'contact-owner',
    ownerApprovalContactId: 'contact-owner',
  },
  status: 'active',
  createdAt: now,
  updatedAt: now,
};

const contacts: ClientContact[] = [
  {
    id: 'contact-pm', agencyId: 'agency-a', clientAccountId: agency.id, displayName: 'Sarah Manager',
    email: 'sarah@examplepm.test', roles: ['property_manager'], isPrimary: true, receivesReports: true,
    receivesMaintenance: true, canApproveMaintenance: true, approvalLimit: 500, status: 'active', createdAt: now, updatedAt: now,
  },
  {
    id: 'contact-owner', agencyId: 'agency-a', clientAccountId: agency.id, displayName: 'Olivia Owner',
    email: 'owner@example.test', roles: ['owner_landlord'], isPrimary: false, receivesReports: true,
    receivesMaintenance: true, canApproveMaintenance: true, status: 'active', createdAt: now, updatedAt: now,
  },
];

const relationships: PropertyClientRelationship[] = [
  {
    id: 'relationship-agent', agencyId: 'agency-a', propertyId: 'property-1', clientAccountId: agency.id,
    relationshipType: 'managing_agent', primaryContactId: 'contact-pm', isCurrent: true,
    propertyManagerApprovalLimit: 500, createdAt: now, updatedAt: now,
  },
  {
    id: 'relationship-maintenance', agencyId: 'agency-a', propertyId: 'property-1', clientAccountId: agency.id,
    relationshipType: 'maintenance_authority', primaryContactId: 'contact-owner', isCurrent: true,
    createdAt: now, updatedAt: now,
  },
];

const engagement: ClientEngagement = {
  id: 'engagement-1', agencyId: 'agency-a', clientAccountId: agency.id, name: 'Portfolio Agreement',
  status: 'active', effectiveFrom: '2026-01-01', services: [{ serviceCode: 'routine_inspection', active: true }],
  createdAt: now, updatedAt: now,
};

describe('Client management domain', () => {
  it('requires identity, a primary contact and commercial terms before activation', () => {
    const incomplete = evaluateClientOnboarding({ legalName: 'New Client', clientType: 'private_landlord', entityType: 'individual' }, [], []);
    expect(incomplete.readyForActivation).toBe(false);
    expect(incomplete.blockers).toContain('Add a primary client contact with an email address or telephone number.');
    expect(incomplete.blockers).toContain('Select how this client is billed.');

    const complete = evaluateClientOnboarding(agency, contacts, [engagement]);
    expect(complete.readyForActivation).toBe(true);
    expect(complete.completedSteps).toContain('identity');
    expect(complete.completedSteps).toContain('contacts');
    expect(complete.completedSteps).toContain('billing');
  });

  it('raises strong duplicate candidates from authoritative business identifiers', () => {
    const matches = findClientDuplicateCandidates({ legalName: 'Example Property Management', abn: '12345678901' }, [agency]);
    expect(matches[0]).toMatchObject({ clientAccountId: agency.id });
    expect(matches[0]?.score).toBeGreaterThanOrEqual(0.65);
    expect(matches[0]?.reasons).toContain('ABN matches');
  });

  it('resolves the current Property Client snapshot and report recipients without accounting-provider metadata', () => {
    const snapshot = resolveClientSnapshot({
      propertyId: 'property-1', accounts: [agency], contacts, relationships, engagements: [engagement], capturedAt: now,
    });
    expect(snapshot).toBeDefined();
    expect(snapshot).toMatchObject({
      clientAccountId: agency.id,
      engagementId: engagement.id,
      clientName: 'Example Property Management',
      propertyManager: { contactId: 'contact-pm', name: 'Sarah Manager' },
      maintenanceApprover: { contactId: 'contact-owner', name: 'Olivia Owner' },
    });
    expect(snapshot?.reportRecipients.map((recipient) => recipient.contactId)).toContain('contact-pm');
  });

  it('uses delegated authority for small work and escalates larger work', () => {
    const snapshot = resolveClientSnapshot({ propertyId: 'property-1', accounts: [agency], contacts, relationships, engagements: [engagement], capturedAt: now });
    if (!snapshot) throw new Error('snapshot missing');
    const delegated = resolveMaintenanceApprovalRecipient({ snapshot, account: agency, amount: 350, relationshipApprovalLimit: 500 });
    expect(delegated.recipientType).toBe('property_manager');
    expect(delegated.recipient?.contactId).toBe('contact-pm');

    const escalated = resolveMaintenanceApprovalRecipient({ snapshot, account: agency, amount: 750, relationshipApprovalLimit: 500 });
    expect(escalated.recipientType).toBe('landlord');
    expect(escalated.recipient?.contactId).toBe('contact-owner');
  });

  it('uses emergency authority only within the configured limit', () => {
    const snapshot = resolveClientSnapshot({ propertyId: 'property-1', accounts: [agency], contacts, relationships, capturedAt: now });
    if (!snapshot) throw new Error('snapshot missing');
    const allowed = resolveMaintenanceApprovalRecipient({ snapshot, account: agency, amount: 1200, emergency: true, relationshipEmergencyLimit: 1500 });
    expect(allowed.recipientType).toBe('property_manager');
    const escalated = resolveMaintenanceApprovalRecipient({ snapshot, account: agency, amount: 1800, emergency: true, relationshipEmergencyLimit: 1500 });
    expect(escalated.recipientType).toBe('landlord');
  });
});
