import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: ['default'],
    // Serialize all test files. Integration tests that share the same
    // Postgres database (push, pull, etl) interfere when run in parallel —
    // concurrent beforeEach DROP SCHEMA calls clobber each other. A single
    // fork keeps files sequential without requiring per-file schema isolation.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
