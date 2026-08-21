# Shopify and Google Calendar Inspection Intake

## Overview

ProInspect can receive paid inspection orders from Shopify and appointment events from Google Calendar, merge them into one Inspection Request and convert a valid request into an Inspection Job.

The integrations are implemented server side. Browser code never receives provider access tokens or webhook secrets.

## Runtime configuration

Set the following values through Secret Manager or the equivalent controlled runtime configuration. Do not commit live values.

```text
PUBLIC_API_BASE_URL=https://api.example.com
WEB_APP_BASE_URL=https://app.example.com

SHOPIFY_API_VERSION=2026-07
SHOPIFY_WEBHOOK_SECRET=<Shopify app client secret>

GOOGLE_CALENDAR_CLIENT_ID=<OAuth client ID>
GOOGLE_CALENDAR_CLIENT_SECRET=<OAuth client secret>
GOOGLE_CALENDAR_REDIRECT_URI=https://api.example.com/api/v1/integrations/google-calendar/oauth/callback

INTEGRATION_TOKEN_ENCRYPTION_KEY=<32-byte base64 or 64-character hex key>
INTEGRATION_TOKEN_KEY_VERSION=v1
INTEGRATION_STATE_SECRET=<random signing secret>
AUTOMATION_RUNNER_SECRET=<random scheduler secret>
```

The API service account also requires access to the existing Firestore and Cloud Tasks resources used by the platform.

## Shopify activation

### 1. Create the Shopify custom app

Create or install a custom app for the ProInspect Shopify store. Grant the minimum Admin API scopes required for the configured workflow:

- read orders;
- read customers;
- read products.

The current implementation only reads provider data. Inspection workflow changes occur inside ProInspect.

### 2. Store the app secret

`SHOPIFY_WEBHOOK_SECRET` must contain the secret used to sign the app's webhook deliveries.

### 3. Connect the store

Open:

`Inspection Jobs -> Sync & Exceptions -> Shopify Orders`

Enter:

- the canonical `store.myshopify.com` domain;
- the Admin API access token;
- whether ready requests should convert automatically.

The API validates the token by reading shop identity, encrypts the token with AES-256-GCM and saves only a credential reference on the public connection record.

### 4. Register webhooks

When `PUBLIC_API_BASE_URL` is configured, connection can register the following webhook subscriptions:

- orders/create;
- orders/paid;
- orders/updated;
- orders/cancelled;
- refunds/create.

The callback is:

`POST /api/v1/integrations/shopify/webhooks/{agencyId}`

Every delivery must contain a valid Shopify HMAC. Delivery IDs are retained to make processing replay safe.

### 5. Review service mappings

The repository seeds mappings for the connected ProInspect catalogue:

| Service code | Shopify product | ProInspect report |
| --- | --- | --- |
| `entry-pcr` | Property Condition Report | Property Condition Report |
| `routine-inspection` | Routine Inspection | Routine Inspection |
| `exit-inspection` | Exit Inspection | Exit Inspection |
| `commercial-entry` | Commercial Property Condition Report | Property Condition Report |
| `commercial-routine` | Commercial Routine Inspection | Routine Inspection |
| `commercial-exit` | Commercial Exit Inspection | Exit Inspection |
| `maintenance-follow-up` | Maintenance Follow-Up Inspection | Maintenance and Follow-Up Report |

The mapping record is authoritative. Product IDs/variants/SKUs can be changed without changing the Inspection Job domain.

### 6. Reconciliation

Use **Sync orders now** after initial connection and periodically thereafter. Reconciliation retrieves changed orders since the last successful sync and closes gaps caused by a delayed or missed webhook.

## Shopify checkout data

For best matching, Shopify checkout/order data should provide:

- property address;
- customer name;
- customer email;
- customer phone;
- access instructions;
- chosen inspection service.

The parser recognises common order note-attribute names including:

- Property Address;
- Full Property Address;
- Inspection Address;
- Access;
- Access Details;
- Access Instructions;
- Key Safe.

Where a property cannot be matched, the request remains in Intake Queue for review.

## Google Calendar activation

### 1. Create OAuth credentials

Create a Google Cloud OAuth client for a web application and add the exact redirect URI configured in `GOOGLE_CALENDAR_REDIRECT_URI`.

The implementation requests Calendar event and read-only Calendar scopes.

### 2. Connect Google Calendar

Open:

`Inspection Jobs -> Sync & Exceptions -> Google Calendar`

Select **Connect Google Calendar**. The API creates a single-use signed OAuth state record and redirects the browser to Google. The callback verifies signature, age and replay state before accepting tokens.

Refresh tokens are encrypted with the integration encryption key.

