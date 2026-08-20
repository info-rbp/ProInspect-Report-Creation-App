import { randomUUID } from 'node:crypto';
import type {
  Client,
  ExternalContact,
  MaintenanceQuote,
  MaintenanceQuoteVersion,
  MaintenanceWorkOrder,
  XeroConnection,
  XeroSyncException,
} from '@pcr/domain';
import type { ApiDependencies, StoredRecord } from '../backend/types.js';
import {
  loadIntegrationCredentials,
  saveIntegrationCredentials,
} from './integrationCredentialStore.js';

const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
const XERO_AUTHORISE_URL = 'https://login.xero.com/identity/connect/authorize';
const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections';
const XERO_ACCOUNTING_BASE = 'https://api.xero.com/api.xro/2.0';

export interface XeroTokenCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType: string;
  scope: string;
  clientId?: string;
  clientSecret?: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

interface XeroTenantConnection {
  id: string;
  tenantId: string;
  tenantType: string;
  tenantName?: string;
  createdDateUtc?: string;
  updatedDateUtc?: string;
}

function now(): string {
  return new Date().toISOString();
}

function xeroClientId(): string {
  const value = process.env.XERO_CLIENT_ID?.trim();
  if (!value) throw new Error('XERO_CLIENT_ID is required.');
  return value;
}

function xeroClientSecret(): string {
  const value = process.env.XERO_CLIENT_SECRET?.trim();
  if (!value) throw new Error('XERO_CLIENT_SECRET is required.');
  return value;
}

export function xeroRedirectUri(): string {
  const value = process.env.XERO_REDIRECT_URI?.trim();
  if (!value) throw new Error('XERO_REDIRECT_URI is required.');
  return value;
}

export function xeroScopes(): string[] {
  const configured = process.env.XERO_SCOPES?.trim();
  return (configured || 'openid profile email offline_access accounting.transactions accounting.contacts accounting.settings')
    .split(/\s+/u)
    .filter(Boolean);
}

export function xeroAuthorisationUrl(state: string): string {
  const url = new URL(XERO_AUTHORISE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', xeroClientId());
  url.searchParams.set('redirect_uri', xeroRedirectUri());
  url.searchParams.set('scope', xeroScopes().join(' '));
  url.searchParams.set('state', state);
  return url.toString();
}

async function tokenRequest(body: URLSearchParams, clientId = xeroClientId(), clientSecret = xeroClientSecret()): Promise<TokenResponse> {
  const response = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body,
  });
  const payload = (await response.json().catch(() => ({}))) as TokenResponse & {
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || `Xero token request failed with ${response.status}.`);
  }
  return payload;
}

export async function exchangeXeroCode(code: string): Promise<XeroTokenCredentials> {
  const token = await tokenRequest(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: xeroRedirectUri(),
    }),
  );
  return {
    accessToken: token.access_token,
    ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
    expiresAt: Date.now() + Math.max(30, Number(token.expires_in || 1800) - 60) * 1000,
    tokenType: token.token_type || 'Bearer',
    scope: token.scope || xeroScopes().join(' '),
  };
}

export async function customConnectionToken(
  clientId: string,
  clientSecret: string,
  scopes: string[],
): Promise<XeroTokenCredentials> {
  const token = await tokenRequest(
    new URLSearchParams({
      grant_type: 'client_credentials',
      scope: scopes.join(' '),
    }),
    clientId,
    clientSecret,
  );
  return {
    accessToken: token.access_token,
    expiresAt: Date.now() + Math.max(30, Number(token.expires_in || 1800) - 60) * 1000,
    tokenType: token.token_type || 'Bearer',
    scope: token.scope || scopes.join(' '),
    clientId,
    clientSecret,
  };
}

