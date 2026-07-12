# Desktop Cloud Sync Setting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Supabase hub Postgres URL a `safeStorage`-encrypted, Settings-configurable app setting (with an on/off toggle), injected into the orchestrator's env at startup — replacing the `WATCHTOWER_PG_URL` launchd hack.

**Architecture:** A pure, electron-free core (`cloudSyncStore.ts`) holds all encrypt/decrypt/parse logic and is fully unit-tested via an injected `SafeStorageLike`. A thin electron wrapper (`cloudSync.ts`) binds it to `safeStorage` + a `userData/cloud-sync.json` file. Electron **main** decrypts at startup and sets `process.env.WATCHTOWER_PG_URL` before forking the orchestrator (which inherits main's env) — so the orchestrator and `SyncService` are unchanged. A new Settings → "Cloud Sync" tab drives it over electron-only IPC. Apply = restart.

**Tech Stack:** Electron main (`safeStorage`, `app`, `utilityProcess`), TypeScript, React + MUI v5 (renderer), Vitest.

## Global Constraints

- **Encryption at rest via Electron `safeStorage`** — the connection string is NEVER stored plaintext and NEVER written to `data.db`. No plaintext fallback: if `safeStorage.isEncryptionAvailable()` is false, saving throws.
- **The URL is write-only to the renderer** — `cloudSync:getConfig` returns only `{ enabled, configured }`, never the URL.
- **Orchestrator code is unchanged** — `defaultPgUrl()`/`createPgStore()`/`SyncService` stay as-is; only main's env injection is new.
- **Precedence:** an explicit `process.env.WATCHTOWER_PG_URL` (dev/launchd) wins; the setting only fills in when the env var is unset (`if (!process.env.WATCHTOWER_PG_URL)`).
- **Apply model = restart** (`cloudSync:setConfig` returns `needsRestart: true`; no live toggle).
- **Naming:** the tab is **"Cloud Sync"** (id `'cloud-sync'`) — distinct from the existing APNs **"Messaging hub"** tab.
- **Test convention:** pure logic gets Vitest unit tests; desktop renderer UI/hooks are verified by `npx tsc -p apps/desktop/tsconfig.json --noEmit` + the Task 5 build (the desktop side has no RTL/jsdom test setup — do not add one).
- Full suite stays green (`npm test`); `npm run typecheck:ci` clean.

---

### Task 1: `cloudSyncStore.ts` (pure core) + `cloudSync.ts` (electron wrapper)

The heart of the feature: all logic in a pure, electron-free module with full unit tests; a thin electron-bound wrapper for the file + `safeStorage`.

**Files:**
- Create: `electron/cloudSyncStore.ts` (pure — no electron/fs imports)
- Create: `electron/cloudSync.ts` (electron wrapper)
- Test: `tests/electron/cloudSync.test.ts`

**Interfaces:**
- Produces (pure core, `cloudSyncStore.ts`):
  - `interface SafeStorageLike { isEncryptionAvailable(): boolean; encryptString(plain: string): Buffer; decryptString(enc: Buffer): string }`
  - `interface CloudSyncFile { enabled: boolean; url?: string }` (`url` = base64 ciphertext)
  - `interface CloudSyncStatus { enabled: boolean; configured: boolean }`
  - `interface CloudSyncUpdate { enabled: boolean; url?: string | null }`
  - `parseConfig(raw: string | null): CloudSyncFile`
  - `computeStatus(file: CloudSyncFile): CloudSyncStatus`
  - `computeUpdate(prev: CloudSyncFile, next: CloudSyncUpdate, ss: SafeStorageLike): CloudSyncFile` (throws if encryption unavailable when encrypting)
  - `resolveUrl(file: CloudSyncFile, ss: SafeStorageLike): string | null`
- Produces (wrapper, `cloudSync.ts`): `getCloudSyncConfig(): CloudSyncStatus`, `setCloudSyncConfig(next: CloudSyncUpdate): void`, `resolveCloudSyncUrl(): string | null`.

- [ ] **Step 1: Write the failing test**

Create `tests/electron/cloudSync.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  parseConfig, computeStatus, computeUpdate, resolveUrl,
  type SafeStorageLike, type CloudSyncFile,
} from '../../electron/cloudSyncStore.js';

// Fake safeStorage: "encrypt" = prefix marker, base64-agnostic (Buffer round-trips).
const ss = (available = true): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (plain) => Buffer.from('enc:' + plain, 'utf8'),
  decryptString: (enc) => {
    const s = enc.toString('utf8');
    if (!s.startsWith('enc:')) throw new Error('bad ciphertext');
    return s.slice(4);
  },
});

describe('parseConfig', () => {
  it('returns disabled for null / bad JSON', () => {
    expect(parseConfig(null)).toEqual({ enabled: false });
    expect(parseConfig('not json')).toEqual({ enabled: false });
  });
  it('parses a valid file and drops an empty url', () => {
    expect(parseConfig('{"enabled":true,"url":"abc"}')).toEqual({ enabled: true, url: 'abc' });
    expect(parseConfig('{"enabled":true,"url":""}')).toEqual({ enabled: true });
  });
});

describe('computeUpdate + resolveUrl round-trip', () => {
  it('encrypts on save and decrypts on resolve', () => {
    const f = computeUpdate({ enabled: false }, { enabled: true, url: 'postgresql://u:p@h/db' }, ss());
    expect(f.enabled).toBe(true);
    expect(f.url).toBeDefined();
    expect(f.url).not.toContain('postgresql://'); // stored as ciphertext, not plaintext
    expect(resolveUrl(f, ss())).toBe('postgresql://u:p@h/db');
  });
  it('status never leaks the url', () => {
    const f = computeUpdate({ enabled: false }, { enabled: true, url: 'postgresql://x' }, ss());
    expect(computeStatus(f)).toEqual({ enabled: true, configured: true });
    expect(JSON.stringify(computeStatus(f))).not.toContain('postgresql');
  });
  it('toggle-only save (url undefined) keeps the stored secret', () => {
    const f1 = computeUpdate({ enabled: false }, { enabled: true, url: 'postgresql://x' }, ss());
    const f2 = computeUpdate(f1, { enabled: false }, ss());
    expect(f2).toEqual({ enabled: false, url: f1.url });
    expect(computeStatus(f2)).toEqual({ enabled: false, configured: true });
  });
  it('empty-string url clears the secret', () => {
    const f1 = computeUpdate({ enabled: false }, { enabled: true, url: 'postgresql://x' }, ss());
    const f2 = computeUpdate(f1, { enabled: true, url: '' }, ss());
    expect(f2).toEqual({ enabled: true });
    expect(computeStatus(f2).configured).toBe(false);
  });
  it('throws when encryption is unavailable', () => {
    expect(() => computeUpdate({ enabled: false }, { enabled: true, url: 'x' }, ss(false))).toThrow(/unavailable/i);
  });
});

describe('resolveUrl gating', () => {
  const enc = (Buffer.from('enc:postgresql://x', 'utf8')).toString('base64');
  const file: CloudSyncFile = { enabled: true, url: enc };
  it('returns null when disabled', () => {
    expect(resolveUrl({ ...file, enabled: false }, ss())).toBeNull();
  });
  it('returns null when encryption is unavailable', () => {
    expect(resolveUrl(file, ss(false))).toBeNull();
  });
  it('returns null when there is no url', () => {
    expect(resolveUrl({ enabled: true }, ss())).toBeNull();
  });
  it('returns the plaintext when enabled + configured + available', () => {
    expect(resolveUrl(file, ss())).toBe('postgresql://x');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/electron/cloudSync.test.ts`
Expected: FAIL — cannot resolve `../../electron/cloudSyncStore.js`.

- [ ] **Step 3: Create the pure core `electron/cloudSyncStore.ts`**

```ts
// Pure, electron-free core for the Cloud Sync setting — all encrypt/decrypt/
// parse logic, with safeStorage injected so it is unit-testable. The electron
// binding lives in ./cloudSync.ts.

/** The subset of Electron `safeStorage` we use — injected so the core is testable. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(enc: Buffer): string;
}

/** On-disk shape. `url` is base64 safeStorage ciphertext (never plaintext). */
export interface CloudSyncFile {
  enabled: boolean;
  url?: string;
}

/** What the renderer is allowed to see — never the URL itself. */
export interface CloudSyncStatus {
  enabled: boolean;
  configured: boolean;
}

/** Save payload. `url === undefined` = toggle-only (keep secret); `''`/null clears. */
export interface CloudSyncUpdate {
  enabled: boolean;
  url?: string | null;
}

export function parseConfig(raw: string | null): CloudSyncFile {
  if (!raw) return { enabled: false };
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const enabled = o.enabled === true;
    const url = typeof o.url === 'string' && o.url.length > 0 ? o.url : undefined;
    return url ? { enabled, url } : { enabled };
  } catch {
    return { enabled: false };
  }
}

export function computeStatus(file: CloudSyncFile): CloudSyncStatus {
  return { enabled: file.enabled, configured: file.url != null };
}

export function computeUpdate(
  prev: CloudSyncFile,
  next: CloudSyncUpdate,
  ss: SafeStorageLike,
): CloudSyncFile {
  let url = prev.url;
  if (next.url !== undefined) {
    if (!next.url) {
      url = undefined; // '' or null clears the saved secret
    } else {
      if (!ss.isEncryptionAvailable()) {
        throw new Error('Secure storage is unavailable; cannot save the connection string.');
      }
      url = ss.encryptString(next.url).toString('base64');
    }
  }
  return url ? { enabled: next.enabled, url } : { enabled: next.enabled };
}

export function resolveUrl(file: CloudSyncFile, ss: SafeStorageLike): string | null {
  if (!file.enabled || !file.url) return null;
  if (!ss.isEncryptionAvailable()) return null;
  try {
    return ss.decryptString(Buffer.from(file.url, 'base64'));
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/electron/cloudSync.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Create the electron wrapper `electron/cloudSync.ts`**

```ts
import { safeStorage, app } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  parseConfig, computeStatus, computeUpdate, resolveUrl,
  type CloudSyncFile, type CloudSyncStatus, type CloudSyncUpdate,
} from './cloudSyncStore.js';

