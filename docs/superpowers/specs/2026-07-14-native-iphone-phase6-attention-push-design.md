# Native iPhone Phase 6a — Attention + Push (full path, no entitlement) — Design

**Date:** 2026-07-14
**Status:** Approved (design) — pending spec review before planning
**Topic:** Phase 6 of the native SwiftUI iPhone rewrite — the complete APNs push
pipeline plus the poll-based Attention feature, delivered as **6a: everything
except the Apple Developer entitlement/provisioning**, which stays deferred.

Parent design: `docs/superpowers/specs/2026-07-11-native-iphone-swiftui-rewrite-design.md`
(§7 feature-parity map rows *AttentionFeature* and *PushRegistrar*; §12 phase 6).

---

## 1. Goal & scope

Wire the full push path for the native iPhone app (bundle id
`cz.greencode.watchtower.ios`) and ship the Attention feature:

- **Backend (TypeScript):** make APNs multi-topic so a push can target the
  native iOS bundle id, not only the iPad's.
- **iOS (Swift):** a `PushRegistrar` dependency + `AppDelegate` APNs
  registration, and an `AttentionFeature` (poll-based threads + reply) wired
  into the app shell.

**Explicitly out of scope (the "no entitlement" boundary):**

- The Apple Developer **entitlement / provisioning profile / `aps-environment`**
  key and the Push Notifications capability in `project.yml`. This requires the
  paid account step and is deferred (parent design §13). Without it, APNs
  registration fails silently on device and the simulator yields no real token —
  `PushRegistrar` is exercised by unit tests only until the entitlement lands.
- **Realtime** subscriptions (poll is parity with the current apps).
- Retiring the Capacitor `apps/iphone` app (that is Phase 7).

**Consequence of the boundary:** the multi-topic backend fix and `PushRegistrar`
are correct *plumbing* that lights up the moment the entitlement is added; the
**Attention feed is the live, user-facing deliverable** of 6a. This matches the
parent design's stated fallback (§13: "if unavailable, Phase 6 ships the
attention feed (poll-based) without push and push defers") — 6a additionally
lands the plumbing so 6b is a pure entitlement/provisioning step.

## 2. Problem statement (backend)

`orchestrator/services/apns.ts:45` hardcodes the push topic:

```ts
'apns-topic': HUB_BUNDLE_ID,   // = 'cz.greencode.watchtower.ipad'
```

`orchestrator/hubSender.ts` loads tokens via `deps.listTokens()` and sends to
each with a single `cfg`; `orchestrator/index.ts:1612-1618` builds that list as a
`Set<string>` **unioning** SQLite tokens (iPad, registered over the WS/IPC
bridge) with Postgres tokens (native iPhone, registered directly via Supabase).
Both registration paths write `platform: 'ios'`, so **platform cannot
disambiguate which app — and therefore which `apns-topic` — a token needs.** An
APNs push carrying the iPad topic to an iPhone-bundle token is rejected
(`TopicDisallowed` / not delivered).

There is **no `attention_threads` table** — attention is a single flat
`attention_messages` table (Postgres, PG migration v12); "threads" are derived
client-side by grouping messages on `instance_id`.

## 3. Backend design — multi-topic APNs

### 3.1 `bundle_id` column on `push_devices` (both stores)

A dedicated column (not an overload of `platform`) so existing `'ios'` rows are
not reinterpreted and the value is self-documenting. Default is the iPad bundle
id, so every pre-existing row keeps its current behavior with zero data
migration.

- **SQLite — migration v23** (current max is v22):
  ```ts
  addColumnIfMissing(db, 'push_devices', 'bundle_id',
    "TEXT NOT NULL DEFAULT 'cz.greencode.watchtower.ipad'")
  ```
  Uses the existing replay-safe `addColumnIfMissing` helper
  (`migrations.ts:30-35`). The default is a **constant literal** — required by
  the documented better-sqlite3 vs `node:sqlite` ADD-COLUMN divergence
  (incident: `sqlite-add-column-engine-divergence`).
