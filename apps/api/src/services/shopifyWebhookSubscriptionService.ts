import type { ShopifyAdminCredentials } from './shopifyAdminService.js';

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION?.trim() || '2026-07';

interface GraphQlEnvelope<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

async function graphQl<T>(
  credentials: ShopifyAdminCredentials,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(
    `https://${credentials.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-shopify-access-token': credentials.accessToken,
      },
      body: JSON.stringify({ query, variables }),
    },
  );
  const payload = (await response.json()) as GraphQlEnvelope<T>;
  if (!response.ok || payload.errors?.length || !payload.data) {
    throw new Error(
      payload.errors?.map((item) => item.message).filter(Boolean).join('; ') ||
        `Shopify Admin API failed with ${response.status}.`,
    );
  }
  return payload.data;
}

export async function getShopifyShopIdentity(
  credentials: ShopifyAdminCredentials,
): Promise<{ id: string; name: string; myshopifyDomain: string; email?: string }> {
  const data = await graphQl<{
    shop: { id: string; name: string; myshopifyDomain: string; email?: string | null };
  }>(
    credentials,
    `query ProInspectShopIdentity { shop { id name myshopifyDomain email } }`,
    {},
  );
  return {
    id: data.shop.id,
    name: data.shop.name,
    myshopifyDomain: data.shop.myshopifyDomain,
    ...(data.shop.email ? { email: data.shop.email } : {}),
  };
}

const WEBHOOK_TOPICS = [
  'ORDERS_CREATE',
  'ORDERS_PAID',
  'ORDERS_UPDATED',
  'ORDERS_CANCELLED',
  'REFUNDS_CREATE',
] as const;

export async function ensureShopifyWebhookSubscriptions(
  credentials: ShopifyAdminCredentials,
  webhookUri: string,
): Promise<Array<{ topic: string; id?: string; created: boolean; errors: string[] }>> {
  const existing = await graphQl<{
    webhookSubscriptions: {
      nodes: Array<{ id: string; topic: string; endpoint: { __typename: string; callbackUrl?: string } }>;
    };
  }>(
    credentials,
    `query ProInspectWebhookSubscriptions {
      webhookSubscriptions(first: 250) {
        nodes { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } }
      }
    }`,
    {},
  );

  const results: Array<{ topic: string; id?: string; created: boolean; errors: string[] }> = [];
  for (const topic of WEBHOOK_TOPICS) {
    const current = existing.webhookSubscriptions.nodes.find(
      (item) => item.topic === topic && item.endpoint.callbackUrl === webhookUri,
    );
    if (current) {
      results.push({ topic, id: current.id, created: false, errors: [] });
      continue;
    }
    const created = await graphQl<{
      webhookSubscriptionCreate: {
        webhookSubscription?: { id: string } | null;
        userErrors: Array<{ field?: string[]; message: string }>;
      };
    }>(
      credentials,
      `mutation ProInspectWebhookCreate($topic: WebhookSubscriptionTopic!, $uri: URL!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: { uri: $uri, format: JSON }) {
          webhookSubscription { id }
          userErrors { field message }
        }
      }`,
      { topic, uri: webhookUri },
    );
    results.push({
      topic,
      ...(created.webhookSubscriptionCreate.webhookSubscription?.id
        ? { id: created.webhookSubscriptionCreate.webhookSubscription.id }
        : {}),
      created: Boolean(created.webhookSubscriptionCreate.webhookSubscription?.id),
      errors: created.webhookSubscriptionCreate.userErrors.map((item) => item.message),
    });
  }
  return results;
}
