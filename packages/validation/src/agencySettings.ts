import type {
  AgencyBrandingProfile,
  AgencyOperationalSettings,
  AgencyOrganisationSettings,
  CommunicationPolicy,
  MaintenancePolicySettings,
} from '@pcr/domain';
import type { ValidationResult, ValidationSchema } from './index.js';

function fail(message: string, field?: string): ValidationResult<never> {
  return { ok: false, error: { code: 'VALIDATION_ERROR', message, status: 400, ...(field ? { details: { field } } : {}) } };
}

function record(value: unknown): ValidationResult<Record<string, unknown>> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ok: true, value: value as Record<string, unknown> }
    : fail('Request body must be a JSON object.');
}

function optionalString(value: unknown, field: string, maximum = 500): ValidationResult<string | undefined> {
  if (value === undefined || value === null || value === '') return { ok: true, value: undefined };
  if (typeof value !== 'string' || value.trim().length > maximum) return fail(`${field} must be a string of ${maximum} characters or fewer.`, field);
  return { ok: true, value: value.trim() };
}

function email(value: unknown, field: string): ValidationResult<string | undefined> {
  const parsed = optionalString(value, field, 254);
  if (!parsed.ok || !parsed.value) return parsed;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(parsed.value) ? parsed : fail(`${field} must be a valid email address.`, field);
}

function url(value: unknown, field: string): ValidationResult<string | undefined> {
  const parsed = optionalString(value, field, 2048);
  if (!parsed.ok || !parsed.value) return parsed;
  try {
    const candidate = new URL(parsed.value);
    if (!['http:', 'https:'].includes(candidate.protocol)) throw new Error('protocol');
    return parsed;
  } catch {
    return fail(`${field} must be a valid http or https URL.`, field);
  }
}

function numberRange(value: unknown, field: string, minimum: number, maximum: number, fallback?: number): ValidationResult<number> {
  const candidate = value === undefined && fallback !== undefined ? fallback : value;
  if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate < minimum || candidate > maximum) {
    return fail(`${field} must be between ${minimum} and ${maximum}.`, field);
  }
  return { ok: true, value: candidate };
}

function stringRequired(value: unknown, field: string, maximum = 200): ValidationResult<string> {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) return fail(`${field} is required and must be ${maximum} characters or fewer.`, field);
  return { ok: true, value: value.trim() };
}

function enumValue<T extends string>(value: unknown, field: string, allowed: readonly T[]): ValidationResult<T> {
  return typeof value === 'string' && allowed.includes(value as T) ? { ok: true, value: value as T } : fail(`${field} is not supported.`, field);
}

function hex(value: unknown, field: string): ValidationResult<string | undefined> {
  const parsed = optionalString(value, field, 7);
  if (!parsed.ok || !parsed.value) return parsed;
  return /^#[0-9a-f]{6}$/iu.test(parsed.value) ? parsed : fail(`${field} must be a six-digit hex colour.`, field);
}