- **Postgres — migration v13** (current max is v12):
  ```sql
  ALTER TABLE push_devices
    ADD COLUMN IF NOT EXISTS bundle_id TEXT NOT NULL
    DEFAULT 'cz.greencode.watchtower.ipad';
  ```
  Appended to `PG_MIGRATIONS` in `orchestrator/db/pg/schema.ts`; idempotent DDL
  per the existing pg-migration convention.

### 3.2 Thread the topic through the send path

- **`sendApns`** (`apns.ts`) gains a `topic` parameter defaulting to
  `HUB_BUNDLE_ID` (backward-compatible), used for the `'apns-topic'` header in
  place of the constant.
- **Token loaders return `{ token: string; bundleId: string }`** rather than
  bare strings:
  - `PushDevicesRepo.listTokens()` selects `apns_token, bundle_id`.
  - `readPgPushTokens()` selects `apns_token, bundle_id`.
  - `orchestrator/index.ts` `listTokens` unions both, **deduping on `token`**
    (first-seen wins) while carrying `bundleId`.
- **`hubSender.fire`** iterates `{token, bundleId}` and passes `bundleId` as the
  `topic` to `sendApns`. Token pruning on `status === 410` /
  `reason === 'BadDeviceToken'` / `reason === 'Unregistered'` is unchanged
  (still removes from SQLite only, as today).

### 3.3 Registration payload

- **`push:registerDevice` IPC** (`packages/shared/src/ipcContract.ts`) payload
  gains an optional `bundleId?: string`; the orchestrator handler
  (`index.ts:1311-1313`) passes it to `PushDevicesRepo.register(...)`, defaulting
  to the iPad bundle id when absent. The iPad's `registerForPush` sends
  `bundleId: 'cz.greencode.watchtower.ipad'`.
- The native iPhone does **not** use this IPC — it writes Supabase directly (see
  §4.1), setting `bundle_id: 'cz.greencode.watchtower.ios'`.

## 4. iOS design — push registration (no entitlement)

### 4.1 `PushRegistrar` dependency

A new `@DependencyClient` in `swift/WatchtowerCore/Sources/WatchtowerCore/Dependencies/`,
modeled on `BillingCache` (smallest existing client) and using the lazy
`LockIsolated` Supabase seam from `BillingWriteClient`:

```swift
@DependencyClient
public struct PushRegistrar: Sendable {
    public var register: @Sendable (_ apnsToken: String) async throws -> Void
}
```

`liveValue.register` upserts the device row:

```swift
try await db.from("push_devices")
   .upsert(PushDeviceUpsert(apnsToken: token,
                            platform: "ios",
                            bundleId: "cz.greencode.watchtower.ios"),
           onConflict: "apns_token")
   .execute()
```

`PushDeviceUpsert` is an `Encodable` with `CodingKeys` mapping to
`apns_token` / `platform` / `bundle_id` (per the `BillingWriteMapping` pattern).
`testValue = PushRegistrar()` (unimplemented). Registered via
`DependencyValues.pushRegistrar`.

### 4.2 `AppDelegate` APNs wiring

`apps/iphone-native/Watchtower/AppDelegate.swift` (currently an empty stub with a
Phase-6 TODO; `@UIApplicationDelegateAdaptor` is already wired in
`WatchtowerApp`) gains:

- On `didFinishLaunching`: request `UNUserNotificationCenter` authorization
  (`.alert`, `.badge`, `.sound`); on grant, `registerForRemoteNotifications()`
  on the main actor.
- `didRegisterForRemoteNotificationsWithDeviceToken`: hex-encode the token and
  hand it to `PushRegistrar` (resolved via `@Dependency`), fire-and-forget in a
  `Task`.
- `didFailToRegisterForRemoteNotificationsWithError`: log only — **non-fatal and
  silent** (parent design §10).

