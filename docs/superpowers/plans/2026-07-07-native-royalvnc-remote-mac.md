# Native RoyalVNC Remote Mac (#86) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the laggy noVNC-in-WebView Remote Mac renderer with a native RoyalVNC (Swift/Capacitor) client that decodes on-device and connects directly to the Mac's Screen Sharing over TCP, for smooth low-latency control from the iPad.

**Architecture:** A Capacitor Swift plugin (`RemoteVnc`) presents a native full-screen `VncViewController` modally over the WebView. The VC drives RoyalVNC by raw TCP straight to `host:5900` (Apple RFB type-30 auth), renders `framebuffer.cgImage`, and owns pointer/keyboard input. React keeps only the credential login form and the auth-block handoff; it invokes the plugin and mirrors its `state`/`authFailed`/`closed` events. The now-dead noVNC WS relay and `@novnc/novnc` are removed (iOS-only).

**Tech Stack:** Swift + RoyalVNCKit (SPM, `github.com/royalapplications/royalvnc`, product `RoyalVNCKit`, dynamic, iOS 15+), Capacitor 6 plugin API; React + Capacitor (iPad app, plain React + inline styles, no MUI); vitest (`environment: node`) for TS logic.

## Global Constraints

- **Locale Czech; no i18n.** All user-facing copy is Czech string literals.
- **iPad app is plain React + inline styles — no MUI.**
- **`@watchtower/shared` is a BUILT composite.** After editing `packages/shared/src/*`, rebuild (`tsc -b packages/shared/tsconfig.json`) before orchestrator/iPad typecheck sees it. (No shared edits are expected in this plan.)
- **Keep the suite green:** `npm test` (vitest run). Currently ~1026 tests. Add/remove tests as tasks dictate; the full suite must pass at every commit.
- **Typecheck gate:** `npm run typecheck:ci` compiles every workspace tsconfig incl. apps/{desktop,ipad,iphone}. A type break anywhere fails CI.
- **VNC target is the Mac's reachable address** `connection.host:5900` — Apple RFB type-30 auth (macOS short name + login password). No client-supplied host beyond the existing connection host.
- **Native build:** bundle id `cz.watchtower.ipad`. SPM product `RoyalVNCKit` is forced `.dynamic` → the `Embed Frameworks` copy phase (`CodeSignOnCopy`) is mandatory or the app dyld-crashes at launch.
- **Do NOT change `Base.lproj/Main.storyboard`.** The Capacitor bridge VC (`MainViewController`) stays the app root; the spike's storyboard swap is not ported.
- **Copy the git-ignored iPad `.env` into the worktree before any device build** (empty `VITE_SUPABASE_ANON_KEY` → startup crash).

---

### Task 1: iPad — `RemoteVnc` Capacitor plugin JS wrapper

**Files:**
- Create: `apps/ipad/src/lib/remoteVnc.ts`
- Test: `tests/ipad/remoteVnc.test.ts`

**Interfaces:**
- Produces:
  - `type VncState = 'connecting' | 'connected' | 'disconnected'`
  - `interface RemoteVncPlugin { present(o: { host: string; username: string; password: string }): Promise<void>; disconnect(): Promise<void>; addListener(ev: 'state', cb: (d: { status: VncState }) => void): Promise<{ remove: () => void }>; addListener(ev: 'authFailed', cb: () => void): Promise<{ remove: () => void }>; addListener(ev: 'closed', cb: () => void): Promise<{ remove: () => void }>; }`
  - `export const RemoteVnc: RemoteVncPlugin` (via `registerPlugin`), web impl is a no-op.
- Consumed by Task 2.

- [ ] **Step 1: Write the failing test**

```ts
// tests/ipad/remoteVnc.test.ts
import { describe, it, expect, vi } from 'vitest';

// Force the web (no-op) implementation: registerPlugin uses the `web` factory
// when there's no native bridge (jsdom/node has none).
vi.mock('@capacitor/core', () => ({
  registerPlugin: (_name: string, impl: { web: () => unknown }) => impl.web(),
}));

describe('RemoteVnc web fallback', () => {
  it('present/disconnect resolve and addListener returns a remover', async () => {
    const { RemoteVnc } = await import('../../apps/ipad/src/lib/remoteVnc.js');
    await expect(RemoteVnc.present({ host: 'h', username: 'u', password: 'p' })).resolves.toBeUndefined();
    await expect(RemoteVnc.disconnect()).resolves.toBeUndefined();
    const sub = await RemoteVnc.addListener('state', () => {});
    expect(typeof sub.remove).toBe('function');
    sub.remove();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ipad/remoteVnc.test.ts`
Expected: FAIL — cannot find module `remoteVnc.js`.

- [ ] **Step 3: Implement the wrapper**

```ts
// apps/ipad/src/lib/remoteVnc.ts
import { registerPlugin } from '@capacitor/core';

export type VncState = 'connecting' | 'connected' | 'disconnected';

export interface RemoteVncPlugin {
  /** Present the native full-screen VNC view controller and connect to host:5900. */
  present(o: { host: string; username: string; password: string }): Promise<void>;
  /** Disconnect + dismiss the native VC if present. */
  disconnect(): Promise<void>;
  addListener(ev: 'state', cb: (d: { status: VncState }) => void): Promise<{ remove: () => void }>;
  addListener(ev: 'authFailed', cb: () => void): Promise<{ remove: () => void }>;
  addListener(ev: 'closed', cb: () => void): Promise<{ remove: () => void }>;
}

// Web (non-iOS) is a no-op: the native renderer only exists on device. The
// React module guards with Capacitor.getPlatform() before calling present().
export const RemoteVnc = registerPlugin<RemoteVncPlugin>('RemoteVnc', {
  web: () => ({
    async present() { /* no-op on web */ },
    async disconnect() { /* no-op on web */ },
    async addListener() { return { remove: () => { /* no-op */ } }; },
  }),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ipad/remoteVnc.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ipad/src/lib/remoteVnc.ts tests/ipad/remoteVnc.test.ts
git commit -m "feat: #86 RemoteVnc Capacitor plugin JS wrapper + web no-op"
```

---

### Task 2: iPad — rewrite `RemoteMacView` to drive the native plugin

**Files:**
- Modify (rewrite): `apps/ipad/src/components/RemoteMacView.tsx`
- Test: manual (React/DOM not unit-tested in the `node`-env vitest setup); verified by typecheck + build.

