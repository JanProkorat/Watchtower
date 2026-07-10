# iPad Off-Network Access via Tailscale — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the iPad reach the Mac's WS bridge and VNC screen from any network by pointing `Connection.host` at the Mac's Tailscale MagicDNS name, and give the iPad an in-app connection editor to set it (issue #161).

**Architecture:** Both the WS transport and the native VNC plugin already key off the single `Connection.host` field, so no switching logic is needed — one Tailscale host works on-LAN (direct) and off-network (tunnel). The only real code is (a) an editable connection form in Settings, factored so its parse+persist logic is unit-testable, and (b) a desktop log annotation flagging when the bound host is a tailnet address. The rest is Tailscale configuration, documented.

**Tech Stack:** React + inline styles (apps/ipad, no MUI), Capacitor Preferences store, vitest (pure-logic tests with a fake `ConnStore`, mirroring `tests/ipad/vncCreds.test.ts`), Node orchestrator (`orchestrator/remoteBind.ts`).

## Global Constraints

- Locale Czech; **no i18n**. UI copy is Czech string literals.
- apps/ipad is plain React + inline styles — **do not introduce MUI or a testing-library/jsdom render stack**. Test pure logic with a fake `ConnStore`.
- Renderer never touches SQLite/native directly; connection persistence goes through the existing `store` (Capacitor Preferences) via `saveConnection`/`loadConnection`.
- Verify in the worktree with `npm run typecheck:ci` (NOT bare `tsc` — symlinked node_modules would false-green) and `npx vitest run tests/ipad tests/orchestrator/remoteBind.test.ts`.
- Commit after each task. Never `git add -A` (a `node_modules` symlink is untracked in this worktree); add explicit paths.

---

### Task 1: Connection form-state + editor logic helpers (pure, tested)

Factor the parse-and-persist logic the editor needs into `connection.ts` so it is testable without rendering, and add the currently-missing `parseConnection` tests.

**Files:**
- Modify: `apps/ipad/src/connection.ts`
- Test: `tests/ipad/connection.test.ts` (create)

**Interfaces:**
- Consumes: existing `parseConnection`, `saveConnection`, `type Connection`, `type ConnStore` from `connection.ts`.
- Produces:
  - `type ConnectionFormState = { host: string; port: string; token: string; mac: string; lanIp: string; wanHost: string; wanPort: string }`
  - `function emptyConnectionFormState(): ConnectionFormState` (port defaults to `'7445'`, rest `''`)
  - `function connectionToFormState(c: Connection): ConnectionFormState`
  - `function commitConnectionEdit(store: ConnStore, form: ConnectionFormState): Promise<{ ok: true; value: Connection } | { ok: false; error: string }>` — parses, and on success persists via `saveConnection` before returning.

- [ ] **Step 1: Write the failing test**

Create `tests/ipad/connection.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  parseConnection, connectionToFormState, emptyConnectionFormState,
  commitConnectionEdit, loadConnection, type ConnStore, type Connection,
} from '../../apps/ipad/src/connection.js';

function fakeStore(): ConnStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k) ?? null, set: async (k, v) => { data.set(k, v); } };
}

describe('parseConnection', () => {
  it('accepts a valid minimal connection', () => {
    const r = parseConnection({ host: 'mac.ts.net', port: '7445', token: 'tok' });
    expect(r).toEqual({ ok: true, value: { host: 'mac.ts.net', port: 7445, token: 'tok' } });
  });
  it('rejects a bad port', () => {
    expect(parseConnection({ host: 'h', port: '0', token: 't' })).toEqual({ ok: false, error: 'Port must be 1–65535' });
  });
  it('rejects a missing host', () => {
    expect(parseConnection({ host: '  ', port: '7445', token: 't' })).toEqual({ ok: false, error: 'Host is required' });
  });
});

describe('connectionToFormState', () => {
  it('round-trips a full connection to strings', () => {
    const c: Connection = { host: 'h', port: 7445, token: 't', wanHost: 'ddns', wanPort: 9 };
    const f = connectionToFormState(c);
    expect(f).toMatchObject({ host: 'h', port: '7445', token: 't', wanHost: 'ddns', wanPort: '9', mac: '', lanIp: '' });
  });
  it('emptyConnectionFormState defaults port to 7445', () => {
    expect(emptyConnectionFormState().port).toBe('7445');
  });
});

describe('commitConnectionEdit', () => {
  it('persists a valid edit and returns the value', async () => {
    const store = fakeStore();
    const form = { ...emptyConnectionFormState(), host: 'mac.ts.net', token: 'tok' };
    const r = await commitConnectionEdit(store, form);
    expect(r.ok).toBe(true);
    expect(await loadConnection(store)).toEqual({ host: 'mac.ts.net', port: 7445, token: 'tok' });
  });
  it('does not persist an invalid edit', async () => {
    const store = fakeStore();
    const r = await commitConnectionEdit(store, { ...emptyConnectionFormState(), host: '', token: 't' });
    expect(r).toEqual({ ok: false, error: 'Host is required' });
    expect(await loadConnection(store)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ipad/connection.test.ts`
