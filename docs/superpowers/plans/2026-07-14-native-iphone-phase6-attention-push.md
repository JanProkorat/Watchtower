# Native iPhone Phase 6a — Attention + Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the complete APNs push pipeline for the native iPhone app (`cz.greencode.watchtower.ios`) — a multi-topic backend fix + iOS `PushRegistrar`/`AppDelegate` registration — plus a poll-based `AttentionFeature`, **excluding** the Apple Developer entitlement/provisioning (deferred to 6b).

**Architecture:** Backend (TypeScript/orchestrator): add a `bundle_id` column to `push_devices` in both stores (SQLite + Postgres), thread a per-device topic through `sendApns`/`hubSender`, and carry `bundleId` on the `push:registerDevice` IPC. iOS (Swift/TCA): a new `PushRegistrar` `@DependencyClient` upserting the device row via Supabase, `AppDelegate` APNs registration, an `AttentionClient` reading/replying to the flat `attention_messages` table, and an `AttentionFeature` reducer + bell/drawer UI in the shell.

**Tech Stack:** TypeScript, Node `utilityProcess` orchestrator, better-sqlite3 / `node:sqlite`, Postgres (`pg`), vitest. Swift 5.10+, SwiftUI, The Composable Architecture (TCA 1.15+), supabase-swift 2.x, XCTest via `TestStore`, XcodeGen, Xcode 26.

## Global Constraints

- **Base:** branch `feat/native-iphone-phase6` off `origin/main` in worktree `.claude/worktrees/native-iphone-phase6` (has Phase 5 + merged reviews). One PR.
- **Bundle ids (verbatim):** iPad = `cz.greencode.watchtower.ipad`; native iPhone = `cz.greencode.watchtower.ios`. The iPad id is the default for every existing `push_devices` row and every code default.
- **SQLite migration:** current max version is **22** → new version **23**. ADD COLUMN defaults **must be constant literals** (better-sqlite3 vs `node:sqlite` divergence — incident `sqlite-add-column-engine-divergence`). Use the existing `addColumnIfMissing(db, table, column, decl)` helper (`orchestrator/db/migrations.ts:30-35`).
- **PG migration:** current max version is **12** → new version **13**. Idempotent DDL only (`ADD COLUMN IF NOT EXISTS`). Append to `PG_MIGRATIONS` in `orchestrator/db/pg/schema.ts`.
- **No `attention_threads` table exists** — attention is the flat `attention_messages` table (PG only); threads are grouped client-side by `instance_id`.
- **iOS:** iOS 17.0 deployment target; TCA reducers pure; all I/O via `@Dependency`; dates kept as opaque ISO strings (never `Date`-with-UTC round-trips — incident `sync-pull-date-shift-bug`). English UI, cs-CZ number/date formatting.
- **No entitlement in 6a:** do **not** add a `.entitlements` file, `aps-environment`, or a Push Notifications `capabilities` block to `apps/iphone-native/project.yml`. Registration is non-fatal/silent without it (parent design §10).
- **Swift build (headless):** from `apps/iphone-native/`, `xcodegen generate` after adding app-target files, then `xcodebuild -project Watchtower.xcodeproj -scheme Watchtower -destination 'platform=iOS Simulator,name=iPhone 16e' -skipMacroValidation -skipPackagePluginValidation build`. Package tests: `swift test` from `swift/WatchtowerCore/` (no `Secrets.xcconfig` needed — lazy client seam).
- **Full test suite before commits touching TS:** `npm test` (219+ / currently ~1245 tests; add tests when adding code). `npm test` does NOT typecheck — run `npx tsc -p orchestrator/tsconfig.json --noEmit` for orchestrator TS.
- **Commit trailer:** end each commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

**Backend (TypeScript):**
- `orchestrator/db/migrations.ts` — add SQLite migration v23 (push_devices.bundle_id).
- `orchestrator/db/repositories/pushDevices.ts` — `register` accepts bundleId; `listTokens()` returns `{token,bundleId}[]`.
- `orchestrator/db/pg/schema.ts` — add PG migration v13 (push_devices.bundle_id).
- `orchestrator/db/repositories/pgPushDevices.ts` — `readPgPushTokens` returns `{token,bundleId}[]`.
- `orchestrator/services/apns.ts` — `sendApns` gains `topic` param.
- `orchestrator/hubSender.ts` — `listTokens`/loop carry `{token,bundleId}`; pass topic.
- `orchestrator/index.ts` — union carries bundleId; `push:registerDevice` handler passes bundleId; `sendApns` wrapper dep signature.
- `packages/shared/src/ipcContract.ts` — `push:registerDevice` payload gains `bundleId?`.
- `apps/ipad/src/state/pushRegistration.ts` + `apps/ipad/src/App.tsx` — iPad sends `bundleId: '…ipad'`.
- Tests: `tests/orchestrator/{pushDevices,pgPushDevices,apns,hubSender,pgAttentionSchema}.test.ts`.

**iOS (Swift) — `swift/WatchtowerCore/Sources/WatchtowerCore/`:**
- `Dependencies/PushRegistrar.swift` — new `@DependencyClient` (Supabase upsert).
- `Dependencies/AttentionClient.swift` — new `@DependencyClient` (list + reply).
- `Billing/BillingModels.swift` — add `AttentionMessage`, `AttentionThread`.
- `Billing/AttentionMapping.swift` — `AttentionMessageDTO`, `mapAttentionRow`, `groupThreads` (verbatim port).
- `Features/AttentionFeature.swift` — new reducer.
- `Features/AppFeature.swift` — embed `AttentionFeature` (Scope + `@Presents`).
- Tests in `swift/WatchtowerCore/Tests/WatchtowerCoreTests/`: `AttentionMappingTests.swift`, `PushRegistrarTests.swift`, `AttentionClientTests.swift`, `AttentionFeatureTests.swift`.

**iOS (Swift) — `apps/iphone-native/Watchtower/`:**
- `AppDelegate.swift` — APNs registration.
- `Views/AttentionView.swift` — bell + drawer sheet.
- `Views/AppShellView.swift` — toolbar bell button + badge + sheet presentation.

---

## MILESTONE 1 — Backend multi-topic APNs (TypeScript)

### Task 1: SQLite `push_devices.bundle_id` column + repo

**Files:**
- Modify: `orchestrator/db/migrations.ts` (add version 23 after the current last entry, currently v22 at ~L429-457)
- Modify: `orchestrator/db/repositories/pushDevices.ts`
- Test: `tests/orchestrator/pushDevices.test.ts`

**Interfaces:**
- Produces: `PushDevicesRepo.register(token: string, platform: string, now: number, bundleId?: string): void` (defaults bundleId to `'cz.greencode.watchtower.ipad'`); `PushDevicesRepo.listTokens(): { token: string; bundleId: string }[]`.

- [ ] **Step 1: Write failing tests** — replace/extend the existing `listTokens` and `register` assertions in `tests/orchestrator/pushDevices.test.ts`:

