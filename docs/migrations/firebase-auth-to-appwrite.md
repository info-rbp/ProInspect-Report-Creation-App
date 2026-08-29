# Firebase Auth to Appwrite Auth

Current authentication uses Firebase/Identity Platform ID tokens, agency memberships, privileged-role TOTP evidence, invitation/admin provisioning, and no arbitrary public membership. Privileged roles are currently `super_admin`, `proinspect_admin`, and `reviewer`.

The inspected Strata source uses PBKDF2 password hashes, seven-day custom sessions, `property_scope`, and roles `system_administrator`, `strata_manager`, `council_member`, `building_manager`, `relief_building_manager`, `contractor`, and `resident`. Those hashes and sessions are not part of Firebase migration and are not copied to Appwrite. Strata users follow the same invite/reauthentication path, with source user/person IDs recorded only as migration identities.

Migration stages:

1. export only supported identity metadata and stable Firebase UID references;
2. create Appwrite users with deterministic mapping recorded in `migration_id_map`;
3. populate `user_profiles`, `agency_memberships`, and `site_memberships` separately;
4. use an officially supported password-hash migration only after algorithm/parameters are verified, otherwise require recovery/reauthentication;
5. require email verification and privileged TOTP enrolment/recovery-code capture before privileged capability activation;
6. invalidate legacy sessions only after Appwrite login, membership, MFA, recovery, suspension, and audit tests pass.

Identity order is profile plan -> invitation/reauthentication -> verified email -> agency membership -> site membership/portal grant -> role capability verification -> MFA enrolment where required -> session revocation rehearsal. Firebase UID and Strata user/person IDs map independently to one Appwrite user; email matching is a review candidate, never an automatic identity merge.

The proposed role model preserves existing names until owners approve aliases. ProInspect internal roles keep agency scope; inspectors/reviewers also require assignment. Strata building/relief managers, contractors and residents require explicit site scope; relief expiry is enforced. Strata/council roles may be multi-site only inside explicit agency membership. `system_administrator` is not automatically equivalent to `super_admin`.

OAuth providers, if enabled later, must produce the same membership and MFA checks; OAuth identity alone grants no agency/site membership. Account recovery must revoke prior sessions, require verified return URLs, protect against account enumeration and force privileged MFA recovery/re-enrolment. Reconciliation includes exported eligible identities, invited/activated/skipped/failed counts, UID maps, duplicate-email decisions, role/scope distributions, verified-email state, MFA enrolment, recovery test and session-revocation test.

Never export or log passwords, raw recovery codes, sessions, ID tokens, TOTP secrets, or API keys. A restored password-only session is not sufficient for a privileged Appwrite principal. Public account creation must not grant agency membership.
