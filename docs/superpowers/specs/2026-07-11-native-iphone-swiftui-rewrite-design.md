# Native SwiftUI iPhone Rewrite — Design

**Date:** 2026-07-11
**Status:** Approved (design) — pending spec review before planning
**Topic:** Rewrite the Watchtower iPhone app from Capacitor (React) to native Swift / SwiftUI

---

## 1. Motivation

The current iPhone app (`apps/iphone`) is a thin Capacitor (React + Vite) shell
that reuses the shared workspace packages the iPad also depends on
(`@watchtower/{data-supabase,module-timetracker,module-attention,ui-core}`). It
works, but three goals motivate a native rewrite:

1. **Native feel & performance** — true SwiftUI scroll/gesture/animation polish,
   haptics, and system integration instead of a webview.
2. **iOS platform features** — access to capabilities the webview can't do well
   (richer push, Keychain, and future widgets / Live Activities / App Intents).
3. **A native pair with the future iPad** — the iPad app is intended to be
   rewritten natively later. This design deliberately establishes a **shared
   Swift core** so the iPad reuses the data + feature layer and only re-skins the
   views.

**Non-goal:** this rewrite does not change the backend, the Supabase schema, or
the iPad/desktop apps. It is a client reimplementation only.

## 2. Scope

**Full parity** with the current Capacitor iPhone app:

- Auth gate (email + password against Supabase).
- TimeTracker views: Dashboard, Earnings (month), Reports (+ charts), Project
  detail, Board, and Records (list / grid / tasks / time-off).
- Full **read + write** mutations (worklogs, tasks, contracts, days-off).
- Attention bell + escalation-reply drawer.
- Push registration (APNs device token → `push_devices`).

Data-plane only, exactly like today: Supabase cloud, no Mac bridge / VNC /
WebSocket. Works from anywhere with an internet connection; last snapshot is
shown offline.

## 3. Chosen stack

| Layer | Choice | Rationale |
|---|---|---|
| Architecture | **The Composable Architecture (TCA)** | User already uses it; its multiplatform pattern (shared reducers, per-device views) is the cleanest expression of the shared-iPad goal; `@Dependency` is the ideal seam for the data layer; `TestStore` matches the repo's test-first culture. |
| Network | **`supabase-swift`** (GoTrue auth + PostgREST + Realtime) | Official, mature SDK; hands us token refresh, Keychain session persistence, a typed query builder, and Realtime for the attention feed. |
| Offline | **Codable snapshot cache** (decoded read-model → disk) | Mirrors today's behavior exactly: the read model is a denormalized snapshot, not a local-first relational sync. Least risk, fastest path to parity, trivially shareable with the iPad. SwiftData is a documented *upgrade path* if offline writes / heavy local querying ever become requirements. |
| UI language | **English UI, cs-CZ formatting** | Follows the app-wide convention in project CLAUDE.md (English UI since 2026-07); dates (`D. M. YYYY`), numbers (`1 234,56`), currency (`Kč`) stay cs-CZ. The Czech labels in the current Capacitor app are stale. |

## 4. Repo layout

```
swift/
└─ WatchtowerCore/              # local SPM package — shared iPhone + future iPad
   ├─ Models/                   Codable structs: Project, Contract, Epic, Task,
   │                            Worklog, DayOff, AttentionThread, AttentionMessage
   ├─ Dependencies/             @DependencyClient wrappers:
   │                            SupabaseClient, BillingCache, PushRegistrar, Clock
   ├─ Billing/                  read-model assembly + shared derivation
   │                            (reported_minutes / billable rounding) + cs-CZ formatters
   └─ Features/                 TCA reducers + state + actions (pure, testable):
                                AppFeature, AuthFeature, DashboardFeature,
                                EarningsFeature, ReportsFeature,
                                ProjectDetailFeature, RecordsFeature (+ list/grid/
                                tasks/timeoff children), BoardFeature, AttentionFeature

apps/iphone-native/             # Xcode project — iPhone target only for now
   └─ Views/                    SwiftUI views per feature + Swift Charts panels + theme
                                @main App with UIApplicationDelegateAdaptor (APNs)
```

The existing Capacitor `apps/iphone` **stays until native reaches parity**, then
retires — the same dogfood-safety-net pattern the repo already uses (kept
`TimeTracker.app` after absorption).

## 5. Data flow (SWR)

Matches the current `useBilling` stale-while-revalidate model:

1. On launch, `BillingCache` loads the last Codable snapshot from disk.
2. The reducer renders it immediately (offline-first).
3. An effect refreshes the read model from PostgREST.
4. The new read model re-caches to disk and updates state.

Writes are **write-through** to PostgREST with last-writer-wins. The client
computes derived billing fields itself (porting the iPad's shared formula into
`WatchtowerCore`), because the Mac's LWW push guard does **not** re-derive a
foreign write (see incident: `ipad-writeback-derived-fields`).

## 6. Navigation