async function refreshXeroToken(credentials: XeroTokenCredentials): Promise<XeroTokenCredentials> {
  if (credentials.clientId && credentials.clientSecret && !credentials.refreshToken) {
    return customConnectionToken(
      credentials.clientId,
      credentials.clientSecret,
      credentials.scope.split(/\s+/u).filter(Boolean),
    );
  }
  if (!credentials.refreshToken) throw new Error('Xero refresh token is unavailable. Reconnect Xero.');
  const token = await tokenRequest(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: credentials.refreshToken,
    }),
  );
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token || credentials.refreshToken,
    expiresAt: Date.now() + Math.max(30, Number(token.expires_in || 1800) - 60) * 1000,
    tokenType: token.token_type || 'Bearer',
    scope: token.scope || credentials.scope,
  };
}

async function validCredentials(
  dependencies: ApiDependencies,
  connection: XeroConnection,
  actorId: string,
): Promise<XeroTokenCredentials> {
  const credentials = await loadIntegrationCredentials<XeroTokenCredentials>(
    dependencies,
    connection.agencyId,
    connection.id,
  );
  if (!credentials) throw new Error('Encrypted Xero credentials are unavailable.');
  if (credentials.expiresAt > Date.now()) return credentials;
  const refreshed = await refreshXeroToken(credentials);
  await saveIntegrationCredentials(dependencies, {
    agencyId: connection.agencyId,
    connectionId: connection.id,
    provider: 'xero',
    credentials: refreshed,
    actorId,
  });
  return refreshed;
}

async function connectionRecord(
  dependencies: ApiDependencies,
  agencyId: string,
): Promise<(XeroConnection & { version: number }) | undefined> {
  const page = await dependencies.repository.list('xeroConnections', agencyId, 10);
  return page.items.find((item) => item.status !== 'disconnected') as unknown as
    | (XeroConnection & { version: number })
    | undefined;
}

export async function listXeroTenants(accessToken: string): Promise<XeroTenantConnection[]> {
  const response = await fetch(XERO_CONNECTIONS_URL, {
    headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
  });
  const payload = (await response.json().catch(() => [])) as XeroTenantConnection[];
  if (!response.ok) throw new Error(`Xero connections request failed with ${response.status}.`);
  return payload;
}

export async function saveXeroConnection(
  dependencies: ApiDependencies,
  input: {
    agencyId: string;
    actorId: string;
    credentials: XeroTokenCredentials;
    tenantId: string;
    tenantName?: string;
    connectionType: XeroConnection['connectionType'];
    salesAccountCode?: string;
    purchaseAccountCode?: string;
    defaultTaxType?: string;
  },
): Promise<XeroConnection> {
  const existing = await connectionRecord(dependencies, input.agencyId);
  const id = existing?.id || 'xero-primary';
  const data = {
    status: 'connected',
    tenantId: input.tenantId,
    ...(input.tenantName ? { tenantName: input.tenantName } : {}),
    credentialReference: id,
    scopes: input.credentials.scope.split(/\s+/u).filter(Boolean),
    connectionType: input.connectionType,
    ...(input.salesAccountCode ? { salesAccountCode: input.salesAccountCode } : {}),
    ...(input.purchaseAccountCode ? { purchaseAccountCode: input.purchaseAccountCode } : {}),
    ...(input.defaultTaxType ? { defaultTaxType: input.defaultTaxType } : {}),
    lastSuccessfulSyncAt: now(),
  };
  const stored = existing
    ? await dependencies.repository.update(
        'xeroConnections',
        input.agencyId,
        id,
        data,
        Number(existing.version),
        input.actorId,
      )
    : await dependencies.repository.create(
        'xeroConnections',
        input.agencyId,
        id,
        data,
        input.actorId,
      );
  await saveIntegrationCredentials(dependencies, {
    agencyId: input.agencyId,
    connectionId: id,
    provider: 'xero',
    credentials: input.credentials,
    actorId: input.actorId,
  });
  return stored as unknown as XeroConnection;
}

