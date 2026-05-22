import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [path.join(__dirname, 'watchtower-hook.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: path.join(__dirname, '..', 'dist-helper', 'watchtower-hook.mjs'),
  banner: { js: '#!/usr/bin/env node' },
  minify: false,
});

console.log('built dist-helper/watchtower-hook.mjs');
