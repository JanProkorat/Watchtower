# Wake-on-LAN (#72) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app "Probudit Mac" button that wakes a sleeping, Ethernet-connected Mac by firing a Wake-on-LAN magic packet (unicast) at the configured home (LAN IP) and away (DDNS) targets.

**Architecture:** The 102-byte magic packet is built in pure TypeScript and passed (base64) across the Capacitor bridge to a small custom Swift plugin that does a one-shot UDP send via `NWConnection`. Unicast only — no broadcast, so no Apple multicast entitlement. Wake config (MAC, LAN IP, DDNS host/port) extends the existing `Connection`; the button reuses a single `WakeButton` component on the connection form and the reconnect banner.

**Tech Stack:** Capacitor 6, plain React + inline styles (no MUI), TypeScript, Swift (`Network` framework), vitest (`environment: node`).

## Global Constraints

- iPad app is **plain React + inline styles — NO MUI** (`apps/ipad`).
- UI copy is **Czech**; **do not add i18n**.
- **Unicast only.** Never send to a broadcast address; the Swift uses `NWConnection` UDP with no `SO_BROADCAST`. No `com.apple.developer.networking.multicast` entitlement.
- The magic packet is **built in TypeScript** and crosses the bridge as **base64**; Swift only decodes + sends.
- Native plugin JS name is **`Wake`**, method **`wake({ payloadBase64, host, port })`**, returns a Promise; web implementation is a **no-op stub** so the browser/desktop build compiles.
- **Fire at every configured target** each tap; result is success if **≥1** send resolves.
- WoL port is **9** for the LAN target and `wanPort` (default **9**) for the DDNS target.
- vitest runs in **`environment: node`** — only pure logic is unit-tested; React/native pieces are validated by typecheck + build (+ device smoke).
- **Do not commit `dist/`** or `ios/App/App/public/` build output.
- Worktree: `.claude/worktrees/wake-72` (branch `feat/72-wake`). It needs its own `node_modules` — run `npm install` in the worktree before Task 1 if `node_modules` is absent.

---

## File Structure

- `apps/ipad/src/lib/wakeOnLan.ts` — **new.** Pure: `parseMac`, `buildMagicPacket`, `magicPacketBase64`.
- `apps/ipad/src/lib/wakePlugin.ts` — **new.** `registerPlugin<WakePlugin>('Wake', …)` + web no-op stub.
- `apps/ipad/src/state/wake.ts` — **new.** Pure orchestration: `WakeTarget`, `WakeDeps`, `wakeTargets`, `performWake`.
- `apps/ipad/src/state/useWake.ts` — **new.** Thin hook binding `performWake` to the `Wake` plugin.
- `apps/ipad/src/connection.ts` — **modify.** Add wake fields to `Connection` + `parseConnection`.
- `apps/ipad/src/components/WakeButton.tsx` — **new.** Reusable button (uses `useWake`, shows status).
- `apps/ipad/src/App.tsx` — **modify.** Probuzení fields in `ConnectionForm`; `WakeButton` on the form and the reconnect banner.
- `apps/ipad/ios/App/App/WakePlugin.swift` — **new.** Custom Capacitor plugin (UDP send).
- `apps/ipad/ios/App/App/Info.plist` — **modify.** Add `NSLocalNetworkUsageDescription`.
- `docs/runbooks/wake-on-lan.md` — **new.** Router + macOS setup.
- Tests: `tests/ipad/wakeOnLan.test.ts`, `tests/ipad/wake.test.ts`, and additions to `tests/ipad/connection.test.ts`.

---

## Task 1: WoL packet library (`wakeOnLan.ts`)

**Files:**
- Create: `apps/ipad/src/lib/wakeOnLan.ts`
- Test: `tests/ipad/wakeOnLan.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface ParsedMac { bytes: number[] }`
  - `parseMac(input: string): ParsedMac | null`
  - `buildMagicPacket(mac: ParsedMac): Uint8Array`
  - `magicPacketBase64(mac: ParsedMac): string`

- [ ] **Step 1: Write the failing test**

