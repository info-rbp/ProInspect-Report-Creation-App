# Firebase Auth to Appwrite Auth

Current authentication uses Firebase/Identity Platform ID tokens, agency memberships, privileged-role TOTP evidence, invitation/admin provisioning, and no arbitrary public membership. Privileged roles are currently `super_admin`, `proinspect_admin`, and `reviewer`.

Migration stages:

1. export only supported identity metadata and stable Firebase UID references;
2. create Appwrite users with deterministic mapping recorded in `migration_id_map`;
3. populate `user_profiles`, `agency_memberships`, and `site_memberships` separately;
4. use an officially supported password-hash migration only after algorithm/parameters are verified, otherwise require recovery/reauthentication;
5. require email verification and privileged TOTP enrolment/recovery-code capture before privileged capability activation;
6. invalidate legacy sessions only after Appwrite login, membership, MFA, recovery, suspension, and audit tests pass.

Never export or log passwords, raw recovery codes, sessions, ID tokens, TOTP secrets, or API keys. A restored password-only session is not sufficient for a privileged Appwrite principal. Public account creation must not grant agency membership.
