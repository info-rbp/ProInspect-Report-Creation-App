import type {
  InspectionJob as DomainInspectionJob,
  PropertyRecord as DomainPropertyRecord,
} from '@pcr/domain';

/**
 * The browser consumes the canonical platform domain model directly. Keeping this
 * module as the public web import surface avoids duplicating property, tenancy,
 * maintenance and workflow types while the application is migrated incrementally.
 */
export * from '@pcr/domain';

/** API-backed records expose optimistic-lock versions at runtime. */
export type PropertyRecord = DomainPropertyRecord & { version?: number };
export type InspectionJob = DomainInspectionJob & { version?: number };