**Interfaces:**
- Consumes: `RemoteVnc`, `VncState` (Task 1); existing `loadVncCreds`/`saveVncCreds` (`apps/ipad/src/state/vncCreds.ts`), `useConnection` (`apps/ipad/src/state/connectionContext.js`), `Connection` (`apps/ipad/src/connection.js`), `WakeButton`, and `@watchtower/ui-core` glass tokens.
- Keeps the same component signature `RemoteMacView({ connection, immersive, onToggleImmersive })` so `App.tsx` needs no change (the `immersive`/`onToggleImmersive` props become unused but are accepted to avoid touching the caller in this task).

- [ ] **Step 1: Rewrite the component**

Replace the entire file with the version below. It preserves the existing Czech login form + saved-credential flow and the disconnected/retry chrome, but swaps the noVNC `screenRef`/`RFB` for `RemoteVnc.present(...)` + event listeners. On iOS it presents the native VC; on web it shows a short notice (native-only).

```tsx
import { useEffect, useRef, useState } from 'react';
import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';
import { RemoteVnc, type VncState } from '../lib/remoteVnc.js';
import { useConnection } from '../state/connectionContext.js';
import { type Connection } from '../connection.js';
import { loadVncCreds, saveVncCreds, type VncCreds } from '../state/vncCreds.js';
import { WakeButton } from './WakeButton.js';
import { baseBg, statusGlass, glassPanel, text, ctaGradient, ctaGlow } from '@watchtower/ui-core';

const store = {
  get: async (k: string) => (await Preferences.get({ key: k })).value,
  set: async (k: string, v: string) => { await Preferences.set({ key: k, value: v }); },
};

const isIos = Capacitor.getPlatform() === 'ios';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function RemoteMacView({ connection, immersive, onToggleImmersive }: {
  connection: Connection;
  immersive: boolean;
  onToggleImmersive: () => void;
}) {
  useConnection(); // ensures we're inside the provider
  const [creds, setCreds] = useState<VncCreds | null>(null);
  const [credsLoaded, setCredsLoaded] = useState(false);
  const [status, setStatus] = useState<VncState>('connecting');
  const [loginOpen, setLoginOpen] = useState(false);
  const [authFailed, setAuthFailed] = useState(false);
  const [nonce, setNonce] = useState(0); // bump to re-present
  const [form, setForm] = useState({ username: '', password: '' });
  const presenting = useRef(false);

  // Load saved macOS credentials once.
  useEffect(() => {
    void loadVncCreds(store).then((c) => {
      if (c) setForm((f) => ({ ...f, username: c.username }));
      setCreds(c);
      setCredsLoaded(true);
    });
  }, []);

  // Present the native VC whenever we have credentials (iOS only). Subscribe to
  // native lifecycle events; disconnect + remove listeners on unmount/re-present.
  useEffect(() => {
    if (!creds || !isIos) return;
    let removers: Array<{ remove: () => void }> = [];
    let cancelled = false;
    setStatus('connecting');
    presenting.current = true;

    void (async () => {
      removers = await Promise.all([
        RemoteVnc.addListener('state', (d) => {
          setStatus(d.status);
          if (d.status === 'connected') { setLoginOpen(false); setAuthFailed(false); }
        }),
        RemoteVnc.addListener('authFailed', () => { setAuthFailed(true); setLoginOpen(true); }),
        RemoteVnc.addListener('closed', () => { setStatus('disconnected'); }),
      ]);
      if (cancelled) { removers.forEach((r) => r.remove()); return; }
      await RemoteVnc.present({ host: connection.host, username: creds.username, password: creds.password });
    })();

    return () => {
      cancelled = true;
      removers.forEach((r) => r.remove());
      void RemoteVnc.disconnect();
      presenting.current = false;
    };
  }, [creds, connection, nonce]);

  async function submitCreds() {
    const next = { username: form.username.trim(), password: form.password };
    if (!next.username || !next.password) return;
    await saveVncCreds(store, next);
    setAuthFailed(false);
    setLoginOpen(false);
    setStatus('connecting');
    setCreds(next); // new ref → re-present effect runs
  }

  if (!credsLoaded) {
    return (
      <div style={{ ...fill, alignItems: 'center', justifyContent: 'center', color: text.muted, fontSize: 14 }}>
        Načítání…
      </div>
    );
  }

  if (!isIos) {
    return (
      <div style={{ ...fill, alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', color: text.muted, fontSize: 14, lineHeight: 1.5 }}>
        Vzdálený Mac je dostupný jen v aplikaci na iPadu.
      </div>
    );
  }

  if (!creds || loginOpen) {
    const err = statusGlass('disconnected');
    return (
      <div style={{ ...fill, alignItems: 'center', justifyContent: 'center', padding: 24, boxSizing: 'border-box' }}>
        <div style={{ ...glassPanel({ radius: 22 }), padding: 24, display: 'grid', gap: 12, width: '100%', maxWidth: 380 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: text.primary }}>Přihlášení k obrazovce Macu</div>
          <div style={{ fontSize: 13, color: text.muted, lineHeight: 1.45 }}>
            Zadejte <b>uživatelské jméno účtu macOS</b> (krátké jméno, např. „jan“ — ne Apple ID)
            a heslo, kterým se přihlašujete k Macu.
          </div>
          {authFailed && (
            <div role="alert" style={{ ...err.panel, borderRadius: 12, padding: '9px 13px', color: err.accent, fontSize: 13 }}>
              Přihlášení selhalo – zkontrolujte krátké jméno účtu macOS a heslo.
            </div>
          )}
          <input placeholder="krátké jméno účtu macOS (např. jan)" autoCapitalize="none" autoCorrect="off"
            value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} style={inputStyle} />
          <input placeholder="heslo k Macu" type="password"
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} style={inputStyle} />
          <button onClick={() => void submitCreds()} style={primaryBtn}>Připojit</button>
        </div>
      </div>
    );
  }

  // Native VC is presented over the WebView. This view shows only the connect/
  // disconnect chrome that sits behind it while (re)connecting or after close.
  return (
    <div style={{ ...fill, flexDirection: 'column', position: 'relative', alignItems: 'center', justifyContent: 'center', background: baseBg }}>
      {status !== 'connected' && (
        <StatusBanner
          status={status}
          connection={connection}
          onRetry={() => setNonce((n) => n + 1)}
          onChangeLogin={() => setLoginOpen(true)}
        />
      )}
    </div>
  );
}

function StatusBanner({ status, connection, onRetry, onChangeLogin }: {
  status: VncState;
  connection: Connection;
  onRetry: () => void;
  onChangeLogin: () => void;
}) {
  const g = statusGlass(status === 'disconnected' ? 'disconnected' : 'connecting');
  return (
    <div role="status" aria-live="polite" style={{
      ...g.panel, borderRadius: 16, padding: '11px 18px', maxWidth: 'calc(100% - 32px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap',
      color: g.accent, fontSize: 13, fontWeight: 600,
    }}>
      <span style={{ ...g.dot, flexShrink: 0 }} />
      {status === 'connecting' ? (
        <span>Připojuji k obrazovce Macu…</span>
      ) : (
        <>
          <span>Odpojeno – zkontrolujte Sdílení obrazovky na Macu</span>
          <button onClick={onRetry} style={glassBtn(g.accent)}>Zkusit znovu</button>
          <button onClick={onChangeLogin} style={glassBtn(g.accent)}>Změnit přihlášení</button>
          {connection.mac && <WakeButton connection={connection} />}
        </>
      )}
    </div>
  );
}

const fill: React.CSSProperties = { display: 'flex', flex: 1, minWidth: 0, height: '100%', backgroundColor: 'transparent' };
const inputStyle: React.CSSProperties = {
  padding: '11px 13px', borderRadius: 11, border: '1px solid rgba(255,255,255,0.15)',
  background: 'rgba(255,255,255,0.06)', color: text.primary, fontSize: 14,
  fontFamily: 'system-ui, sans-serif', outline: 'none',
};
const primaryBtn: React.CSSProperties = {
  padding: '11px 0', borderRadius: 12, border: 'none', background: ctaGradient,
  boxShadow: ctaGlow, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
};
function glassBtn(color: string): React.CSSProperties {
  return {
    padding: '6px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.20)',
    background: 'rgba(255,255,255,0.08)', color, fontSize: 12, fontWeight: 600,
    cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
  };
}
```

