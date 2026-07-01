import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react()],
  // noVNC uses top-level await (H264 capability check). The build target below
  // allows it for production, but the dev server's esbuild defaults to es2020
  // and rejects TLA — align both the transform and dep-prebundle targets here.
  esbuild: { target: 'es2022' },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
  resolve: {
    alias: {
      '@watchtower/shared': path.resolve(__dirname, '../../packages/shared/src'),
      '@watchtower/transport': path.resolve(__dirname, '../../packages/transport/src'),
      '@watchtower/ui-core': path.resolve(__dirname, '../../packages/ui-core/src'),
      // noVNC publishes exports as a bare string rather than a subpath map,
      // which confuses Vite's package-exports resolver. Point the subpath
      // import directly at the file so the build succeeds.
      '@novnc/novnc/core/rfb.js': path.resolve(
        __dirname,
        '../../node_modules/@novnc/novnc/core/rfb.js',
      ),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    // noVNC uses top-level await (H264 capability check). Target es2022+
    // to allow it. The `safari15` target sets the floor at Safari 15.0 /
    // iOS 15.0, the first WebKit release with top-level await.
    target: ['es2022', 'safari15'],
  },
});
