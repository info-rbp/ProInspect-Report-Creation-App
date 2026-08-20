import type {
  InspectionReportType,
  InspectionServiceMapping,
  ShopifyOrderReference,
} from '@pcr/domain';

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION?.trim() || '2026-07';

export interface ShopifyAdminCredentials {
  shopDomain: string;
  accessToken: string;
}

interface GraphQlError {
  message?: string;
}

interface GraphQlEnvelope<T> {
  data?: T;
  errors?: GraphQlError[];
}

interface ShopifyOrderNode {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledAt?: string | null;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus?: string | null;
  currencyCode?: string | null;
  note?: string | null;
  tags?: string[] | null;
  customer?: {
    id?: string | null;
    displayName?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  currentTotalPriceSet?: {
    shopMoney?: { amount?: string | null; currencyCode?: string | null } | null;
  } | null;
  lineItems?: {
    nodes?: Array<{
      id: string;
      name?: string | null;
      title?: string | null;
      variantTitle?: string | null;
      sku?: string | null;
      quantity?: number | null;
      product?: { id?: string | null; handle?: string | null } | null;
      variant?: { id?: string | null } | null;
      originalTotalSet?: {
        shopMoney?: { amount?: string | null; currencyCode?: string | null } | null;
      } | null;
    }> | null;
  } | null;
}

export interface ShopifyOrderWebhookPayload {
  id?: number | string;
  admin_graphql_api_id?: string;
  name?: string;
  order_number?: number | string;
  checkout_token?: string;
  email?: string;
  phone?: string;
  financial_status?: string;
  fulfillment_status?: string;
  currency?: string;
  current_total_price?: string;
  total_price?: string;
  cancelled_at?: string | null;
  created_at?: string;
  updated_at?: string;
  note?: string;
  tags?: string;
  customer?: {
    id?: number | string;
    admin_graphql_api_id?: string;
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
  };
  shipping_address?: {
    address1?: string;
    address2?: string;
    city?: string;
    province_code?: string;
    zip?: string;
    country_code?: string;
  };
  note_attributes?: Array<{ name?: string; value?: string }>;
  line_items?: Array<{
    id?: number | string;
    admin_graphql_api_id?: string;
    product_id?: number | string;
    variant_id?: number | string;
    title?: string;
    variant_title?: string;
    sku?: string;
    quantity?: number;
    price?: string;
  }>;
}

export interface ShopifyOrderCursorPage {
  orders: ShopifyOrderReference[];
  endCursor?: string;
  hasNextPage: boolean;
}

export interface ShopifyInspectionDefaults {
  serviceCode: string;
  label: string;
  productId?: string;
  productHandle: string;
  reportType: InspectionReportType;
  propertyUse?: 'residential' | 'commercial';
  defaultDurationMinutes: number;
  paymentRequired: boolean;
  manualApprovalRequired: boolean;
}

/**
 * Store-specific bootstrap mappings discovered from the connected ProInspect
 * Shopify catalogue. Agencies can override these with service-mapping records.
 */
export const PROINSPECT_SHOPIFY_DEFAULTS: ShopifyInspectionDefaults[] = [
  {
    serviceCode: 'entry-pcr',
    label: 'Property Condition Report',
    productId: 'gid://shopify/Product/10264785191194',
    productHandle: 'property-condition-report',
    reportType: 'Property Condition Report',
    propertyUse: 'residential',
    defaultDurationMinutes: 60,
    paymentRequired: true,
    manualApprovalRequired: false,
  },
  {
    serviceCode: 'routine-inspection',
    label: 'Routine Inspection',
    productId: 'gid://shopify/Product/10265687163162',
    productHandle: 'routine-inspection',
    reportType: 'Routine Inspection',
    propertyUse: 'residential',
    defaultDurationMinutes: 30,
    paymentRequired: true,
    manualApprovalRequired: false,
  },
  {
    serviceCode: 'exit-inspection',
    label: 'Exit Inspection',
    productId: 'gid://shopify/Product/10265691390234',
    productHandle: 'exit-inspection',
    reportType: 'Exit Inspection',
    propertyUse: 'residential',
    defaultDurationMinutes: 60,
    paymentRequired: true,
    manualApprovalRequired: false,
  },
  {
    serviceCode: 'commercial-entry',
    label: 'Commercial Property Condition Report',
    productId: 'gid://shopify/Product/10281799319834',
    productHandle: 'commercial-property-condition-report',
    reportType: 'Property Condition Report',
    propertyUse: 'commercial',
    defaultDurationMinutes: 180,
    paymentRequired: true,
    manualApprovalRequired: true,
  },
  {
    serviceCode: 'commercial-routine',
    label: 'Commercial Routine Inspection',
    productId: 'gid://shopify/Product/10281822257434',
    productHandle: 'commercial-routine-inspection',
    reportType: 'Routine Inspection',
    propertyUse: 'commercial',
    defaultDurationMinutes: 120,
    paymentRequired: true,
    manualApprovalRequired: true,
  },
  {
    serviceCode: 'commercial-exit',
    label: 'Commercial Exit Inspection',
    productId: 'gid://shopify/Product/10281822519578',
    productHandle: 'commercial-exit-inspection',
    reportType: 'Exit Inspection',
    propertyUse: 'commercial',
    defaultDurationMinutes: 180,
    paymentRequired: true,
    manualApprovalRequired: true,
  },
  {
    serviceCode: 'maintenance-follow-up',
    label: 'Maintenance Follow-Up Inspection',
    productId: 'gid://shopify/Product/10282452484378',
    productHandle: 'maintenance-follow-up-inspection',
    reportType: 'Maintenance and Follow-Up Report',
    defaultDurationMinutes: 45,
    paymentRequired: true,
    manualApprovalRequired: false,
  },
];

function canonicalShopDomain(value: string): string {
  const domain = value
    .trim()
    .replace(/^https?:\/\//iu, '')
    .replace(/\/$/u, '')
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/u.test(domain)) {
    throw new Error('Shopify shop domain must use the store.myshopify.com form.');
  }
  return domain;
}

async function graphQl<T>(
  credentials: ShopifyAdminCredentials,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const domain = canonicalShopDomain(credentials.shopDomain);
  const response = await fetch(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-shopify-access-token': credentials.accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = (await response.json()) as GraphQlEnvelope<T>;
  if (!response.ok || payload.errors?.length || !payload.data) {
    throw new Error(
      payload.errors?.map((error) => error.message).filter(Boolean).join('; ') ||
        `Shopify Admin API failed with ${response.status}.`,
    );
  }
  return payload.data;
}

function gid(resource: 'Order' | 'Customer' | 'Product' | 'ProductVariant' | 'LineItem', value: unknown): string | undefined {
  if (typeof value === 'string' && value.startsWith('gid://shopify/')) return value;
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/u.test(value))) {
    return `gid://shopify/${resource}/${String(value)}`;
  }
  return undefined;
}