Create `tests/ipad/wakeOnLan.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseMac, buildMagicPacket, magicPacketBase64 } from '../../apps/ipad/src/lib/wakeOnLan.js';

describe('parseMac', () => {
  it('parses colon-separated, case-insensitive', () => {
    expect(parseMac('AA:bb:CC:dd:EE:ff')?.bytes).toEqual([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
  });
  it('parses hyphen-separated', () => {
    expect(parseMac('00-11-22-33-44-55')?.bytes).toEqual([0, 0x11, 0x22, 0x33, 0x44, 0x55]);
  });
  it('trims surrounding whitespace', () => {
    expect(parseMac('  aa:bb:cc:dd:ee:ff  ')?.bytes).toEqual([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
  });
  it('rejects wrong octet count', () => {
    expect(parseMac('aa:bb:cc:dd:ee')).toBeNull();
    expect(parseMac('aa:bb:cc:dd:ee:ff:00')).toBeNull();
  });
  it('rejects non-hex and malformed octets', () => {
    expect(parseMac('zz:bb:cc:dd:ee:ff')).toBeNull();
    expect(parseMac('a:bb:cc:dd:ee:ff')).toBeNull();   // single digit
    expect(parseMac('')).toBeNull();
  });
});

describe('buildMagicPacket', () => {
  it('is 102 bytes: 6x 0xFF then the MAC 16x', () => {
    const mac = parseMac('01:02:03:04:05:06')!;
    const pkt = buildMagicPacket(mac);
    expect(pkt.length).toBe(102);
    expect([...pkt.slice(0, 6)]).toEqual([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    expect([...pkt.slice(6, 12)]).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...pkt.slice(96, 102)]).toEqual([1, 2, 3, 4, 5, 6]); // 16th repeat
  });
});

describe('magicPacketBase64', () => {
  it('round-trips back to the 102-byte packet', () => {
    const mac = parseMac('01:02:03:04:05:06')!;
    const b64 = magicPacketBase64(mac);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect([...bytes]).toEqual([...buildMagicPacket(mac)]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jan/Projects/Watchtower/.claude/worktrees/wake-72 && npx vitest run tests/ipad/wakeOnLan.test.ts`
Expected: FAIL — cannot resolve `../../apps/ipad/src/lib/wakeOnLan.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/ipad/src/lib/wakeOnLan.ts`:

```ts
// Wake-on-LAN magic-packet construction. Pure (no I/O) so it is unit-testable;
// the bytes are handed to the native Wake plugin as base64.

export interface ParsedMac {
  bytes: number[]; // exactly 6 octets, 0–255
}

/** Parse "AA:BB:CC:DD:EE:FF" or "AA-BB-CC-DD-EE-FF" (case-insensitive). */
export function parseMac(input: string): ParsedMac | null {
  const parts = input.trim().split(/[:-]/);
  if (parts.length !== 6) return null;
  const bytes: number[] = [];
  for (const p of parts) {
    if (!/^[0-9a-fA-F]{2}$/.test(p)) return null;
    bytes.push(parseInt(p, 16));
  }
  return { bytes };
}

/** 102-byte magic packet: 6x 0xFF, then the 6-byte MAC repeated 16 times. */
export function buildMagicPacket(mac: ParsedMac): Uint8Array {
  const pkt = new Uint8Array(102);
  pkt.fill(0xff, 0, 6);
  for (let i = 0; i < 16; i++) pkt.set(mac.bytes, 6 + i * 6);
  return pkt;
}

/** Base64 of the magic packet, for the Capacitor bridge (binary can't cross). */
export function magicPacketBase64(mac: ParsedMac): string {
  const pkt = buildMagicPacket(mac);
  let bin = '';
  for (const b of pkt) bin += String.fromCharCode(b);
  return btoa(bin);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jan/Projects/Watchtower/.claude/worktrees/wake-72 && npx vitest run tests/ipad/wakeOnLan.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/ipad/src/lib/wakeOnLan.ts tests/ipad/wakeOnLan.test.ts
git commit -m "feat: #72 wakeOnLan magic-packet lib (parse MAC, build 102-byte packet)"
```

---

## Task 2: Connection wake config (`connection.ts`)

**Files:**
- Modify: `apps/ipad/src/connection.ts`
- Test: `tests/ipad/connection.test.ts` (add cases)

**Interfaces:**
- Consumes: `parseMac` from `apps/ipad/src/lib/wakeOnLan.js` (Task 1).
- Produces:
  - `Connection` now also has optional `mac?: string; lanIp?: string; wanHost?: string; wanPort?: number`.
  - `parseConnection` input type adds optional `mac?: string; lanIp?: string; wanHost?: string; wanPort?: string`.

- [ ] **Step 1: Write the failing test**

Add to `tests/ipad/connection.test.ts` (inside the file, after the existing `parseConnection` describe block):

