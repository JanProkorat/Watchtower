# Project Restructure → Workspace + Shared Core — Design (#70)

**Date:** 2026-06-24
**Status:** Spec — approved; ready for plan → execute (in a fresh session)
**Parent:** Epic #77 (iPad/iPhone remote access); sub-project #3 of 9 (Phase A·3)
**Branch (to create at execution):** `feat/workspace-restructure`
**Depends on:** #68 (transport foundation, merged), #69 (TimeTracker→Postgres sync, merged)

---

## 1. Goal

Restructure the single `client/` + `shared/` layout into an **npm workspace** with a
shared core and a thin desktop app shell, so later phases can add iPad/iPhone
client shells that compose the same packages. This is a **pure restructure — no
behavior change.** The desktop app must build and run identically afterward.

Scope is deliberately the **skeleton + already-clean cores only** (chosen over a
full §5 module carve): the speculative `module-*` / `ui-core` / `data-supabase`
splits are deferred to the phases that gain a real second consumer, because
carving the renderer's TimeTracker/Instances modules into separate packages
means untangling their current cross-imports for zero behavior change and no
current second client.

## 2. Target layout

```
packages/
  shared/        ← from shared/            @watchtower/shared
  transport/     ← from client/src/transport  @watchtower/transport
apps/
  desktop/       ← from client/            (Electron React renderer shell)
electron/        (unchanged location; shared imports rewired)
orchestrator/    (unchanged location; shared imports rewired)
helper/          (unchanged)
tests/           (stays at root; import paths rewired)
docs/  build-resources/  scripts/  (unchanged)
root:
  package.json   → adds "workspaces": ["packages/*", "apps/*"]
  tsconfig.base.json → adds "paths" for @watchtower/*
  vitest.config.ts   → adds resolve.alias for @watchtower/*
```

Package names are scoped: `@watchtower/shared`, `@watchtower/transport`.

## 3. Resolution strategy (the crux — hybrid, keyed to how each consumer runs)

`shared/` is consumed three ways: bundled by Vite (renderer), compiled by `tsc`
and run as `.js` at Node runtime (electron main + orchestrator utilityProcess),
and by vitest. `transport/` is renderer-only today. The two packages are **not**
symmetric, because `tsc` resolves a bare specifier like `@watchtower/shared` for
type-checking but **does not rewrite it in emitted JS** — so a pure-alias
`shared` would emit Node code importing `@watchtower/shared` that fails to
resolve at runtime unless it physically exists in `node_modules`.

Therefore:

- **`@watchtower/shared` — built composite package.** `tsconfig.json` with
  `"composite": true`, emits `dist/` + `.d.ts`; `package.json` `"exports"` →
  `dist`. electron + orchestrator tsconfigs add a `references` entry to it, so
  `tsc -b` builds shared first (incremental) and the Node runtime resolves the
  bare import via the npm-workspaces symlink (`node_modules/@watchtower/shared`
  → `packages/shared`). The **renderer (Vite) + vitest alias `@watchtower/shared`
  → `packages/shared/src`** so dev keeps instant HMR and never reads a stale
  `dist`.
- **`@watchtower/transport` — pure source alias, no build.** Renderer-only;
  Vite + vitest + tsconfig `paths` resolve it to `packages/transport/src`.

Base tooling is **npm workspaces** (not pnpm): the repo is already on npm, which
keeps `electron-builder`, the existing npm scripts, and `electron-rebuild` of
the `better-sqlite3` / `node-pty` native modules working with no new tooling.
pnpm's symlinked store tends to fight native-module rebuilds.

## 4. Migration sequence (green-checkpointed)

Each step should leave `npm test` + the typechecks runnable; a restructure has
interdependencies, so the plan will draw exact task boundaries, but the order is:

1. **Workspaces + `packages/shared`.** Add the root `workspaces` field; move the
   8 `shared/*.ts` files into `packages/shared/src/` with a `package.json`
   (`exports` → `dist`) + composite `tsconfig.json`. Rewire **every** shared
   importer to `@watchtower/shared`: client (`apps/desktop` happens in step 3, so
   for now `client/`), electron (5+ sites), orchestrator, the 20 shared-importing
   test files, and helper if any. Add `references` in electron/orchestrator
   tsconfigs and the `paths` entry in `tsconfig.base.json`.