Expected: FAIL — `connectionToFormState`, `emptyConnectionFormState`, `commitConnectionEdit` are not exported.

- [ ] **Step 3: Add the helpers to `connection.ts`**

Append to `apps/ipad/src/connection.ts` (after the existing exports):

```ts
export type ConnectionFormState = {
  host: string; port: string; token: string;
  mac: string; lanIp: string; wanHost: string; wanPort: string;
};

export function emptyConnectionFormState(): ConnectionFormState {
  return { host: '', port: '7445', token: '', mac: '', lanIp: '', wanHost: '', wanPort: '' };
}

export function connectionToFormState(c: Connection): ConnectionFormState {
  return {
    host: c.host, port: String(c.port), token: c.token,
    mac: c.mac ?? '', lanIp: c.lanIp ?? '',
    wanHost: c.wanHost ?? '', wanPort: c.wanPort ? String(c.wanPort) : '',
  };
}

export async function commitConnectionEdit(
  store: ConnStore,
  form: ConnectionFormState,
): Promise<{ ok: true; value: Connection } | { ok: false; error: string }> {
  const parsed = parseConnection(form);
  if (!parsed.ok) return parsed;
  await saveConnection(store, parsed.value);
  return parsed;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ipad/connection.test.ts`
Expected: PASS (9 assertions across 3 describe blocks).

- [ ] **Step 5: Commit**

```bash
git add apps/ipad/src/connection.ts tests/ipad/connection.test.ts
git commit -m "feat(ipad): connection form-state + commitConnectionEdit helpers"
```

---

### Task 2: Extract `ConnectionFields` presentational component

DRY the host/port/token + Wake-on-LAN input block out of `App.tsx`'s `ConnectionForm` so both it and the Settings editor share one component. Route the first-run form through `commitConnectionEdit`/`connectionToFormState` from Task 1.

**Files:**
- Create: `apps/ipad/src/components/ConnectionFields.tsx`
- Modify: `apps/ipad/src/App.tsx` (`ConnectionForm`, ~lines 526–663; `inputStyle` at ~664)

