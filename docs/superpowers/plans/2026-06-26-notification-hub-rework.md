# Notification hub rework (iPad) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the iPad's in-app reply banner with a live "needs attention" notification hub (rail bell + popover) that opens the relevant instance's terminal, and remove all the now-dead ping/reply machinery.

**Architecture:** The hub is derived from live instance status (`ACTION_NEEDED_STATUSES`) — not escalation pings. A rail bell shows a count badge from any module; its popover lists attention instances; tapping one (or an APNs notification) navigates to that instance's terminal where the user answers. The APNs away-path stays (gate → hubSender → APNs), simplified to just send (no WS push, no ping log).

**Tech Stack:** React (iPad, plain + inline styles, no MUI), `@watchtower/shared/tabAttention.js`, vitest (`environment: node`), better-sqlite3 migrations.

## Global Constraints

- **Branch:** `feat/71-messaging-hub` worktree at `/Users/jan/Projects/Watchtower/.claude/worktrees/messaging-hub-71` (isolated node_modules; native modules rebuilt for Electron). Run git/npm/npx there. Do NOT touch the main checkout.
- **`@watchtower/shared` is a BUILT composite** — after editing `packages/shared/src/*`, run `npx tsc -b packages/shared/tsconfig.json` (worktree-local). Vitest resolves shared → `src` via alias.
- **Attention status set = `ACTION_NEEDED_STATUSES`** from `@watchtower/shared/tabAttention.js` = `Set(['waiting-permission','waiting-input','crashed'])`. Reuse it (DRY — `TabStrip` uses the same). Reason text per status (Czech): `waiting-permission`→`čeká na povolení`, `waiting-input`→`dokončeno, čeká na vstup`, `crashed`→`spadlo`.
- **iPad app:** plain React, **no MUI**, inline styles matching the existing palette (`#0e0f12`/`#13141a`/`#7c6df0`/`#fca5a5`). Czech UI strings.
- **Build-green per commit:** `npm test` green + `npm run typecheck` (shared/transport/orchestrator/iPad clean; desktop pre-existing drift only) + iPad builds. Removing a contract kind and its consumers happens in one task so no commit dangles.
- Do NOT commit any `dist/`.

---

### Task 1: `useAttentionInstances` hook

**Files:**
- Create: `apps/ipad/src/state/useAttentionInstances.ts`
- Create: `apps/ipad/src/state/attentionList.ts` (pure mapper, testable)
- Test: `tests/ipad/attentionList.test.ts`

**Interfaces:**
- Produces:
  - `attentionList.ts`: `interface AttentionItem { instanceId: string; label: string; reason: string }` and a pure `buildAttentionList(instances: InstanceView[], projects: ProjectSummary[]): AttentionItem[]`.
  - `useAttentionInstances(): AttentionItem[]` — wraps `useInstances()` + `useProjects()` through `buildAttentionList`.
- Consumes: `InstanceView` (`{id,cwd,status,...}`), `ProjectSummary` (`{id,name,folderPath}`), `ACTION_NEEDED_STATUSES`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/ipad/attentionList.test.ts
import { describe, it, expect } from 'vitest';
import { buildAttentionList } from '../../apps/ipad/src/state/attentionList.js';

const inst = (id: string, cwd: string, status: string) => ({ id, cwd, status, lastActivityAt: 0, kind: 'claude', taskId: null });