// The encrypted hub setting lives in a main-owned file (not data.db) so main
// can read it BEFORE the orchestrator — which owns data.db — starts.
function filePath(): string {
  return path.join(app.getPath('userData'), 'cloud-sync.json');
}

function load(): CloudSyncFile {
  const p = filePath();
  return parseConfig(existsSync(p) ? readFileSync(p, 'utf8') : null);
}

/** Renderer-facing status (enabled + whether a secret is stored). Never the URL. */
export function getCloudSyncConfig(): CloudSyncStatus {
  return computeStatus(load());
}

/** Persist an enable/URL change. Throws if encryption is unavailable. */
export function setCloudSyncConfig(next: CloudSyncUpdate): void {
  const merged = computeUpdate(load(), next, safeStorage);
  writeFileSync(filePath(), JSON.stringify(merged), 'utf8');
}

/** Startup: the decrypted URL to inject into the orchestrator env, or null. */
export function resolveCloudSyncUrl(): string | null {
  return resolveUrl(load(), safeStorage);
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc -p electron/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add electron/cloudSyncStore.ts electron/cloudSync.ts tests/electron/cloudSync.test.ts
git commit -m "feat(desktop): cloudSync store — safeStorage-encrypted hub URL (pure core + wrapper)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Electron-only IPC wiring (contract + handlers)

Expose `cloudSync:getConfig` / `cloudSync:setConfig` as electron-only IPC handled entirely in main (never reaches the orchestrator), mirroring `devops:setPat`.

**Files:**
- Modify: `packages/shared/src/ipcContract.ts` (request kinds ~`:18`, response kinds ~`:606`, `ELECTRON_ONLY_KINDS` ~`:859`)
- Modify: `electron/ipc.ts` (handler branches near the `devops:*` handlers ~`:98`)
- Test: `tests/shared/ipcContract.test.ts`

**Interfaces:**
- Consumes: `getCloudSyncConfig`, `setCloudSyncConfig` from `electron/cloudSync.js` (Task 1).
- Produces: IPC kinds `cloudSync:getConfig` (req `{}` → res `{ enabled: boolean; configured: boolean }`) and `cloudSync:setConfig` (req `{ enabled: boolean; url?: string | null }` → res `{ ok: true; needsRestart: boolean }`), both in `ELECTRON_ONLY_KINDS`.

- [ ] **Step 1: Write the failing test**

Add to `tests/shared/ipcContract.test.ts` (import `ELECTRON_ONLY_KINDS` from the module if not already imported):

```ts
import { ELECTRON_ONLY_KINDS } from '../../packages/shared/src/ipcContract.js';

describe('cloudSync IPC', () => {
  it('cloudSync kinds are electron-only (never proxied to the orchestrator)', () => {
    expect(ELECTRON_ONLY_KINDS.has('cloudSync:getConfig')).toBe(true);
    expect(ELECTRON_ONLY_KINDS.has('cloudSync:setConfig')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/ipcContract.test.ts`
Expected: FAIL — `ELECTRON_ONLY_KINDS` lacks the cloudSync kinds (and/or a TS error that the kinds aren't in the union).

- [ ] **Step 3: Add the contract kinds + ELECTRON_ONLY membership**

In `packages/shared/src/ipcContract.ts`, in the `IpcRequest` union right after the `hub:setConfig` request line (`:18`):

```ts
  | { kind: 'cloudSync:getConfig'; payload: Record<string, never> }
  | { kind: 'cloudSync:setConfig'; payload: { enabled: boolean; url?: string | null } }
```

In the `IpcResponse` union right after the `hub:setConfig` response line (`:606`):

```ts
  | { kind: 'cloudSync:getConfig'; payload: { enabled: boolean; configured: boolean } }
  | { kind: 'cloudSync:setConfig'; payload: { ok: true; needsRestart: boolean } }
```

In `ELECTRON_ONLY_KINDS` (the `new Set([...])` at `:859`), add:

```ts
  'cloudSync:getConfig',
  'cloudSync:setConfig',
```

- [ ] **Step 4: Add the main-process handlers**

In `electron/ipc.ts`, add an import at the top:

```ts
import { getCloudSyncConfig, setCloudSyncConfig } from './cloudSync.js';
```

Add these branches alongside the `devops:*` handlers (immediately before the `if (ELECTRON_ONLY_KINDS.has(kind))` throw):

```ts
      if (kind === 'cloudSync:getConfig') {
        return getCloudSyncConfig();
      }

      if (kind === 'cloudSync:setConfig') {
        setCloudSyncConfig(payload as { enabled: boolean; url?: string | null });
        return { ok: true, needsRestart: true };
      }
```

- [ ] **Step 5: Run test + typecheck**

Run: `npx vitest run tests/shared/ipcContract.test.ts`
Expected: PASS.
Run: `npx tsc -p packages/shared/tsconfig.json --noEmit && npx tsc -p electron/tsconfig.json --noEmit`
Expected: no errors (the switch now handles the new kinds; `messagePort.ts` needs NO change since these are electron-only).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/ipcContract.ts electron/ipc.ts tests/shared/ipcContract.test.ts
git commit -m "feat(desktop): cloudSync:get/setConfig electron-only IPC

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Startup env injection in `main.ts`

Decrypt the setting at startup and set `process.env.WATCHTOWER_PG_URL` before the orchestrator forks (it inherits main's env), unless an explicit env var already wins.

**Files:**
- Modify: `electron/main.ts` (import + the `app.whenReady().then(...)` body, right before `const orch = startOrchestrator();` at `:72`)

**Interfaces:**
- Consumes: `resolveCloudSyncUrl` from `electron/cloudSync.js` (Task 1).

- [ ] **Step 1: Add the import**

At the top of `electron/main.ts` (with the other local imports, e.g. after the `orchestratorHost.js` import at `:8`):

```ts
import { resolveCloudSyncUrl } from './cloudSync.js';
```

- [ ] **Step 2: Inject before forking the orchestrator**

In `electron/main.ts`, inside `app.whenReady().then(() => {` — immediately BEFORE `const orch = startOrchestrator();` (`:72`) — insert:

```ts
  // Cloud Sync: the persisted, safeStorage-encrypted hub URL is the packaged-app
  // path to enabling Supabase sync (replacing the WATCHTOWER_PG_URL launchd hack).
  // The orchestrator fork inherits this env. An explicit env var (dev / launchd
  // override) still wins.
  if (!process.env.WATCHTOWER_PG_URL) {
    const cloudUrl = resolveCloudSyncUrl();
    if (cloudUrl) process.env.WATCHTOWER_PG_URL = cloudUrl;
  }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p electron/tsconfig.json --noEmit`
Expected: no errors.

(No unit test: this is a main-process side effect. The decrypt/gating logic it depends on — `resolveUrl` — is fully tested in Task 1; the guard is a one-line `!process.env.WATCHTOWER_PG_URL` check verified by the Task 5 build/smoke.)

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts
git commit -m "feat(desktop): inject cloudSync hub URL into orchestrator env at startup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Renderer — hook, Cloud Sync tab, and tab registration

The `useCloudSyncConfig` hook, the `CloudSyncTab` UI, and the three registration points (URL routing, settings switch, rail nav).

**Files:**
- Create: `apps/desktop/src/state/useCloudSyncConfig.ts`
- Create: `apps/desktop/src/components/settings/CloudSyncTab.tsx`
- Modify: `apps/desktop/src/util/settingsUrl.ts:16` (add `'cloud-sync'` to `SETTINGS_TABS`)
- Modify: `apps/desktop/src/components/settings/ModuleSettings.tsx` (import + render `CloudSyncTab`)
- Modify: `apps/desktop/src/components/ModuleRail.tsx` (import icon + add to `SETTINGS_SUB_TABS`)

**Interfaces:**
- Consumes: `window.watchtower.invoke('cloudSync:getConfig'|'cloudSync:setConfig', …)` (Task 2 types make this type-safe).
- Produces: `useCloudSyncConfig()` → `{ enabled, configured, loading, error, needsRestart, save, refresh }`; `CloudSyncTab` component; a reachable `'cloud-sync'` settings tab.

- [ ] **Step 1: Create the hook `apps/desktop/src/state/useCloudSyncConfig.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';

export interface CloudSyncState {
  enabled: boolean;
  configured: boolean;
  loading: boolean;
  error: string | null;
  needsRestart: boolean;
  save(next: { enabled: boolean; url?: string | null }): Promise<void>;
  refresh(): Promise<void>;
}

export function useCloudSyncConfig(): CloudSyncState {
  const [enabled, setEnabled] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsRestart, setNeedsRestart] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.watchtower.invoke('cloudSync:getConfig', {});
      setEnabled(res.enabled);
      setConfigured(res.configured);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const save = useCallback(
    async (next: { enabled: boolean; url?: string | null }) => {
      setError(null);
      try {
        const res = await window.watchtower.invoke('cloudSync:setConfig', next);
        setNeedsRestart(res.needsRestart);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [refresh],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { enabled, configured, loading, error, needsRestart, save, refresh };
}
```

- [ ] **Step 2: Create the UI `apps/desktop/src/components/settings/CloudSyncTab.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, FormControlLabel, Stack, Switch, TextField, Typography } from '@mui/material';
import { useCloudSyncConfig } from '../../state/useCloudSyncConfig.js';

export function CloudSyncTab(): JSX.Element {
  const { enabled, configured, loading, error, needsRestart, save } = useCloudSyncConfig();
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraftEnabled(enabled); }, [enabled]);

  const dirty = draftEnabled !== enabled || url.trim().length > 0;

  const onSave = async () => {
    setSaving(true);
    try {
      await save({ enabled: draftEnabled, url: url.trim() ? url.trim() : undefined });
      setUrl('');
    } catch {
      /* error surfaced via hook.error */
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ p: 2, maxWidth: 640 }}>
      <Typography variant="h6" sx={{ mb: 0.5 }}>Cloud Sync</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        Push billing data to Supabase so the iPad and iPhone apps can read it. The connection
        string is encrypted with your OS keychain and stored only on this Mac. Changes apply on
        the next launch.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Stack spacing={2}>
        <FormControlLabel
          control={<Switch checked={draftEnabled} onChange={(e) => setDraftEnabled(e.target.checked)} disabled={loading} />}
          label="Enable cloud sync"
        />

        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>CONNECTION STRING</Typography>
            {configured && <Chip size="small" color="success" label="saved" />}
          </Box>
          <TextField
            type="password"
            size="small"
            fullWidth
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={configured ? '•••••• (saved, leave unchanged)' : 'postgresql://…'}
            sx={{ '& input': { fontFamily: 'Menlo, monospace', fontSize: 12 } }}
          />
        </Box>

        <Box>
          <Button variant="contained" size="small" disabled={saving || loading || !dirty} onClick={() => void onSave()}>
            Save
          </Button>
        </Box>

        {needsRestart && (
          <Alert severity="info">Restart Watchtower to apply — cloud sync starts on next launch.</Alert>
        )}
      </Stack>
    </Box>
  );
}
```

- [ ] **Step 3: Register the tab id (URL routing)**

In `apps/desktop/src/util/settingsUrl.ts:16`, add `'cloud-sync'` to the tuple:

```ts
export const SETTINGS_TABS = ['general', 'json', 'hooks', 'skills', 'agents', 'mcp', 'hub', 'cloud-sync'] as const;
```

- [ ] **Step 4: Render it in the settings switch**

In `apps/desktop/src/components/settings/ModuleSettings.tsx`, add the import (with the other tab imports):

```ts
import { CloudSyncTab } from './CloudSyncTab.js';
```

and a render line after the `hub` line inside the `<Box>`:

```tsx
        {view.tab === 'cloud-sync' && <CloudSyncTab />}
```

- [ ] **Step 5: Add the rail nav entry**

In `apps/desktop/src/components/ModuleRail.tsx`, add the icon import (with the other `@mui/icons-material` imports near the top):

```ts
import CloudSyncIcon from '@mui/icons-material/CloudSync';
```

and append to the `SETTINGS_SUB_TABS` array (after the `hub` entry):

```tsx
  { id: 'cloud-sync', label: 'Cloud Sync', icon: <CloudSyncIcon fontSize="inherit" /> },
```

- [ ] **Step 6: Typecheck the renderer**

Run: `npx tsc -p apps/desktop/tsconfig.json --noEmit`
Expected: no errors. (The `cloudSync:*` kinds from Task 2 make `window.watchtower.invoke` type-safe; `'cloud-sync'` is now a valid `SettingsTab`.)

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/state/useCloudSyncConfig.ts apps/desktop/src/components/settings/CloudSyncTab.tsx apps/desktop/src/util/settingsUrl.ts apps/desktop/src/components/settings/ModuleSettings.tsx apps/desktop/src/components/ModuleRail.tsx
git commit -m "feat(desktop): Cloud Sync settings tab (toggle + encrypted connection string)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Full verification + manual smoke

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all green (bootstrap `EADDRINUSE` failures, if any, are a local port collision with a running instance — re-run those two with `WATCHTOWER_WS_HOST=127.0.0.1 WATCHTOWER_WS_PORT=7466 npx vitest run tests/orchestrator/bootstrap.test.ts tests/orchestrator/bootstrap.wsBridge.test.ts` to confirm they pass on a free port).

- [ ] **Step 2: Typecheck gate**

Run: `npm run typecheck:ci`
Expected: clean.

- [ ] **Step 3: Build main + orchestrator**

Run: `npm run build`
Expected: succeeds (builds main, orch, renderer, helper).

- [ ] **Step 4: Manual smoke (user-driven)**

Launch the dev app (`npm run dev`), open **Settings → Cloud Sync**, enable + paste the prod connection string, Save → confirm the "Restart to apply" info alert appears and the field shows the "saved" chip after reload. Restart, then confirm the orchestrator picks up the hub (billing changes reach the iPad within ~a minute). Note: the launchd `LaunchAgent` from the stopgap can now be removed (`launchctl bootout gui/$(id -u)/cz.watchtower.hub-env`) so the two mechanisms don't both set the env — with the setting in place it's redundant.

---

## Self-Review

**Spec coverage:**
- safeStorage encryption, no plaintext, not in data.db → Task 1 (`computeUpdate` throws when unavailable; ciphertext only) ✓
- URL write-only to renderer → Task 1 `computeStatus` + Task 2 `getConfig` response shape ✓
- Orchestrator unchanged; startup env injection with precedence → Task 3 ✓
- Electron-only IPC (get/setConfig) → Task 2 ✓
- Settings "Cloud Sync" tab (toggle + masked field + saved chip + restart hint) → Task 4 ✓
- Apply = restart (`needsRestart`) → Task 2 response + Task 4 alert ✓
- Main-owned userData file (not data.db) → Task 1 wrapper `filePath()` ✓
- Naming distinct from APNs "Messaging hub" → Task 4 (`'cloud-sync'`, "Cloud Sync") ✓
- Tests: pure core unit-tested; UI via typecheck+build → Tasks 1, 2, 5 ✓

**Placeholder scan:** none — every step has complete code/commands.

**Type consistency:** `SafeStorageLike`/`CloudSyncFile`/`CloudSyncStatus`/`CloudSyncUpdate` defined in Task 1 and consumed unchanged in the wrapper + IPC. IPC kinds `cloudSync:getConfig` (res `{enabled, configured}`) and `cloudSync:setConfig` (req `{enabled, url?}` → res `{ok, needsRestart}`) match across Task 2 (contract), Task 3/4 consumers. Hook `save({enabled, url?})` matches the `setConfig` payload. Tab id `'cloud-sync'` consistent across settingsUrl / ModuleSettings / ModuleRail.
