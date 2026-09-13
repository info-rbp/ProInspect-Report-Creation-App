# Appwrite credential bootstrap for launch readiness

Appwrite no longer supports the launch controller's original programmatic stored-key creation flow. Launch readiness therefore uses an operator-assisted bootstrap that keeps key creation in the Appwrite Console while preserving target, scope, lifetime, Secret Manager, rotation and revocation checks in the controller.

## Installer key

For an Appwrite operation that uses `withAppwrite`, create a dedicated stored key in the Appwrite Console for the exact non-production project.

Requirements:

- name starts with `launch-installer-`;
- scopes exactly match the command being executed;
- expiry is no more than one hour from execution;
- the key is dedicated to the current launch operation and is not a standing application credential.

Export the key ID and secret only in the authenticated operator shell:

```bash
export APPWRITE_INSTALLER_KEY_ID='<console-created-key-id>'
export APPWRITE_INSTALLER_KEY_SECRET='<console-created-key-secret>'
```

The controller verifies the live key inventory, exact ID, name prefix, exact scopes and one-hour lifetime before the operation. It deletes the stored key in `finally` and records only non-secret key metadata in the private launch state. If metadata is wrong or incomplete, no key is deleted and no Appwrite operation is attempted.

Create a fresh installer key for the next command after the previous key has been revoked.

## Runtime service keys

Runtime service credentials are created manually in the Appwrite Console because the platform does not expose the required stored-key creation operation to the pinned CLI.

For each reviewed `runtimeCredentialPolicies` service:

1. Create a stored Appwrite key named `launch-<environment>-<service>-<unique suffix>`.
2. Apply exactly the reviewed scopes.
3. Set expiry no later than the policy's `expiryHours`.
4. Add the returned secret directly to the policy's Google Secret Manager secret as a new immutable version. Do not place the secret in Git, launch configuration, command arguments or diagnostic files.
5. Export only the non-secret key ID and Secret Manager version number.

Environment variable names are derived from the service name. For `pdf-worker`, for example:

```bash
export APPWRITE_RUNTIME_KEY_ID_PDF_WORKER='<appwrite-key-id>'
export APPWRITE_RUNTIME_SECRET_VERSION_PDF_WORKER='<secret-manager-version-number>'
```

The credential stage verifies:

- the key exists in the exact Appwrite project;
- its name identifies the intended environment and service;
- its scopes exactly equal the reviewed policy;
- its remaining lifetime is usable and its expiry does not exceed the reviewed lifetime;
- the named immutable Secret Manager version exists and is enabled.

Only after these checks does the controller record the key metadata, bind the immutable Secret Manager version in private launch configuration and mark a still-valid predecessor as `retiring` for rollback. Expired predecessor keys may then be deleted. The controller never receives or writes the runtime key secret.

## Failure behaviour

Missing bootstrap inputs, wrong project identity, wrong key name, scope drift, excessive lifetime, truncated key inventory, missing Secret Manager versions or disabled Secret Manager versions fail closed before adoption.

Do not substitute Appwrite ephemeral JWT keys for stored installer/runtime keys. Ephemeral keys do not satisfy the controller's stored-key identity and immediate revocation contract.
