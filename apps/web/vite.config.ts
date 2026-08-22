import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  server: { port: 3000, host: '0.0.0.0' },
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
});
