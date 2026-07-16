// electron-builder `afterPack` hook — code-sign the packaged macOS bundle.
//
// build.mac.identity is null, so electron-builder skips its own signing step
// (afterSign never fires). We sign here instead, for two reasons:
//
// 1. Spotlight: on Apple Silicon the linker injects a bare ad-hoc signature on
//    the Mach-O but leaves the bundle with no `_CodeSignature/CodeResources`
//    seal, so `codesign --verify` fails and macOS refuses to Spotlight-index
//    the app. Re-signing the whole bundle applies a valid seal.
//
// 2. safeStorage PAT persistence: Electron's safeStorage stores the Azure
//    DevOps PAT under an OS-Keychain key whose access ACL is bound to the app's
//    code-signing designated requirement. An *ad-hoc* signature has no cert, so
//    its requirement is the per-build cdhash — every release looked like a new
//    app and lost the PAT (→ ADO 401 after each update). Signing with a real,
//    reused certificate (Apple Development is enough) gives a stable requirement
//    so the PAT survives across rebuilds. We auto-discover an identity and fall
//    back to ad-hoc only when none exists (e.g. CI), preserving the Spotlight
//    fix there.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pickSigningIdentity } from './signingIdentity.mjs';

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);

  let findIdentityOutput = '';
  try {
    findIdentityOutput = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
      encoding: 'utf8',
    });
  } catch {
    /* no keychain / no identities — falls through to ad-hoc */
  }
  const identity = pickSigningIdentity({ env: process.env, findIdentityOutput });
  const signArg = identity ?? '-';

  execFileSync('codesign', ['--force', '--deep', '--sign', signArg, appPath], { stdio: 'inherit' });
  // Fail the build loudly if the seal didn't take — a silently-broken signature
  // would just reproduce the original Spotlight bug.
  execFileSync('codesign', ['--verify', '--verbose=2', appPath], { stdio: 'inherit' });
  console.log(
    identity
      ? `[sign] signed ${appName} with identity ${identity} (stable requirement — safeStorage PAT persists across builds)`
      : `[sign] no signing identity found — applied ad-hoc signature to ${appName} (PAT will not persist across builds; install a Developer ID / Apple Development cert to fix)`,
  );
}