- Root `AppFeature` = auth gate: `loading → AuthFeature (login) → signed-in shell`.
- Shell = tab container (Dashboard / Earnings / Reports / Records).
- `StackState` drives the project drill-down.
- `@Presents` drives sheets: worklog editor, attention reply drawer, board upload.
- Native `TabView` leaning on the system Liquid Glass tab bar; brand glass
  (`.ultraThinMaterial` + purple/cyan accents) where the family look requires it.

## 7. Feature parity map

| Today (React) | Native feature | Notes |
|---|---|---|
| DashboardView | DashboardFeature | pull-to-refresh |
| EarningsMonthView | EarningsFeature | month navigation, drill into project |
| ReportsView + 5 panels | ReportsFeature | **Swift Charts**: ProjectDonut (donut), TrendChart (line/bar), EarningsSummary; **ActivityHeatmap = custom grid**; ReportsFilterBar |
| ProjectDetailView | ProjectDetailFeature | opens on the month the caller was viewing |
| BoardView + BoardUploadSheet | BoardFeature | kanban board + upload sheet |
| WorklogListView + WorklogDrawer | RecordsFeature.list | read + create/update/delete |
| TaskListView | RecordsFeature.tasks | task mutations |
| TaskGridView | RecordsFeature.grid | sticky header + pinned footer |
| TimeOffView | RecordsFeature.timeoff | days-off mutations; Czech public holidays computed |
| NotificationHub + AttentionThreadDrawer | AttentionFeature | poll or Realtime on `attention_threads`/`attention_messages`; reply writes a message row; no "open in terminal" (no Mac bridge on iPhone) |
| registerPush.ts | PushRegistrar dependency | APNs token → upsert `push_devices` (apns_token, platform=ios) |

## 8. Config, auth, secrets

- `supabase-swift` Auth, email + password, session persisted in **Keychain**.
- Supabase URL + anon key injected via a **git-ignored `.xcconfig`** (separate
  dev / prod build configs), surfaced through Info.plist — the same "never commit
  keys" convention as today's `.env` injection. The Supabase URL is currently
  hardcoded in `packages/data-supabase/src/supabaseClient.ts`; the native app
  reads it from config instead.

## 9. Known pitfalls to bake in (from prior incidents)

- **DATE columns** are parsed as plain `yyyy-MM-dd` calendar values, never
  `Date`-with-UTC — avoids the 1-day back-shift in timezones ahead of UTC
  (incident: `sync-pull-date-shift-bug`).
- **Derived billing fields** are computed client-side via the shared
  `WatchtowerCore` formula on every write (incident: `ipad-writeback-derived-fields`).
- **cs-CZ formatting** via a single set of formatters in `WatchtowerCore`
  (NBSP thousands separator, `D. M. YYYY`, CZK `Kč`).

## 10. Error handling

- Read failures surface an inline error state per feature (mirrors the React
  inline `<Alert>` pattern) while still showing the cached snapshot.
- Write failures surface in the editing sheet and do not optimistically corrupt
  the cache.
- Push-registration failure is non-fatal and silent (matches today).

## 11. Testing

- TCA `TestStore` reducer tests with `withDependencies` stubbing
  `SupabaseClient` and `BillingCache` — deterministic, no network.
- Unit tests for the cs-CZ formatters and the billing-derivation formula.
- Swift tests run via `xcodebuild` / `swift test`. Wiring them into the existing
  npm-based CI (`ci.yml`) is a **follow-up**, flagged as a risk below — not
  silently skipped.

## 12. Phasing

Each phase gets its own implementation plan and PR.

1. **Foundation** — `WatchtowerCore` package, `SupabaseClient` dependency, Auth +
   app shell + tab scaffold + theme.
2. **Read model** — Codable snapshot cache + Dashboard + Earnings (read).
3. **Reports** — Swift Charts panels + filter bar.
4. **Records (read)** — worklog list, task list, task grid, time-off.
5. **Mutations** — write-through across records + project detail + board.
6. **Attention + push** — threads, reply, APNs registration.
7. **Polish & cutover** — offline hardening, parity verification, retire the
   Capacitor app.

## 13. Open risks

- **`supabase-swift` currency** — verify at plan time that its PostgREST +
  Realtime surface covers everything the read model and attention feed need.
- **APNs requires a paid Apple Developer account + push entitlement.** The
  Capacitor README notes cross-device messaging was deferred for exactly this
  reason. Confirm account status before Phase 6; if unavailable, Phase 6 ships
  the attention feed (poll-based) without push and push defers.
- **Xcode project inside the npm monorepo** — `.gitignore` for build artifacts,
  DerivedData, `xcuserdata`; how (and whether) Swift build/test joins CI;
  7-day free-cert expiry for on-device runs (already a known constraint).

## 14. Decisions captured

- Data stack: `supabase-swift` + Codable snapshot cache (not SwiftData, not
  hand-rolled).
- Architecture: TCA, shared `WatchtowerCore` SPM package, per-device views.
- Scope: full parity in one rewrite, delivered across 7 phases.
- UI language: English UI, cs-CZ formatting.
- Capacitor app retained until native parity, then retired.
