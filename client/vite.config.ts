import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  // Relative base so the packaged renderer (loaded via file:// by Electron's
  // loadFile) resolves /assets/* against index.html, not the filesystem root.
  base: './',
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: {
    outDir: path.resolve(__dirname, '../dist-renderer'),
    emptyOutDir: true,
  },
});
