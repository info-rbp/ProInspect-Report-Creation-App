# Shopify operational mapping

Shopify remains authoritative for products, variants, catalogue/pricing, checkout, payments, refunds, cancellations, and financial order state. Appwrite stores operational references and workflow state only.

The target flow is Shopify webhook → `integration_events` deduplication → `shopify_service_mappings` → `service_definitions` → `service_requests` → API workflow router → inspection or other operational records → `audit_events` and `integration_outbox`.

Preserve shop domain, order GID/number, customer ID, line item/product/variant IDs, delivery ID, financial/fulfilment status, refund/cancellation references, timestamps, and payload hash/reference. Never derive a new financial truth in Appwrite. Existing HMAC verification, encrypted credential storage, API-version policy, idempotent upsert, and reconciliation remain required.

The migration does not bulk-copy Shopify orders as an Appwrite ledger. It imports active service mappings and operational references required by eligible open workflows. Each webhook delivery first creates/deduplicates `integration_events` by agency/provider/delivery or payload key. Every line resolves product/variant to `shopify_service_mappings`, then to `service_definitions`, then creates a generic `service_request`/item. Only the service workflow router may create an `inspection_request`; non-inspection products must not inherit inspection assumptions.

Customer IDs remain external references on clients and requests and never confer portal access. Order paid/authorised state may satisfy an operational payment gate, but refunds, cancellations and financial/fulfilment changes are taken from Shopify and handled through explicit review/cancellation actions. Secrets remain in the approved secret store referenced by `integration_connections`, not in Appwrite rows.

Reconciliation requires mapping counts, unmapped/ambiguous variants, duplicate deliveries, order/line reference uniqueness, service-request counts, financial-status comparison, refund/cancellation exceptions, payload hash/reference, and zero duplicate downstream workflows. Webhook routing is not switched in this preparation task.