export const agencyOrganisationSettingsSchema: ValidationSchema<Omit<AgencyOrganisationSettings, 'id' | 'agencyId' | 'version' | 'createdAt' | 'updatedAt'>> = {
  parse(value) {
    const parsed = record(value); if (!parsed.ok) return parsed;
    const registeredName = stringRequired(parsed.value.registeredName, 'registeredName'); if (!registeredName.ok) return registeredName;
    const timezone = stringRequired(parsed.value.timezone ?? 'Australia/Perth', 'timezone', 100); if (!timezone.ok) return timezone;
    try { new Intl.DateTimeFormat('en-AU', { timeZone: timezone.value }).format(); } catch { return fail('timezone must be a valid IANA timezone.', 'timezone'); }
    const locale = stringRequired(parsed.value.locale ?? 'en-AU', 'locale', 35); if (!locale.ok) return locale;
    const currency = stringRequired(parsed.value.currency ?? 'AUD', 'currency', 3); if (!currency.ok || !/^[A-Z]{3}$/u.test(currency.value.toUpperCase())) return fail('currency must be a three-letter ISO currency code.', 'currency');
    const countryCode = stringRequired(parsed.value.countryCode ?? 'AU', 'countryCode', 2); if (!countryCode.ok || !/^[A-Z]{2}$/u.test(countryCode.value.toUpperCase())) return fail('countryCode must be a two-letter country code.', 'countryCode');
    const month = numberRange(parsed.value.financialYearStartMonth, 'financialYearStartMonth', 1, 12, 7); if (!month.ok) return month;
    const taxRate = numberRange(parsed.value.defaultTaxRate, 'defaultTaxRate', 0, 100, 10); if (!taxRate.ok) return taxRate;
    const status = enumValue(parsed.value.status ?? 'active', 'status', ['draft', 'active', 'retired'] as const); if (!status.ok) return status;
    const tradingName = optionalString(parsed.value.tradingName, 'tradingName', 200); if (!tradingName.ok) return tradingName;
    const abn = optionalString(parsed.value.abn, 'abn', 20); if (!abn.ok) return abn;
    if (abn.value && !/^\d{11}$/u.test(abn.value.replace(/\s/gu, ''))) return fail('abn must contain 11 digits.', 'abn');
    const website = url(parsed.value.website, 'website'); if (!website.ok) return website;
    const contactEmail = email(parsed.value.contactEmail, 'contactEmail'); if (!contactEmail.ok) return contactEmail;
    const supportEmail = email(parsed.value.supportEmail, 'supportEmail'); if (!supportEmail.ok) return supportEmail;
    const privacyEmail = email(parsed.value.privacyEmail, 'privacyEmail'); if (!privacyEmail.ok) return privacyEmail;
    const defaultReplyToEmail = email(parsed.value.defaultReplyToEmail, 'defaultReplyToEmail'); if (!defaultReplyToEmail.ok) return defaultReplyToEmail;
    const contactPhone = optionalString(parsed.value.contactPhone, 'contactPhone', 50); if (!contactPhone.ok) return contactPhone;
    const taxLabel = stringRequired(parsed.value.taxLabel ?? 'GST', 'taxLabel', 20); if (!taxLabel.ok) return taxLabel;
    const taxRegistrationNumber = optionalString(parsed.value.taxRegistrationNumber, 'taxRegistrationNumber', 50); if (!taxRegistrationNumber.ok) return taxRegistrationNumber;
    return { ok: true, value: {
      registeredName: registeredName.value,
      status: status.value,
      timezone: timezone.value,
      locale: locale.value,
      currency: currency.value.toUpperCase(),
      countryCode: countryCode.value.toUpperCase(),
      financialYearStartMonth: month.value,
      taxLabel: taxLabel.value,
      defaultTaxRate: taxRate.value,
      ...(tradingName.value ? { tradingName: tradingName.value } : {}),
      ...(abn.value ? { abn: abn.value.replace(/\s/gu, '') } : {}),
      ...(website.value ? { website: website.value } : {}),
      ...(contactEmail.value ? { contactEmail: contactEmail.value } : {}),
      ...(contactPhone.value ? { contactPhone: contactPhone.value } : {}),
      ...(supportEmail.value ? { supportEmail: supportEmail.value } : {}),
      ...(privacyEmail.value ? { privacyEmail: privacyEmail.value } : {}),
      ...(defaultReplyToEmail.value ? { defaultReplyToEmail: defaultReplyToEmail.value } : {}),
      ...(taxRegistrationNumber.value ? { taxRegistrationNumber: taxRegistrationNumber.value } : {}),
      ...(parsed.value.businessAddress && typeof parsed.value.businessAddress === 'object' ? { businessAddress: parsed.value.businessAddress as AgencyOrganisationSettings['businessAddress'] } : {}),
      ...(parsed.value.postalAddress && typeof parsed.value.postalAddress === 'object' ? { postalAddress: parsed.value.postalAddress as AgencyOrganisationSettings['postalAddress'] } : {}),
    } };
  },
};

