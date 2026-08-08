import { defineConfig } from 'vitest/config';

const common = {
  pool: 'forks' as const,
  fileParallelism: false,
  maxWorkers: 1,
  globals: true,
};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          ...common,
          name: 'web',
          environment: 'jsdom',
          include: ['apps/web/tests/**/*.test.ts', 'apps/web/tests/**/*.test.tsx'],
        },
      },
      {
        test: {
          ...common,
          name: 'node',
          environment: 'node',
          include: ['apps/api/tests/**/*.test.ts', 'packages/*/tests/**/*.test.ts'],
        },
      },
    ],
  },
});
