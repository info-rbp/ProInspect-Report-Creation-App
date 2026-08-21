import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const stackedFeatureScaffolding = [
  'apps/api/src/backend/googleCalendarIntegrationRoutes.ts',
  'apps/api/src/backend/inspectionOperationsRoutes.ts',
  'apps/api/src/backend/legacyBaselineRoutes.ts',
  'apps/api/src/backend/maintenanceCommercialRoutes.ts',
  'apps/api/src/backend/shopifyIntegrationRoutes.ts',
  'apps/api/src/services/maintenanceCommercialService.ts',
  'apps/api/src/services/xeroAccountingService.ts',
  'apps/web/components/jobs/InspectionJobOperationsPanel.tsx',
  'apps/web/components/jobs/InspectionSyncPanel.tsx',
  'apps/web/components/maintenance/MaintenanceContractorQuotesPanel.tsx',
  'apps/web/components/properties/PropertyFloorPlanPanel.tsx',
  'apps/web/pages/admin/InspectionOperationsPage.tsx',
  'apps/web/pages/admin/MaintenanceOperationsPage.tsx',
  'apps/web/pages/admin/PropertyWorkspacePage.tsx',
  'apps/web/pages/admin/ReportDetailPage.tsx',
  'apps/web/services/platform/inspectionOperationsService.ts',
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '.firebase-emulator-data/**',
      'apps/web/types/heic2any.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs', 'eslint.config.js'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // These files belong to the stacked Properties / Inspection Operations / Maintenance
    // feature sequence and currently retain harmless imports or compatibility destructuring
    // while those parent branches are consolidated. Keep the exception path-scoped so new
    // Reports and platform code remains subject to the normal unused-variable rule.
    files: stackedFeatureScaffolding,
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    // The renderer intentionally normalises an unknown repository value to truthiness.
    files: ['apps/pdf-worker/src/renderer.ts'],
    rules: {
      'no-extra-boolean-cast': 'off',
    },
  },
);