```ts
import { test, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../orchestrator/db/migrations.js';
import { PushDevicesRepo } from '../../orchestrator/db/repositories/pushDevices.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  runMigrations(db as never);
  return db;
}

test('register defaults bundle_id to ipad and listTokens returns {token,bundleId}', () => {
  const repo = new PushDevicesRepo(freshDb() as never);
  repo.register('tok-ipad', 'ios', 1000);
  expect(repo.listTokens()).toEqual([{ token: 'tok-ipad', bundleId: 'cz.greencode.watchtower.ipad' }]);
});

test('register stores an explicit bundle_id', () => {
  const repo = new PushDevicesRepo(freshDb() as never);
  repo.register('tok-ios', 'ios', 1000, 'cz.greencode.watchtower.ios');
  expect(repo.listTokens()).toEqual([{ token: 'tok-ios', bundleId: 'cz.greencode.watchtower.ios' }]);
});

test('register upsert updates bundle_id on conflict', () => {
  const repo = new PushDevicesRepo(freshDb() as never);
  repo.register('t', 'ios', 1000, 'cz.greencode.watchtower.ipad');
  repo.register('t', 'ios', 2000, 'cz.greencode.watchtower.ios');
  expect(repo.listTokens()).toEqual([{ token: 't', bundleId: 'cz.greencode.watchtower.ios' }]);
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/orchestrator/pushDevices.test.ts`
Expected: FAIL (listTokens returns strings / register has 3 params / no bundle_id column).

- [ ] **Step 3: Add the migration** — append a new version object to the migrations array in `orchestrator/db/migrations.ts` (immediately after the current highest-version entry). Use the replay-safe helper:

```ts
{
  version: 23,
  up: (db) => {
    addColumnIfMissing(
      db,
      'push_devices',
      'bundle_id',
      "TEXT NOT NULL DEFAULT 'cz.greencode.watchtower.ipad'",
    );
  },
},
```

(Match the exact shape of the neighboring migration entries — if they use `up(db) {…}` method shorthand or `run:` instead of `up:`, follow that. Confirm the `addColumnIfMissing` signature at `migrations.ts:30-35`.)

- [ ] **Step 4: Update the repo** — `orchestrator/db/repositories/pushDevices.ts`:

