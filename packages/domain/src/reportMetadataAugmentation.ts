declare module './reportModel.js' {
  interface ReportMetadataRecord {
    issuedAt?: string;
    tenantReviewDueAt?: string;
    brandingProfileId?: string;
    brandingProfileVersion?: number;
  }
}

export {};