- [ ] **Step 2: Verify no remaining noVNC references in this file**

Run: `grep -n "novnc\|RFB\|screenRef\|scaleViewport" apps/ipad/src/components/RemoteMacView.tsx`
Expected: no matches.

- [ ] **Step 3: Typecheck + build the iPad bundle**

Run: `npm run typecheck:ci && npm run build -w @watchtower/ipad`
Expected: PASS (the `@novnc/novnc` import is gone; `remoteVnc.ts` resolves). Any residual `@novnc/novnc` type error means a stale import remains — fix it here.

- [ ] **Step 4: Commit**

```bash
git add apps/ipad/src/components/RemoteMacView.tsx
git commit -m "feat: #86 RemoteMacView drives native RemoteVnc plugin (drop noVNC)"
```

---

### Task 3: iPad — remove noVNC dependency + dead VNC helpers

**Files:**
- Modify: `apps/ipad/package.json` (drop `@novnc/novnc`), `package-lock.json`
- Delete: `apps/ipad/src/types/novnc.d.ts`
- Delete (if unreferenced): `apps/ipad/src/lib/vncKeys.ts`, `tests/ipad/vncKeys.test.ts`
- Modify: `apps/ipad/src/connection.ts` (remove `connectionToVncWsUrl`)
- Modify: `tests/ipad/connection.test.ts` (remove the `connectionToVncWsUrl` test)

**Interfaces:**
- Removes: `connectionToVncWsUrl` (was consumed only by the noVNC `RemoteMacView`, now gone). `connectionToWsUrl` (the `/ws` data channel) is **kept**.

- [ ] **Step 1: Confirm nothing still references the removed symbols**

Run:
```bash
grep -rn "connectionToVncWsUrl\|@novnc/novnc\|vncKeys\|VNC_KEYSYMS" apps client tests packages | grep -v node_modules
```
Expected: matches only in `connection.ts` (definition), `connection.test.ts` (the test to delete), `vncKeys.ts`/`vncKeys.test.ts` (files to delete), and `package.json`. If `vncKeys`/`VNC_KEYSYMS` appears anywhere else, do NOT delete `vncKeys.ts` — leave it and note the reference in the commit body.

- [ ] **Step 2: Remove the dependency + files**

```bash
npm uninstall @novnc/novnc -w @watchtower/ipad
git rm apps/ipad/src/types/novnc.d.ts apps/ipad/src/lib/vncKeys.ts tests/ipad/vncKeys.test.ts
```
(If Step 1 showed `vncKeys` is still referenced, skip removing `vncKeys.ts`/`vncKeys.test.ts`.)

- [ ] **Step 3: Remove `connectionToVncWsUrl`**

