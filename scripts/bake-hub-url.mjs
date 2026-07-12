// Overwrites electron/hubBake.ts with WATCHTOWER_PG_URL read from .env.production,
// so the packaged .app can enable cloud sync without a shell/launchd env var.
// Run only from scripts/dist-mac.mjs (which restores the committed default after
// packaging). If .env.production is absent or has no URL, leaves it undefined.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env.production');
const target = path.join(root, 'electron', 'hubBake.ts');

const HEADER = '// Build-time-baked Supabase hub Postgres URL. See scripts/bake-hub-url.mjs.\n';

// `--reset` restores the committed `undefined` default (used by dist-mac.mjs's
// finally, so a baked secret never lingers in the working tree — no git dependency).
if (process.argv.includes('--reset')) {
  writeFileSync(target, HEADER + 'export const BAKED_PG_URL: string | undefined = undefined;\n', 'utf8');
  console.log('[bake-hub-url] reset electron/hubBake.ts to undefined');
  process.exit(0);
}

let url;
if (existsSync(envFile)) {
  const line = readFileSync(envFile, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('WATCHTOWER_PG_URL='));
  if (line) {
    url = line.slice('WATCHTOWER_PG_URL='.length).trim().replace(/^["']|["']$/g, '');
  }
}

const literal = url ? JSON.stringify(url) : 'undefined';
writeFileSync(
  target,
  '// AUTO-GENERATED at build time by scripts/bake-hub-url.mjs — do NOT commit a real URL.\n' +
    `export const BAKED_PG_URL: string | undefined = ${literal};\n`,
  'utf8',
);
console.log(
  url
    ? '[bake-hub-url] baked hub URL into electron/hubBake.ts'
    : '[bake-hub-url] no WATCHTOWER_PG_URL in .env.production — left undefined',
);
