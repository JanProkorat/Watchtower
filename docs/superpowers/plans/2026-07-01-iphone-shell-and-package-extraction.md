# Plan — #76 iPhone shell (TimeTracker-only) + shared-package extraction

Epic #77. Chosen approach: **extract shared packages first**, then build `apps/iphone`.

## Scope

**In:**
- Extract 3 workspace packages out of `apps/ipad/src` (source-aliased, like `@watchtower/transport`):
  - `@watchtower/ui-core` — `czFormat`, `monthHelpers`, `projectDetailHelpers`, ambient CSS.
  - `@watchtower/data-supabase` — `supabaseClient`, `useSupabaseAuth`, `useBilling`, `billingCache`, `billingWrites`, `paginate`, the 4 `*Mutations` hooks.
  - `@watchtower/module-timetracker` — `components/billing/*` (16 files) + `useReportsFilters`.
- Rewire all `apps/ipad` imports to the packages; keep the iPad app green (tsc + build + tests + still runs).
- New `apps/iphone` Capacitor app: Supabase auth gate + offline cache + TimeTracker views in an iPhone nav shell (bottom tab bar, portrait).

**Deferred to a follow-up issue (flagging, not doing here):**
- Cross-device **messaging / ping-reply UI**. No reusable module exists (NotificationHub is live-plane attention), and it needs push infra (APNs, paid dev acct, device tokens). This is #76's "receives/answers pings" clause — recommend splitting it out so the TimeTracker core ships.

## Phases (one per turn, commit at each; isolated worktree)

- **P0 — Worktree.** Fetch origin; worktree `.claude/worktrees/iphone-76` off `origin/main`, branch `feat/76-iphone-shell`. Copy `.env.*` in (git-ignored, per prior gotcha). Commit this plan into `docs/superpowers/plans/`.
- **P1 — `ui-core`.** Create package (package.json/tsconfig), move pure helpers + ambient CSS, add vite alias + tsconfig paths in `apps/ipad`, rewire imports. Verify: `apps/ipad` tsc + build + tests.
- **P2 — `data-supabase`.** Move client/auth/billing/cache/writes/mutations; depends on `ui-core` + `@watchtower/shared`. Rewire iPad. Verify.
- **P3 — `module-timetracker`.** Move `components/billing/*` + `useReportsFilters`; depends on `data-supabase` + `ui-core` + shared. Rewire `App.tsx` (BillingArea). Verify iPad fully (tsc + build + **full** test suite).
- **P4 — Scaffold `apps/iphone`.** package.json, vite.config (aliases), tsconfig, `capacitor.config.ts` (appId `cz.greencode.watchtower.iphone`), index.html, main.tsx, index.css. `cap add ios`.
- **P5 — iPhone shell + TimeTracker.** App.tsx: Supabase auth (reuse BillingLogin) + bottom-tab nav (Přehled / Výdělky / Reporty / Záznamy) composing module-timetracker; offline cache via `useBilling`.
- **P6 — iPhone layout adaptation.** Narrow-screen tuning for TT views (built for iPad width); simulator/device iteration.
- **P7 — Verify + PR.** Full tests + typecheck all workspaces + builds (ipad + iphone); open PR; file the messaging follow-up issue.

## Risks / notes
- ~30 iPad import rewires (P1–P3): silent build-break risk (workspace resolution) → run `tsc` after every phase, not just at the end.
- TT views are laid out for iPad width; iPhone needs real layout work (P6), likely iterative on-device.
- iPhone device install needs the Apple dev account; **simulator works without home network** (Supabase is cloud) — matches the "no home wifi/ethernet" constraint.
- Messaging deferred (see scope).

---

## Progress & resume (2026-07-01)

**P0–P6 DONE, committed + pushed on `feat/76-iphone-shell`; PR open to `main`.**
On-device visual verification of P6 happens against the PR branch (user chose
"open PR now, verify after"); push follow-up layout fixes if anything looks
wrong logged-in. Messaging follow-up issue filed (see P7).

- **P4** — `apps/iphone` scaffolded (configs, index/main/css, ErrorBoundary),
  `cap add ios` + pods, `.gitignore` mirrored. tsc/build/cap-sync clean.
- **P5** — auth gate (`useSupabaseAuth`) → `BillingLogin` → bottom-tab shell
  (Přehled/Výdělky/Reporty/Záznamy) composing the individual module views;
  records sub-nav; project drill-down; portrait-locked Info.plist.