In `apps/ipad/src/connection.ts`, delete the function:
```ts
export function connectionToVncWsUrl(c: Connection): string {
  return `ws://${c.host}:${c.port}/vnc`;
}
```
In `tests/ipad/connection.test.ts`, delete the `describe('connectionToVncWsUrl', ...)` block (and its import if it imports `connectionToVncWsUrl` separately).

- [ ] **Step 4: Typecheck + full suite**

Run: `npm run typecheck:ci && npm test`
Expected: PASS; no unresolved `@novnc/novnc`, no missing `connectionToVncWsUrl`.

- [ ] **Step 5: Commit**

```bash
git add apps/ipad/package.json package-lock.json apps/ipad/src/connection.ts tests/ipad/connection.test.ts
git commit -m "chore: #86 remove noVNC dep + dead VNC web helpers (iOS-only native)"
```

---

### Task 4: Orchestrator — remove the dead `/vnc` WS→TCP relay

**Files:**
- Modify: `orchestrator/wsBridge.ts` (remove the `/vnc` route + `vncConnect` option + `relayVnc`/`net` imports if now unused)
- Delete: `orchestrator/vncRelay.ts`, `tests/orchestrator/vncRelay.test.ts`, `tests/orchestrator/wsBridge.vnc.test.ts`
- Test: existing `tests/orchestrator/wsBridge*.test.ts` (the non-vnc ones) must still pass.

**Interfaces:**
- Removes: the `GET /vnc` route and `WsBridgeOptions.vncConnect`. The `/ws` data channel and all other bridge behavior are unchanged. **The auth-block detector (`orchestrator/authBlockDetector.ts`) and the `authBlock` push stay** — they drive the React handoff.

- [ ] **Step 1: Confirm the relay's only consumer was noVNC**

Run:
```bash
grep -rn "vncRelay\|relayVnc\|vncConnect\|'/vnc'\|\"/vnc\"" orchestrator tests | grep -v node_modules
```
Expected: matches only in `wsBridge.ts`, `vncRelay.ts`, and the two vnc test files.

- [ ] **Step 2: Delete the relay module + its tests**

```bash
git rm orchestrator/vncRelay.ts tests/orchestrator/vncRelay.test.ts tests/orchestrator/wsBridge.vnc.test.ts
```

- [ ] **Step 3: Remove the route + option from `wsBridge.ts`**

Delete the `scoped.get('/vnc', …)` handler block, the `vncConnect` field from `WsBridgeOptions`, and the `import { relayVnc, type VncWsLike } from './vncRelay.js';` line. If `import net, { type Socket } from 'node:net';` is now unused (grep the file for `net.` / `Socket`), remove it too; otherwise leave it.

- [ ] **Step 4: Typecheck + full suite**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit && npm test`
Expected: PASS; orchestrator compiles without `vncRelay`; no test references the removed route.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/wsBridge.ts
git commit -m "chore: #86 remove dead /vnc WS relay (native VNC uses direct TCP)"
```

---

### Task 5: Native — `VncViewController` + `RemoteVncPlugin` + registration

**Files:**
- Create: `apps/ipad/ios/App/App/VncViewController.swift`
- Create: `apps/ipad/ios/App/App/RemoteVncPlugin.swift`
- Modify: `apps/ipad/ios/App/App/MainViewController.swift` (register the plugin)
- Test: source review + the build gate in Task 6 (Swift is not in the vitest suite).

**Interfaces:**
- Consumes (from RoyalVNCKit): `VNCConnection`, `VNCConnection.Settings`, `VNCConnectionDelegate`, `VNCFramebuffer` (`.cgImage`, `.size`), `VNCUsernamePasswordCredential`, `VNCPasswordCredential`, `VNCPrintLogger`, and the input methods on `VNCConnection` (`mouseButtonDown/Up`, `keyDown/Up`, cursor-move + scroll — see Step 1).
- Produces (to JS, Task 1's contract): plugin `RemoteVnc` with `present`, `disconnect`, and listener events `state` (`{status}`), `authFailed`, `closed`.
- Consumes (Capacitor): `CAPPlugin`, `CAPBridgedPlugin`, `CAPPluginCall`, `bridge?.viewController` (the presenter). Registration mirrors `WakePlugin` in `MainViewController`.

- [ ] **Step 1: Confirm the RoyalVNCKit input API before writing gestures**

The connection lifecycle, rendering, tap-click, and keyboard signatures are confirmed by the spike (`SpikeVNCViewController.swift` on `spike/86-royalvnc`). The **cursor-move, scroll-wheel, and right-click** signatures are not yet confirmed. After the SPM package resolves (Task 6 Step 1 runs `-resolvePackageDependencies`), read the public `VNCConnection` interface and confirm the exact method names/signatures:

Run (after Task 6's resolve; if doing Task 5 first, resolve manually — see Task 6 Step 1):
```bash
find ~/Library/Developer/Xcode/DerivedData apps/ipad/ios -type d -name "royalvnc" 2>/dev/null | head; \
grep -rn "func mouse\|func scroll\|func keyDown\|func keyUp\|func mouseButton\|func mouseWheel" \
  $(find ~/Library/Developer/Xcode/DerivedData -path "*royalvnc*/Sources*" -name "*.swift" 2>/dev/null) 2>/dev/null | head -40
```
Use the exact signatures found. The code below uses the spike-confirmed `mouseButtonDown/Up(_:x:y:)` and `keyDown/Up(_:)`; adjust the move/scroll calls (marked `// VERIFY`) to match.

- [ ] **Step 2: Write `VncViewController.swift`**

Full-screen VC: renders the framebuffer aspect-fit, maps touches to framebuffer coordinates (accounting for letterboxing), sends pointer + keyboard input, shows a glass status pill + a back button, and calls back to the plugin via closures. Based on the spike VC, with production input + chrome.

