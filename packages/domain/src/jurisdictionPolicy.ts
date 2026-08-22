export type JurisdictionCode = 'AU-WA' | string;
export type TenancyKind = 'residential' | 'commercial' | 'retail' | 'other';
export type DocumentAction = 'execute' | 'acknowledge' | 'serve';
export type DocumentMutationPolicy = 'no_text_changes' | 'additional_details_only' | 'agency_editable';

export interface JurisdictionDocumentRule {
  id: string;
  formCode?: string;
  purpose: string;
  templateVersionId: string;
  action: DocumentAction;
  required: boolean;
  requiredSignerRoles: string[];
  requiredAttachmentPurposes: string[];
  approvalCapabilities: string[];
  permittedServiceMethods: string[];
  minimumNoticeDays?: number;
  mutationPolicy: DocumentMutationPolicy;
}

export interface JurisdictionPolicyVersion {
  id: string;
  agencyId?: string;
  jurisdiction: JurisdictionCode;
  tenancyKind: TenancyKind;
  workflow: string;
  versionNumber: number;
  status: 'draft' | 'published' | 'retired';
  effectiveFrom: string;
  effectiveTo?: string;
  sourceAuthority?: string;
  rules: JurisdictionDocumentRule[];
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

export function policyApplies(policy: JurisdictionPolicyVersion, at: string): boolean {
  const time = Date.parse(at);
  return policy.status === 'published' && Date.parse(policy.effectiveFrom) <= time && (!policy.effectiveTo || Date.parse(policy.effectiveTo) >= time);
}
