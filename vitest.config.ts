/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// vitest config for the markup-clone repo.
// - jsdom for component tests (none yet but the env is ready)
// - node for the API route tests (super test hitting the route handlers)
// - test files live in tests/unit/, tests/integration/, or anywhere
//   matching *.test.{ts,tsx} or *.spec.{ts,tsx}.
// - Setup file ensures the test DATABASE_URL is set even if a test imports
//   the prisma client before reading env.

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Tests resolve @markup/core against the workspace package SOURCE so
      // `vitest` works on a fresh clone without `npm run build:core` first
      // (the package's exports map points at dist/, which may not exist).
      '@markup/core': path.resolve(__dirname, './packages/markup-core/src'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
      environment: 'node', // default; tests can opt into jsdom via /* @vitest-environment jsdom */
      environmentMatchGlobs: [
        ['tests/widget/**', 'jsdom'],
      ],
    globals: true, // describe/it/expect without imports
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'dist'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks', // don't share state across files; helps with prisma
    poolOptions: {
      forks: {
        singleFork: true, // run tests serially to avoid prisma contention
      },
    },
  },
});