```ts
const DEFAULT_BUNDLE_ID = 'cz.greencode.watchtower.ipad';

register(token: string, platform: string, now: number, bundleId: string = DEFAULT_BUNDLE_ID): void {
  this.db
    .prepare(
      `INSERT INTO push_devices (apns_token, platform, registered_at, bundle_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(apns_token) DO UPDATE SET
         platform = excluded.platform,
         registered_at = excluded.registered_at,
         bundle_id = excluded.bundle_id`,
    )
    .run(token, platform, now, bundleId);
}

listTokens(): { token: string; bundleId: string }[] {
  return this.db
    .prepare('SELECT apns_token AS token, bundle_id AS bundleId FROM push_devices')
    .all() as { token: string; bundleId: string }[];
}
```

(Preserve the file's existing `db` field access idiom and the `remove` method unchanged.)

- [ ] **Step 5: Run tests, verify they pass**

Run: `npx vitest run tests/orchestrator/pushDevices.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc -p orchestrator/tsconfig.json --noEmit
git add orchestrator/db/migrations.ts orchestrator/db/repositories/pushDevices.ts tests/orchestrator/pushDevices.test.ts
git commit -m "feat(orch): push_devices.bundle_id column + repo (SQLite v23)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Postgres `push_devices.bundle_id` column + reader

**Files:**
- Modify: `orchestrator/db/pg/schema.ts` (append PG migration v13 to `PG_MIGRATIONS`)
- Modify: `orchestrator/db/repositories/pgPushDevices.ts`
- Test: `tests/orchestrator/pgPushDevices.test.ts`, `tests/orchestrator/pgAttentionSchema.test.ts`

**Interfaces:**
- Produces: `readPgPushTokens(pg): Promise<{ token: string; bundleId: string }[]>` (returns `[]` when `pg` is null).

- [ ] **Step 1: Write failing tests**

In `tests/orchestrator/pgPushDevices.test.ts`:

```ts
import { test, expect } from 'vitest';
import { readPgPushTokens } from '../../orchestrator/db/repositories/pgPushDevices.js';

test('readPgPushTokens returns [] when pg is null', async () => {
  expect(await readPgPushTokens(null as never)).toEqual([]);
});

test('readPgPushTokens maps rows to {token,bundleId}', async () => {
  const pg = { query: async () => ({ rows: [
    { apns_token: 'a', bundle_id: 'cz.greencode.watchtower.ios' },
    { apns_token: 'b', bundle_id: 'cz.greencode.watchtower.ipad' },
  ] }) };
  expect(await readPgPushTokens(pg as never)).toEqual([
    { token: 'a', bundleId: 'cz.greencode.watchtower.ios' },
    { token: 'b', bundleId: 'cz.greencode.watchtower.ipad' },
  ]);
});
```

In `tests/orchestrator/pgAttentionSchema.test.ts`, update the latest-version assertion (currently `=== 12`) and add a bundle_id assertion:

```ts
// Was: expect(Math.max(...versions)).toBe(12);
expect(Math.max(...versions)).toBe(13);

const v13 = PG_MIGRATIONS.find((m) => m.version === 13)!;
expect(v13.up.join('\n')).toMatch(/ALTER TABLE push_devices\s+ADD COLUMN IF NOT EXISTS bundle_id/);
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/orchestrator/pgPushDevices.test.ts tests/orchestrator/pgAttentionSchema.test.ts`
Expected: FAIL (mapping returns tokens as strings; max version is 12).

- [ ] **Step 3: Add PG migration v13** — append to the `PG_MIGRATIONS` array in `orchestrator/db/pg/schema.ts`:

```ts
{
  version: 13,
  up: [
    `ALTER TABLE push_devices
       ADD COLUMN IF NOT EXISTS bundle_id TEXT NOT NULL
       DEFAULT 'cz.greencode.watchtower.ipad'`,
  ],
},
```

(Match the exact object shape used by existing entries — `{ version, up: string[] }`.)

- [ ] **Step 4: Update the reader** — `orchestrator/db/repositories/pgPushDevices.ts`:

```ts
export async function readPgPushTokens(
  pg: { query: (sql: string) => Promise<{ rows: { apns_token: string; bundle_id: string }[] }> } | null,
): Promise<{ token: string; bundleId: string }[]> {
  if (!pg) return [];
  const { rows } = await pg.query('SELECT apns_token, bundle_id FROM push_devices');
  return rows.map((r) => ({ token: r.apns_token, bundleId: r.bundle_id }));
}
```

(Preserve the exact `pg` parameter type the file already uses.)

- [ ] **Step 5: Run tests, verify they pass**

Run: `npx vitest run tests/orchestrator/pgPushDevices.test.ts tests/orchestrator/pgAttentionSchema.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc -p orchestrator/tsconfig.json --noEmit
git add orchestrator/db/pg/schema.ts orchestrator/db/repositories/pgPushDevices.ts tests/orchestrator/pgPushDevices.test.ts tests/orchestrator/pgAttentionSchema.test.ts
git commit -m "feat(orch): push_devices.bundle_id column + reader (PG v13)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `sendApns` topic parameter

**Files:**
- Modify: `orchestrator/services/apns.ts:28-59` (the `sendApns` function)
- Test: `tests/orchestrator/apns.test.ts`

**Interfaces:**
- Consumes: `HUB_BUNDLE_ID` from `@watchtower/shared/hubConfig.js`.
- Produces: `sendApns(cfg, deviceToken, msg, topic?: string, http2mod?): Promise<{ok,status,reason?}>` — `topic` defaults to `HUB_BUNDLE_ID`. **Keep `http2mod` as the last param** so existing call sites/tests that inject it still work; `topic` goes before it.

- [ ] **Step 1: Write a failing test** — add to `tests/orchestrator/apns.test.ts` a test that captures the `apns-topic` header via an injected http2 mock:

```ts
test('sendApns sends the given topic in apns-topic header', async () => {
  let sentHeaders: Record<string, string> = {};
  const fakeReq: any = {
    on: (ev: string, cb: (arg?: unknown) => void) => {
      if (ev === 'response') cb({ ':status': 200 });
      if (ev === 'end') cb();
      return fakeReq;
    },
    end: () => {},
  };
  const fakeClient: any = {
    on: () => fakeClient,
    request: (h: Record<string, string>) => { sentHeaders = h; return fakeReq; },
    close: () => {},
  };
  const http2mod: any = { connect: () => fakeClient };
  const cfg: any = { apnsKey: TEST_P8, apnsKeyId: 'K', apnsTeamId: 'T', apnsEnv: 'sandbox' };

  await sendApns(cfg, 'devtoken', { title: 't', body: 'b', data: {} }, 'cz.greencode.watchtower.ios', http2mod);
  expect(sentHeaders['apns-topic']).toBe('cz.greencode.watchtower.ios');
});

test('sendApns defaults apns-topic to HUB_BUNDLE_ID', async () => {
  // same mock; call without the topic arg, then assert:
  // expect(sentHeaders['apns-topic']).toBe(HUB_BUNDLE_ID);
});
```

(Reuse the existing `TEST_P8` PEM fixture already in `apns.test.ts` for `buildApnsJwt`; import `HUB_BUNDLE_ID`. If no reusable fixture exists, generate an EC P-256 key once at top of file.)

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/orchestrator/apns.test.ts`
Expected: FAIL (topic arg ignored; header is always HUB_BUNDLE_ID).

- [ ] **Step 3: Implement** — change `sendApns` signature and header in `orchestrator/services/apns.ts`:

```ts
export async function sendApns(
  cfg: HubConfig,
  deviceToken: string,
  msg: { title: string; body: string; data: Record<string, unknown> },
  topic: string = HUB_BUNDLE_ID,
  http2mod: typeof http2 = http2,
): Promise<{ ok: boolean; status: number; reason?: string }> {
  // ...unchanged JWT/body...
  const req = client.request({
    ':method': 'POST', ':path': `/3/device/${deviceToken}`,
    authorization: `bearer ${cachedJwt!.token}`,
    'apns-topic': topic, 'apns-push-type': 'alert', 'apns-priority': '10',
    'content-type': 'application/json',
  });
  // ...unchanged...
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run tests/orchestrator/apns.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc -p orchestrator/tsconfig.json --noEmit
git add orchestrator/services/apns.ts tests/orchestrator/apns.test.ts
git commit -m "feat(orch): sendApns topic param (defaults to HUB_BUNDLE_ID)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `hubSender` + `index.ts` thread per-device topic

**Files:**
- Modify: `orchestrator/hubSender.ts:12-28`
- Modify: `orchestrator/index.ts:1612-1620` (the `listTokens`/`removeToken`/`sendApns` dep wiring)
- Test: `tests/orchestrator/hubSender.test.ts`

**Interfaces:**
- Consumes: `sendApns(cfg, token, msg, topic, http2mod?)` (Task 3); `PushDevicesRepo.listTokens(): {token,bundleId}[]` (Task 1); `readPgPushTokens(pg): Promise<{token,bundleId}[]>` (Task 2).
- Produces: `createHubSender(deps)` where `deps.listTokens(): Promise<{token,bundleId}[]> | {token,bundleId}[]` and `deps.sendApns(cfg, token, msg, topic)`.

- [ ] **Step 1: Update the hubSender test** — `tests/orchestrator/hubSender.test.ts`: change the fake `listTokens` to return objects and assert `sendApns` receives each device's topic:

```ts
const sent: { token: string; topic: string }[] = [];
const sender = createHubSender({
  getConfig: () => ({ enabled: true, apnsKey: 'k', apnsKeyId: 'k', apnsTeamId: 't', apnsEnv: 'sandbox' } as any),
  listTokens: async () => [
    { token: 'ipad-tok', bundleId: 'cz.greencode.watchtower.ipad' },
    { token: 'ios-tok', bundleId: 'cz.greencode.watchtower.ios' },
  ],
  removeToken: () => {},
  sendApns: async (_cfg, token, _msg, topic) => { sent.push({ token, topic }); return { ok: true, status: 200 }; },
  buildContext: () => ({ title: 'T', body: 'B' }),
});
await sender.fire('inst', '/x/proj', 'crashed');
expect(sent).toEqual([
  { token: 'ipad-tok', topic: 'cz.greencode.watchtower.ipad' },
  { token: 'ios-tok', topic: 'cz.greencode.watchtower.ios' },
]);
```

Keep the existing pruning test but update its `listTokens` to return `[{ token: 'bad', bundleId: '…ipad' }]` and its `sendApns` fake signature to `(cfg, token, msg, topic)`.

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/orchestrator/hubSender.test.ts`
Expected: FAIL (sendApns called without topic; tokens are objects now).

- [ ] **Step 3: Update `hubSender.ts`** — the send loop:

```ts
const devices = await deps.listTokens();
for (const { token, bundleId } of devices) {
  const res = await deps.sendApns(cfg, token, { title, body, data: { instanceId, kind } }, bundleId);
  if (res.status === 410 || res.reason === 'BadDeviceToken' || res.reason === 'Unregistered') {
    deps.removeToken(token);
  }
}
```

Update the `HubSenderDeps` type: `listTokens: () => Promise<{ token: string; bundleId: string }[]> | { token: string; bundleId: string }[]` and `sendApns: (cfg: HubConfig, token: string, msg: {...}, topic: string) => Promise<{ ok: boolean; status: number; reason?: string }>`.

- [ ] **Step 4: Update `index.ts` wiring** — at ~L1612-1620:

```ts
listTokens: async () => {
  const sqlite = new PushDevicesRepo(handle.db).listTokens();           // {token,bundleId}[]
  const pg = await readPgPushTokens(handle.pg);                         // {token,bundleId}[]
  const seen = new Set<string>();
  const merged: { token: string; bundleId: string }[] = [];
  for (const d of [...sqlite, ...pg]) {
    if (seen.has(d.token)) continue;
    seen.add(d.token);
    merged.push(d);
  }
  return merged;
},
removeToken: (token: string) => new PushDevicesRepo(handle.db).remove(token),
sendApns: (cfg, token, msg, topic) => sendApns(cfg, token, msg, topic),
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `npx vitest run tests/orchestrator/hubSender.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc -p orchestrator/tsconfig.json --noEmit
git add orchestrator/hubSender.ts orchestrator/index.ts tests/orchestrator/hubSender.test.ts
git commit -m "feat(orch): route APNs per-device topic through hubSender

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `push:registerDevice` IPC carries `bundleId` (iPad sends ipad id)

**Files:**
- Modify: `packages/shared/src/ipcContract.ts:84` (the `push:registerDevice` request payload)
- Modify: `orchestrator/index.ts:1311-1313` (the handler)
- Modify: `apps/ipad/src/state/pushRegistration.ts` + `apps/ipad/src/App.tsx:381-388`
- Test: `tests/orchestrator/*` — add a focused handler test if a harness exists, else assert via a small unit around the payload default.

**Interfaces:**
- Consumes: `PushDevicesRepo.register(token, platform, now, bundleId?)` (Task 1).
- Produces: IPC `push:registerDevice` payload `{ token: string; platform: string; bundleId?: string }`.

- [ ] **Step 1: Write a failing test** — add to `tests/orchestrator/pushDevices.test.ts` a test proving the handler default. If the orchestrator exposes a testable `handleRegisterDevice`, use it; otherwise test the intended behavior directly against the repo with an undefined bundleId funnelled through a tiny helper mirroring the handler:

```ts
test('registerDevice handler defaults bundleId to ipad when omitted', () => {
  const repo = new PushDevicesRepo(freshDb() as never);
  const payload: { token: string; platform: string; bundleId?: string } = { token: 't', platform: 'ios' };
  repo.register(payload.token, payload.platform, 1000, payload.bundleId); // undefined -> default
  expect(repo.listTokens()).toEqual([{ token: 't', bundleId: 'cz.greencode.watchtower.ipad' }]);
});
```

- [ ] **Step 2: Run test, verify it fails or passes-by-default**

Run: `npx vitest run tests/orchestrator/pushDevices.test.ts`
Expected: PASS already if Task 1's default holds (this test locks the contract). If you added a real handler indirection, make it fail first, then implement.

- [ ] **Step 3: Extend the IPC contract** — `packages/shared/src/ipcContract.ts`:

```ts
{ kind: 'push:registerDevice'; payload: { token: string; platform: string; bundleId?: string } }
```

- [ ] **Step 4: Update the handler** — `orchestrator/index.ts:1311-1313`:

```ts
new PushDevicesRepo(handle.db).register(
  req.payload.token, req.payload.platform, Date.now(), req.payload.bundleId,
);
```

- [ ] **Step 5: iPad sends its bundle id** — in `apps/ipad/src/App.tsx:381-388`, change the `sendToken` to include the bundle id:

```ts
sendToken: (t) => bridge.invoke('push:registerDevice', {
  token: t, platform: 'ios', bundleId: 'cz.greencode.watchtower.ipad',
}),
```

If `apps/ipad/src/state/pushRegistration.ts` types the `sendToken` payload, widen it to accept `bundleId`.

- [ ] **Step 6: Full suite + typecheck + commit**

```bash
npm test
npx tsc -p orchestrator/tsconfig.json --noEmit
npx tsc -p client/tsconfig.json --noEmit || true   # pre-existing drift tolerated; no NEW errors in touched files
git add packages/shared/src/ipcContract.ts orchestrator/index.ts apps/ipad/src/state/pushRegistration.ts apps/ipad/src/App.tsx tests/orchestrator/pushDevices.test.ts
git commit -m "feat(ipc): push:registerDevice carries bundleId (iPad sends ipad id)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

**Milestone 1 gate:** `npm test` green; the backend can now push to either bundle id per registered device.

---

## MILESTONE 2 — iOS push registration (Swift)

### Task 6: `PushRegistrar` dependency

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerCore/Dependencies/PushRegistrar.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/PushRegistrarTests.swift`

**Interfaces:**
- Produces: `PushRegistrar` `@DependencyClient` with `register: @Sendable (_ apnsToken: String) async throws -> Void`; `DependencyValues.pushRegistrar`. An `Encodable` `PushDeviceUpsert(apnsToken:platform:bundleId:)` with `CodingKeys` → `apns_token`/`platform`/`bundle_id`.

- [ ] **Step 1: Write a failing test** — `PushRegistrarTests.swift`. Because `liveValue` hits the network, the unit test verifies the **payload encoding** and that `testValue` is unimplemented; the reducer/AppDelegate tests (Task 7) exercise the closure via override.

```swift
import XCTest
@testable import WatchtowerCore

final class PushRegistrarTests: XCTestCase {
    func testUpsertPayloadEncodesSnakeCaseWithIosBundleId() throws {
        let payload = PushDeviceUpsert(
            apnsToken: "abc123", platform: "ios", bundleId: "cz.greencode.watchtower.ios")
        let data = try JSONEncoder().encode(payload)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: String])
        XCTAssertEqual(json["apns_token"], "abc123")
        XCTAssertEqual(json["platform"], "ios")
        XCTAssertEqual(json["bundle_id"], "cz.greencode.watchtower.ios")
    }
}
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd swift/WatchtowerCore && swift test --filter PushRegistrarTests`
Expected: FAIL (`PushDeviceUpsert` undefined).

- [ ] **Step 3: Implement** — `PushRegistrar.swift`, following the `BillingWriteClient` lazy `LockIsolated` Supabase seam and `BillingCache`'s `@DependencyClient` shape:

```swift
import Dependencies
import DependenciesMacros
import Foundation
import Supabase

public struct PushDeviceUpsert: Encodable, Sendable, Equatable {
    public let apnsToken: String
    public let platform: String
    public let bundleId: String
    enum CodingKeys: String, CodingKey {
        case apnsToken = "apns_token"
        case platform
        case bundleId = "bundle_id"
    }
    public init(apnsToken: String, platform: String, bundleId: String) {
        self.apnsToken = apnsToken; self.platform = platform; self.bundleId = bundleId
    }
}

@DependencyClient
public struct PushRegistrar: Sendable {
    public var register: @Sendable (_ apnsToken: String) async throws -> Void
}

extension PushRegistrar: DependencyKey {
    public static var liveValue: PushRegistrar {
        // Reuse the same lazy client builder pattern as BillingWriteClient.
        let box = LockIsolated<Supabase.SupabaseClient?>(nil)
        func client() throws -> Supabase.SupabaseClient { /* build from SupabaseConfig.load(...) as in BillingWriteClient */ }
        return PushRegistrar(register: { token in
            let db = try client()
            try await db.from("push_devices")
                .upsert(
                    PushDeviceUpsert(apnsToken: token, platform: "ios", bundleId: "cz.greencode.watchtower.ios"),
                    onConflict: "apns_token")
                .execute()
        })
    }
    public static let testValue = PushRegistrar()
}