**Interfaces:**
- Consumes: `ConnectionFormState`, `parseConnection` (for the WakeButton's derived connection) from Task 1; existing `WakeButton`, `text`, `glassPanel` styles.
- Produces: `function ConnectionFields({ form, onChange }: { form: ConnectionFormState; onChange: (f: ConnectionFormState) => void }): JSX.Element` and `export const inputStyle: React.CSSProperties`.

- [ ] **Step 1: Create `ConnectionFields.tsx`**

```tsx
import type React from 'react';
import { parseConnection, type ConnectionFormState } from '../connection.js';
import { WakeButton } from './WakeButton.js';
import { text } from '@watchtower/ui-core';

export const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '11px 13px', borderRadius: 11,
  border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.06)',
  color: text.primary, fontSize: 15, outline: 'none', WebkitAppearance: 'none',
};

export function ConnectionFields({ form, onChange }: {
  form: ConnectionFormState;
  onChange: (f: ConnectionFormState) => void;
}): JSX.Element {
  const set = (patch: Partial<ConnectionFormState>) => onChange({ ...form, ...patch });
  const parsed = parseConnection(form);
  const wakeConnection = parsed.ok
    ? parsed.value
    : { host: form.host, port: 0, token: form.token,
        mac: form.mac.trim() || undefined, lanIp: form.lanIp.trim() || undefined,
        wanHost: form.wanHost.trim() || undefined,
        wanPort: form.wanPort.trim() ? Number(form.wanPort) : undefined };
  return (
    <>
      <input placeholder="Host Macu (LAN IP nebo Tailscale název)" value={form.host}
        onChange={(e) => set({ host: e.target.value })} style={inputStyle} />
      <input placeholder="port" value={form.port}
        onChange={(e) => set({ port: e.target.value })} style={inputStyle} />
      <input placeholder="token" type="password" value={form.token}
        onChange={(e) => set({ token: e.target.value })} style={inputStyle} />
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', margin: '6px 0', paddingTop: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: text.muted, marginBottom: 8 }}>Probuzení (Wake-on-LAN)</div>
        <div style={{ display: 'grid', gap: 10 }}>
          <input placeholder="MAC adresa (AA:BB:CC:DD:EE:FF)" value={form.mac}
            onChange={(e) => set({ mac: e.target.value })} style={inputStyle} />
          <input placeholder="LAN IP Macu (doma)" value={form.lanIp}
            onChange={(e) => set({ lanIp: e.target.value })} style={inputStyle} />
          <input placeholder="DDNS host (mimo síť)" value={form.wanHost}
            onChange={(e) => set({ wanHost: e.target.value })} style={inputStyle} />
          <input placeholder="DDNS port (výchozí 9)" value={form.wanPort}
            onChange={(e) => set({ wanPort: e.target.value })} style={inputStyle} />
          <WakeButton connection={wakeConnection} />
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Refactor `ConnectionForm` in `App.tsx` to use it**

In `apps/ipad/src/App.tsx`: import `{ ConnectionFields, inputStyle } from './components/ConnectionFields.js'` and `{ connectionToFormState, emptyConnectionFormState, commitConnectionEdit }` from `./connection.js`. Replace the `useState({...})` init with `useState<ConnectionFormState>(emptyConnectionFormState())`; in the load effect use `setForm(connectionToFormState(c))`; in `handleConnect` replace the `saveConnection` + `onConnected` block with:

```tsx
const r = await commitConnectionEdit(store, form);
if (!r.ok) { setError(r.error); setConnecting(false); return; }
onConnected(r.value);
```

Replace the three inline `<input>`s + the Wake `<div>` block (host/port/token/mac/lanIp/wanHost/wanPort + WakeButton) with `<ConnectionFields form={form} onChange={setForm} />`. Delete the now-duplicated local `inputStyle` at the bottom of `App.tsx` (it's exported from `ConnectionFields`); if `App.tsx` still references `inputStyle` elsewhere, import it instead.

- [ ] **Step 3: Verify typecheck + existing tests**

Run: `npm run typecheck:ci`
Expected: PASS (no errors introduced).
Run: `npx vitest run tests/ipad`
Expected: PASS (Task 1 tests + existing ipad tests green).

- [ ] **Step 4: Commit**

```bash
git add apps/ipad/src/components/ConnectionFields.tsx apps/ipad/src/App.tsx
git commit -m "refactor(ipad): extract shared ConnectionFields; route first-run form through commitConnectionEdit"
```

---

### Task 3: In-app connection editor in Settings (#161)

Thread the App-level connection setter down to `SettingsModule` and render an editable "Připojení k Macu" card. Editing the host is what enables Tailscale.

**Files:**
- Modify: `apps/ipad/src/App.tsx` (`App` return ~687–691; `ShellProps`/`Shell` ~289–292; `<SettingsModule />` at ~474)
- Modify: `apps/ipad/src/components/SettingsModule.tsx`

**Interfaces:**
- Consumes: `ConnectionFields` (Task 2); `connectionToFormState`, `commitConnectionEdit`, `type Connection` (Task 1); the App `store`.
- Produces: `SettingsModule` gains props `{ connection: Connection; onConnectionChange: (c: Connection) => void }`.

- [ ] **Step 1: Thread the setter through App + Shell**

In `App.tsx`, pass the setter:

```tsx
<Shell connection={connection} onConnectionChange={setConnection} />
```

Extend `ShellProps` and `Shell`:

```tsx
interface ShellProps {
  connection: Connection;
  onConnectionChange: (c: Connection) => void;
}
function Shell({ connection, onConnectionChange }: ShellProps) {
```

At the settings render site (~line 474):

```tsx
) : activeModule === 'settings' ? (
  <SettingsModule connection={connection} onConnectionChange={onConnectionChange} />
) : (
```

- [ ] **Step 2: Add the editor card to `SettingsModule.tsx`**

Give the component props and add the card above the "Další nastavení připravujeme." line. Import the `store` — to avoid circular imports, add a tiny local Preferences store in `SettingsModule.tsx` (same 3 lines as `App.tsx`) rather than importing from `App.tsx`:

```tsx
import { useState } from 'react';
import { Preferences } from '@capacitor/preferences';
import { ConnectionFields } from './ConnectionFields.js';
import {
  connectionToFormState, commitConnectionEdit, type Connection, type ConnectionFormState,
} from '../connection.js';

const store = {
  get: async (k: string) => (await Preferences.get({ key: k })).value,
  set: async (k: string, v: string) => { await Preferences.set({ key: k, value: v }); },
};

export function SettingsModule({ connection, onConnectionChange }: {
  connection: Connection;
  onConnectionChange: (c: Connection) => void;
}): JSX.Element {
  const [form, setForm] = useState<ConnectionFormState>(() => connectionToFormState(connection));
  const [connError, setConnError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setConnError(null); setSaved(false);
    const r = await commitConnectionEdit(store, form);
    if (!r.ok) { setConnError(r.error); return; }
    onConnectionChange(r.value);
    setSaved(true);
  }
  // ...existing useSupabaseAuth() + return, with the card below inserted...
}
```

Insert this card (Czech copy) inside the max-width column, before the "Další nastavení" note:

```tsx
<div style={{ ...glassCard(16), padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
  <div style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: text.muted }}>
    Připojení k Macu
  </div>
  <div style={{ fontSize: 12, color: text.dim }}>
    Pro přístup mimo domácí síť zadejte Tailscale název Macu jako host.
  </div>
  <div style={{ display: 'grid', gap: 10 }}>
    <ConnectionFields form={form} onChange={setForm} />
  </div>
  {connError && <div style={{ fontSize: 12, color: '#ff8a8a' }}>{connError}</div>}
  {saved && <div style={{ fontSize: 12, color: '#9be7c0' }}>Uloženo, připojuji…</div>}
  <button onClick={() => void handleSave()} style={{
    alignSelf: 'flex-start', padding: '9px 16px', borderRadius: 11, border: 'none',
    background: ctaGradient, boxShadow: ctaGlow, color: '#fff', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent',
  }}>Uložit a připojit</button>
</div>
```

Changing the App-level `connection` (via `onConnectionChange`) rebuilds the transport in `ConnectionProvider` (it deps on `connection.host/port/token`), so saving a new host reconnects with no relaunch.

- [ ] **Step 3: Verify typecheck + tests**

Run: `npm run typecheck:ci`
Expected: PASS.
Run: `npx vitest run tests/ipad`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/ipad/src/App.tsx apps/ipad/src/components/SettingsModule.tsx
git commit -m "feat(ipad): in-app connection editor in Settings (#161)"
```

---

### Task 4: Desktop advertises the tailnet address

Flag when the WS bridge bound a Tailscale address so the user knows the exact off-network host to enter.

**Files:**
- Modify: `orchestrator/remoteBind.ts` (`isTailscale` ~line 9; `formatIpadConnectionInfo` ~line 49)
- Test: `tests/orchestrator/remoteBind.test.ts`

**Interfaces:**
- Consumes: existing `formatIpadConnectionInfo({ host, port, token })`.
- Produces: `export function isTailscale(addr: string): boolean` (make the existing private fn exported); annotated `formatIpadConnectionInfo` output.

- [ ] **Step 1: Write the failing test**

Add to `tests/orchestrator/remoteBind.test.ts`:

```ts
import { formatIpadConnectionInfo, isTailscale } from '../../orchestrator/remoteBind.js';

describe('formatIpadConnectionInfo', () => {
  it('annotates a Tailscale host as off-network reachable', () => {
    const line = formatIpadConnectionInfo({ host: '100.101.102.103', port: 7445, token: 't' });
    expect(line).toContain('Tailscale');
    expect(line).toContain('ws://100.101.102.103:7445/ws');
  });
  it('does not annotate a plain LAN host', () => {
    const line = formatIpadConnectionInfo({ host: '192.168.0.52', port: 7445, token: 't' });
    expect(line).not.toContain('Tailscale');
  });
  it('isTailscale detects the CGNAT range', () => {
    expect(isTailscale('100.64.0.1')).toBe(true);
    expect(isTailscale('192.168.0.52')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/remoteBind.test.ts`
Expected: FAIL — `isTailscale` not exported; no "Tailscale" annotation.

- [ ] **Step 3: Implement**

In `orchestrator/remoteBind.ts`: change `function isTailscale` to `export function isTailscale`. Replace `formatIpadConnectionInfo`:

```ts
export function formatIpadConnectionInfo(opts: { host: string; port: number; token: string }): string {
  const scope = isTailscale(opts.host) ? ' (Tailscale — reachable off-network)' : '';
  return `[orchestrator] iPad connect${scope} → ws://${opts.host}:${opts.port}/ws  token: ${opts.token}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator/remoteBind.test.ts`
Expected: PASS (existing 7 + 3 new).

- [ ] **Step 5: Commit**

```bash
git add orchestrator/remoteBind.ts tests/orchestrator/remoteBind.test.ts
git commit -m "feat(orchestrator): flag Tailscale-bound WS bridge in iPad connect line"
```

---

### Task 5: Setup documentation

**Files:**
- Create: `docs/ipad-remote-access.md`

- [ ] **Step 1: Write the doc**

```markdown
# iPad remote access (off-network) via Tailscale

The iPad reaches the Mac's instance control (WS bridge) and the "Vzdálený Mac"
VNC screen through a single `host` value. Set it to the Mac's Tailscale MagicDNS
name and it works both on the home Wi-Fi and from anywhere.

## One-time setup
1. Install Tailscale on the Mac and the iPad; sign both into the same tailnet.
2. Enable **MagicDNS** in the Tailscale admin console.
3. Note the Mac's MagicDNS name (e.g. `jans-mac.<tailnet>.ts.net`) or its
   `100.x` address (`tailscale ip -4`).
4. Run Watchtower on the Mac as usual — `WATCHTOWER_WS_HOST=auto` binds the
   tailnet interface automatically (the `iPad connect →` log line is annotated
   "(Tailscale — reachable off-network)").
5. On the iPad: **Nastavení → Připojení k Macu**, set **Host** = the MagicDNS
   name, **port** = the bridge port (default 7445), **token** = the value from
   the desktop log, then **Uložit a připojit**.

## Notes / limitations
- The Mac must stay **awake and online** — Tailscale keeps the path but can't
  wake a sleeping Mac; Wake-on-LAN is not available on this hardware (finding #105).
- Traffic is WireGuard-encrypted and the bridge is reachable only from your
  tailnet — never the public internet — which is why the plaintext-`ws://`
  token transport is acceptable off-network.
- No LAN/WAN switching: one MagicDNS host works everywhere (Tailscale uses a
  direct path on the same LAN).
```

- [ ] **Step 2: Commit**

```bash
git add docs/ipad-remote-access.md
git commit -m "docs: iPad off-network access via Tailscale setup"
```

---

## Self-Review

- **Spec coverage:** connection editor (#161) → Tasks 1–3; desktop advertises tailnet host → Task 4; docs → Task 5; VNC rides `connection.host` (no task needed, verified in spec); no wss/switching/WoL (out of scope). ✓
- **Placeholder scan:** none — every step has concrete code/commands. ✓
- **Type consistency:** `ConnectionFormState`, `connectionToFormState`, `emptyConnectionFormState`, `commitConnectionEdit`, `isTailscale` used with identical signatures across tasks; `SettingsModule` props match the App/Shell call site. ✓
- **Test reality:** pure-logic tests with a fake `ConnStore` (mirrors `tests/ipad/vncCreds.test.ts`); no jsdom/testing-library introduced. React wiring (Tasks 2–3) verified by `typecheck:ci`. ✓