async function xeroRequest<T>(
  dependencies: ApiDependencies,
  connection: XeroConnection & { version: number },
  actorId: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const credentials = await validCredentials(dependencies, connection, actorId);
  const response = await fetch(`${XERO_ACCOUNTING_BASE}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${credentials.accessToken}`,
      'xero-tenant-id': connection.tenantId || '',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  const payload = (await response.json().catch(() => ({}))) as T & {
    ErrorNumber?: number;
    Message?: string;
    Elements?: Array<{ ValidationErrors?: Array<{ Message?: string }> }>;
  };
  if (!response.ok) {
    const validation = payload.Elements?.flatMap((item) => item.ValidationErrors || [])
      .map((item) => item.Message)
      .filter(Boolean)
      .join('; ');
    throw new Error(validation || payload.Message || `Xero API failed with ${response.status}.`);
  }
  return payload;
}

async function createSyncException(
  dependencies: ApiDependencies,
  input: {
    agencyId: string;
    actorId: string;
    resourceType: XeroSyncException['resourceType'];
    internalId: string;
    operation: XeroSyncException['operation'];
    code: string;
    message: string;
    externalId?: string;
  },
): Promise<void> {
  const id = randomUUID();
  await dependencies.repository.create(
    'xeroSyncExceptions',
    input.agencyId,
    id,
    {
      resourceType: input.resourceType,
      internalId: input.internalId,
      ...(input.externalId ? { externalId: input.externalId } : {}),
      operation: input.operation,
      severity: 'warning',
      status: 'open',
      code: input.code,
      message: input.message,
      attemptCount: 1,
      lastAttemptedAt: now(),
    },
    input.actorId,
  );
}

async function ensureXeroContact(
  dependencies: ApiDependencies,
  connection: XeroConnection & { version: number },
  actorId: string,
  client: Client,
): Promise<string> {
  if (client.xeroContactId) return client.xeroContactId;
  const payload = await xeroRequest<{ Contacts?: Array<{ ContactID?: string }> }>(
    dependencies,
    connection,
    actorId,
    '/Contacts',
    {
      method: 'POST',
      body: JSON.stringify({
        Contacts: [
          {
            Name: client.name,
            EmailAddress: client.defaultApprovalEmail || client.email,
            Phones: client.phone
              ? [{ PhoneType: 'DEFAULT', PhoneNumber: client.phone }]
              : [],
          },
        ],
      }),
    },
  );
  const contactId = payload.Contacts?.[0]?.ContactID;
  if (!contactId) throw new Error('Xero did not return a ContactID.');
  const stored = await dependencies.repository.get('clients', client.agencyId, client.id);
  if (stored) {
    await dependencies.repository.update(
      'clients',
      client.agencyId,
      client.id,
      { xeroContactId: contactId },
      Number(stored.version),
      actorId,
    );
  }
  return contactId;
}

function xeroQuoteStatus(status: MaintenanceQuote['status']): string {
  if (status === 'sent' || status === 'viewed' || status === 'information_requested') return 'SENT';
  if (status === 'accepted' || status === 'converted_to_work_order') return 'ACCEPTED';
  if (status === 'declined') return 'DECLINED';
  if (status === 'invoiced') return 'INVOICED';
  return 'DRAFT';
}

export async function syncMaintenanceQuoteToXero(
  dependencies: ApiDependencies,
  input: {
    agencyId: string;
    quoteId: string;
    actorId: string;
  },
): Promise<MaintenanceQuote> {
  const [connection, quoteRecord] = await Promise.all([
    connectionRecord(dependencies, input.agencyId),
    dependencies.repository.get('maintenanceQuotes', input.agencyId, input.quoteId),
  ]);
  if (!connection || connection.status !== 'connected' || !connection.tenantId) {
    throw Object.assign(new Error('Connect Xero before synchronising quotes.'), {
      code: 'XERO_NOT_CONNECTED',
      status: 409,
    });
  }
  if (!quoteRecord) throw Object.assign(new Error('Maintenance quote not found.'), { code: 'QUOTE_NOT_FOUND', status: 404 });
  const quote = quoteRecord as unknown as MaintenanceQuote & { version: number };
  if (!quote.currentVersionId) throw new Error('Maintenance quote has no immutable version.');
  const [versionRecord, clientRecord] = await Promise.all([
    dependencies.repository.get('maintenanceQuoteVersions', input.agencyId, quote.currentVersionId),
    quote.clientId ? dependencies.repository.get('clients', input.agencyId, quote.clientId) : Promise.resolve(undefined),
  ]);
  if (!versionRecord || !clientRecord) throw new Error('Quote version and client are required for Xero synchronisation.');
  const version = versionRecord as unknown as MaintenanceQuoteVersion;
  const client = clientRecord as unknown as Client;
  try {
    const contactId = await ensureXeroContact(dependencies, connection, input.actorId, client);
    const payload = {
      Quotes: [
        {
          ...(quote.xeroQuoteId ? { QuoteID: quote.xeroQuoteId } : {}),
          QuoteNumber: quote.xeroQuoteNumber || quote.quoteNumber,
          Reference: quote.quoteNumber,
          Contact: { ContactID: contactId },
          Date: version.createdAt.slice(0, 10),
          ExpiryDate: version.validUntil,
          Status: xeroQuoteStatus(quote.status),
          LineAmountTypes: 'Exclusive',
          Title: version.title,
          Summary: version.summary,
          Terms: version.terms,
          CurrencyCode: version.currency,
          LineItems: version.lineItems.map((line) => ({
            Description: line.description,
            Quantity: line.quantity,
            UnitAmount: line.unitAmountExcludingTax,
            ...(line.itemCode ? { ItemCode: line.itemCode } : {}),
            ...(line.accountCode || connection.salesAccountCode
              ? { AccountCode: line.accountCode || connection.salesAccountCode }
              : {}),
            ...(line.taxType || connection.defaultTaxType
              ? { TaxType: line.taxType || connection.defaultTaxType }
              : {}),
          })),
        },
      ],
    };
    const response = await xeroRequest<{
      Quotes?: Array<{ QuoteID?: string; QuoteNumber?: string; Status?: string }>;
    }>(dependencies, connection, input.actorId, '/Quotes', {
      method: quote.xeroQuoteId ? 'POST' : 'PUT',
      body: JSON.stringify(payload),
    });
    const synced = response.Quotes?.[0];
    if (!synced?.QuoteID) throw new Error('Xero did not return a quote identifier.');
    const stored = await dependencies.repository.update(
      'maintenanceQuotes',
      input.agencyId,
      quote.id,
      {
        xeroQuoteId: synced.QuoteID,
        xeroQuoteNumber: synced.QuoteNumber || quote.quoteNumber,
        xeroStatus: 'synchronised',
        xeroSyncedAt: now(),
      },
      Number(quoteRecord.version),
      input.actorId,
    );
    await dependencies.repository.update(
      'xeroConnections',
      input.agencyId,
      connection.id,
      { lastSuccessfulSyncAt: now(), lastAttemptedSyncAt: now(), status: 'connected' },
      Number(connection.version),
      input.actorId,
    );
    return stored as unknown as MaintenanceQuote;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Xero quote synchronisation failed.';
    await createSyncException(dependencies, {
      agencyId: input.agencyId,
      actorId: input.actorId,
      resourceType: 'quote',
      internalId: quote.id,
      operation: quote.xeroQuoteId ? 'update' : 'create',
      code: 'XERO_QUOTE_SYNC_FAILED',
      message,
      ...(quote.xeroQuoteId ? { externalId: quote.xeroQuoteId } : {}),
    });
    await dependencies.repository.update(
      'maintenanceQuotes',
      input.agencyId,
      quote.id,
      { xeroStatus: 'attention_required', xeroLastError: message },
      Number(quoteRecord.version),
      input.actorId,
    );
    throw error;
  }
}

async function contractorContactId(
  dependencies: ApiDependencies,
  connection: XeroConnection & { version: number },
  actorId: string,
  contact: ExternalContact,
): Promise<string> {
  if (contact.xeroContactId) return contact.xeroContactId;
  const response = await xeroRequest<{ Contacts?: Array<{ ContactID?: string }> }>(
    dependencies,
    connection,
    actorId,
    '/Contacts',
    {
      method: 'POST',
      body: JSON.stringify({
        Contacts: [
          {
            Name: contact.businessName || contact.name,
            EmailAddress: contact.email,
            Phones: contact.phone
              ? [{ PhoneType: 'DEFAULT', PhoneNumber: contact.phone }]
              : [],
          },
        ],
      }),
    },
  );
  const contactId = response.Contacts?.[0]?.ContactID;
  if (!contactId) throw new Error('Xero did not return a contractor ContactID.');
  const stored = await dependencies.repository.get('externalContacts', contact.agencyId, contact.id);
  if (stored) {
    await dependencies.repository.update(
      'externalContacts',
      contact.agencyId,
      contact.id,
      { xeroContactId: contactId },
      Number(stored.version),
      actorId,
    );
  }
  return contactId;
}

export async function syncWorkOrderPurchaseOrderToXero(
  dependencies: ApiDependencies,
  input: { agencyId: string; workOrderId: string; actorId: string },
): Promise<MaintenanceWorkOrder> {
  const [connection, workOrderRecord] = await Promise.all([
    connectionRecord(dependencies, input.agencyId),
    dependencies.repository.get('maintenanceWorkOrders', input.agencyId, input.workOrderId),
  ]);
  if (!connection?.tenantId || connection.status !== 'connected') throw new Error('Connect Xero before creating purchase orders.');
  if (!workOrderRecord) throw new Error('Maintenance work order not found.');
  const workOrder = workOrderRecord as unknown as MaintenanceWorkOrder & { version: number };
  if (!workOrder.externalContactId) throw new Error('Assign a contractor before creating a Xero purchase order.');
  const contactRecord = await dependencies.repository.get('externalContacts', input.agencyId, workOrder.externalContactId);
  if (!contactRecord) throw new Error('Assigned contractor was not found.');
  const contact = contactRecord as unknown as ExternalContact;
  const contactId = await contractorContactId(dependencies, connection, input.actorId, contact);
  const response = await xeroRequest<{
    PurchaseOrders?: Array<{ PurchaseOrderID?: string; PurchaseOrderNumber?: string }>;
  }>(dependencies, connection, input.actorId, '/PurchaseOrders', {
    method: workOrder.xeroPurchaseOrderId ? 'POST' : 'PUT',
    body: JSON.stringify({
      PurchaseOrders: [
        {
          ...(workOrder.xeroPurchaseOrderId ? { PurchaseOrderID: workOrder.xeroPurchaseOrderId } : {}),
          PurchaseOrderNumber: workOrder.xeroPurchaseOrderNumber || workOrder.workOrderNumber,
          Contact: { ContactID: contactId },
          Date: now().slice(0, 10),
          Status: workOrder.status === 'cancelled' ? 'DELETED' : workOrder.status === 'draft' ? 'DRAFT' : 'AUTHORISED',
          Reference: workOrder.workOrderNumber,
          LineAmountTypes: 'Exclusive',
          LineItems: [
            {
              Description: workOrder.scope,
              Quantity: 1,
              UnitAmount: workOrder.contractorAmount ?? workOrder.approvedAmount,
              ...(connection.purchaseAccountCode ? { AccountCode: connection.purchaseAccountCode } : {}),
              ...(connection.defaultTaxType ? { TaxType: connection.defaultTaxType } : {}),
            },
          ],
        },
      ],
    }),
  });
  const purchaseOrder = response.PurchaseOrders?.[0];
  if (!purchaseOrder?.PurchaseOrderID) throw new Error('Xero did not return a purchase order identifier.');
  const stored = await dependencies.repository.update(
    'maintenanceWorkOrders',
    input.agencyId,
    workOrder.id,
    {
      xeroPurchaseOrderId: purchaseOrder.PurchaseOrderID,
      xeroPurchaseOrderNumber: purchaseOrder.PurchaseOrderNumber || workOrder.workOrderNumber,
      xeroPurchaseOrderSyncedAt: now(),
    },
    Number(workOrderRecord.version),
    input.actorId,
  );
  return stored as unknown as MaintenanceWorkOrder;
}

export async function createXeroInvoiceFromQuote(
  dependencies: ApiDependencies,
  input: { agencyId: string; quoteId: string; actorId: string },
): Promise<MaintenanceQuote> {
  const [connection, quoteRecord] = await Promise.all([
    connectionRecord(dependencies, input.agencyId),
    dependencies.repository.get('maintenanceQuotes', input.agencyId, input.quoteId),
  ]);
  if (!connection?.tenantId || connection.status !== 'connected') throw new Error('Connect Xero before creating invoices.');
  if (!quoteRecord) throw new Error('Maintenance quote not found.');
  const quote = quoteRecord as unknown as MaintenanceQuote & { version: number; xeroInvoiceId?: string };
  if (!quote.currentVersionId || !quote.clientId) throw new Error('Quote version and client are required.');
  const [versionRecord, clientRecord] = await Promise.all([
    dependencies.repository.get('maintenanceQuoteVersions', input.agencyId, quote.currentVersionId),
    dependencies.repository.get('clients', input.agencyId, quote.clientId),
  ]);
  if (!versionRecord || !clientRecord) throw new Error('Quote version or client was not found.');
  const version = versionRecord as unknown as MaintenanceQuoteVersion;
  const client = clientRecord as unknown as Client;
  const contactId = await ensureXeroContact(dependencies, connection, input.actorId, client);
  const response = await xeroRequest<{
    Invoices?: Array<{ InvoiceID?: string; InvoiceNumber?: string }>;
  }>(dependencies, connection, input.actorId, '/Invoices', {
    method: quote.xeroInvoiceId ? 'POST' : 'PUT',
    body: JSON.stringify({
      Invoices: [
        {
          ...(quote.xeroInvoiceId ? { InvoiceID: quote.xeroInvoiceId } : {}),
          Type: 'ACCREC',
          Contact: { ContactID: contactId },
          Date: now().slice(0, 10),
          DueDate: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
          Reference: quote.quoteNumber,
          Status: 'DRAFT',
          LineAmountTypes: 'Exclusive',
          LineItems: version.lineItems.map((line) => ({
            Description: line.description,
            Quantity: line.quantity,
            UnitAmount: line.unitAmountExcludingTax,
            ...(line.itemCode ? { ItemCode: line.itemCode } : {}),
            ...(line.accountCode || connection.salesAccountCode
              ? { AccountCode: line.accountCode || connection.salesAccountCode }
              : {}),
            ...(line.taxType || connection.defaultTaxType
              ? { TaxType: line.taxType || connection.defaultTaxType }
              : {}),
          })),
        },
      ],
    }),
  });
  const invoice = response.Invoices?.[0];
  if (!invoice?.InvoiceID) throw new Error('Xero did not return an invoice identifier.');
  const stored = await dependencies.repository.update(
    'maintenanceQuotes',
    input.agencyId,
    quote.id,
    {
      status: 'invoiced',
      xeroInvoiceId: invoice.InvoiceID,
      xeroInvoiceNumber: invoice.InvoiceNumber,
      xeroStatus: 'synchronised',
      xeroInvoiceCreatedAt: now(),
    },
    Number(quoteRecord.version),
    input.actorId,
  );
  return stored as unknown as MaintenanceQuote;
}

export async function getXeroConnection(
  dependencies: ApiDependencies,
  agencyId: string,
): Promise<XeroConnection | undefined> {
  return connectionRecord(dependencies, agencyId);
}

export async function disconnectXero(
  dependencies: ApiDependencies,
  agencyId: string,
  actorId: string,
): Promise<XeroConnection | undefined> {
  const connection = await connectionRecord(dependencies, agencyId);
  if (!connection) return undefined;
  return dependencies.repository.update(
    'xeroConnections',
    agencyId,
    connection.id,
    { status: 'disconnected', disconnectedAt: now() },
    Number(connection.version),
    actorId,
  ) as unknown as XeroConnection;
}
