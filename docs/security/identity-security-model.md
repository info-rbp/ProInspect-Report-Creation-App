# Identity and security model

## Decision

The platform uses Google Cloud Identity Platform for human authentication and a server-authoritative Cloud Run API for every privileged decision. Browser routes and browser-supplied `agencyId`, role, owner IDs or assignment IDs are never security boundaries.

The initial internal release may use one Identity Platform tenant with authoritative agency membership stored at `agencies/{agencyId}/memberships/{uid}`. Before any external agency is onboarded, create one Identity Platform tenant per agency and make the Identity Platform tenant ID resolve to the platform agency ID.

## Request security sequence

Every protected API command must:

1. verify the Identity Platform ID token and check revocation;
2. verify App Check for the public web client;
3. resolve the agency from the verified tenant or trusted claim;
4. load the active server-side agency membership;
5. use the membership role, never the browser role;
6. enforce capability, record scope, assignment and lifecycle state;
7. enforce separation of duties and MFA policy;
8. append an immutable audit event for allowed and denied sensitive actions.

## Google Cloud placeholders

The repository cannot perform the following without an applied Google Cloud environment and organisation-specific values. Complete these after Phase 3 development and staging projects exist.

- Create the initial Identity Platform tenant and record its tenant ID as a protected environment variable.
- Before external onboarding, create one tenant per agency and store the mapping in the agency record.
- Enable MFA and require enrolment for `proinspect_admin`, `reviewer` and exceptional `super_admin` access.
- Configure a strong password policy and email enumeration protection.
- Configure authorised domains and disable anonymous sign-in and public self-sign-up.
- Register the production web client with Firebase App Check and set `REQUIRE_APP_CHECK=true` on the API.
- Configure session revocation operations for suspension, role change, agency removal and suspected compromise.
- Configure Cloud Armor or API Gateway quotas in front of the public API where appropriate.
- Confirm Identity Platform audit logs are retained in the regional logging strategy.

See `google-cloud-activation.md` for exact operational checks and evidence to retain.

## Membership document

```json
{
  "uid": "identity-platform-uid",
  "agencyId": "agency-id",
  "role": "reviewer",
  "status": "active",
  "mfaRequired": true,
  "invitationExpiresAt": "2026-08-01T00:00:00Z",
  "propertyIds": [],
  "tenancyIds": [],
  "inspectionJobIds": [],
  "reportIds": [],
  "updatedAt": "2026-07-20T00:00:00Z"
}
```

Membership writes are restricted to the Admin SDK/API. Firestore clients cannot create or alter memberships.

## Data rules

Firestore and Storage are deny-by-default. Client access is read-only where a genuine browser use case exists. Privileged writes, audit writes, workflow transitions, final report creation and membership changes use the Cloud Run API/Admin SDK, which bypasses client rules and must apply the policy engine first.