```ts
describe('parseConnection wake fields', () => {
  const base = { host: 'x', port: '7445', token: 't' };

  it('keeps wake fields absent when not provided', () => {
    const r = parseConnection(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.mac).toBeUndefined();
  });

  it('accepts a valid MAC and trims LAN/DDNS hosts', () => {
    const r = parseConnection({ ...base, mac: 'AA:BB:CC:DD:EE:FF', lanIp: ' 192.168.1.50 ', wanHost: ' home.ddns ' });
    expect(r).toEqual({ ok: true, value: {
      host: 'x', port: 7445, token: 't',
      mac: 'AA:BB:CC:DD:EE:FF', lanIp: '192.168.1.50', wanHost: 'home.ddns', wanPort: 9,
    } });
  });

  it('rejects an invalid MAC', () => {
    expect(parseConnection({ ...base, mac: 'nope' }).ok).toBe(false);
  });

  it('defaults wanPort to 9 and validates a provided one', () => {
    expect(parseConnection({ ...base, wanHost: 'h', wanPort: '' }).ok).toBe(true);
    const r = parseConnection({ ...base, wanHost: 'h', wanPort: '9999' });
    expect(r.ok && r.value.wanPort).toBe(9999);
    expect(parseConnection({ ...base, wanHost: 'h', wanPort: '70000' }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jan/Projects/Watchtower/.claude/worktrees/wake-72 && npx vitest run tests/ipad/connection.test.ts`
Expected: FAIL — wake fields not parsed (value lacks `mac`/`wanPort`).

- [ ] **Step 3: Write the implementation**

Replace the top of `apps/ipad/src/connection.ts` (the `Connection` type and `parseConnection`) with:

```ts
import { parseMac } from './lib/wakeOnLan.js';

export type Connection = {
  host: string; port: number; token: string;
  mac?: string;        // Mac's Ethernet MAC, for Wake-on-LAN
  lanIp?: string;      // home wake target (the Mac's LAN IP)
  wanHost?: string;    // away wake target (DDNS hostname / public IP)
  wanPort?: number;    // away wake target port (default 9)
};
export type ConnStore = { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void> };

const KEY = 'watchtower.connection';

export function parseConnection(input: {
  host: string; port: string; token: string;
  mac?: string; lanIp?: string; wanHost?: string; wanPort?: string;
}):
  | { ok: true; value: Connection }
  | { ok: false; error: string } {
  const host = input.host.trim();
  if (!host) return { ok: false, error: 'Host is required' };
  const port = Number(input.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: 'Port must be 1–65535' };
  const token = input.token.trim();
  if (!token) return { ok: false, error: 'Token is required' };

  const value: Connection = { host, port, token };

  const mac = input.mac?.trim();
  if (mac) {
    if (!parseMac(mac)) return { ok: false, error: 'MAC adresa je neplatná' };
    value.mac = mac;
  }
  const lanIp = input.lanIp?.trim();
  if (lanIp) value.lanIp = lanIp;
  const wanHost = input.wanHost?.trim();
  if (wanHost) {
    value.wanHost = wanHost;
    const rawPort = input.wanPort?.trim();
    if (rawPort) {
      const wp = Number(rawPort);
      if (!Number.isInteger(wp) || wp < 1 || wp > 65535) return { ok: false, error: 'Wake port must be 1–65535' };
      value.wanPort = wp;
    } else {
      value.wanPort = 9;
    }
  }
  return { ok: true, value };
}
```

Leave `connectionToWsUrl`, `connectionToVncWsUrl`, `saveConnection`, `loadConnection` unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jan/Projects/Watchtower/.claude/worktrees/wake-72 && npx vitest run tests/ipad/connection.test.ts`
Expected: PASS (existing + new cases).

- [ ] **Step 5: Commit**

```bash
git add apps/ipad/src/connection.ts tests/ipad/connection.test.ts
git commit -m "feat: #72 connection wake config (mac, lanIp, wanHost, wanPort)"
```

---

## Task 3: Wake plugin wrapper + orchestration + hook

**Files:**
- Create: `apps/ipad/src/lib/wakePlugin.ts`
- Create: `apps/ipad/src/state/wake.ts`
- Create: `apps/ipad/src/state/useWake.ts`
- Test: `tests/ipad/wake.test.ts`

**Interfaces:**
- Consumes: `magicPacketBase64`, `parseMac` from `lib/wakeOnLan.js` (Task 1); `Connection` from `connection.js` (Task 2).
- Produces:
  - `wakePlugin.ts`: `interface WakePlugin { wake(o: { payloadBase64: string; host: string; port: number }): Promise<void> }`, `const Wake: WakePlugin`.
  - `wake.ts`: `interface WakeTarget { host: string; port: number }`; `interface WakeDeps { send(payloadBase64: string, host: string, port: number): Promise<void> }`; `type WakeResult = { ok: true; sent: number } | { ok: false; error: string }`; `wakeTargets(cfg): WakeTarget[]`; `performWake(deps, req): Promise<WakeResult>`.
  - `useWake.ts`: `type WakeStatus = 'idle' | 'sending' | 'sent' | 'error'`; `useWake(): { status: WakeStatus; wake(cfg: Connection): Promise<void> }`.

- [ ] **Step 1: Write the failing test**

Create `tests/ipad/wake.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { wakeTargets, performWake, type WakeDeps } from '../../apps/ipad/src/state/wake.js';