### 3. Select the booking calendar

After OAuth:

1. select the dedicated ProInspect booking calendar;
2. set the agency timezone;
3. optionally store public Google appointment-schedule booking-page URLs;
4. save the connection.

Booking-page URLs are operational configuration. Appointment schedule administration remains in Google Calendar.

### 4. Seed event mappings

Default event patterns recognise:

- Property Condition Report / PCR / Entry Inspection;
- Routine Inspection;
- Exit / Vacate / Move-Out Inspection;
- Maintenance Follow-Up.

Ordinary blockouts such as `Block Out`, `Work Placement` and `Building Management` are not converted into inspection requests.

### 5. Create the watch channel

Select **Renew watch** after choosing the Calendar. ProInspect registers an Events watch with a random channel token and stores:

- channel ID;
- resource ID;
- token;
- expiry time.

Google watch channels expire. Renew them before expiry through the UI or an operating procedure.

The callback is:

`POST /api/v1/integrations/google-calendar/notifications/{agencyId}`

The callback validates channel ID, resource ID and channel token. Notifications contain no event body, so ProInspect performs an incremental Events sync using the stored sync token.

### 6. Initial and periodic reconciliation

Use **Sync bookings** for the first import and periodically thereafter. The first sync uses a configurable lookback window. Subsequent syncs use the Calendar sync token.

A stale Google sync token automatically triggers a safe full reconciliation.

## Recommended Google booking questions

The event description parser recognises the following field labels:

- Booked by;
- Customer;
- Client;
- Full Property Address;
- Property Address;
- Access Method;
- Access To Property;
- Access Details;
- Access Information;
- Tenant Name;
- Tenant Email Address;
- Tenant Phone Number;
- Shopify Order;
- Order Number.

Including the Shopify order number is the strongest way to merge a booking with a paid order. Customer email is used only where it identifies one unambiguous unmatched order.

## Combined automation flow

```text
Shopify order received
        |
        v
Inspection Request created
        |
        +-- unpaid ----------> awaiting_payment
        |
        +-- paid, no booking -> awaiting_booking
        |
Google appointment received
        |
        v
Merge by order number / event / unique customer email
        |
        v
Property matching
        |
        +-- ambiguous -------> Intake Queue review
        +-- not found -------> Property onboarding
        +-- matched ---------> ready_for_job
                                |
                                v
                         Inspection Job
```

The job is created only when every configured intake gate is satisfied.

## Two-way Calendar behavior

When a ProInspect job is scheduled or rescheduled, the operator can create/update its Google event.

ProInspect-created events use a deterministic event ID and private extended properties:

- `proinspectAgencyId`;
- `proinspectRequestId`;
- `proinspectJobId`;
- `shopifyOrderId`;
- `source`.

A Calendar reschedule updates a job automatically only while the job is in planning states. Once field work has begun, the job schedule is preserved and a critical sync exception is created.

Calendar cancellation follows the same safety rule. It may cancel intake or early planning work, but never erases completed inspection facts.

## Automation runner

Call:

`POST /api/v1/inspection-operations/run-automation`

Headers:

```text
x-agency-id: <agency id>
x-proinspect-automation-secret: <AUTOMATION_RUNNER_SECRET>
Idempotency-Key: <unique execution key>
```

The command:

- materialises recurring requests in their booking lead window;
- updates SLA state;
- queues upcoming inspection reminders;
- writes an audit summary.

Use a private Cloud Scheduler invocation or an equivalent authenticated task. Do not expose the automation secret in browser code.

## Operational acceptance checklist

- [ ] Shopify token can read shop identity.
- [ ] Shopify webhooks are registered against the production API URL.
- [ ] Invalid Shopify HMAC is rejected.
- [ ] Duplicate Shopify delivery is replay safe.
- [ ] Paid mapped order creates one intake request.
- [ ] Cancelled order before field work cancels safely.
- [ ] Cancelled order after field work raises an exception and preserves evidence.
- [ ] Google OAuth callback rejects stale/replayed state.
- [ ] Calendar tokens are encrypted at rest.
- [ ] Dedicated Calendar is selected.
- [ ] Initial Calendar reconciliation completes.
- [ ] Watch callback validates channel metadata.
- [ ] Booking maps to the correct service.
- [ ] Blockout events are ignored.
- [ ] Order and booking merge into one request.
- [ ] Property ambiguity requires review.
- [ ] Ready request converts exactly once.
- [ ] Job creates or updates one Google event.
- [ ] Calendar conflict after field work raises an exception.
- [ ] Recurring schedule creates one request per due date.
- [ ] Automation reminders and SLA updates are audited.