```swift
import UIKit
import RoyalVNCKit

/// Full-screen native VNC screen. Owns the RoyalVNC connection, renders the
/// framebuffer, and translates iOS touch/keyboard input into RFB input events.
/// Lifecycle is reported to the presenting plugin through the closures below.
final class VncViewController: UIViewController, VNCConnectionDelegate {
    // Injected by the plugin.
    var host = ""
    var username = ""
    var password = ""
    var onState: ((String) -> Void)?
    var onAuthFailed: (() -> Void)?
    var onClosed: (() -> Void)?

    private let imageView = UIImageView()
    private let statusLabel = PaddedLabel()
    private let backButton = UIButton(type: .system)
    private let keyboardCatcher = UITextField()

    private var connection: VNCConnection?
    private var fbSize: CGSize = .zero
    private var authRejected = false
    private var pointerDown = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        setupUI()
        connect()
    }

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }

    private func setupUI() {
        imageView.contentMode = .scaleAspectFit
        imageView.backgroundColor = .black
        imageView.isUserInteractionEnabled = true
        imageView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(imageView)

        // Hidden text field: becomes first responder to summon the iOS soft
        // keyboard and to receive hardware key presses (pressesBegan/Ended).
        keyboardCatcher.autocorrectionType = .no
        keyboardCatcher.autocapitalizationType = .none
        keyboardCatcher.spellCheckingType = .no
        keyboardCatcher.inputAssistantItem.leadingBarButtonGroups = []
        keyboardCatcher.inputAssistantItem.trailingBarButtonGroups = []
        keyboardCatcher.frame = .zero
        keyboardCatcher.delegate = self
        view.addSubview(keyboardCatcher)

        statusLabel.textColor = .white
        statusLabel.font = .systemFont(ofSize: 14, weight: .semibold)
        statusLabel.backgroundColor = UIColor(white: 0.08, alpha: 0.82)
        statusLabel.layer.cornerRadius = 14
        statusLabel.layer.masksToBounds = true
        statusLabel.textAlignment = .center
        statusLabel.text = "Připojuji k obrazovce Macu…"
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(statusLabel)

        backButton.setTitle("‹ Zpět", for: .normal)
        backButton.setTitleColor(.white, for: .normal)
        backButton.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
        backButton.backgroundColor = UIColor(white: 0.08, alpha: 0.82)
        backButton.layer.cornerRadius = 12
        backButton.contentEdgeInsets = UIEdgeInsets(top: 8, left: 14, bottom: 8, right: 14)
        backButton.addTarget(self, action: #selector(backTapped), for: .touchUpInside)
        backButton.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(backButton)

        let keyboardButton = UIButton(type: .system)
        keyboardButton.setTitle("⌨", for: .normal)
        keyboardButton.setTitleColor(.white, for: .normal)
        keyboardButton.titleLabel?.font = .systemFont(ofSize: 20)
        keyboardButton.backgroundColor = UIColor(white: 0.08, alpha: 0.82)
        keyboardButton.layer.cornerRadius = 12
        keyboardButton.contentEdgeInsets = UIEdgeInsets(top: 6, left: 12, bottom: 6, right: 12)
        keyboardButton.addTarget(self, action: #selector(toggleKeyboard), for: .touchUpInside)
        keyboardButton.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(keyboardButton)

        NSLayoutConstraint.activate([
            imageView.topAnchor.constraint(equalTo: view.topAnchor),
            imageView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            imageView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            imageView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            statusLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            statusLabel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            statusLabel.heightAnchor.constraint(equalToConstant: 40),
            backButton.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            backButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            keyboardButton.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            keyboardButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
        ])

        addGestures()
    }

    private func addGestures() {
        let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
        imageView.addGestureRecognizer(tap)

        let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
        pan.maximumNumberOfTouches = 1
        imageView.addGestureRecognizer(pan)

        let twoFingerPan = UIPanGestureRecognizer(target: self, action: #selector(handleScroll(_:)))
        twoFingerPan.minimumNumberOfTouches = 2
        twoFingerPan.maximumNumberOfTouches = 2
        imageView.addGestureRecognizer(twoFingerPan)

        let longPress = UILongPressGestureRecognizer(target: self, action: #selector(handleLongPress(_:)))
        imageView.addGestureRecognizer(longPress)
    }

    private func connect() {
        connection?.disconnect()
        authRejected = false
        let settings = VNCConnection.Settings(
            isDebugLoggingEnabled: false,
            hostname: host,
            port: 5900,
            isShared: true,
            isScalingEnabled: false,
            useDisplayLink: false,
            inputMode: .none,
            isClipboardRedirectionEnabled: false,
            colorDepth: .depth24Bit,
            frameEncodings: VNCFrameEncodingType.defaultFrameEncodings
        )
        let conn = VNCConnection(settings: settings, logger: VNCPrintLogger())
        conn.delegate = self
        connection = conn
        onState?("connecting")
        conn.connect()
    }

    @objc private func backTapped() {
        connection?.disconnect()
        connection = nil
        dismiss(animated: true) { [weak self] in self?.onClosed?() }
    }

    @objc private func toggleKeyboard() {
        if keyboardCatcher.isFirstResponder { keyboardCatcher.resignFirstResponder() }
        else { keyboardCatcher.becomeFirstResponder() }
    }

    // MARK: - Coordinate mapping (aspect-fit letterbox aware)
    private func framebufferPoint(from p: CGPoint) -> (UInt16, UInt16)? {
        guard fbSize != .zero, imageView.bounds.width > 0, imageView.bounds.height > 0 else { return nil }
        let viewSize = imageView.bounds.size
        let scale = min(viewSize.width / fbSize.width, viewSize.height / fbSize.height)
        let drawW = fbSize.width * scale
        let drawH = fbSize.height * scale
        let offX = (viewSize.width - drawW) / 2
        let offY = (viewSize.height - drawH) / 2
        let fx = (p.x - offX) / scale
        let fy = (p.y - offY) / scale
        let x = UInt16(max(0, min(fbSize.width - 1, fx)))
        let y = UInt16(max(0, min(fbSize.height - 1, fy)))
        return (x, y)
    }

    @objc private func handleTap(_ gr: UITapGestureRecognizer) {
        guard let conn = connection, let (x, y) = framebufferPoint(from: gr.location(in: imageView)) else { return }
        conn.mouseButtonDown(.left, x: x, y: y)
        conn.mouseButtonUp(.left, x: x, y: y)
    }

    @objc private func handlePan(_ gr: UIPanGestureRecognizer) {
        guard let conn = connection, let (x, y) = framebufferPoint(from: gr.location(in: imageView)) else { return }
        switch gr.state {
        case .began:
            conn.mouseButtonDown(.left, x: x, y: y); pointerDown = true
        case .changed:
            if pointerDown { conn.mouseButtonDown(.left, x: x, y: y) } // VERIFY: prefer conn.mouseMove(x:y:) if available
        case .ended, .cancelled, .failed:
            conn.mouseButtonUp(.left, x: x, y: y); pointerDown = false
        default: break
        }
    }

    @objc private func handleScroll(_ gr: UIPanGestureRecognizer) {
        guard let conn = connection, let (x, y) = framebufferPoint(from: gr.location(in: imageView)) else { return }
        let dy = gr.translation(in: imageView).y
        guard abs(dy) > 8 else { return }
        // VERIFY against RoyalVNCKit: wheel is commonly RFB buttons 4 (up) / 5 (down).
        let up = dy > 0
        conn.mouseButtonDown(up ? .wheelUp : .wheelDown, x: x, y: y)
        conn.mouseButtonUp(up ? .wheelUp : .wheelDown, x: x, y: y)
        gr.setTranslation(.zero, in: imageView)
    }

    @objc private func handleLongPress(_ gr: UILongPressGestureRecognizer) {
        guard gr.state == .began, let conn = connection,
              let (x, y) = framebufferPoint(from: gr.location(in: imageView)) else { return }
        conn.mouseButtonDown(.right, x: x, y: y)
        conn.mouseButtonUp(.right, x: x, y: y)
    }

    // MARK: - Rendering
    private func render(_ framebuffer: VNCFramebuffer) {
        guard let cg = framebuffer.cgImage else { return }
        let img = UIImage(cgImage: cg)
        DispatchQueue.main.async {
            self.fbSize = CGSize(width: Int(framebuffer.size.width), height: Int(framebuffer.size.height))
            self.imageView.image = img
        }
    }

    // MARK: - Keyboard → keysym
    override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        if !sendPresses(presses, down: true) { super.pressesBegan(presses, with: event) }
    }
    override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        if !sendPresses(presses, down: false) { super.pressesEnded(presses, with: event) }
    }
    private func sendPresses(_ presses: Set<UIPress>, down: Bool) -> Bool {
        guard let conn = connection else { return false }
        var handled = false
        for press in presses {
            guard let key = press.key else { continue }
            if let keysym = VncKeyMap.keysym(for: key) {
                if down { conn.keyDown(keysym) } else { conn.keyUp(keysym) } // VERIFY: keyDown/Up arg type (VNCKeyCode)
                handled = true
            }
        }
        return handled
    }

    // MARK: - VNCConnectionDelegate
    func connection(_ connection: VNCConnection, stateDidChange state: VNCConnection.ConnectionState) {
        DispatchQueue.main.async {
            switch state.status {
            case .connecting:
                self.onState?("connecting"); self.statusLabel.text = "Připojuji k obrazovce Macu…"; self.statusLabel.isHidden = false
            case .connected:
                self.onState?("connected"); self.statusLabel.isHidden = true
            case .disconnecting:
                self.statusLabel.text = "Odpojuji…"; self.statusLabel.isHidden = false
            case .disconnected:
                if self.authRejected { self.onAuthFailed?(); self.dismiss(animated: true) }
                else { self.onState?("disconnected"); self.statusLabel.text = "Odpojeno – zkontrolujte Sdílení obrazovky na Macu"; self.statusLabel.isHidden = false }
            }
        }
    }

    func connection(_ connection: VNCConnection, credentialFor authenticationType: VNCAuthenticationType,
                    completion: @escaping ((any VNCCredential)?) -> Void) {
        if authenticationType.requiresUsername {
            completion(VNCUsernamePasswordCredential(username: username, password: password))
        } else {
            completion(VNCPasswordCredential(password: password))
        }
    }

    func connection(_ connection: VNCConnection, didCreateFramebuffer framebuffer: VNCFramebuffer) { render(framebuffer) }
    func connection(_ connection: VNCConnection, didResizeFramebuffer framebuffer: VNCFramebuffer) { render(framebuffer) }
    func connection(_ connection: VNCConnection, didUpdateFramebuffer framebuffer: VNCFramebuffer,
                    x: UInt16, y: UInt16, width: UInt16, height: UInt16) { render(framebuffer) }
    func connection(_ connection: VNCConnection, didUpdateCursor cursor: VNCCursor) { }

    // Some RoyalVNC versions surface auth failure via a dedicated delegate hook;
    // if present, set authRejected there. Otherwise the disconnected state with
    // an auth error is the signal (see stateDidChange). VERIFY the exact hook.
}

extension VncViewController: UITextFieldDelegate {
    // Route soft-keyboard characters into RFB when there are no hardware presses.
    func textField(_ textField: UITextField, shouldChangeCharactersIn range: NSRange, replacementString string: String) -> Bool {
        guard let conn = connection else { return false }
        if string.isEmpty {
            // Backspace
            if let bs = VncKeyMap.backspace { conn.keyDown(bs); conn.keyUp(bs) }
        } else {
            for scalar in string.unicodeScalars {
                if let keysym = VncKeyMap.keysym(forScalar: scalar) { conn.keyDown(keysym); conn.keyUp(keysym) }
            }
        }
        return false // never mutate the hidden field's text
    }
}

/// UILabel with content insets, for the status pill.
final class PaddedLabel: UILabel {
    override func drawText(in rect: CGRect) { super.drawText(in: rect.insetBy(dx: 16, dy: 0)) }
    override var intrinsicContentSize: CGSize {
        let s = super.intrinsicContentSize; return CGSize(width: s.width + 32, height: s.height)
    }
}
```

