import type {
  ApiDependencies,
  ExternalGrantStore,
  NotificationDeliveryStore,
  ReportVersionReader,
} from './types.js';

function missingDependency(name: string): Error {
  return Object.assign(
    new Error(`${name} runtime provider is not configured.`),
    {
      code: 'RUNTIME_PROVIDER_REQUIRED',
      status: 500,
      details: { provider: name },
    },
  );
}

export function requireReportVersionReader(
  dependencies: ApiDependencies,
): ReportVersionReader {
  if (!dependencies.reportVersions) {
    throw missingDependency('reportVersions');
  }
  return dependencies.reportVersions;
}

export function requireNotificationDeliveryStore(
  dependencies: ApiDependencies,
): NotificationDeliveryStore {
  if (!dependencies.notificationDelivery) {
    throw missingDependency('notificationDelivery');
  }
  return dependencies.notificationDelivery;
}


export function requireExternalGrantStore(
  dependencies: ApiDependencies,
): ExternalGrantStore {
  if (!dependencies.externalGrants) {
    throw missingDependency('externalGrants');
  }

  return dependencies.externalGrants;
}