export const agencyBrandingProfileSchema: ValidationSchema<Omit<AgencyBrandingProfile, 'agencyId' | 'version' | 'createdAt' | 'updatedAt'>> = {
  parse(value) {
    const parsed = record(value); if (!parsed.ok) return parsed;
    const id = stringRequired(parsed.value.id, 'id', 100); if (!id.ok) return id;
    const name = stringRequired(parsed.value.name, 'name', 120); if (!name.ok) return name;
    const status = enumValue(parsed.value.status ?? 'draft', 'status', ['draft', 'active', 'retired'] as const); if (!status.ok) return status;
    const primaryColour = hex(parsed.value.primaryColour, 'primaryColour'); if (!primaryColour.ok) return primaryColour;
    const secondaryColour = hex(parsed.value.secondaryColour, 'secondaryColour'); if (!secondaryColour.ok) return secondaryColour;
    const accentColour = hex(parsed.value.accentColour, 'accentColour'); if (!accentColour.ok) return accentColour;
    const privacyNoticeUrl = url(parsed.value.privacyNoticeUrl, 'privacyNoticeUrl'); if (!privacyNoticeUrl.ok) return privacyNoticeUrl;
    return { ok: true, value: { ...(parsed.value as Omit<AgencyBrandingProfile, 'agencyId' | 'version' | 'createdAt' | 'updatedAt'>), id: id.value, name: name.value, status: status.value, ...(primaryColour.value ? { primaryColour: primaryColour.value } : {}), ...(secondaryColour.value ? { secondaryColour: secondaryColour.value } : {}), ...(accentColour.value ? { accentColour: accentColour.value } : {}), ...(privacyNoticeUrl.value ? { privacyNoticeUrl: privacyNoticeUrl.value } : {}) } };
  },
};

export const agencyOperationalSettingsSchema: ValidationSchema<Omit<AgencyOperationalSettings, 'id' | 'agencyId' | 'version' | 'createdAt' | 'updatedAt'>> = {
  parse(value) {
    const parsed = record(value); if (!parsed.ok) return parsed;
    const strategy = enumValue(parsed.value.assignmentStrategy ?? 'manual', 'assignmentStrategy', ['manual', 'workload', 'service_area', 'round_robin', 'qualification'] as const); if (!strategy.ok) return strategy;
    const status = enumValue(parsed.value.status ?? 'active', 'status', ['draft', 'active', 'retired'] as const); if (!status.ok) return status;
    if (!Array.isArray(parsed.value.inspectionDefaults)) return fail('inspectionDefaults must be an array.', 'inspectionDefaults');
    return { ok: true, value: { ...(parsed.value as Omit<AgencyOperationalSettings, 'id' | 'agencyId' | 'version' | 'createdAt' | 'updatedAt'>), assignmentStrategy: strategy.value, status: status.value } };
  },
};

export const communicationPolicySchema: ValidationSchema<Omit<CommunicationPolicy, 'id' | 'agencyId' | 'version' | 'createdAt' | 'updatedAt'>> = {
  parse(value) {
    const parsed = record(value); if (!parsed.ok) return parsed;
    if (!Array.isArray(parsed.value.providers)) return fail('providers must be an array.', 'providers');
    const status = enumValue(parsed.value.status ?? 'active', 'status', ['draft', 'active', 'retired'] as const); if (!status.ok) return status;
    return { ok: true, value: { ...(parsed.value as Omit<CommunicationPolicy, 'id' | 'agencyId' | 'version' | 'createdAt' | 'updatedAt'>), status: status.value } };
  },
};

export const maintenancePolicySettingsSchema: ValidationSchema<Omit<MaintenancePolicySettings, 'id' | 'agencyId' | 'version' | 'createdAt' | 'updatedAt'>> = {
  parse(value) {
    const parsed = record(value); if (!parsed.ok) return parsed;
    const tax = numberRange(parsed.value.defaultTaxRate, 'defaultTaxRate', 0, 100, 10); if (!tax.ok) return tax;
    const markup = numberRange(parsed.value.defaultMarkupPercent, 'defaultMarkupPercent', 0, 500, 0); if (!markup.ok) return markup;
    const quoteValidity = numberRange(parsed.value.quoteValidityDays, 'quoteValidityDays', 1, 365, 30); if (!quoteValidity.ok) return quoteValidity;
    const quoteCount = numberRange(parsed.value.minimumContractorQuoteCount, 'minimumContractorQuoteCount', 1, 10, 1); if (!quoteCount.ok) return quoteCount;
    const status = enumValue(parsed.value.status ?? 'active', 'status', ['draft', 'active', 'retired'] as const); if (!status.ok) return status;
    return { ok: true, value: { ...(parsed.value as Omit<MaintenancePolicySettings, 'id' | 'agencyId' | 'version' | 'createdAt' | 'updatedAt'>), defaultTaxRate: tax.value, defaultMarkupPercent: markup.value, quoteValidityDays: quoteValidity.value, minimumContractorQuoteCount: quoteCount.value, status: status.value } };
  },
};