function customerName(input: ShopifyOrderWebhookPayload['customer']): string | undefined {
  if (!input) return undefined;
  const value = [input.first_name, input.last_name]
    .filter((candidate): candidate is string => Boolean(candidate?.trim()))
    .join(' ')
    .trim();
  return value || undefined;
}

function nodeOrder(order: ShopifyOrderNode, shopDomain: string): ShopifyOrderReference {
  return {
    shopDomain: canonicalShopDomain(shopDomain),
    orderGid: order.id,
    orderNumber: order.name,
    ...(order.customer?.id ? { customerId: order.customer.id } : {}),
    ...(order.customer?.displayName ? { customerName: order.customer.displayName } : {}),
    ...(order.customer?.email || order.email
      ? { customerEmail: order.customer?.email || order.email || undefined }
      : {}),
    ...(order.customer?.phone || order.phone
      ? { customerPhone: order.customer?.phone || order.phone || undefined }
      : {}),
    ...(order.displayFinancialStatus
      ? { financialStatus: order.displayFinancialStatus.toLowerCase() }
      : {}),
    ...(order.displayFulfillmentStatus
      ? { fulfilmentStatus: order.displayFulfillmentStatus.toLowerCase() }
      : {}),
    ...(order.currentTotalPriceSet?.shopMoney?.currencyCode || order.currencyCode
      ? {
          currency:
            order.currentTotalPriceSet?.shopMoney?.currencyCode ||
            order.currencyCode ||
            undefined,
        }
      : {}),
    ...(order.currentTotalPriceSet?.shopMoney?.amount
      ? { totalAmount: order.currentTotalPriceSet.shopMoney.amount }
      : {}),
    ...(order.tags?.length ? { tags: order.tags } : {}),
    ...(order.note ? { note: order.note } : {}),
    lines: (order.lineItems?.nodes || []).map((line) => ({
      lineItemId: line.id,
      ...(line.product?.id ? { productId: line.product.id } : {}),
      ...(line.variant?.id ? { variantId: line.variant.id } : {}),
      title: line.title || line.name || 'Inspection service',
      ...(line.variantTitle ? { variantTitle: line.variantTitle } : {}),
      ...(line.sku ? { sku: line.sku } : {}),
      quantity: Number(line.quantity || 1),
      ...(line.originalTotalSet?.shopMoney?.amount
        ? { amount: line.originalTotalSet.shopMoney.amount }
        : {}),
      ...(line.originalTotalSet?.shopMoney?.currencyCode
        ? { currency: line.originalTotalSet.shopMoney.currencyCode }
        : {}),
    })),
    ...(order.cancelledAt ? { cancelledAt: order.cancelledAt } : {}),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

export function parseShopifyOrderWebhook(
  payload: ShopifyOrderWebhookPayload,
  shopDomain: string,
): ShopifyOrderReference {
  const orderGid = payload.admin_graphql_api_id || gid('Order', payload.id);
  if (!orderGid) throw new Error('Shopify order payload does not contain an order identity.');
  const createdAt = payload.created_at || new Date().toISOString();
  const updatedAt = payload.updated_at || createdAt;
  return {
    shopDomain: canonicalShopDomain(shopDomain),
    orderGid,
    orderNumber: payload.name || String(payload.order_number || payload.id || orderGid),
    ...(payload.checkout_token ? { checkoutToken: payload.checkout_token } : {}),
    ...(payload.customer?.admin_graphql_api_id || gid('Customer', payload.customer?.id)
      ? {
          customerId:
            payload.customer?.admin_graphql_api_id ||
            gid('Customer', payload.customer?.id),
        }
      : {}),
    ...(customerName(payload.customer) ? { customerName: customerName(payload.customer) } : {}),
    ...(payload.customer?.email || payload.email
      ? { customerEmail: payload.customer?.email || payload.email }
      : {}),
    ...(payload.customer?.phone || payload.phone
      ? { customerPhone: payload.customer?.phone || payload.phone }
      : {}),
    ...(payload.financial_status ? { financialStatus: payload.financial_status } : {}),
    ...(payload.fulfillment_status ? { fulfilmentStatus: payload.fulfillment_status } : {}),
    ...(payload.currency ? { currency: payload.currency } : {}),
    ...(payload.current_total_price || payload.total_price
      ? { totalAmount: payload.current_total_price || payload.total_price }
      : {}),
    ...(payload.tags
      ? { tags: payload.tags.split(',').map((tag) => tag.trim()).filter(Boolean) }
      : {}),
    ...(payload.note ? { note: payload.note } : {}),
    lines: (payload.line_items || []).map((line) => ({
      lineItemId:
        line.admin_graphql_api_id ||
        gid('LineItem', line.id) ||
        `line-${String(line.id || Math.random())}`,
      ...(gid('Product', line.product_id) ? { productId: gid('Product', line.product_id) } : {}),
      ...(gid('ProductVariant', line.variant_id)
        ? { variantId: gid('ProductVariant', line.variant_id) }
        : {}),
      title: line.title || 'Inspection service',
      ...(line.variant_title ? { variantTitle: line.variant_title } : {}),
      ...(line.sku ? { sku: line.sku } : {}),
      quantity: Number(line.quantity || 1),
      ...(line.price ? { amount: line.price } : {}),
      ...(payload.currency ? { currency: payload.currency } : {}),
    })),
    ...(payload.cancelled_at ? { cancelledAt: payload.cancelled_at } : {}),
    createdAt,
    updatedAt,
  };
}

export function shopifyPropertyAddress(payload: ShopifyOrderWebhookPayload): string | undefined {
  const attribute = payload.note_attributes?.find((item) =>
    /^(property[ _-]?address|full[ _-]?property[ _-]?address|inspection[ _-]?address)$/iu.test(
      item.name?.trim() || '',
    ),
  )?.value;
  if (attribute?.trim()) return attribute.trim();
  const shipping = payload.shipping_address;
  if (!shipping?.address1) return undefined;
  return [
    shipping.address1,
    shipping.address2,
    shipping.city,
    shipping.province_code,
    shipping.zip,
    shipping.country_code,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(', ');
}

export function shopifyAccessInstructions(payload: ShopifyOrderWebhookPayload): string | undefined {
  return payload.note_attributes?.find((item) =>
    /^(access|access[ _-]?details|access[ _-]?instructions|key[ _-]?safe)$/iu.test(
      item.name?.trim() || '',
    ),
  )?.value;
}

export function matchShopifyServiceMapping(
  order: ShopifyOrderReference,
  mappings: InspectionServiceMapping[],
): InspectionServiceMapping | undefined {
  const active = mappings.filter((mapping) => mapping.active && mapping.provider === 'shopify');
  for (const line of order.lines) {
    const exact = active.find(
      (mapping) =>
        (mapping.variantId && mapping.variantId === line.variantId) ||
        (mapping.productId && mapping.productId === line.productId) ||
        (mapping.sku && mapping.sku.toLowerCase() === line.sku?.toLowerCase()),
    );
    if (exact) return exact;
  }
  return active.find((mapping) =>
    order.lines.some((line) => {
      const text = `${line.title} ${line.variantTitle || ''}`.toLowerCase();
      return (
        (mapping.productHandle && text.includes(mapping.productHandle.replaceAll('-', ' '))) ||
        text.includes(mapping.label.toLowerCase())
      );
    }),
  );
}

export function defaultShopifyServiceMappings(
  agencyId: string,
  now = new Date().toISOString(),
): InspectionServiceMapping[] {
  return PROINSPECT_SHOPIFY_DEFAULTS.map((item) => ({
    id: `shopify-${item.serviceCode}`,
    agencyId,
    provider: 'shopify',
    active: true,
    serviceCode: item.serviceCode,
    label: item.label,
    ...(item.productId ? { productId: item.productId } : {}),
    productHandle: item.productHandle,
    reportType: item.reportType,
    ...(item.propertyUse ? { propertyUse: item.propertyUse } : {}),
    defaultDurationMinutes: item.defaultDurationMinutes,
    paymentRequired: item.paymentRequired,
    manualApprovalRequired: item.manualApprovalRequired,
    defaultPriority: 'normal',
    createdAt: now,
    updatedAt: now,
  }));
}

const ORDERS_QUERY = `
  query ProInspectOrders($query: String!, $first: Int!, $after: String) {
    orders(query: $query, first: $first, after: $after, sortKey: UPDATED_AT) {
      nodes {
        id
        name
        email
        phone
        createdAt
        updatedAt
        cancelledAt
        displayFinancialStatus
        displayFulfillmentStatus
        currencyCode
        note
        tags
        customer { id displayName email phone }
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        lineItems(first: 50) {
          nodes {
            id
            name
            title
            variantTitle
            sku
            quantity
            product { id handle }
            variant { id }
            originalTotalSet { shopMoney { amount currencyCode } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export async function fetchShopifyOrders(
  credentials: ShopifyAdminCredentials,
  updatedSince: string,
  after?: string,
  first = 100,
): Promise<ShopifyOrderCursorPage> {
  const data = await graphQl<{
    orders: {
      nodes: ShopifyOrderNode[];
      pageInfo: { hasNextPage: boolean; endCursor?: string | null };
    };
  }>(credentials, ORDERS_QUERY, {
    query: `updated_at:>=${JSON.stringify(updatedSince)}`,
    first: Math.min(Math.max(first, 1), 250),
    after: after || null,
  });
  return {
    orders: data.orders.nodes.map((order) => nodeOrder(order, credentials.shopDomain)),
    ...(data.orders.pageInfo.endCursor ? { endCursor: data.orders.pageInfo.endCursor } : {}),
    hasNextPage: data.orders.pageInfo.hasNextPage,
  };
}
