// Package the macOS app with the Supabase hub URL baked into the build, then
// restore the committed `undefined` default so the baked secret never lingers in
// the working tree (and can't be accidentally committed). The real URL ends up
// only inside the packaged .app.
import { execSync } from 'node:child_process';

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

try {
  run('node scripts/bake-hub-url.mjs');
  run('npm run build');
  run('npx electron-builder --mac');
} finally {
  // Always restore electron/hubBake.ts to its `undefined` default (writes the
  // file directly — no git dependency), even if the build/package step failed,
  // so the baked secret never lingers in the working tree.
  run('node scripts/bake-hub-url.mjs --reset');
}
