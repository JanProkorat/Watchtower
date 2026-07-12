# Desktop Cloud Sync — hub URL as an encrypted, Settings-configurable value

**Date:** 2026-07-12
**Scope:** Watchtower desktop app (`electron/`, `orchestrator/` boundary, `apps/desktop/`, `packages/shared/`).

> **Revision (post-implementation, per user feedback):** pasting a connection
> string into Settings was rejected as too clunky. The URL is now **baked into
> the build** at `dist:mac` time from `.env.production` (`electron/hubBake.ts`
> via `scripts/bake-hub-url.mjs`, restored to `undefined` afterward by
> `scripts/dist-mac.mjs` so the secret ships only inside the packaged `.app`,
> never in git). The Settings **"Cloud Sync"** tab is now just an **on/off
> toggle** (plus an `available` hint when no URL was baked). Because the only
> persisted state is a boolean, **`safeStorage` and all encrypt/decrypt/URL
> handling are removed** — `cloud-sync.json` holds `{ enabled }` only. The
> startup injection and "apply = restart" model are unchanged. The sections
> below describe the original encrypted-field design; the toggle/baked design
> supersedes the storage + UI parts.

## Problem

The Supabase Postgres "hub" that the desktop app syncs billing data to is
enabled **only** by the `WATCHTOWER_PG_URL` process env var. For a packaged app
launched from the Dock, that means a fragile workaround: a login `LaunchAgent`
that publishes the URL into the launchd session env (a global, plaintext-secret
hack). We want the hub to be a **first-class, persisted app setting**,
configured from the desktop Settings UI with an on/off toggle, with the
connection string (which contains a DB password) **encrypted at rest** — no
launchd tricks, no global env var.

## Guiding constraint: "store it the same way the app already stores secrets"

