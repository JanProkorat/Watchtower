import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// iPhone app — TimeTracker-only (data plane / Supabase). No live-plane
// transport and no noVNC, so this config is the iPad's minus the noVNC alias
// and its top-level-await workarounds.
export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@watchtower/shared': path.resolve(__dirname, '../../packages/shared/src'),
      '@watchtower/ui-core': path.resolve(__dirname, '../../packages/ui-core/src'),
      '@watchtower/data-supabase': path.resolve(__dirname, '../../packages/data-supabase/src'),
      '@watchtower/module-timetracker': path.resolve(__dirname, '../../packages/module-timetracker/src'),
      '@watchtower/module-attention': path.resolve(__dirname, '../../packages/module-attention/src'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    // Floor at Safari 15 / iOS 15 to match the iPad build's supported WebKit.
    target: ['es2022', 'safari15'],
  },
});