Also create the keysym map helper in the **same file** (or a small `VncKeyMap.swift` — keep it beside the VC). Provide a minimal, correct X11-keysym map. **Confirm `keyDown/keyUp` accept the keysym type RoyalVNC expects** (the spike used `VNCKeyCode`); if `VNCKeyCode` wraps a `UInt32` keysym, construct it accordingly.

```swift
// VncKeyMap: iOS UIKey / unicode → X11 keysym (RoyalVNC keyDown/Up input).
enum VncKeyMap {
    static let backspace: VNCKeyCode? = VNCKeyCode(0xFF08)

    static func keysym(for key: UIKey) -> VNCKeyCode? {
        switch key.keyCode {
        case .keyboardReturnOrEnter: return VNCKeyCode(0xFF0D)
        case .keyboardDeleteOrBackspace: return VNCKeyCode(0xFF08)
        case .keyboardTab: return VNCKeyCode(0xFF09)
        case .keyboardEscape: return VNCKeyCode(0xFF1B)
        case .keyboardLeftArrow: return VNCKeyCode(0xFF51)
        case .keyboardUpArrow: return VNCKeyCode(0xFF52)
        case .keyboardRightArrow: return VNCKeyCode(0xFF53)
        case .keyboardDownArrow: return VNCKeyCode(0xFF54)
        default:
            if let scalar = key.characters.unicodeScalars.first, !key.characters.isEmpty {
                return keysym(forScalar: scalar)
            }
            return nil
        }
    }

    // Latin-1 / ASCII printable → keysym is the code point itself.
    static func keysym(forScalar scalar: Unicode.Scalar) -> VNCKeyCode? {
        let v = scalar.value
        guard v >= 0x20 && v <= 0xFF else { return nil }
        return VNCKeyCode(v)
    }
}
```

> **VERIFY note for the implementer:** `VNCKeyCode(_ :)` construction, `keyDown/keyUp` argument type, `mouseMove`/wheel button cases (`.wheelUp`/`.wheelDown`), and the auth-failure signal are the four points to confirm against the resolved RoyalVNCKit source (Step 1). Everything else is spike-confirmed. Adjust the `// VERIFY` lines to the real API; do not invent names that don't compile.

- [ ] **Step 3: Write `RemoteVncPlugin.swift`**

```swift
import Foundation
import Capacitor

@objc(RemoteVncPlugin)
public class RemoteVncPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RemoteVncPlugin"
    public let jsName = "RemoteVnc"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "present", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnect", returnType: CAPPluginReturnPromise),
    ]

    private var vc: VncViewController?

    @objc func present(_ call: CAPPluginCall) {
        guard let host = call.getString("host"), !host.isEmpty else {
            call.reject("host is required"); return
        }
        let username = call.getString("username") ?? ""
        let password = call.getString("password") ?? ""
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let vc = VncViewController()
            vc.host = host; vc.username = username; vc.password = password
            vc.modalPresentationStyle = .fullScreen
            vc.onState = { [weak self] status in self?.notifyListeners("state", data: ["status": status]) }
            vc.onAuthFailed = { [weak self] in self?.notifyListeners("authFailed", data: [:]) }
            vc.onClosed = { [weak self] in
                self?.notifyListeners("closed", data: [:]); self?.vc = nil
            }
            self.vc = vc
            self.bridge?.viewController?.present(vc, animated: true) { call.resolve() }
        }
    }

    @objc func disconnect(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.vc?.dismiss(animated: true)
            self?.vc = nil
            call.resolve()
        }
    }
}
```