The desktop app's only persisted credential today is the DevOps PAT
(`electron/devopsPat.ts`), stored **encrypted via Electron `safeStorage`** (OS
keychain). This feature mirrors that: `safeStorage` encryption, ciphertext
persisted by electron **main**, decrypted lazily on use. The one necessary
deviation from the PAT: the PAT is injected per-request *after* startup, but the
hub URL is needed *before* the orchestrator forks — so its ciphertext lives in a
**main-owned `userData` file** (not the orchestrator's `data.db`, which main
can't read pre-fork), and it's injected into the orchestrator's **fork env** at
startup.

## Key facts from investigation

- `orchestrator/db/pg/pool.ts:27-31` — `defaultPgUrl()` reads
  `process.env.WATCHTOWER_PG_URL`. **Unchanged by this feature.**
- `orchestrator/bootstrap.ts:110` — `createPgStore()` (env-driven) + the
  `evaluateHubGuard`. For a packaged app `WATCHTOWER_DEV_URL` is unset, so the
  guard is a no-op (`pool.ts:64`, `allow:true`). Injecting only
  `WATCHTOWER_PG_URL` keeps the guard a no-op. **Unchanged.**
- `electron/orchestratorHost.ts` `startOrchestrator()` — `utilityProcess.fork(entry, [], { serviceName, stdio:'inherit' })` passes **no explicit `env`**, so the child **inherits main's `process.env`** (documented at `electron/main.ts:22`). Setting `process.env.WATCHTOWER_PG_URL` in main *before* `startOrchestrator()` (called at `main.ts:72`) reaches the child with no other change.
- `electron/devopsPat.ts` — the `safeStorage` model to copy (encrypt at
  `:25`, decrypt at `:35`, lazy `isEncryptionAvailable()` per its `:20-24`
  comment, in-memory cache).
- `electron/ipc.ts:98-106` + `ipcContract.ts` `ELECTRON_ONLY_KINDS` (`:859-867`)
  — the pattern for IPC kinds handled entirely in main (never reach the
  orchestrator), like `devops:setPat`.
- Settings UI: tab registry `apps/desktop/src/util/settingsUrl.ts:16`
  (`SETTINGS_TABS`), switch in `apps/desktop/src/components/settings/ModuleSettings.tsx`,
  control patterns in `HubTab.tsx` (Switch + draft/Save) and
  `apps/desktop/src/components/reviews/DevopsPatField.tsx` (masked password +
  "saved" chip).
- **Live reconfigure is not feasible** — pg store + `SyncService` are
  single-shot at bootstrap, captured by many closures (`SyncService.store` is
  `readonly`, no `setStore`). So **apply = restart the app.**

## Architecture

```
Settings "Cloud Sync" tab (renderer)
   │  cloudSync:getConfig / cloudSync:setConfig   (ELECTRON_ONLY IPC)
   ▼
electron/cloudSync.ts (main)  ── safeStorage encrypt/decrypt
   │  ciphertext + enabled flag → <userData>/cloud-sync.json
   ▼
startup (electron/main.ts, before startOrchestrator)
   │  if enabled && url && !process.env.WATCHTOWER_PG_URL:
   │     process.env.WATCHTOWER_PG_URL = decrypt(url)
   ▼
orchestrator fork inherits env → defaultPgUrl() → createPgStore() → SyncService
   (orchestrator code UNCHANGED)
```

## Components

### 1. `electron/cloudSync.ts` (new) — main-process store

Mirrors `electron/devopsPat.ts`. Owns a JSON file at
`path.join(app.getPath('userData'), 'cloud-sync.json')` with shape
`{ enabled: boolean; url?: string /* base64 safeStorage ciphertext */ }`.

- `getCloudSyncConfig(): { enabled: boolean; configured: boolean }` — reads the
  file; `configured` = a ciphertext URL is present. **Never returns the URL**
  (write-only secret; the renderer only learns "configured or not").
- `setCloudSyncConfig(next: { enabled: boolean; url?: string | null }): void`
  — if `url` is a non-empty string, `safeStorage.encryptString(url)` →
  base64 → file; if `url === ''`/`null`, clear the stored ciphertext; if `url`
  is `undefined`, leave the existing ciphertext untouched (toggle-only save).
  Persists `enabled`. Updates in-memory cache.
- `resolveCloudSyncUrl(): string | null` — for startup: returns the decrypted
  URL when `enabled && configured && safeStorage.isEncryptionAvailable()`,
  else `null`. Called lazily (never at import), matching devopsPat's guard.

If `safeStorage.isEncryptionAvailable()` is false at save time, `setCloudSyncConfig`
throws a clear error surfaced to the UI ("secure storage unavailable"); the app
never falls back to plaintext.

### 2. Startup injection — `electron/main.ts`

After the dev `.env` load block (`main.ts:34-37`) and **before**
`startOrchestrator()` (`main.ts:72`):

```ts
// Cloud Sync: a persisted, encrypted hub URL is the packaged-app path to
// enabling Supabase sync (replacing the WATCHTOWER_PG_URL launchd hack). A real
// env var (dev sessions / explicit override) still wins.
if (!process.env.WATCHTOWER_PG_URL) {
  const url = resolveCloudSyncUrl();
  if (url) process.env.WATCHTOWER_PG_URL = url;
}
```

The orchestrator fork inherits `process.env` (the fork passes no explicit
`env`), so no orchestrator change is needed. Precedence: explicit env/launchd
`WATCHTOWER_PG_URL` overrides the setting (the `!process.env.WATCHTOWER_PG_URL`
guard keeps dev flexibility); otherwise the setting drives it.

### 3. IPC — electron-only kinds

- `packages/shared/src/ipcContract.ts`: add request kinds
  `cloudSync:getConfig` (payload `{}`) and `cloudSync:setConfig`
  (payload `{ enabled: boolean; url?: string | null }`), and responses
  `cloudSync:getConfig` (`{ enabled: boolean; configured: boolean }`) and
  `cloudSync:setConfig` (`{ ok: true; needsRestart: boolean }`). Add both kinds
  to `ELECTRON_ONLY_KINDS`.
- `packages/shared/src/messagePort.ts`: **no change** (electron-only; never
  reaches the orchestrator).
- `electron/ipc.ts`: handle both kinds in main (like `devops:setPat` at
  `:98-106`) → call `getCloudSyncConfig` / `setCloudSyncConfig`.
  `setConfig` returns `needsRestart: true`.

### 4. Renderer hook — `apps/desktop/src/state/useCloudSyncConfig.ts` (new)

Mirrors `useHubConfig.ts`.
- `refresh()` → `window.watchtower.invoke('cloudSync:getConfig', {})` →
  `{ enabled, configured }`.
- `save(next)` → `invoke('cloudSync:setConfig', next)` → surfaces
  `needsRestart`.
- Exposes `{ enabled, configured, loading, error, save, refresh }`.

### 5. Settings UI — `CloudSyncTab.tsx` (new) + registration

- Register tab id `'cloud-sync'` in `SETTINGS_TABS` (`settingsUrl.ts:16`), add a
  `case` in `ModuleSettings.tsx`, and a rail/nav entry alongside the other
  settings tabs (label "Cloud Sync").
- `CloudSyncTab.tsx` (MUI, mirroring `HubTab` + `DevopsPatField`):
  - `FormControlLabel` + `Switch` — "Enable cloud sync".
  - A **password-masked** `TextField` for the connection string, with a
    "saved" chip + placeholder `'•••••• (saved, leave unchanged)'` when
    `configured` (copy `DevopsPatField.tsx:66,69-80`). Leaving it unchanged on
    save sends `url: undefined` (keeps the stored secret).
  - Draft-then-Save (`Button` disabled until dirty), an `Alert` for errors, and
    — after a successful save that returns `needsRestart` — an info `Alert`:
    "Restart Watchtower to apply." plus a short explanation that sync starts on
    next launch.
  - A one-line description of what it does (pushes billing data to Supabase so
    the iPad/iPhone can read it).

## Data flow

1. User enables + pastes the connection string, Save →
   `cloudSync:setConfig { enabled:true, url:'postgres://…' }` → main encrypts →
   `cloud-sync.json` → returns `{ ok, needsRestart:true }` → UI shows restart
   hint.
2. User restarts → `main.ts` `resolveCloudSyncUrl()` decrypts → sets
   `process.env.WATCHTOWER_PG_URL` → orchestrator forks → `createPgStore()` →
   `runPgMigrations` → `SyncService.start()` pushes every 60s **with the
   deriver**.
3. Disable (toggle off, Save) → `enabled:false` persisted → next launch injects
   nothing → hub dormant (SQLite-only). Existing prod data is untouched.

## Error handling

- `safeStorage` unavailable at save → `setCloudSyncConfig` throws → UI `Alert`
  "Secure storage is unavailable; cannot save." No plaintext fallback.
- Enabled but decryption fails / unavailable at startup → `resolveCloudSyncUrl`
  returns `null`, nothing injected, sync stays dormant; log a warning. App
  still boots normally.
- Corrupt/missing `cloud-sync.json` → treated as `{ enabled:false }` (disabled),
  never throws at startup.

## Testing

Vitest (main-process units are the priority; UI is thin):

- **`cloudSync.ts`** (mock `electron` `safeStorage` + a temp file / injected
  path):
  - encrypt→persist→`getCloudSyncConfig` returns `{enabled, configured:true}`
    and never leaks the URL;
  - `resolveCloudSyncUrl` returns the plaintext only when
    `enabled && configured && isEncryptionAvailable`; returns `null` when
    disabled, unconfigured, or encryption unavailable;
  - `setConfig({url:''})` clears the secret; `setConfig({url:undefined})` keeps
    it (toggle-only save); `setConfig` throws when `isEncryptionAvailable` is
    false;
  - corrupt/missing file → disabled, no throw.
- **`electron/ipc.ts`** handler test: `cloudSync:setConfig` returns
  `needsRestart:true`; `cloudSync:getConfig` returns the config shape; neither
  kind is forwarded to the orchestrator (assert it's in `ELECTRON_ONLY_KINDS`).
- **`useCloudSyncConfig`** hook: `save`/`refresh` invoke the right kinds and
  surface `needsRestart`/errors (mock `window.watchtower.invoke`).
- **`CloudSyncTab`** (RTL, jsdom): toggle + masked field render; "saved" chip
  shows when `configured`; Save disabled until dirty; restart hint appears after
  a `needsRestart` save.

Full suite stays green; `typecheck:ci` clean.

## Out of scope

- **Live toggle** (no restart) — needs a bootstrap-wiring refactor; restart is
  the pragmatic model.
- **Dev/Prod preset picker** and a **Test-connection button** — deferred (easy
  follow-ups); v1 is a single URL field + toggle, matching the PAT UI's
  simplicity.
- **iPhone / iPad** — unaffected (they read Supabase directly).
- Removing the temporary launchd `LaunchAgent` — a manual cleanup step for the
  user once this ships; not code.
