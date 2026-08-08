import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { name: 'web', environment: 'jsdom', globals: true, include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'] } });
