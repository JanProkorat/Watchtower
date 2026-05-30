// electron-builder `afterPack` hook — ad-hoc sign the packaged macOS bundle.
//
// build.mac.identity is null, so electron-builder skips code signing entirely.
// On Apple Silicon the linker still injects a bare ad-hoc signature on the
// Mach-O, but the bundle is left with no `_CodeSignature/CodeResources` seal.
// That makes the signature structurally invalid (`codesign --verify` fails with
// "code has no resources but signature indicates they must be present"), and
// macOS refuses to Spotlight-index an app bundle whose signature won't
// validate — so Watchtower never shows up in Spotlight search.
//
// Re-signing the whole bundle ad-hoc (`codesign -s -`, inside-out via --deep)
// gives it a valid seal. Ad-hoc is NOT notarized — Gatekeeper still warns on
// first open — but it is enough for Spotlight to index the app. afterPack runs
// after the .app is assembled and before the DMG is built, so the DMG picks up
// the signed bundle. (afterSign would never fire here: with identity:null
// electron-builder skips its signing step altogether.)
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);

  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit',
  });
  // Fail the build loudly if the seal didn't take — a silently-broken signature
  // would just reproduce the original Spotlight bug.
  execFileSync('codesign', ['--verify', '--verbose=2', appPath], { stdio: 'inherit' });
  console.log(`[adhoc-sign] valid ad-hoc signature applied to ${appPath}`);
}
