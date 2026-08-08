# Google Cloud identity activation checklist

These tasks are placeholders until the Phase 3 environments have been applied. Record project IDs, tenant IDs, dates and screenshots or exported configuration in the deployment evidence register. Do not store secrets in this repository.

## Development

- [ ] Apply the development landing zone.
- [ ] Create the internal Identity Platform tenant.
- [ ] Disable anonymous authentication and public self-sign-up.
- [ ] Enable email enumeration protection.
- [ ] Configure password policy: minimum 14 characters and rejection of common or compromised passwords where supported.
- [ ] Enable MFA and enrol all administrators and reviewers.
- [ ] Register the web app with App Check; use debug tokens only in local development.
- [ ] Set Cloud Run variables `IDENTITY_PLATFORM_TENANT_ID`, `REQUIRE_APP_CHECK=true`, and the expected audience/project values.
- [ ] Seed agency memberships through an audited administrator process.
- [ ] Run cross-agency, privilege-escalation, revoked-session and App Check integration tests.

## Staging

- [ ] Repeat configuration from source-controlled Terraform or documented API commands.
- [ ] Confirm no console-only difference from development except approved environment values.
- [ ] Test account suspension and refresh-token revocation.
- [ ] Test invitation expiry and reassignment history.
- [ ] Verify denied access events and successful privileged actions appear in Cloud Logging and append-only audit records.

## Production approval gate

- [ ] Security reviewer approves the role and capability matrix.
- [ ] Privacy reviewer approves tenant separation and log retention.
- [ ] Required MFA enrolment report shows 100% compliance for privileged users.
- [ ] App Check enforcement is enabled.
- [ ] Email enumeration protection is enabled.
- [ ] Password policy is enabled.
- [ ] Break-glass access is documented, time-limited and audited.
- [ ] Tenant-per-agency migration is completed before an external agency is onboarded.

## Evidence required to close Phase 4

- exported Identity Platform configuration or approved screenshots;
- tenant and agency mapping register;
- MFA enrolment evidence;
- passing cross-agency and privilege-escalation test results;
- sample allowed and denied audit events;
- session revocation test evidence;
- App Check rejection and acceptance test evidence.
