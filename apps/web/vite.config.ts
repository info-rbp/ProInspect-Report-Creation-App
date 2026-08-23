import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const configuredApiBase = env.VITE_API_BASE_URL?.trim() || '';
  const useDevProxy = command === 'serve' && env.VITE_USE_DEV_API_PROXY === 'true';
  const effectiveApiBase = configuredApiBase || (useDevProxy ? '/' : '');

  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
      proxy: useDevProxy ? {
        '/api': {
          target: 'http://127.0.0.1:8080',
          changeOrigin: true,
        },
      } : undefined,
    },
    // Older service modules still read VITE_API_BASE_URL directly. In explicit
    // development proxy mode give all of them the same same-origin base (`/`).
    // Production/staging continue to receive the deployed absolute URL from env.
    define: {
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify(effectiveApiBase),
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
        '@pcr/domain': path.resolve(import.meta.dirname, '../../packages/domain/src/index.ts'),
        '@pcr/templates/pcrPreset': path.resolve(import.meta.dirname, '../../packages/templates/src/pcrPreset.ts'),
        '@pcr/templates/canonicalCatalogue': path.resolve(import.meta.dirname, '../../packages/templates/src/canonicalCatalogue.ts'),
        '@pcr/templates/catalogueAdmin': path.resolve(import.meta.dirname, '../../packages/templates/src/catalogueAdmin.ts'),
        '@pcr/templates/propertyLayoutCatalogue': path.resolve(import.meta.dirname, '../../packages/templates/src/propertyLayoutCatalogue.ts'),
        '@pcr/templates': path.resolve(import.meta.dirname, '../../packages/templates/src/index.ts'),
        '@pcr/report-presentation/view-model': path.resolve(import.meta.dirname, '../../packages/report-presentation/src/viewModel.ts'),
        '@pcr/report-presentation/document-model': path.resolve(import.meta.dirname, '../../packages/report-presentation/src/documentModel.ts'),
        '@pcr/report-presentation/presets': path.resolve(import.meta.dirname, '../../packages/report-presentation/src/presets.ts'),
        '@pcr/report-presentation': path.resolve(import.meta.dirname, '../../packages/report-presentation/src/index.ts'),
      },
    },
    build: { outDir: 'dist' },
  };
});
