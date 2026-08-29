# Shopify operational mapping

Shopify remains authoritative for products, variants, catalogue/pricing, checkout, payments, refunds, cancellations, and financial order state. Appwrite stores operational references and workflow state only.

The target flow is Shopify webhook → `integration_events` deduplication → `shopify_service_mappings` → `service_definitions` → `service_requests` → API workflow router → inspection or other operational records → `audit_events` and `integration_outbox`.

Preserve shop domain, order GID/number, customer ID, line item/product/variant IDs, delivery ID, financial/fulfilment status, refund/cancellation references, timestamps, and payload hash/reference. Never derive a new financial truth in Appwrite. Existing HMAC verification, encrypted credential storage, API-version policy, idempotent upsert, and reconciliation remain required.
