import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@watchtower/shared': path.resolve(__dirname, '../../packages/shared/src'),
      '@watchtower/transport': path.resolve(__dirname, '../../packages/transport/src'),
      '@watchtower/ui-core': path.resolve(__dirname, '../../packages/ui-core/src'),
      '@watchtower/data-supabase': path.resolve(__dirname, '../../packages/data-supabase/src'),
      '@watchtower/module-timetracker': path.resolve(__dirname, '../../packages/module-timetracker/src'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
});
