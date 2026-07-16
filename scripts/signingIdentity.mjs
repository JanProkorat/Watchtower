// Pure helper: choose a codesign identity for the packaged macOS bundle.
//
// Why this matters beyond Gatekeeper: Electron's safeStorage stores the Azure
// DevOps PAT under an OS-Keychain key whose access ACL is bound to the app's
// code-signing designated requirement. An *ad-hoc* signature (`codesign -s -`)
// has no cert identity, so its requirement is the per-build cdhash — every new
// build looks like a different app and loses access to the PAT key (→ ADO 401
// after each release). Signing with a real, reused certificate gives a stable
// requirement, so the PAT survives across rebuilds.
//
// Preference order: explicit env override → Developer ID Application (also
// notarizable) → Apple Development (stable, enough for local dogfood) → null,
// which the caller treats as "fall back to ad-hoc".

/**
 * @param {{ env?: Record<string,string|undefined>, findIdentityOutput?: string }} opts
 * @returns {string|null} identity string for `codesign --sign`, or null for ad-hoc
 */
export function pickSigningIdentity({ env = {}, findIdentityOutput = '' } = {}) {
  const override = env.WATCHTOWER_SIGN_IDENTITY || env.CSC_NAME;
  if (override) return override;

  // Lines look like: `  1) <SHA1HASH> "Apple Development: Name (TEAMID)"`
  const rows = [];
  for (const line of findIdentityOutput.split('\n')) {
    const m = /^\s*\d+\)\s+([0-9A-Fa-f]+)\s+"(.+)"\s*$/.exec(line);
    if (m) rows.push({ hash: m[1], name: m[2] });
  }
  if (rows.length === 0) return null;

  const devId = rows.find((r) => r.name.startsWith('Developer ID Application'));
  if (devId) return devId.hash;
  const appleDev = rows.find((r) => r.name.startsWith('Apple Development'));
  if (appleDev) return appleDev.hash;
  return rows[0].hash;
}