- [ ] **Step 4: Register the plugin in `MainViewController.swift`**

Add the registration beside `WakePlugin`:
```swift
override open func capacitorDidLoad() {
    bridge?.registerPluginInstance(WakePlugin())
    bridge?.registerPluginInstance(RemoteVncPlugin())
}
```

- [ ] **Step 5: Commit** (compiles at Task 6; commit sources now for review granularity)

```bash
git add apps/ipad/ios/App/App/VncViewController.swift apps/ipad/ios/App/App/RemoteVncPlugin.swift apps/ipad/ios/App/App/MainViewController.swift
git commit -m "feat: #86 native VncViewController + RemoteVnc Capacitor plugin"
```

---

### Task 6: Native — wire RoyalVNCKit SPM into the Xcode project + build

**Files:**
- Modify: `apps/ipad/ios/App/App.xcodeproj/project.pbxproj`
- Create/Modify: `apps/ipad/ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved` (generated by resolve; commit it)

**Interfaces:**
- Adds the `RoyalVNCKit` SPM product to the App target: `XCRemoteSwiftPackageReference "royalvnc"`, `XCSwiftPackageProductDependency RoyalVNCKit`, product in `packageReferences` + `packageProductDependencies` + the Frameworks (link) phase + a dedicated **Embed Frameworks** copy phase (`dstSubfolderSpec = 10`, `CodeSignOnCopy`). Adds `VncViewController.swift` + `RemoteVncPlugin.swift` to the Sources phase.

- [ ] **Step 1: Add the SPM package + build-file/phase entries to `project.pbxproj`**

Apply exactly these additions (ported from `spike/86-royalvnc`, minus the SpikeVNCViewController lines, plus our two Swift files). Use unique IDs in the `AA105000000000000010x` family.

In `PBXBuildFile` section:
```
		AA10500000000000000109B1 /* VncViewController.swift in Sources */ = {isa = PBXBuildFile; fileRef = AA10500000000000000109A1 /* VncViewController.swift */; };
		AA1050000000000000010AB1 /* RemoteVncPlugin.swift in Sources */ = {isa = PBXBuildFile; fileRef = AA1050000000000000010AA1 /* RemoteVncPlugin.swift */; };
		AA10500000000000000107B1 /* RoyalVNCKit in Frameworks */ = {isa = PBXBuildFile; productRef = AA10500000000000000107C1 /* RoyalVNCKit */; };
		AA10500000000000000107E1 /* RoyalVNCKit in Embed Frameworks */ = {isa = PBXBuildFile; productRef = AA10500000000000000107C1 /* RoyalVNCKit */; settings = {ATTRIBUTES = (CodeSignOnCopy, ); }; };
```

In `PBXFileReference` section:
```
		AA10500000000000000109A1 /* VncViewController.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = VncViewController.swift; sourceTree = "<group>"; };
		AA1050000000000000010AA1 /* RemoteVncPlugin.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = RemoteVncPlugin.swift; sourceTree = "<group>"; };
```

Add a `PBXCopyFilesBuildPhase` section (Embed Frameworks):
```
/* Begin PBXCopyFilesBuildPhase section */
		AA10500000000000000107F1 /* Embed Frameworks */ = {
			isa = PBXCopyFilesBuildPhase;
			buildActionMask = 2147483647;
			dstPath = "";
			dstSubfolderSpec = 10;
			files = (
				AA10500000000000000107E1 /* RoyalVNCKit in Embed Frameworks */,
			);
			name = "Embed Frameworks";
			runOnlyForDeploymentPostprocessing = 0;
		};
/* End PBXCopyFilesBuildPhase section */
```

In the `PBXFrameworksBuildPhase` `files` list, add:
```
				AA10500000000000000107B1 /* RoyalVNCKit in Frameworks */,
```

In the App group `children` (beside the other Swift files), add:
```
				AA10500000000000000109A1 /* VncViewController.swift */,
				AA1050000000000000010AA1 /* RemoteVncPlugin.swift */,
```

In the App `PBXNativeTarget`: add the Embed Frameworks phase to `buildPhases` (after the `[CP] Embed Pods Frameworks` phase) and add a `packageProductDependencies`:
```
				AA10500000000000000107F1 /* Embed Frameworks */,
```
```
			packageProductDependencies = (
				AA10500000000000000107C1 /* RoyalVNCKit */,
			);
```

In the `PBXProject` node, add `packageReferences`:
```
			packageReferences = (
				AA10500000000000000107D1 /* XCRemoteSwiftPackageReference "royalvnc" */,
			);
```

Add the two new sections:
```
/* Begin XCRemoteSwiftPackageReference section */
		AA10500000000000000107D1 /* XCRemoteSwiftPackageReference "royalvnc" */ = {
			isa = XCRemoteSwiftPackageReference;
			repositoryURL = "https://github.com/royalapplications/royalvnc";
			requirement = {
				branch = main;
				kind = branch;
			};
		};
/* End XCRemoteSwiftPackageReference section */

/* Begin XCSwiftPackageProductDependency section */
		AA10500000000000000107C1 /* RoyalVNCKit */ = {
			isa = XCSwiftPackageProductDependency;
			package = AA10500000000000000107D1 /* XCRemoteSwiftPackageReference "royalvnc" */;
			productName = RoyalVNCKit;
		};
/* End XCSwiftPackageProductDependency section */
```

Finally, in the App `PBXSourcesBuildPhase` `files` list, add:
```
				AA10500000000000000109B1 /* VncViewController.swift in Sources */,
				AA1050000000000000010AB1 /* RemoteVncPlugin.swift in Sources */,
```

- [ ] **Step 2: Resolve SPM + confirm the input API (feeds Task 5 Step 1)**

Run:
```bash
cd apps/ipad/ios/App
xcodebuild -resolvePackageDependencies -project App.xcodeproj -scheme App
```
Expected: resolves `royalvnc`, writes `Package.resolved`. Then run the grep from Task 5 Step 1 against the resolved checkout and reconcile any `// VERIFY` lines in `VncViewController.swift`.