2. **`packages/transport`.** Move `client/src/transport` → `packages/transport/src`
   (+ `package.json` + `tsconfig.json`); rewire its importers (renderer + the 2
   transport test files) to `@watchtower/transport`; add Vite/vitest/tsconfig
   aliases. Confirm transport's only cross-package dependency is
   `@watchtower/shared` (it should be, post-#68).
3. **`client/ → apps/desktop`.** Move the renderer (`src/{components,layout,state,
   util}`, `index.html`, `vite.config.ts`, `tsconfig.json`, add `package.json`).
   Keep Vite `outDir` → repo-root `dist-renderer` so electron's
   `loadFile('../../dist-renderer/index.html')` and the electron-builder globs
   are untouched. Update the 18 client-importing test files'
   relative paths to `apps/desktop/src/*`.
4. **Project references + scripts.** Wire `tsc -b` so `packages/shared` builds
   before electron/orchestrator. Update root `package.json` scripts: `build`
   builds shared (via `tsc -b`) before main/orch/renderer/helper; `dev` ensures
   shared is built/watched before the Node watchers and the Vite server start
   (renderer aliases to src, so it needs no shared build, but the Node watchers
   do). Update `typecheck` to include the new package tsconfigs.
5. **Full verification** (acceptance below).

## 5. Tests

`tests/` stays at the repo root (vitest `include: tests/**/*.test.ts` unchanged).
- 20 files importing `../..[/..]/shared/*.js` → `@watchtower/shared`.
- 18 files importing `client/src/*` → `apps/desktop/src/*` relative paths (or the
  `@watchtower/*` aliases where they import a packaged module).
- 45 files importing `orchestrator/*` are unaffected (orchestrator does not move).
- `vitest.config.ts` gains `resolve.alias` entries for `@watchtower/shared` →
  `packages/shared/src` and `@watchtower/transport` → `packages/transport/src`,
  mirroring the tsconfig `paths`. Keep `pool: 'forks' / singleFork: true` (added
  in #69 for the Postgres integration suites).

## 6. Packaging — untouched

`electron-builder` packages the build **outputs** (`dist-renderer`,
`dist-electron`, `dist-orchestrator`, `dist-helper`), not source. As long as
those output directories keep their locations (step 3 keeps `dist-renderer`),
the `dist:mac` flow, the afterPack code-signing, and the `loadFile` path need no
change.

## 7. Acceptance (pure restructure, no behavior change)

- `npm test` green at **≥ 617** (the #69 baseline), no test deleted, only import
  paths updated.
- `npx tsc -b` (project references) and the `typecheck` script both clean — no
  NEW errors beyond the documented pre-existing client drift (rootDir for `dev/`,
  MUI v6 `slotProps`, `useInstances.spawn`).
- `npm run dev` launches the app (Vite renderer + tsc-watch main/orch).
- `npm run dist:mac` produces a working unsigned `.app`/`.dmg` that runs
  identically to pre-restructure.
- No `shared/` or `client/` directory remains; no relative `../../shared/*.js`
  import remains in the codebase.

## 8. Out of scope (later phases)

- `ui-core`, `module-timetracker`, `module-instances`, `data-supabase`,
  `module-remote-mac`, `module-messaging` package carves (the phases that gain a
  real second consumer do these).
- `apps/ipad`, `apps/iphone` shells (#73, #76).
- Any behavior, feature, or dependency change.

## 9. Risks

- **Native modules under workspace hoisting.** `better-sqlite3` / `node-pty` are
  hoisted to the root `node_modules`; after the workspace conversion, re-run
  `npm run electron:rebuild` and verify the orchestrator still opens the DB and
  spawns ptys. npm (not pnpm) keeps this conventional.
- **tsc emit vs bare specifiers** (the reason shared is a built package, not
  alias-only) — see §3. Verify the orchestrator's emitted JS resolves
  `@watchtower/shared` at runtime, not just at type-check, before declaring done.
- **Interdependent move.** A restructure can't always stay green between
  sub-steps; the plan should batch each package's move + all its import rewrites
  into one task so each task ends green.