public extension DependencyValues {
    var pushRegistrar: PushRegistrar {
        get { self[PushRegistrar.self] }
        set { self[PushRegistrar.self] = newValue }
    }
}
```

(Copy the exact `client()`/`LockIsolated`/`SupabaseConfig.load` construction from `BillingWriteClient.swift` so the seam matches — do not invent a new one.)

- [ ] **Step 4: Run test, verify it passes**

Run: `cd swift/WatchtowerCore && swift test --filter PushRegistrarTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add swift/WatchtowerCore/Sources/WatchtowerCore/Dependencies/PushRegistrar.swift swift/WatchtowerCore/Tests/WatchtowerCoreTests/PushRegistrarTests.swift
git commit -m "feat(iphone-native): PushRegistrar dependency (push_devices upsert)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: `AppDelegate` APNs registration

**Files:**
- Modify: `apps/iphone-native/Watchtower/AppDelegate.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/PushTokenFormatTests.swift` (pure token-hex helper lives in WatchtowerCore so it's unit-testable)
- Create: `swift/WatchtowerCore/Sources/WatchtowerCore/Dependencies/PushTokenFormat.swift`

**Interfaces:**
- Consumes: `PushRegistrar` (Task 6).
- Produces: `hexEncode(_ data: Data) -> String` (lowercase hex) in WatchtowerCore.

Rationale: `AppDelegate` lives in the app target (not unit-tested by `swift test`); keep it thin and delegate the only logic (token → hex → `PushRegistrar.register`) to a testable helper + the injected client.

- [ ] **Step 1: Write a failing test** — `PushTokenFormatTests.swift`:

```swift
import XCTest
@testable import WatchtowerCore

final class PushTokenFormatTests: XCTestCase {
    func testHexEncodeLowercase() {
        let data = Data([0x00, 0x0f, 0xab, 0xff])
        XCTAssertEqual(hexEncode(data), "000fabff")
    }
}
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd swift/WatchtowerCore && swift test --filter PushTokenFormatTests`
Expected: FAIL (`hexEncode` undefined).

- [ ] **Step 3: Implement the helper** — `PushTokenFormat.swift`:

```swift
import Foundation
public func hexEncode(_ data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd swift/WatchtowerCore && swift test --filter PushTokenFormatTests`
Expected: PASS.

- [ ] **Step 5: Wire `AppDelegate`** — `apps/iphone-native/Watchtower/AppDelegate.swift`:

```swift
import UIKit
import UserNotifications
import Dependencies
import WatchtowerCore

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async { application.registerForRemoteNotifications() }
        }
        return true
    }

    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = hexEncode(deviceToken)
        @Dependency(\.pushRegistrar) var pushRegistrar
        Task { try? await pushRegistrar.register(token) }
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // Non-fatal, silent (parent design §10). No entitlement in 6a → expected to fail here.
    }
}
```

- [ ] **Step 6: Build the app** (verifies AppDelegate compiles against the app target):

```bash
cd apps/iphone-native && xcodegen generate
xcodebuild -project Watchtower.xcodeproj -scheme Watchtower \
  -destination 'platform=iOS Simulator,name=iPhone 16e' \
  -skipMacroValidation -skipPackagePluginValidation build
```
Expected: BUILD SUCCEEDED.

- [ ] **Step 7: Commit**

```bash
git add swift/WatchtowerCore/Sources/WatchtowerCore/Dependencies/PushTokenFormat.swift swift/WatchtowerCore/Tests/WatchtowerCoreTests/PushTokenFormatTests.swift apps/iphone-native/Watchtower/AppDelegate.swift
git commit -m "feat(iphone-native): AppDelegate APNs registration (no entitlement)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

**Milestone 2 gate:** package tests green; app BUILD SUCCEEDED. Registration is a silent no-op until the 6b entitlement lands.

---

## MILESTONE 3 — iOS Attention models + client

### Task 8: Attention models + grouping (verbatim port)

**Files:**
- Modify: `swift/WatchtowerCore/Sources/WatchtowerCore/Billing/BillingModels.swift` (add models)
- Create: `swift/WatchtowerCore/Sources/WatchtowerCore/Billing/AttentionMapping.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/AttentionMappingTests.swift`

**Port source:** `packages/data-supabase/src/attentionCache.ts` — `AttentionMessage`/`AttentionThread` types (L1-11), `mapAttentionRow` (L13-21), `groupThreads` (L23-39). The TDD vectors below are the contract; if a vector fails, fix the Swift port against the TS source — never edit the vector.

**Interfaces:**
- Produces: `AttentionMessage`, `AttentionThread` (Equatable, Codable, Sendable); `AttentionMessageDTO: Decodable`; `mapAttentionRow(_ dto: AttentionMessageDTO) -> AttentionMessage`; `groupThreads(_ rows: [AttentionMessage]) -> [AttentionThread]`.

- [ ] **Step 1: Write failing tests** — `AttentionMappingTests.swift`, mirroring the `groupThreads` semantics (group by instanceId; sort by createdAt; `unanswered` = last claude msg has no user reply referencing its syncId, and not closed):

```swift
import XCTest
@testable import WatchtowerCore

final class AttentionMappingTests: XCTestCase {
    private func msg(_ syncId: String, _ inst: String, _ role: String,
                     replyTo: String? = nil, createdAt: String, closedAt: String? = nil) -> AttentionMessage {
        AttentionMessage(syncId: syncId, instanceId: inst, projectLabel: inst, role: role,
                         kind: nil, body: "b", options: nil, replyTo: replyTo,
                         injectedAt: nil, closedAt: closedAt, createdAt: createdAt)
    }

    func testGroupsByInstanceAndSortsByCreatedAt() {
        let threads = groupThreads([
            msg("b", "i1", "claude", createdAt: "2026-07-14T10:01:00Z"),
            msg("a", "i1", "claude", createdAt: "2026-07-14T10:00:00Z"),
        ])
        XCTAssertEqual(threads.count, 1)
        XCTAssertEqual(threads[0].instanceId, "i1")
        XCTAssertEqual(threads[0].messages.map(\.syncId), ["a", "b"])
    }

    func testUnansweredWhenLastClaudeHasNoMatchingUserReply() {
        let t = groupThreads([msg("c1", "i1", "claude", createdAt: "2026-07-14T10:00:00Z")])
        XCTAssertTrue(t[0].unanswered)
    }

    func testAnsweredWhenUserReplyReferencesClaudeSyncId() {
        let t = groupThreads([
            msg("c1", "i1", "claude", createdAt: "2026-07-14T10:00:00Z"),
            msg("u1", "i1", "user", replyTo: "c1", createdAt: "2026-07-14T10:01:00Z"),
        ])
        XCTAssertFalse(t[0].unanswered)
    }

    func testClosedThreadIsNotUnanswered() {
        let t = groupThreads([
            msg("c1", "i1", "claude", createdAt: "2026-07-14T10:00:00Z", closedAt: "2026-07-14T11:00:00Z"),
        ])
        XCTAssertFalse(t[0].unanswered)
        XCTAssertTrue(t[0].closed)
    }
}
```

(Read `attentionCache.ts` and add any additional vectors its `groupThreads` implies — e.g. `options` JSON parsing in `mapAttentionRow`, multiple claude messages where only the latest counts.)

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd swift/WatchtowerCore && swift test --filter AttentionMappingTests`
Expected: FAIL (types + functions undefined).

- [ ] **Step 3: Implement models** — append to `BillingModels.swift`:

```swift
public struct AttentionMessage: Equatable, Codable, Sendable {
    public let syncId: String
    public let instanceId: String
    public let projectLabel: String?
    public let role: String          // "claude" | "user"
    public let kind: String?
    public let body: String?
    public let options: [String]?    // parsed from options JSONB; adjust type to match TS
    public let replyTo: String?
    public let injectedAt: String?
    public let closedAt: String?
    public let createdAt: String
    public init(syncId: String, instanceId: String, projectLabel: String?, role: String,
                kind: String?, body: String?, options: [String]?, replyTo: String?,
                injectedAt: String?, closedAt: String?, createdAt: String) { /* assign all */ }
}

public struct AttentionThread: Equatable, Codable, Sendable {
    public let instanceId: String
    public let projectLabel: String?
    public let messages: [AttentionMessage]
    public let unanswered: Bool
    public let closed: Bool
    public init(instanceId: String, projectLabel: String?, messages: [AttentionMessage],
                unanswered: Bool, closed: Bool) { /* assign all */ }
}
```

(Match the exact `options` shape used by `attentionCache.ts`/`useAttentionReply.ts`; if options carry `{label,value}`, model it as a small `Codable` struct instead of `[String]`.)

- [ ] **Step 4: Implement DTO + mapping + grouping** — `AttentionMapping.swift`:

```swift
import Foundation

struct AttentionMessageDTO: Decodable {
    let syncId: String
    let instanceId: String
    let projectLabel: String?
    let role: String
    let kind: String?
    let body: String?
    let options: [String]?
    let replyTo: String?
    let injectedAt: String?
    let closedAt: String?
    let createdAt: String
    enum CodingKeys: String, CodingKey {
        case syncId = "sync_id"; case instanceId = "instance_id"
        case projectLabel = "project_label"; case role; case kind; case body
        case options; case replyTo = "reply_to"; case injectedAt = "injected_at"
        case closedAt = "closed_at"; case createdAt = "created_at"
    }
}

func mapAttentionRow(_ dto: AttentionMessageDTO) -> AttentionMessage {
    AttentionMessage(syncId: dto.syncId, instanceId: dto.instanceId, projectLabel: dto.projectLabel,
        role: dto.role, kind: dto.kind, body: dto.body, options: dto.options, replyTo: dto.replyTo,
        injectedAt: dto.injectedAt, closedAt: dto.closedAt, createdAt: dto.createdAt)
}

func groupThreads(_ rows: [AttentionMessage]) -> [AttentionThread] {
    // Port of attentionCache.ts:groupThreads — group by instanceId, sort by createdAt,
    // unanswered = latest 'claude' msg has no 'user' msg whose replyTo == its syncId AND not closed.
    // (Implement to satisfy the vectors above.)
}
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `cd swift/WatchtowerCore && swift test --filter AttentionMappingTests`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add swift/WatchtowerCore/Sources/WatchtowerCore/Billing/BillingModels.swift swift/WatchtowerCore/Sources/WatchtowerCore/Billing/AttentionMapping.swift swift/WatchtowerCore/Tests/WatchtowerCoreTests/AttentionMappingTests.swift
git commit -m "feat(iphone-native): attention models + groupThreads port

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: `AttentionClient` dependency

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerCore/Dependencies/AttentionClient.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/AttentionClientTests.swift`

**Interfaces:**
- Consumes: `AttentionMessage`, `AttentionMessageDTO`, `mapAttentionRow` (Task 8).
- Produces: `AttentionClient` `@DependencyClient` — `listThreads: @Sendable () async throws -> [AttentionMessage]`; `reply: @Sendable (_ instanceId, _ replyTo, _ body, _ syncId, _ createdAt: String) async throws -> Void`; `DependencyValues.attentionClient`; `AttentionReplyInsert` (`Encodable`, snake_case, `role: "user"`).

- [ ] **Step 1: Write a failing test** — verify the reply payload encoding (live network isn't unit-tested; reducer overrides the closures):

```swift
import XCTest
@testable import WatchtowerCore

final class AttentionClientTests: XCTestCase {
    func testReplyInsertEncodesUserRoleSnakeCase() throws {
        let p = AttentionReplyInsert(syncId: "u1", instanceId: "i1", replyTo: "c1",
                                     body: "hi", createdAt: "2026-07-14T10:00:00Z")
        let json = try XCTUnwrap(JSONSerialization.jsonObject(
            with: JSONEncoder().encode(p)) as? [String: String])
        XCTAssertEqual(json["role"], "user")
        XCTAssertEqual(json["sync_id"], "u1")
        XCTAssertEqual(json["instance_id"], "i1")
        XCTAssertEqual(json["reply_to"], "c1")
        XCTAssertEqual(json["body"], "hi")
        XCTAssertEqual(json["created_at"], "2026-07-14T10:00:00Z")
    }
}
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd swift/WatchtowerCore && swift test --filter AttentionClientTests`
Expected: FAIL (`AttentionReplyInsert` undefined).

- [ ] **Step 3: Implement** — `AttentionClient.swift` (reads follow `BillingClient`, writes follow `BillingWriteClient`; reuse the same lazy `client()` seam):

```swift
import Dependencies
import DependenciesMacros
import Foundation
import Supabase

struct AttentionReplyInsert: Encodable, Sendable, Equatable {
    let syncId: String; let instanceId: String; let replyTo: String
    let body: String; let createdAt: String
    let role = "user"
    enum CodingKeys: String, CodingKey {
        case syncId = "sync_id"; case instanceId = "instance_id"; case replyTo = "reply_to"
        case body; case createdAt = "created_at"; case role
    }
}

@DependencyClient
public struct AttentionClient: Sendable {
    public var listThreads: @Sendable () async throws -> [AttentionMessage]
    public var reply: @Sendable (_ instanceId: String, _ replyTo: String, _ body: String,
                                 _ syncId: String, _ createdAt: String) async throws -> Void
}

extension AttentionClient: DependencyKey {
    public static var liveValue: AttentionClient {
        // let client() = same lazy LockIsolated seam as BillingClient
        AttentionClient(
            listThreads: {
                let db = try client()
                let dtos: [AttentionMessageDTO] = try await db.from("attention_messages")
                    .select("*").order("created_at").execute().value
                return dtos.map(mapAttentionRow)
            },
            reply: { instanceId, replyTo, body, syncId, createdAt in
                let db = try client()
                try await db.from("attention_messages")
                    .insert(AttentionReplyInsert(syncId: syncId, instanceId: instanceId,
                        replyTo: replyTo, body: body, createdAt: createdAt))
                    .execute()
            })
    }
    public static let testValue = AttentionClient()
}

public extension DependencyValues {
    var attentionClient: AttentionClient {
        get { self[AttentionClient.self] }
        set { self[AttentionClient.self] = newValue }
    }
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd swift/WatchtowerCore && swift test --filter AttentionClientTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add swift/WatchtowerCore/Sources/WatchtowerCore/Dependencies/AttentionClient.swift swift/WatchtowerCore/Tests/WatchtowerCoreTests/AttentionClientTests.swift
git commit -m "feat(iphone-native): AttentionClient dependency (list + reply)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## MILESTONE 4 — iOS AttentionFeature + UI

### Task 10: `AttentionFeature` — load, group, poll, error

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerCore/Features/AttentionFeature.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/AttentionFeatureTests.swift`

**Interfaces:**
- Consumes: `AttentionClient` (Task 9), `groupThreads` (Task 8), `@Dependency(\.continuousClock)`.
- Produces: `AttentionFeature` reducer with `State { threads: [AttentionThread]; isLoading: Bool; errorMessage: String?; var unansweredCount: Int { threads.filter(\.unanswered).count } }` and actions `onAppear`, `refresh`, `threadsLoaded(Result<[AttentionMessage], Error>)`.

- [ ] **Step 1: Write failing tests** — `AttentionFeatureTests.swift`, using the `WorklogFormFeatureTests` `TestStore` + `withDependencies` closure-override pattern:

```swift
import XCTest
import ComposableArchitecture
@testable import WatchtowerCore

@MainActor
final class AttentionFeatureTests: XCTestCase {
    func testOnAppearLoadsAndGroupsThreads() async {
        let rows = [
            AttentionMessage(syncId: "c1", instanceId: "i1", projectLabel: "proj", role: "claude",
                kind: nil, body: "need input", options: nil, replyTo: nil,
                injectedAt: nil, closedAt: nil, createdAt: "2026-07-14T10:00:00Z"),
        ]
        let store = TestStore(initialState: AttentionFeature.State()) { AttentionFeature() }
            withDependencies: {
                $0.attentionClient.listThreads = { rows }
                $0.continuousClock = ImmediateClock()
            }
        await store.send(.onAppear) { $0.isLoading = true }
        await store.receive(\.threadsLoaded.success) {
            $0.isLoading = false
            $0.threads = groupThreads(rows)
            XCTAssertEqual($0.unansweredCount, 1)
        }
    }

    func testLoadFailureSurfacesErrorAndKeepsThreads() async {
        struct Boom: Error {}
        let store = TestStore(initialState: AttentionFeature.State()) { AttentionFeature() }
            withDependencies: {
                $0.attentionClient.listThreads = { throw Boom() }
                $0.continuousClock = ImmediateClock()
            }
        await store.send(.onAppear) { $0.isLoading = true }
        await store.receive(\.threadsLoaded.failure) {
            $0.isLoading = false
            $0.errorMessage = "Couldn't load messages."
        }
    }
}
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd swift/WatchtowerCore && swift test --filter AttentionFeatureTests`
Expected: FAIL (`AttentionFeature` undefined).

- [ ] **Step 3: Implement** — `AttentionFeature.swift` (load + error only in this task; reply added in Task 11):

```swift
import ComposableArchitecture
import Foundation

@Reducer
public struct AttentionFeature: Sendable {
    @ObservableState
    public struct State: Equatable {
        public var threads: [AttentionThread] = []
        public var isLoading = false
        public var errorMessage: String?
        public var unansweredCount: Int { threads.filter(\.unanswered).count }
        public init() {}
    }
    public enum Action: Equatable {
        case onAppear
        case refresh
        case threadsLoaded(Result<[AttentionMessage], AttentionError>)
    }
    public enum AttentionError: Error, Equatable { case loadFailed }

    @Dependency(\.attentionClient) var attentionClient
    public init() {}

    public var body: some ReducerOf<Self> {
        Reduce { state, action in
            switch action {
            case .onAppear, .refresh:
                state.isLoading = true
                return .run { send in
                    do { await send(.threadsLoaded(.success(try await attentionClient.listThreads()))) }
                    catch { await send(.threadsLoaded(.failure(.loadFailed))) }
                }
            case let .threadsLoaded(.success(rows)):
                state.isLoading = false
                state.errorMessage = nil
                state.threads = groupThreads(rows)
                return .none
            case .threadsLoaded(.failure):
                state.isLoading = false
                state.errorMessage = "Couldn't load messages."
                return .none
            }
        }
    }
}
```

(If the repo's other reducers wrap raw `Error` differently, follow that; the tests key on `.threadsLoaded.success`/`.failure` case paths.)

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd swift/WatchtowerCore && swift test --filter AttentionFeatureTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add swift/WatchtowerCore/Sources/WatchtowerCore/Features/AttentionFeature.swift swift/WatchtowerCore/Tests/WatchtowerCoreTests/AttentionFeatureTests.swift
git commit -m "feat(iphone-native): AttentionFeature load + error surface

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: `AttentionFeature` — reply (optimistic + rollback)

**Files:**
- Modify: `swift/WatchtowerCore/Sources/WatchtowerCore/Features/AttentionFeature.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/AttentionFeatureTests.swift`

**Interfaces:**
- Consumes: `AttentionClient.reply`, `@Dependency(\.uuid)`, `@Dependency(\.date.now)`.
- Produces: actions `replyDraftChanged(instanceId:String, text:String)`, `sendReply(instanceId:String, replyTo:String)`, `replyFinished(Result<Void, AttentionError>)`; State gains `replyDrafts: [String: String]`, `isSending: Bool`.

- [ ] **Step 1: Write failing tests** — add reply success + rollback:

```swift
func testSendReplySuccess() async {
    let captured = LockIsolated<[String]>([])
    var initial = AttentionFeature.State()
    initial.threads = groupThreads([AttentionMessage(syncId: "c1", instanceId: "i1", projectLabel: "p",
        role: "claude", kind: nil, body: "q", options: nil, replyTo: nil,
        injectedAt: nil, closedAt: nil, createdAt: "2026-07-14T10:00:00Z")])
    initial.replyDrafts["i1"] = "my answer"
    let store = TestStore(initialState: initial) { AttentionFeature() } withDependencies: {
        $0.uuid = .incrementing
        $0.date.now = Date(timeIntervalSince1970: 1_780_000_000)
        $0.attentionClient.reply = { _, _, body, _, _ in captured.withValue { $0.append(body) } }
    }
    await store.send(.sendReply(instanceId: "i1", replyTo: "c1")) {
        $0.isSending = true
        $0.replyDrafts["i1"] = ""
    }
    await store.receive(\.replyFinished.success) { $0.isSending = false }
    XCTAssertEqual(captured.value, ["my answer"])
}

func testSendReplyFailureRollsBackDraft() async {
    struct Boom: Error {}
    var initial = AttentionFeature.State()
    initial.replyDrafts["i1"] = "my answer"
    let store = TestStore(initialState: initial) { AttentionFeature() } withDependencies: {
        $0.uuid = .incrementing
        $0.date.now = Date(timeIntervalSince1970: 1_780_000_000)
        $0.attentionClient.reply = { _, _, _, _, _ in throw Boom() }
    }
    await store.send(.sendReply(instanceId: "i1", replyTo: "c1")) {
        $0.isSending = true
        $0.replyDrafts["i1"] = ""
    }
    await store.receive(\.replyFinished.failure) {
        $0.isSending = false
        $0.replyDrafts["i1"] = "my answer"   // rolled back
        $0.errorMessage = "Couldn't send reply."
    }
}
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd swift/WatchtowerCore && swift test --filter AttentionFeatureTests`
Expected: FAIL (new actions/state undefined).

- [ ] **Step 3: Implement** — add to `State`: `public var replyDrafts: [String: String] = [:]`, `public var isSending = false`. Add to `Action`: the three cases. Add dependencies `@Dependency(\.uuid) var uuid`, `@Dependency(\.date.now) var now`. Add cases:

```swift
case let .replyDraftChanged(instanceId, text):
    state.replyDrafts[instanceId] = text
    return .none

case let .sendReply(instanceId, replyTo):
    let text = state.replyDrafts[instanceId] ?? ""
    guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return .none }
    let previousDraft = text
    state.isSending = true
    state.replyDrafts[instanceId] = ""          // optimistic clear
    let syncId = uuid().uuidString
    let createdAt = ISO8601DateFormatter().string(from: now)
    return .run { send in
        do {
            try await attentionClient.reply(instanceId, replyTo, text, syncId, createdAt)
            await send(.replyFinished(.success(())))
        } catch {
            await send(.replyFinished(.failure(.replyFailed(instanceId: instanceId, draft: previousDraft))))
        }
    }

case .replyFinished(.success):
    state.isSending = false
    return .none

case let .replyFinished(.failure(err)):
    state.isSending = false
    if case let .replyFailed(instanceId, draft) = err { state.replyDrafts[instanceId] = draft }
    state.errorMessage = "Couldn't send reply."
    return .none
```

Extend `AttentionError` to `case loadFailed` + `case replyFailed(instanceId: String, draft: String)`. (Adjust the `.success`/`.failure` case-path key names if the reducer wraps results differently; tests key on `\.replyFinished.success`/`.failure`.)

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd swift/WatchtowerCore && swift test --filter AttentionFeatureTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add swift/WatchtowerCore/Sources/WatchtowerCore/Features/AttentionFeature.swift swift/WatchtowerCore/Tests/WatchtowerCoreTests/AttentionFeatureTests.swift
git commit -m "feat(iphone-native): AttentionFeature reply (optimistic + rollback)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: `AttentionView` + bell/badge in the shell

**Files:**
- Create: `apps/iphone-native/Watchtower/Views/AttentionView.swift`
- Modify: `apps/iphone-native/Watchtower/Views/AppShellView.swift`
- Modify: `swift/WatchtowerCore/Sources/WatchtowerCore/Features/AppFeature.swift` (embed AttentionFeature)
- Test: `swift/WatchtowerCore/Tests/WatchtowerCoreTests/AppFeatureTests.swift` (extend if present) — assert the attention scope wiring compiles + a presented action routes.

**Interfaces:**
- Consumes: `AttentionFeature` (Tasks 10-11).
- Produces: `AppFeature.State.attention: AttentionFeature.State` (via `Scope`) and a `@Presents var attentionSheet` (or a bool + scoped store) driving the drawer; `AppFeature.Action.attention(AttentionFeature.Action)`.

- [ ] **Step 1: Write a failing reducer test** — in `AppFeatureTests.swift`, assert an attention action routes through the parent scope (follow how Phase 5 wired `ProjectDetailFeature`/editor scopes into `AppFeature`):

```swift
func testAttentionScopeRoutesOnAppear() async {
    let store = TestStore(initialState: AppFeature.State()) { AppFeature() } withDependencies: {
        $0.attentionClient.listThreads = { [] }
        $0.continuousClock = ImmediateClock()
    }
    await store.send(.attention(.onAppear)) { $0.attention.isLoading = true }
    await store.receive(\.attention.threadsLoaded.success) { $0.attention.isLoading = false }
}
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd swift/WatchtowerCore && swift test --filter AppFeatureTests`
Expected: FAIL (no `attention` case/state on AppFeature).

- [ ] **Step 3: Embed in `AppFeature`** — add `public var attention = AttentionFeature.State()` to the signed-in state, `case attention(AttentionFeature.Action)` to `Action`, and `Scope(state: \.attention, action: \.attention) { AttentionFeature() }` to the body (mirror the exact scoping style Phase 5 used for its child features).

- [ ] **Step 4: Run test, verify it passes**

Run: `cd swift/WatchtowerCore && swift test --filter AppFeatureTests`
Expected: PASS.

- [ ] **Step 5: Build the view + shell wiring** — `AttentionView.swift`: a `List` of `state.threads` (project label + latest body), each row with a `TextField` bound via `.replyDraftChanged` and a send button firing `.sendReply(instanceId:replyTo:)`; an inline error banner when `errorMessage != nil`; pull-to-refresh → `.refresh`. In `AppShellView.swift`, add a toolbar bell button showing `unansweredCount` as a badge that presents `AttentionView` as a `.sheet`. Reuse existing `GlassCard`/`SectionHeader` from `Views/Components.swift`. Then:

```bash
cd apps/iphone-native && xcodegen generate
xcodebuild -project Watchtower.xcodeproj -scheme Watchtower \
  -destination 'platform=iOS Simulator,name=iPhone 16e' \
  -skipMacroValidation -skipPackagePluginValidation build
```
Expected: BUILD SUCCEEDED.

- [ ] **Step 6: Full package test run + commit**

```bash
cd swift/WatchtowerCore && swift test
git add apps/iphone-native/Watchtower/Views/AttentionView.swift apps/iphone-native/Watchtower/Views/AppShellView.swift swift/WatchtowerCore/Sources/WatchtowerCore/Features/AppFeature.swift swift/WatchtowerCore/Tests/WatchtowerCoreTests/AppFeatureTests.swift
git commit -m "feat(iphone-native): Attention bell + reply drawer in shell

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

**Milestone 4 gate:** `swift test` fully green; app BUILD SUCCEEDED; the Attention bell shows unanswered count and the drawer lists threads + sends replies.

---

## Final verification (before PR)

- [ ] `npm test` — full TS suite green (backend changes).
- [ ] `npx tsc -p orchestrator/tsconfig.json --noEmit` — clean.
- [ ] `cd swift/WatchtowerCore && swift test` — full package suite green.
- [ ] `cd apps/iphone-native && xcodegen generate && xcodebuild … -skipMacroValidation -skipPackagePluginValidation build` — BUILD SUCCEEDED.
- [ ] Whole-branch review (subagent-driven-development final review, Opus) — focus on: the SQLite/PG migration pair being additive+idempotent, the token-union dedup carrying the right bundleId, and the reply rollback correctness.
- [ ] Open one PR from `feat/native-iphone-phase6` → `main`. PR body notes the deferred 6b entitlement step and that live APNs delivery is unverifiable until then.

## Self-review notes (coverage vs spec)

- Spec §3.1 (bundle_id both stores) → Tasks 1, 2. §3.2 (topic threading) → Tasks 3, 4. §3.3 (IPC bundleId) → Task 5.
- Spec §4.1 (PushRegistrar) → Task 6. §4.2 (AppDelegate) → Task 7.
- Spec §5.1 (models+grouping) → Task 8. §5.2 (AttentionClient) → Task 9. §5.3 (reducer: load/poll/reply) → Tasks 10, 11. §5.4 (bell+drawer) → Task 12.
- Spec §6 testing → per-task tests + final verification. §7 error handling → Tasks 10 (load) + 11 (reply rollback) + 7 (silent push).
- **Poll (5s):** Task 10 implements load/refresh; the 5s `continuousClock` poll-while-open loop should be added in Task 10's `.run` (kick off a timer effect cancelled on drawer dismiss) or Task 12's sheet lifecycle. Implementer: wire the poll to the sheet's presented lifecycle so it doesn't run while closed. Tests use `ImmediateClock`; add a poll-tick test if you implement it as a self-rescheduling effect.
