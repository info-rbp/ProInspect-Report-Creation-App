export interface ComplianceRuleVersion {
  id: string;
  agencyId?: string;
  code: string;
  jurisdiction?: string;
  appliesTo: 'property' | 'tenancy' | 'inspection' | 'maintenance' | 'contractor' | 'document';
  trigger: string;
  dueOffsetDays?: number;
  evidenceRequirements: string[];
  severity: 'info' | 'warning' | 'critical';
  status: 'draft' | 'published' | 'retired';
  effectiveFrom: string;
  effectiveTo?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ComplianceObligation {
  id: string;
  agencyId: string;
  ruleVersionId: string;
  entityType: string;
  entityId: string;
  label: string;
  status: 'open' | 'satisfied' | 'overdue' | 'waived' | 'not_applicable';
  dueAt?: string;
  ownerUserId?: string;
  evidenceIds: string[];
  satisfiedAt?: string;
  waivedReason?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ComplianceAssessment {
  evaluatedAt: string;
  entityType: string;
  entityId: string;
  open: number;
  overdue: number;
  critical: number;
  obligations: ComplianceObligation[];
}
