// Bundle preload.ts to a CommonJS file. Electron's preload loader uses
// require() under the hood, which can't load ESM modules — and our project
// has "type": "module" in package.json so tsc would emit ESM .js. The .cjs
// extension forces Node (and Electron's loader) to treat it as CJS
// regardless of the parent package.json type.
//
// Same pattern as helper/build.mjs.

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.join(__dirname, '..', 'dist-electron', 'electron', 'preload.cjs');

await build({
  entryPoints: [path.join(__dirname, 'preload.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: outFile,
  external: ['electron'],
  minify: false,
});

console.log(`built ${path.relative(process.cwd(), outFile)}`);
