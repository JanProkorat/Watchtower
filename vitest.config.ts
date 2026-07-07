import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@watchtower/shared': path.resolve(__dirname, 'packages/shared/src'),
      '@watchtower/transport': path.resolve(__dirname, 'packages/transport/src'),
      // node_modules/@watchtower/data-supabase is a symlink shared with the main
      // worktree (see node_modules -> ../node_modules at the repo root); without
      // this alias, tests import the MAIN tree's packages/data-supabase source
      // instead of this worktree's edits — silent false-green results.
      '@watchtower/data-supabase': path.resolve(__dirname, 'packages/data-supabase/src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: ['default'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
