# People & Access activation gate

The People & Access code path is implemented behind server-authoritative Identity Platform and agency membership checks. Do not enable this feature in production until the environment controls below are verified.

## Required environment activation

- Rotate any credential that previously appeared in client source or repository history.
- Enable Identity Platform and disable anonymous/public self-sign-up.
- Configure one tenant per external agency before external onboarding.
- Enforce MFA enrolment for platform administrators, agency administrators and reviewers.
- Enable password policy and email enumeration protection.
- Configure Firebase App Check and keep `REQUIRE_APP_CHECK=true` outside tests.
- Deploy the deny-by-default Firestore rules in this branch.
- Confirm only Admin SDK/API identities can create or mutate memberships, invitations and workforce profiles.
- Configure invitation email delivery using the approved notification provider. The API creates the authoritative invitation and identity; provider delivery remains an environment integration concern.
- Verify refresh-token revocation for suspension, revocation and role change.
- Run cross-agency, privilege escalation, last-admin, self-deactivation and invitation-expiry tests in staging.
- Retain allowed/denied security audit events and user-administration material-action audit events.

## Release evidence

Capture deployed rules, Identity Platform configuration, MFA compliance, App Check enforcement, session revocation results, invitation delivery evidence and passing CI/security tests before enabling People & Access for production administrators.
