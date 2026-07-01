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