describe('wakeTargets', () => {
  it('builds a LAN target at port 9 and a DDNS target at wanPort', () => {
    expect(wakeTargets({ lanIp: '192.168.1.50', wanHost: 'home.ddns', wanPort: 9999 }))
      .toEqual([{ host: '192.168.1.50', port: 9 }, { host: 'home.ddns', port: 9999 }]);
  });
  it('omits absent targets and defaults DDNS port to 9', () => {
    expect(wakeTargets({ wanHost: 'home.ddns' })).toEqual([{ host: 'home.ddns', port: 9 }]);
    expect(wakeTargets({ lanIp: '10.0.0.2' })).toEqual([{ host: '10.0.0.2', port: 9 }]);
    expect(wakeTargets({})).toEqual([]);
  });
});

describe('performWake', () => {
  const okDeps = (): WakeDeps => ({ send: vi.fn().mockResolvedValue(undefined) });

  it('rejects an invalid MAC', async () => {
    const r = await performWake(okDeps(), { mac: 'bad', targets: [{ host: 'h', port: 9 }] });
    expect(r).toEqual({ ok: false, error: 'MAC adresa je neplatná' });
  });

  it('errors when there are no targets', async () => {
    const r = await performWake(okDeps(), { mac: 'aa:bb:cc:dd:ee:ff', targets: [] });
    expect(r.ok).toBe(false);
  });

  it('sends to every target and reports the count', async () => {
    const deps = okDeps();
    const r = await performWake(deps, { mac: 'aa:bb:cc:dd:ee:ff', targets: [{ host: 'a', port: 9 }, { host: 'b', port: 7 }] });
    expect(r).toEqual({ ok: true, sent: 2 });
    expect(deps.send).toHaveBeenCalledTimes(2);
  });

  it('succeeds if at least one target send resolves', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('no route'))
      .mockResolvedValueOnce(undefined);
    const r = await performWake({ send }, { mac: 'aa:bb:cc:dd:ee:ff', targets: [{ host: 'a', port: 9 }, { host: 'b', port: 9 }] });
    expect(r).toEqual({ ok: true, sent: 1 });
  });

  it('errors only when all sends fail', async () => {
    const send = vi.fn().mockRejectedValue(new Error('fail'));
    const r = await performWake({ send }, { mac: 'aa:bb:cc:dd:ee:ff', targets: [{ host: 'a', port: 9 }] });
    expect(r).toEqual({ ok: false, error: 'Nepodařilo se odeslat paket' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jan/Projects/Watchtower/.claude/worktrees/wake-72 && npx vitest run tests/ipad/wake.test.ts`
Expected: FAIL — cannot resolve `state/wake.js`.

- [ ] **Step 3: Write the plugin wrapper**

Create `apps/ipad/src/lib/wakePlugin.ts`:

```ts
import { registerPlugin } from '@capacitor/core';

export interface WakePlugin {
  /** Fire one UDP datagram (the base64 magic packet) to host:port. */
  wake(options: { payloadBase64: string; host: string; port: number }): Promise<void>;
}

// Native impl is WakePlugin.swift (jsName 'Wake'). On web there is no UDP, so
// the stub is a no-op — keeps the browser/desktop build compiling.
export const Wake = registerPlugin<WakePlugin>('Wake', {
  web: () => ({ async wake() { /* no-op on web */ } }),
});
```

- [ ] **Step 4: Write the orchestration**

Create `apps/ipad/src/state/wake.ts`:

```ts
import { parseMac, magicPacketBase64 } from '../lib/wakeOnLan.js';

export interface WakeTarget { host: string; port: number }

export interface WakeDeps {
  send(payloadBase64: string, host: string, port: number): Promise<void>;
}

export interface WakeRequest { mac: string; targets: WakeTarget[] }

export type WakeResult = { ok: true; sent: number } | { ok: false; error: string };

/** LAN target at the fixed WoL port 9; DDNS target at wanPort (default 9). */
export function wakeTargets(cfg: { lanIp?: string; wanHost?: string; wanPort?: number }): WakeTarget[] {
  const targets: WakeTarget[] = [];
  if (cfg.lanIp) targets.push({ host: cfg.lanIp, port: 9 });
  if (cfg.wanHost) targets.push({ host: cfg.wanHost, port: cfg.wanPort ?? 9 });
  return targets;
}

/**
 * Build the packet once, fire it at every target. Per-target failures are
 * swallowed (the off-network target always fails); success = at least one send.
 */
export async function performWake(deps: WakeDeps, req: WakeRequest): Promise<WakeResult> {
  const mac = parseMac(req.mac);
  if (!mac) return { ok: false, error: 'MAC adresa je neplatná' };
  if (req.targets.length === 0) return { ok: false, error: 'Není nastaven žádný cíl' };
  const payload = magicPacketBase64(mac);
  let sent = 0;
  for (const t of req.targets) {
    try { await deps.send(payload, t.host, t.port); sent++; } catch { /* ignore per-target */ }
  }
  return sent > 0 ? { ok: true, sent } : { ok: false, error: 'Nepodařilo se odeslat paket' };
}
```

- [ ] **Step 5: Write the hook**

Create `apps/ipad/src/state/useWake.ts`:

```ts
import { useCallback, useMemo, useState } from 'react';
import { Wake } from '../lib/wakePlugin.js';
import { performWake, wakeTargets, type WakeDeps } from './wake.js';
import type { Connection } from '../connection.js';

export type WakeStatus = 'idle' | 'sending' | 'sent' | 'error';

export function useWake(): { status: WakeStatus; wake(cfg: Connection): Promise<void> } {
  const [status, setStatus] = useState<WakeStatus>('idle');
  const deps = useMemo<WakeDeps>(
    () => ({ send: (payloadBase64, host, port) => Wake.wake({ payloadBase64, host, port }) }),
    [],
  );

  const wake = useCallback(async (cfg: Connection) => {
    if (!cfg.mac) return;
    const targets = wakeTargets(cfg);
    if (targets.length === 0) return;
    setStatus('sending');
    const r = await performWake(deps, { mac: cfg.mac, targets });
    setStatus(r.ok ? 'sent' : 'error');
  }, [deps]);

  return { status, wake };
}
```

- [ ] **Step 6: Run test + typecheck**

Run: `cd /Users/jan/Projects/Watchtower/.claude/worktrees/wake-72 && npx vitest run tests/ipad/wake.test.ts && npx tsc -p apps/ipad/tsconfig.json --noEmit`
Expected: tests PASS; typecheck clean (no errors).

- [ ] **Step 7: Commit**

```bash
git add apps/ipad/src/lib/wakePlugin.ts apps/ipad/src/state/wake.ts apps/ipad/src/state/useWake.ts tests/ipad/wake.test.ts
git commit -m "feat: #72 Wake plugin wrapper + performWake orchestration + useWake hook"
```

---

## Task 4: Native Swift Wake plugin + Info.plist

**Files:**
- Create: `apps/ipad/ios/App/App/WakePlugin.swift`
- Modify: `apps/ipad/ios/App/App/Info.plist`

**Interfaces:**
- Consumes: the bridge call shape from Task 3 — `Wake.wake({ payloadBase64, host, port })`.
- Produces: a native plugin with `jsName` `Wake` and method `wake`. No TS interface.

**Note for the implementer:** Swift is not unit-tested here and the iOS app build/run happens in Xcode on a device (this subagent cannot sign/run it). Your automated check is that `cap sync ios` succeeds; the Swift compile + actual wake are human/device-validated. Write the Swift exactly as below.

**IMPORTANT — Xcode target membership (manual step):** dropping `WakePlugin.swift` on disk does **not** add it to the App target — `cap sync` does not edit `project.pbxproj`, and Xcode does not glob-include source files. So the file will not compile into the app until it is added to the **App** target. Do **not** hand-edit `project.pbxproj` (corruption-prone). Instead, this is a documented human step done during device validation: in Xcode, drag `WakePlugin.swift` into the `App` group (uncheck "Copy items if needed"; check target **App**), or right-click the App group → Add Files. Record this in the task report as a required manual follow-up so it isn't missed.

- [ ] **Step 1: Write the Swift plugin**

Create `apps/ipad/ios/App/App/WakePlugin.swift`:

```swift
import Foundation
import Capacitor
import Network

// Custom Capacitor plugin: fire one UDP datagram (the WoL magic packet) to
// host:port. Unicast only — no broadcast, so no multicast entitlement.
// jsName "Wake" matches registerPlugin<WakePlugin>('Wake') on the JS side.
@objc(WakePlugin)
public class WakePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WakePlugin"
    public let jsName = "Wake"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "wake", returnType: CAPPluginReturnPromise)
    ]

    @objc func wake(_ call: CAPPluginCall) {
        guard let b64 = call.getString("payloadBase64"),
              let hostStr = call.getString("host"),
              let portInt = call.getInt("port"),
              portInt > 0, portInt <= 65535,
              let data = Data(base64Encoded: b64),
              let port = NWEndpoint.Port(rawValue: UInt16(portInt)) else {
            call.reject("Invalid wake arguments")
            return
        }

        let conn = NWConnection(host: NWEndpoint.Host(hostStr), port: port, using: .udp)
        var finished = false
        let finish: (Error?) -> Void = { err in
            if finished { return }
            finished = true
            if let err = err { call.reject("wake send failed: \(err)") } else { call.resolve() }
            conn.cancel()
        }

        conn.stateUpdateHandler = { state in
            switch state {
            case .ready:
                conn.send(content: data, completion: .contentProcessed { err in finish(err) })
            case .failed(let err):
                finish(err)
            case .cancelled:
                break
            default:
                break
            }
        }
        conn.start(queue: .global(qos: .userInitiated))
    }
}
```

- [ ] **Step 2: Add the Local Network usage string to Info.plist**

In `apps/ipad/ios/App/App/Info.plist`, add this key/value inside the top-level `<dict>` (alongside the other keys):

```xml
	<key>NSLocalNetworkUsageDescription</key>
	<string>Watchtower posílá paket pro probuzení Macu v místní síti.</string>
```

- [ ] **Step 3: Sync the iOS project**

Run: `cd /Users/jan/Projects/Watchtower/.claude/worktrees/wake-72/apps/ipad && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npm run cap:sync`
Expected: `Sync finished` with no error (copies web assets, runs `pod install`). Note: `cap sync` does **not** add `WakePlugin.swift` to the Xcode target — that is the manual Xcode step flagged in the task note above. Once the file is in the App target, registration is automatic via `CAPBridgedPlugin` (no AppDelegate edit needed).

- [ ] **Step 4: Confirm the web build is unaffected**

Run: `cd /Users/jan/Projects/Watchtower/.claude/worktrees/wake-72/apps/ipad && npm run build`
Expected: `built in …` (the TS/web build does not depend on the Swift; the `Wake` plugin resolves to the web no-op stub in the browser).

- [ ] **Step 5: Commit**

```bash
git add apps/ipad/ios/App/App/WakePlugin.swift apps/ipad/ios/App/App/Info.plist
git commit -m "feat: #72 native Wake plugin (NWConnection UDP) + Local Network usage string"
```

(Do **not** `git add` `apps/ipad/ios/App/App/public/` or other `cap sync` build output.)

---

## Task 5: Wake button + connection-form fields + reconnect-banner button

**Files:**
- Create: `apps/ipad/src/components/WakeButton.tsx`
- Modify: `apps/ipad/src/App.tsx`

**Interfaces:**
- Consumes: `useWake` (Task 3); `Connection`, `parseConnection` (Task 2).
- Produces: `WakeButton` component — `function WakeButton({ connection }: { connection: Connection }): JSX.Element`.

**Note:** This is logic-light React (no MUI, inline styles). It is validated by typecheck + build; no unit test.

- [ ] **Step 1: Write the WakeButton component**

Create `apps/ipad/src/components/WakeButton.tsx`:

```tsx
import { useWake } from '../state/useWake.js';
import type { Connection } from '../connection.js';

// "Probudit Mac" button. Disabled until a MAC is configured. Fire-and-forget:
// after a tap it shows a transient "Paket odeslán" — it cannot confirm the Mac
// actually woke (UDP has no ack); the normal reconnect loop takes over.
export function WakeButton({ connection }: { connection: Connection }) {
  const { status, wake } = useWake();
  const disabled = !connection.mac || status === 'sending';

  const label =
    status === 'sending' ? 'Odesílám…'
    : status === 'sent' ? 'Paket odeslán'
    : status === 'error' ? 'Chyba odeslání'
    : '⏻ Probudit Mac';

  return (
    <button
      onClick={() => { void wake(connection); }}
      disabled={disabled}
      title={connection.mac ? 'Probudit Mac' : 'Nejprve nastavte MAC adresu'}
      style={{
        padding: '10px 14px',
        borderRadius: 8,
        border: '1px solid #2e3038',
        backgroundColor: disabled ? '#1a1b1f' : '#23304a',
        color: disabled ? '#6b7280' : '#93c5fd',
        fontSize: 14,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        whiteSpace: 'nowrap',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {label}
    </button>
  );
}
```

- [ ] **Step 2: Add Probuzení fields + WakeButton to the connection form**

In `apps/ipad/src/App.tsx`, in `ConnectionForm`:

(a) Import `WakeButton` at the top with the other component imports:

```tsx
import { WakeButton } from './components/WakeButton.js';
```

(b) Extend the form state to carry the wake fields. Replace:

```tsx
  const [form, setForm] = useState({ host: '', port: '7445', token: '' });
```

with:

```tsx
  const [form, setForm] = useState({ host: '', port: '7445', token: '', mac: '', lanIp: '', wanHost: '', wanPort: '' });
```

(c) In the `loadConnection` effect, hydrate the wake fields too. Replace:

```tsx
        setForm({ host: c.host, port: String(c.port), token: c.token });
```

with:

```tsx
        setForm({
          host: c.host, port: String(c.port), token: c.token,
          mac: c.mac ?? '', lanIp: c.lanIp ?? '', wanHost: c.wanHost ?? '', wanPort: c.wanPort ? String(c.wanPort) : '',
        });
```

(d) Inside the `<div style={{ display: 'grid', gap: 10, maxWidth: 360 }}>`, after the token `<input>` and before the Connect `<button>`, add the Probuzení section:

```tsx
        <div style={{ borderTop: '1px solid #2e3038', margin: '6px 0', paddingTop: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#9ca3af', marginBottom: 8 }}>Probuzení (Wake-on-LAN)</div>
          <div style={{ display: 'grid', gap: 10 }}>
            <input placeholder="MAC adresa (AA:BB:CC:DD:EE:FF)" value={form.mac}
              onChange={(e) => setForm({ ...form, mac: e.target.value })} style={inputStyle} />
            <input placeholder="LAN IP Macu (doma)" value={form.lanIp}
              onChange={(e) => setForm({ ...form, lanIp: e.target.value })} style={inputStyle} />
            <input placeholder="DDNS host (mimo síť)" value={form.wanHost}
              onChange={(e) => setForm({ ...form, wanHost: e.target.value })} style={inputStyle} />
            <input placeholder="DDNS port (výchozí 9)" value={form.wanPort}
              onChange={(e) => setForm({ ...form, wanPort: e.target.value })} style={inputStyle} />
            <WakeButton connection={wakeConnection} />
          </div>
        </div>
```

(e) Just before the `return (`, derive the `wakeConnection` used by the button from the current form (so the button works before a successful Connect). Add:

```tsx
  const parsedForWake = parseConnection(form);
  const wakeConnection = parsedForWake.ok
    ? parsedForWake.value
    : { host: form.host, port: 0, token: form.token,
        mac: form.mac.trim() || undefined, lanIp: form.lanIp.trim() || undefined,
        wanHost: form.wanHost.trim() || undefined,
        wanPort: form.wanPort.trim() ? Number(form.wanPort) : undefined };
```

(`parseConnection` is already imported in App.tsx. The fallback covers the case where host/token are incomplete but the user still wants to wake; `WakeButton` only reads the wake fields.)

- [ ] **Step 3: Add the WakeButton to the reconnect banner**

In `apps/ipad/src/App.tsx`, `InstancesModule` must accept the connection so its banner can wake. 

(a) Change the `InstancesModule` signature from:

```tsx
function InstancesModule({ activeId, setActiveId, ackedIds }: { activeId: string | null; setActiveId: (id: string | null) => void; ackedIds: ReadonlySet<string> }) {
```

to:

```tsx
function InstancesModule({ activeId, setActiveId, ackedIds, connection }: { activeId: string | null; setActiveId: (id: string | null) => void; ackedIds: ReadonlySet<string>; connection: Connection }) {
```

(b) Add the `Connection` type import (top of App.tsx, with the connection imports):

```tsx
import { parseConnection, loadConnection, saveConnection, type Connection } from './connection.js';
```

(replace the existing `import { parseConnection, loadConnection, saveConnection, type Connection } from './connection.js';` only if `Connection` is not already imported — App.tsx already imports `type Connection`, so no change may be needed; ensure `Connection` is imported.)

(c) Add the WakeButton inside the disconnected banner. Replace the banner block:

```tsx
          {everConnected ? 'Mac odpojen – obnovuji připojení…' : 'Připojuji k Macu…'}
        </div>
```

with:

```tsx
          {everConnected ? 'Mac odpojen – obnovuji připojení…' : 'Připojuji k Macu…'}
          {connection.mac && (
            <div style={{ marginTop: 8 }}>
              <WakeButton connection={connection} />
            </div>
          )}
        </div>
```

(d) Pass `connection` down where `InstancesModule` is rendered in `Shell`. Replace:

```tsx
          <InstancesModule activeId={activeId} setActiveId={selectInstance} ackedIds={ackedIds} />
```

with:

```tsx
          <InstancesModule activeId={activeId} setActiveId={selectInstance} ackedIds={ackedIds} connection={connection} />
```

(`Shell` already receives `connection` via `ShellProps`.)

- [ ] **Step 4: Typecheck + build**

Run: `cd /Users/jan/Projects/Watchtower/.claude/worktrees/wake-72 && npx tsc -p apps/ipad/tsconfig.json --noEmit && cd apps/ipad && npm run build`
Expected: typecheck clean; `built in …`.

- [ ] **Step 5: Commit**

```bash
git add apps/ipad/src/components/WakeButton.tsx apps/ipad/src/App.tsx
git commit -m "feat: #72 Probuzení form fields + WakeButton on connect screen and reconnect banner"
```

---

## Task 6: Runbook

**Files:**
- Create: `docs/runbooks/wake-on-lan.md`

**Interfaces:** none (documentation).

- [ ] **Step 1: Write the runbook**

Create `docs/runbooks/wake-on-lan.md`:

```markdown
# Wake-on-LAN setup for the iPad "Probudit Mac" button (#72)

Wakes a sleeping, wired Mac from the iPad. Unicast magic packet — no Apple
multicast entitlement needed.

## macOS (the Mac to wake)
1. Connect the Mac to the router by **wired Ethernet** (USB-C dock). Wi-Fi WoL
   is unreliable on Apple Silicon and unsupported by the router for WoL.
2. System Settings → Battery → Options → **"Wake for network access"** = on
   (Always, or "Only on power adapter" if docked).
3. Leave the Mac in normal (deep) sleep at home; keep it on the charger. An 80%
   charge cap + Optimized Battery Charging is fine.
4. Find the values you'll enter in the app:
   - **Ethernet MAC:** System Settings → Network → (your Ethernet/dock service)
     → Details → Hardware → MAC Address, or `ifconfig en<N> | grep ether`.
   - **LAN IP:** same Network panel (e.g. `192.168.1.50`). Reserve it as a
     static DHCP lease on the router so it doesn't change.

## Router — TP-Link Archer AX55 Pro (for the away case)
1. Set up **DDNS** (TP-Link DDNS or no-ip) → you get a hostname like
   `myhome.tplinkdns.com`.
2. Add a **UDP port-forward / virtual server** for the WoL port (e.g. external
   UDP `9` → the Mac's LAN IP `:9`), or use the router's built-in
   "Wake-on-LAN" tool if present. This is the only internet-exposed surface and
   it can do nothing but wake the machine.

## App (iPad connection form → "Probuzení")
- **MAC adresa:** the Ethernet MAC from above.
- **LAN IP Macu (doma):** the Mac's LAN IP — used when you're on home Wi-Fi.
- **DDNS host (mimo síť):** your DDNS hostname — used when you're away.
- **DDNS port:** the external UDP port you forwarded (default 9).
- Tap **Probudit Mac**. The first home wake triggers the iOS Local Network
  permission prompt — allow it. The button confirms "Paket odeslán"; it cannot
  confirm the Mac woke, so just wait for the connection to re-establish.

## Gotchas
- **No delivery confirmation:** WoL is fire-and-forget UDP; "Paket odeslán"
  means the packet left the iPad, nothing more.
- **Home unicast relies on the ARP entry:** the router must still map the
  sleeping Mac's MAC↔IP. On wired Ethernet with "Wake for network access" this
  is normally retained; if a long-sleep home wake fails, use the DDNS path
  (the router broadcasts internally) or reserve the static lease.
- **Sandbox vs reachability:** waking only brings the Mac up; the WS/Tailscale
  reconnect is handled separately (see `tailscale-reach.md`).
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/wake-on-lan.md
git commit -m "docs: #72 Wake-on-LAN runbook (macOS, TP-Link router, app fields)"
```

---

## Final verification (after all tasks)

- [ ] `cd /Users/jan/Projects/Watchtower/.claude/worktrees/wake-72 && npm test` — full suite green (existing + `wakeOnLan` + `wake` + new `connection` cases).
- [ ] `npx tsc -p apps/ipad/tsconfig.json --noEmit` — iPad typecheck clean.
- [ ] `cd apps/ipad && npm run build` — iPad web build succeeds.
- [ ] Device validation (human, in Xcode): **first add `WakePlugin.swift` to the App target** (drag into the `App` group, target App checked — see Task 4 note), then build + run on the iPad, configure the Probuzení fields, sleep the Mac, tap Probudit Mac on home Wi-Fi and from off-network, confirm the Mac wakes and the session reconnects. Allow the Local Network prompt on first LAN wake.