**No entitlement / `aps-environment` / capability is added** — that is the
deferred 6b step. On the simulator and on an unprovisioned device this path is a
no-op; its logic is verified by unit tests.

## 5. iOS design — Attention feature

Ports the behavior of the React hooks `useAttentionThreads` /
`useAttentionReply` and `attentionCache.ts` (grouping) into Swift, reading and
writing the flat `attention_messages` Supabase table directly.

### 5.1 Models & grouping

New Codable models alongside the existing domain structs in
`WatchtowerCore/Billing/BillingModels.swift` (there is no `Models/` dir despite
the parent design's layout sketch — `WorklogRow` et al. live in `Billing/`):

- `AttentionMessage` — `syncId, instanceId, projectLabel?, role ("claude"|"user"),
  kind?, body?, options?, replyTo?, injectedAt?, closedAt?, createdAt` (Strings /
  optional Strings; dates kept as opaque ISO strings per parent design §9).
- `AttentionThread` — `instanceId, projectLabel?, messages: [AttentionMessage],
  unanswered: Bool, closed: Bool`.
- An `AttentionMessageDTO` (`Decodable`, explicit snake_case `CodingKeys`,
  `options` decoded from JSON) + a `mapAttentionRow`/`groupThreads` port:
  - group by `instanceId`, sort messages by `createdAt`;
  - `unanswered` = the last `claude` message has no `user` message whose
    `replyTo` equals its `syncId`, **and** the thread is not closed.
  These are pure functions with TDD vectors mirrored from `attentionCache.ts`.

### 5.2 `AttentionClient` dependency

A new `@DependencyClient` (reads follow `BillingClient`, writes follow
`BillingWriteClient`):

```swift
@DependencyClient
public struct AttentionClient: Sendable {
    public var listThreads: @Sendable () async throws -> [AttentionMessage]
    public var reply: @Sendable (_ instanceId: String,
                                 _ replyTo: String,
                                 _ body: String,
                                 _ syncId: String,
                                 _ createdAt: String) async throws -> Void
}
```

- `listThreads` → `.from("attention_messages").select("*").order("created_at")`
  → `[AttentionMessageDTO]` → mapped rows. (RLS `attn_read` permits any
  authenticated read; single-user app, so no per-user filter — parity with the
  iPad.)
- `reply` → `.from("attention_messages").insert(AttentionReplyInsert(...))` with
  `role: "user"`, `sync_id`, `instance_id`, `reply_to`, `body`, `created_at`.
  (RLS `attn_write` permits `role='user'` inserts.)

`syncId`/`createdAt` are passed in (from `@Dependency(\.uuid)` /
`@Dependency(\.date.now)`) so the reducer stays deterministic under `TestStore`.

### 5.3 `AttentionFeature` reducer

Modeled on `WorklogFormFeature` (effectful reducer + error surfacing +
delegate):

- **State:** `threads: [AttentionThread]`, `isLoading`, `errorMessage?`,
  `replyDrafts: [instanceId: String]` (or a focused reply target),
  `isSending`, derived `unansweredCount`.
- **Actions:** `onAppear`, `refresh`, `threadsLoaded(Result<[AttentionMessage],
  Error>)`, `replyChanged`, `sendReply(instanceId,replyTo)`,
  `replyFinished(Result<Void, Error>)`, `delegate`.
- **Effects:** on appear/refresh call `attentionClient.listThreads` → group →
  state; **5s poll while the drawer is open** (via `@Dependency(\.continuousClock)`,
  matching the React 5s poll); reply is optimistic-append then `await` insert
  with **rollback + inline error on failure** (per `WorklogFormFeature`).
- Read/reply failures surface an inline error while keeping the last-loaded
  threads visible (parent design §10).

### 5.4 UI & navigation

- A **bell button** in the `AppShellView` toolbar with an unanswered-count
  **badge**, presenting the attention drawer as a `@Presents` sheet (parent
  design §6/§7).
- The sheet lists threads (project label + latest message), each with an inline
  reply field; sending posts a `user` message. **No "open in terminal"** — the
  iPhone has no Mac bridge.

## 6. Testing

- **Swift (`WatchtowerCoreTests`, `TestStore` + `withDependencies`):**
  - `AttentionFeature`: load → grouped threads; reply success (optimistic +
    finished); reply failure → rollback + `errorMessage`; poll tick refetches.
  - `groupThreads`/`mapAttentionRow`: TDD vectors mirrored from `attentionCache.ts`
    (unanswered detection, closed threads, ordering).
  - `PushRegistrar`: overriding `pushRegistrar.register` and asserting the
    captured `apns_token`/`bundle_id` payload; `AppDelegate` token → hex → client
    call (logic under test; the register closure is stubbed).
  - Run: `swift test` from `swift/WatchtowerCore/` (no `Secrets.xcconfig`
    needed — lazy client seam), plus an app build
    `xcodebuild … -skipMacroValidation -skipPackagePluginValidation` after
    `xcodegen generate`.
- **TypeScript (vitest):**
  - `tests/orchestrator/pgAttentionSchema.test.ts`: bump the latest-pg-version
    assertion from `=== 12` to `=== 13` and assert v13 adds `bundle_id`.
  - `pushDevices.test.ts` / `pgPushDevices.test.ts`: assert loaders return
    `{token, bundleId}` and the `bundle_id` default.
  - `hubSender.test.ts`: assert each `sendApns` call receives the device's
    `bundleId` as topic; pruning behavior unchanged.
  - `apns.test.ts`: **new** assertion that `sendApns` sends the passed `topic` in
    the `apns-topic` header (currently untested), via an injected `http2` mock.
  - IPC/registration: `push:registerDevice` carries `bundleId`; default when
    absent.

## 7. Error handling

- APNs registration failure — non-fatal, silent (parent §10).
- Attention read failure — inline error, cached threads still shown.
- Attention reply failure — rollback the optimistic append, inline error in the
  drawer; no cache corruption.

## 8. Delivery & risks

- **Branch/worktree:** `feat/native-iphone-phase6` off `origin/main` (has Phase 5
  + the merged reviews work) in `.claude/worktrees/native-iphone-phase6`
  (concurrent-worktree convention). One PR.
- **Execution:** implementation plan (writing-plans) → subagent-driven-development
  (TDD per task, per-task spec+quality review, Opus on the highest-risk reducers,
  final whole-branch review).
- **Backup convention:** none of these edits touch `~/.claude/` config files; the
  backup rule does not apply.
- **Swift CI gap (pre-existing):** the npm CI (`ci.yml`) does not build or test
  the Swift package/app (parent design §11 follow-up). Verification for the Swift
  half is local (`swift test` + `xcodebuild` app build); called out, not silently
  skipped.
- **Live push unverifiable in 6a:** by design (no entitlement). The end-to-end
  APNs delivery to the native app is validated in 6b once the entitlement +
  provisioning are in place; 6a proves the code paths by unit test and the
  backend topic threading by TS tests.
- **Migration ordering:** SQLite v23 and PG v13 are additive, defaulted, and
  idempotent; safe on populated prod DBs. The pg schema-version test guards the
  bump.

## 9. Decisions captured

- Dedicated `bundle_id` column on `push_devices`, default = iPad bundle id (no
  reinterpretation of `platform`, zero data migration).
- `sendApns` `topic` param defaults to `HUB_BUNDLE_ID` (backward-compatible).
- Poll (5s) for the attention feed, not Realtime (parity; Realtime is a
  documented upgrade).
- Push registration code + `AppDelegate` wiring land in 6a; the entitlement /
  `aps-environment` / provisioning are the deferred 6b step.
- Attention bell + reply drawer sheet in the shell toolbar; no "open in terminal"
  on iPhone.
