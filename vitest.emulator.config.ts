import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { pool: 'forks', fileParallelism: false, maxWorkers: 1, environment: 'node', include: ['tests/emulator/**/*.test.ts'], testTimeout: 15000 } });
