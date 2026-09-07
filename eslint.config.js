import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const scopedUnusedVariableExceptions = [
  'apps/api/src/backend/googleCalendarIntegrationRoutes.ts',
  'apps/api/src/backend/inspectionOperationsRoutes.ts',
  'apps/api/src/backend/legacyBaselineRoutes.ts',
  'apps/api/src/backend/maintenanceCommercialRoutes.ts',
  'apps/api/src/backend/shopifyIntegrationRoutes.ts',
  'apps/api/src/services/maintenanceCommercialService.ts',
  'apps/api/src/services/xeroAccountingService.ts',
  'apps/notification-worker/src/runtime.ts',
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

const generatedUpgradePatchers = [
  'infrastructure/upgrades/platform-completion-v1/apply-02e-v2.mjs',
  'infrastructure/upgrades/platform-completion-v1/apply-04-v2.mjs',
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
    files: ['scripts/**/*.mjs', 'infrastructure/**/*.mjs', 'eslint.config.js'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
      },
    },
  },
  {
    files: ['cloudflare/**/*.js'],
    languageOptions: {
      globals: {
        console: 'readonly',
        URL: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        fetch: 'readonly',
      },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Keep compatibility-oriented unused-variable exceptions path-scoped. The
    // notification worker currently imports one Firestore type retained for the
    // typed delivery boundary while the legacy worker entrypoint is retired.
    files: scopedUnusedVariableExceptions,
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    // Stage 2E/4 patchers embed TypeScript/regex source inside template strings.
    // Keep the escape exception limited to those code-generator files; emitted
    // application source remains fully linted by the normal rules.
    files: generatedUpgradePatchers,
    rules: {
      'no-useless-escape': 'off',
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