describe('buildAttentionList', () => {
  it('includes only attention statuses, with project label + reason', () => {
    const instances = [
      inst('a', '/Users/jan/Projects/api', 'waiting-permission'),
      inst('b', '/Users/jan/Projects/web', 'working'),       // excluded
      inst('c', '/Users/jan/x/fitness', 'waiting-input'),
      inst('d', '/tmp/z', 'crashed'),
    ];
    const projects = [{ id: 1, name: 'API', folderPath: '/Users/jan/Projects/api' }];
    expect(buildAttentionList(instances as never, projects as never)).toEqual([
      { instanceId: 'a', label: 'API', reason: 'čeká na povolení' },          // project name
      { instanceId: 'c', label: 'fitness', reason: 'dokončeno, čeká na vstup' }, // cwd basename fallback
      { instanceId: 'd', label: 'z', reason: 'spadlo' },
    ]);
  });
  it('returns empty when nothing needs attention', () => {
    expect(buildAttentionList([inst('a', '/x', 'working')] as never, [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/ipad/attentionList.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// apps/ipad/src/state/attentionList.ts
import { ACTION_NEEDED_STATUSES } from '@watchtower/shared/tabAttention.js';
import type { InstanceView } from './useInstances.js';
import type { ProjectSummary } from './useProjects.js';

export interface AttentionItem { instanceId: string; label: string; reason: string }

const REASON: Record<string, string> = {
  'waiting-permission': 'čeká na povolení',
  'waiting-input': 'dokončeno, čeká na vstup',
  'crashed': 'spadlo',
};

export function buildAttentionList(instances: InstanceView[], projects: ProjectSummary[]): AttentionItem[] {
  return instances
    .filter((i) => ACTION_NEEDED_STATUSES.has(i.status))
    .map((i) => {
      const label = projects.find((p) => p.folderPath === i.cwd)?.name
        ?? i.cwd.split('/').filter(Boolean).pop() ?? i.id;
      return { instanceId: i.id, label, reason: REASON[i.status] ?? 'vyžaduje pozornost' };
    });
}
```

```ts
// apps/ipad/src/state/useAttentionInstances.ts
import { useInstances } from './useInstances.js';
import { useProjects } from './useProjects.js';
import { buildAttentionList, type AttentionItem } from './attentionList.js';

export function useAttentionInstances(): AttentionItem[] {
  const { instances } = useInstances();
  const { projects } = useProjects();
  return buildAttentionList(instances, projects);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/ipad/attentionList.test.ts && npx tsc -p apps/ipad/tsconfig.json --noEmit` → PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add apps/ipad/src/state/useAttentionInstances.ts apps/ipad/src/state/attentionList.ts tests/ipad/attentionList.test.ts
git commit -m "feat: #71 useAttentionInstances — live attention list from instance status"
```

---

### Task 2: Rail bell + popover + navigation lift

**Files:**
- Modify: `apps/ipad/src/components/Rail.tsx` (add bell + badge)
- Create: `apps/ipad/src/components/NotificationHub.tsx` (popover list)
- Modify: `apps/ipad/src/App.tsx` (lift `activeId`/`setActiveId` to `Shell`; wire bell count + popover + navigate)

**Interfaces:**
- Consumes: `useAttentionInstances` (Task 1).
- Produces: `Rail` gains `notificationCount?: number` + `onOpenNotifications?: () => void`; `NotificationHub` props `{ items: AttentionItem[]; onSelect(instanceId: string): void; onClose(): void }`.

- [ ] **Step 1: Lift active-instance selection to `Shell`**

In `App.tsx`: move `const { activeId, setActiveId } = useActiveTerminal();` from `InstancesModule` (line 45) up into `Shell` (near line 149). Change `InstancesModule` to accept them as props: `function InstancesModule({ activeId, setActiveId }: { activeId: string | null; setActiveId: (id: string | null) => void })` and pass them at the render site (`<InstancesModule activeId={activeId} setActiveId={setActiveId} />`). `handleSpawned` in InstancesModule still calls `setActiveId(id)` via the prop.

- [ ] **Step 2: Add the bell to `Rail.tsx`**

Add to `Props`: `notificationCount?: number; onOpenNotifications?: () => void;`. In the header block (after the logo, lines ~106–135), render a bell button with a count badge when `notificationCount! > 0`:

```tsx
{/* Notification bell — visible in every module */}
<button
  onClick={() => onOpenNotifications?.()}
  title="Upozornění"
  style={{
    position: 'relative', width: 40, height: 40, marginBottom: 4, borderRadius: 8,
    border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent',
  }}
>
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2m6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1z" />
  </svg>
  {notificationCount ? (
    <span style={{
      position: 'absolute', top: 2, right: 2, minWidth: 16, height: 16, padding: '0 4px',
      borderRadius: 8, background: '#dc2626', color: '#fff', fontSize: 10, fontWeight: 700,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>{notificationCount}</span>
  ) : null}
</button>
```

- [ ] **Step 3: Create `NotificationHub.tsx` (popover)**

```tsx
// apps/ipad/src/components/NotificationHub.tsx
import type { AttentionItem } from '../state/attentionList.js';

interface Props { items: AttentionItem[]; onSelect(instanceId: string): void; onClose(): void }

export function NotificationHub({ items, onSelect, onClose }: Props) {
  return (
    <>
      {/* click-away scrim */}
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 20 }} />
      <div style={{
        position: 'absolute', top: 56, left: 8, zIndex: 21, width: 280, maxHeight: '60%', overflowY: 'auto',
        background: '#13141a', border: '1px solid #2e3038', borderRadius: 10, padding: 6,
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
      }}>
        {items.length === 0 ? (
          <div style={{ padding: 12, color: '#6b7280', fontSize: 13 }}>Žádná upozornění</div>
        ) : items.map((it) => (
          <button key={it.instanceId} onClick={() => onSelect(it.instanceId)} style={{
            display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 8,
            border: 'none', background: 'transparent', color: '#e5e7eb', cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{it.label}</div>
            <div style={{ fontSize: 12, color: '#fca5a5' }}>{it.reason}</div>
          </button>
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 4: Wire into `Shell` (`App.tsx`)**

In `Shell`: `const attention = useAttentionInstances();` + `const [hubOpen, setHubOpen] = useState(false);`. Pass to Rail: `<Rail active={activeModule} onSelect={setActiveModule} notificationCount={attention.length} onOpenNotifications={() => setHubOpen(true)} />`. Render the popover (inside the Shell's positioned container — ensure the container is `position: relative`):

```tsx
{hubOpen && (
  <NotificationHub
    items={attention}
    onClose={() => setHubOpen(false)}
    onSelect={(id) => { setActiveModule('instances'); setActiveId(id); setHubOpen(false); }}
  />
)}
```

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc -p apps/ipad/tsconfig.json --noEmit && npm run build -w @watchtower/ipad` → clean + builds.

- [ ] **Step 6: Commit**

```bash
git add apps/ipad/src/components/Rail.tsx apps/ipad/src/components/NotificationHub.tsx apps/ipad/src/App.tsx
git commit -m "feat: #71 rail notification bell + hub popover + nav lift"
```

---

### Task 3: Remove the reply banner; APNs tap navigates

**Files:**
- Delete: `apps/ipad/src/components/PingReply.tsx`, `apps/ipad/src/state/usePings.ts`, `apps/ipad/src/state/pingStore.ts`, `tests/ipad/pingStore.test.ts`
- Modify: `apps/ipad/src/App.tsx`

**Interfaces:** Consumes the Shell's `setActiveModule`/`setActiveId` (Task 2). After this, the iPad no longer references `attentionPing`, `messaging:reply`, or `messaging:getPing`.

- [ ] **Step 1: Delete the files**

```bash
git rm apps/ipad/src/components/PingReply.tsx apps/ipad/src/state/usePings.ts apps/ipad/src/state/pingStore.ts tests/ipad/pingStore.test.ts
```

- [ ] **Step 2: Strip `App.tsx`**

- Remove `import { usePings } ...` (line 12) and `import { PingReply } ...` (line 20).
- Remove `const { ping, clear: clearPing, seedPing } = usePings();` (line 152).
- Remove the `{ping && <PingReply ping={ping} onClear={clearPing} />}` mount (line 208).
- Rewire the `pushNotificationActionPerformed` handler (lines 173–188 — currently calls `messaging:getPing` + `seedPing`) to navigate: read `instanceId` from the action payload's `notification.data` and call `setActiveModule('instances')` + `setActiveId(String(instanceId))`. Keep the `Number(...)`-style guard only if present; here the payload value is a string instanceId — no coercion needed. Example shape:

```tsx
const sub = PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
  const data = action.notification?.data as { instanceId?: unknown } | undefined;
  const id = data?.instanceId;
  if (typeof id === 'string' && id) { setActiveModule('instances'); setActiveId(id); }
});
return () => { void sub.then((l) => l.remove()); };
```
(Keep the existing listener-handle cleanup pattern.)

- [ ] **Step 3: Typecheck + build + suite**

Run: `npm run typecheck && npm run build -w @watchtower/ipad && npm test`
Expected: iPad clean (no refs to PingReply/usePings/pingStore/messaging:reply/getPing); builds; suite green (pingStore test gone). The orchestrator still defines `messaging:reply`/`getPing`/`attentionPing` (orphaned, compiles) — removed in Task 4.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: #71 remove reply banner; APNs tap opens the instance"
```

---

### Task 4: Orchestrator + contract + migration cleanup; simplify hubSender

**Files:**
- Delete: `orchestrator/messagingReply.ts`, `orchestrator/db/repositories/pings.ts`, `tests/orchestrator/messagingReply.test.ts`, `tests/orchestrator/pings.test.ts`
- Modify: `orchestrator/hubSender.ts`, `orchestrator/index.ts`, `orchestrator/db/migrations.ts`, `packages/shared/src/messagePort.ts`, `packages/shared/src/ipcContract.ts`, `tests/orchestrator/hubSender.test.ts`, `tests/orchestrator/migrations.test.ts`, `tests/orchestrator/apns.test.ts`, `docs/runbooks/apns-messaging-hub.md`

**Interfaces:** removes `messaging:reply`/`messaging:getPing` request+response kinds, the `attentionPing` push (both unions), `PingView`, `PingsRepo`, `routeMessagingReply`, `deliverReply`, and migration v16. Every reference removed together → build green (iPad already clean from Task 3).

- [ ] **Step 1: Delete dead files**

```bash
git rm orchestrator/messagingReply.ts orchestrator/db/repositories/pings.ts tests/orchestrator/messagingReply.test.ts tests/orchestrator/pings.test.ts
```

- [ ] **Step 2: Rewrite `hubSender.ts`** (drop `emitPush`/`logPing`/`pingId` + the `OrchPush` import)

```ts
import type { EscalationKind } from './escalationGate.js';
import type { HubConfig } from '@watchtower/shared/hubConfig.js';

export interface HubSenderDeps {
  getConfig(): HubConfig;
  listTokens(): string[];
  removeToken(token: string): void;
  sendApns(cfg: HubConfig, token: string, msg: { title: string; body: string; data: Record<string, unknown> }): Promise<{ ok: boolean; status: number; reason?: string }>;
  buildContext(instanceId: string, cwd: string, kind: EscalationKind): { title: string; body: string };
}

export function createHubSender(deps: HubSenderDeps) {
  return {
    async fire(instanceId: string, cwd: string, kind: EscalationKind): Promise<void> {
      const cfg = deps.getConfig();
      if (!cfg.enabled) return;
      if (!cfg.apnsKey || !cfg.apnsKeyId || !cfg.apnsTeamId) return;
      const { title, body } = deps.buildContext(instanceId, cwd, kind);
      for (const token of deps.listTokens()) {
        const r = await deps.sendApns(cfg, token, { title, body, data: { instanceId } });
        if (!r.ok && (r.status === 410 || r.reason === 'BadDeviceToken' || r.reason === 'Unregistered')) {
          deps.removeToken(token);
        }
      }
    },
  };
}
```

- [ ] **Step 3: Trim `index.ts`**

- Remove the `PingsRepo` import (line 13) and `routeMessagingReply` import (line 51).
- Remove the `deliverReply` function (lines 307–314).
- Remove the `messaging:getPing` case (lines 998–999) and the `messaging:reply` case (lines 1001–1005).
- In the `createHubSender({...})` deps (lines 1142–1161), remove the `logPing:` and `emitPush,` lines; keep `getConfig`, `listTokens`, `removeToken`, `sendApns`, `buildContext`.

- [ ] **Step 4: Remove contract kinds**

- `packages/shared/src/messagePort.ts`: remove the `PingView` import (line 2), the `messaging:getPing`/`messaging:reply` entries from `OrchRequest` (lines 80–81) and `OrchResponse` (lines 539–540), and the `attentionPing` entry from `OrchPush` (line 554).
- `packages/shared/src/ipcContract.ts`: remove the `messaging:getPing`/`messaging:reply` entries from `IpcRequest` (lines 83–84) and `IpcResponse` (lines 604–605), the `attentionPing` entry from `IpcPush` (line 764), and the `PingView` interface (lines 86–94).

- [ ] **Step 5: Remove migration v16**

In `orchestrator/db/migrations.ts`, delete the entire `{ version: 16, up: ... pings ... }` entry (lines 326–339), leaving v15 (`push_devices`) as the last. In `tests/orchestrator/migrations.test.ts`: change `toBe(16)` → `toBe(15)` at lines 43 and 176, and the `// full → v16` comment (line 172) → `// full → v15`.

- [ ] **Step 6: Update `hubSender.test.ts` + `apns.test.ts` + runbook**

- `tests/orchestrator/hubSender.test.ts`: remove the `logPing`/`emitPush` deps from the test's `base` object and the `pushes` array; drop the `expect(pushes).toEqual([...attentionPing...])` assertion; keep/adjust the assertions for APNs sends to all tokens + 410 prune + disabled-no-op. Assert the APNs `data` is `{ instanceId }` (no `pingId`).
- `tests/orchestrator/apns.test.ts`: in the `buildApnsPayload` test, change the sample `data` from `{ instanceId: 'i1', pingId: 7 }` to `{ instanceId: 'i1' }` and the expected payload accordingly (keep it a faithful example of what hubSender now sends).
- `docs/runbooks/apns-messaging-hub.md`: update the tap-behaviour sentence from "tap → reply box" to "tap → opens the instance's terminal" (the reply happens in the terminal).

- [ ] **Step 7: Verify build-green**

```bash
grep -rniE "messaging:reply|messaging:getPing|attentionPing|PingsRepo|PingView|routeMessagingReply|deliverReply" orchestrator packages/shared/src apps/ipad/src --include=*.ts --include=*.tsx | grep -v "\.bak" || echo "NO DEAD REFS"
npx tsc -b packages/shared/tsconfig.json && npm run typecheck && npm test
```
Expected: "NO DEAD REFS"; full typecheck clean (only pre-existing desktop drift); suite green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: #71 remove dead ping/reply machinery; hubSender = APNs-only"
```

---

## Self-Review

**Spec coverage:**
- §2 hub source = live status (`ACTION_NEEDED_STATUSES`) → Task 1. ✓
- §2/§3 bell + popover + navigate → Task 2. ✓
- §3 navigation lift → Task 2 Step 1. ✓
- §3 APNs tap → navigate → Task 3 Step 2. ✓
- §3 reason text per status → Task 1. ✓
- §5 removals: PingReply/usePings/pingStore → Task 3; messaging:reply/getPing + attentionPing + PingsRepo + routeMessagingReply + deliverReply + pings migration → Task 4. ✓
- §4 hubSender simplification → Task 4 Step 2. ✓
- §5 migration note (v16 removed, vestigial dev table) → Task 4 Step 5. ✓
- §7 testing (attentionList unit; hubSender update; deleted tests; typecheck/build) → Tasks 1, 3, 4. ✓

**Placeholder scan:** code steps show complete code; deletion/removal steps give exact files + line refs + a `grep` verification — appropriate for removals. No TBD.

**Type/name consistency:** `AttentionItem {instanceId,label,reason}` consistent across Tasks 1–2. `ACTION_NEEDED_STATUSES` (shared SSOT) used for both the hub and matches `TabStrip`. APNs `data` shape `{ instanceId }` consistent across hubSender (Task 4 Step 2) + apns.test (Step 6). `setActiveModule`/`setActiveId` lifted in Task 2, consumed by Task 3's APNs handler. Build-green ordering: iPad consumers removed (Task 3) before the orchestrator/contract kinds (Task 4), so no commit dangles.

**Note (spec correction):** the spec §2/§3 wrote `idle-notify` as an attention status; the real status string is `waiting-input` (per `@watchtower/shared/tabAttention.js` `ACTION_NEEDED_STATUSES`). The plan uses the shared SSOT set — this corrects the spec's stray label.
