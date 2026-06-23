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
      '@watchtower/shared': path.resolve(__dirname, '../packages/shared/src'),
      '@watchtower/transport': path.resolve(__dirname, '../packages/transport/src'),
    },
  },
  server: { port: 5173, strictPort: true },
  build: {
    outDir: path.resolve(__dirname, '../dist-renderer'),
    emptyOutDir: true,
  },
});