- [ ] **Step 3: Build (compile) the app for a device destination**

```bash
cd apps/ipad/ios/App
xcodebuild -project App.xcodeproj -scheme App \
  -destination 'generic/platform=iOS' -configuration Debug \
  CODE_SIGNING_ALLOWED=NO build 2>&1 | tail -40
```
Expected: `BUILD SUCCEEDED`. Fix any compile errors in `VncViewController.swift` / `RemoteVncPlugin.swift` (most likely the `// VERIFY` API points).

- [ ] **Step 4: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add apps/ipad/ios/App/App.xcodeproj/project.pbxproj \
  apps/ipad/ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved
git commit -m "build: #86 wire RoyalVNCKit SPM + embed phase into App target"
```

---

### Task 7: Docs — Screen Sharing runbook + spec reconciliation

**Files:**
- Modify: `docs/runbooks/macos-screen-sharing.md`
- Modify: `docs/superpowers/specs/2026-06-25-remote-mac-vnc-design.md` (append an §8 addendum noting #86 shipped the native upgrade)

- [ ] **Step 1: Update the runbook**

Replace the noVNC-relay reachability guidance with the direct-TCP model. Add a section:
```markdown
## Native RoyalVNC client (#86)

The iPad app now renders Screen Sharing with a native RoyalVNC client that
connects **directly over TCP to the Mac at `<connection host>:5900`** (no
orchestrator relay). Requirements:

1. System Settings → General → Sharing → **Screen Sharing → ON**.
2. Screen Sharing → (i) → allow access for your macOS user; the iPad logs in
   with your **macOS account short name + login password** (Apple RFB type-30).
   The legacy "VNC viewers may control screen with password" (≤8-char) path is
   NOT used.
3. Port **5900** must be reachable from the iPad — over the LAN, or over
   Tailscale (the Mac's `100.x` address). Access is gated by tailnet membership
   + the macOS password; there is no separate VNC token.
4. In the app: Rail → "Vzdálený Mac" (or the auth-block "Otevřít obrazovku
   Macu" handoff) → enter the macOS short name + password once (stored on
   device). The native full-screen VNC view opens; "‹ Zpět" returns to the app.
```

- [ ] **Step 2: Append the spec addendum**

In `docs/superpowers/specs/2026-06-25-remote-mac-vnc-design.md` §8, add:
```markdown
> **Update 2026-07-07 (#86):** the "Native RoyalVNC plugin" upgrade path shipped.
> The renderer is now native (direct TCP to host:5900, Apple type-30); noVNC and
> the `/vnc` WS relay were removed. See
> `docs/superpowers/specs/2026-07-07-native-royalvnc-remote-mac-design.md`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/runbooks/macos-screen-sharing.md docs/superpowers/specs/2026-06-25-remote-mac-vnc-design.md
git commit -m "docs: #86 native VNC runbook + spec addendum"
```

---

### Task 8: Final verification + on-device smoke

**Files:** none (verification only).

- [ ] **Step 1: Full typecheck + suite**

Run: `npm run typecheck:ci && npm test`
Expected: typecheck PASS across all workspaces; full vitest suite green.

- [ ] **Step 2: iPad device build + deploy**

Ensure the git-ignored iPad `.env` is present in the worktree (copy from the primary checkout if missing), then build the web bundle, sync Capacitor, and install to the connected iPad Pro per `ipad-iphone-on-device-cli-deploy`:
```bash
npm run build -w @watchtower/ipad
npx --workspace @watchtower/ipad cap sync ios
# then xcodebuild -project apps/ipad/ios/App/App.xcodeproj -scheme App \
#   -destination 'id=<device-udid>' -configuration Debug build
# devicectl device install app --device <udid> <App.app>
# devicectl device process launch --device <udid> cz.watchtower.ipad
```

- [ ] **Step 3: On-device smoke against the AC**

With the desktop running `npm run dev:ipad` (WS host bound to LAN/Tailscale) and macOS Screen Sharing on:
1. Rail → "Vzdálený Mac" → enter macOS short name + password → native screen renders.
2. Verify **smooth** pointer (tap = click, drag = move/select), two-finger scroll, long-press = right-click, and typing (hardware keyboard + ⌨ soft keyboard).
3. Trigger an auth block in a managed instance (`saml2aws login`) → amber banner in Instances → "Otevřít obrazovku Macu" → native VNC opens.
4. Wrong password → `authFailed` → login form re-opens.
5. "‹ Zpět" → returns to the app.

- [ ] **Step 4: Push the branch + open the PR**

```bash
git push -u origin HEAD
gh pr create --title "feat: #86 native RoyalVNC client for smooth Remote Mac" --body "<summary + AC checklist + on-device evidence>"
```

---

## Self-Review

**Spec coverage:**
- Transport: direct TCP host:5900, type-30 → Task 5 (VC connect), Task 6 (SPM). ✓
- Native full-screen VC, no modifier bar → Task 5. ✓
- Plugin boundary (present/disconnect + state/authFailed/closed) → Tasks 1, 5. ✓
- React keeps login form + handoff; drives plugin → Task 2. ✓
- iOS-only, remove noVNC → Tasks 2, 3. ✓
- Remove dead `/vnc` relay; keep auth-block detector → Task 4. ✓
- SPM + Embed Frameworks dyld guard → Task 6. ✓
- Runbook + spec reconciliation → Task 7. ✓
- Full verification + on-device smoke → Task 8. ✓

**Placeholder scan:** No TBD/TODO. The four external-API unknowns are gated by an explicit verification step (Task 5 Step 1 / Task 6 Step 2) with best-effort signatures and a "make it compile, don't invent names" instruction — not hand-waves. ✓

**Type consistency:** `present({host,username,password})`, event names `state`/`authFailed`/`closed`, and `VncState` (`connecting|connected|disconnected`) are identical across Tasks 1, 2, 5. pbxproj IDs (`…107C1`/`…107D1`/`…107B1`/`…107E1`/`…107F1`, `…109x`, `…10Ax`) are internally consistent in Task 6. ✓

**Note on UI/native tasks (2, 5, 6, 8):** vitest is `environment: node` (no jsdom), so React components and Swift are validated by typecheck + build + the on-device smoke (Task 8), with all extractable TS logic unit-tested (Task 1 wrapper). Matches the #75 plan's precedent.