- **P6** — ui-core `useIsNarrow()` (≤480px, SSR-safe); phone-width fixes gated on
  it so the iPad path is byte-identical: DashboardView KPI wrap, EarningsSummary
  4-tile wrap, ContractDrawer input rows stack, TaskGridView slim frozen cols.
  Full suite 909 pass / 8 fail (pre-existing `relativeTimeCz` — stale test, the
  function doesn't exist on main either).

_Original resume note (kept for history):_ Extraction DONE (P0–P3). Resume at **P4**.

**Worktree:** `/Users/jan/Projects/Watchtower/.claude/worktrees/iphone-76` (branch `feat/76-iphone-shell`, tracks origin). `node_modules` already installed here.

**Packages created** (source-aliased, no build step — pattern = `@watchtower/transport`):
`@watchtower/ui-core` (glass tokens, cz format, `PullToRefresh`), `@watchtower/data-supabase`
(`getSupabase`, `useSupabaseAuth`, `useBilling` + offline cache, 4 mutation hooks, `billingWrites`),
`@watchtower/module-timetracker` (barrel exports `BillingArea` + `DashboardView`,`EarningsMonthView`,
`ProjectDetailView`,`ReportsView`,`WorklogListView`,`TaskListView`,`TaskGridView`,`TimeOffView`,
`BillingSection`, `useReportsFilters`, `timeOffModel`). All data-plane only — no live-plane coupling.

**Wiring a package into an app:** `package.json` `{name, private, type:module, main:"src/index.ts", exports}`;
`tsconfig.json` extends `../../tsconfig.base.json`, `moduleResolution:Bundler`, `jsx:react-jsx` if it has
`.tsx`, `types:["vite/client"]` if it uses `import.meta.env`, `paths` to the packages it imports; then in
the app add a vite `resolve.alias` **and** a tsconfig `paths` entry, and run `npm install` (creates the
`node_modules/@watchtower/<pkg>` symlink so vitest/node resolve it).

### P4 — scaffold `apps/iphone`
- `package.json` name `@watchtower/iphone` (copy iPad deps: react, @supabase/supabase-js, @capacitor/{core,ios,preferences,push-notifications}); scripts `build`,`build:dev`,`cap:sync`.
- `vite.config.ts` (copy iPad's; aliases for shared/ui-core/data-supabase/module-timetracker; **drop** the noVNC alias — iPhone has no VNC).
- `tsconfig.json` (copy iPad's + the 4 `@watchtower/*` paths). `index.html`, `src/main.tsx`, `src/index.css`.
- `capacitor.config.ts` appId **`cz.greencode.watchtower.iphone`**, appName `Watchtower`, webDir `dist`.
- `npx cap add ios` then `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx cap sync ios` (pod install needs the UTF-8 locale — known CocoaPods bug).

### P5 — iPhone shell + TimeTracker
- `App.tsx`: `useSupabaseAuth` gate → `BillingLogin` when signed out; when in, a **bottom tab bar** (Přehled / Výdělky / Reporty / Záznamy) switching between `DashboardView` / `EarningsMonthView` / `ReportsView` / records views from `@watchtower/module-timetracker`. Portrait. Reuse ambient bg from ui-core glass.
- Offline cache is already inside `useBilling` (Capacitor Preferences) — works as-is.

### P6 — narrow-screen layout adaptation
- The TT views are laid out for iPad width; tune for iPhone (iterative, simulator). UI two-attempt rule applies.

### P7 — verify + PR
- `npx vitest run` (baseline **909 pass / 8 fail**; the 8 `relativeTimeCz` failures are pre-existing on main — NOT a regression), tsc for every package + both apps, `vite build` for ipad + iphone. Open PR to `main`. File the **deferred messaging follow-up** issue (cross-device ping/reply UI — no reusable module, needs push infra).

### Gotchas (also in ~/.claude memory)
- **`.env` is git-ignored → absent in the worktree.** For `apps/iphone` `build:dev`/runtime you need `VITE_SUPABASE_ANON_KEY`; copy from the main checkout: `cp ~/Projects/Watchtower/apps/ipad/.env.* .../worktrees/iphone-76/apps/iphone/`. (Have the user `cp` — writing `.env*` is guarded.) Supabase URL is hardcoded in `supabaseClient.ts`.
- Time clock for #76 is open (`.claude/private/clock/76.json`); leave it — auto-logger bills across sessions. Close it (`logged:true`, add `czech_summary`) only when the PR merges.
- Messaging is OUT of scope (deferred).
