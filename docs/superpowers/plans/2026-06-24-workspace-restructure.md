# Workspace Restructure Implementation Plan (#70)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the single `client/` + `shared/` layout into an npm-workspaces monorepo (`packages/shared`, `packages/transport`, `apps/desktop`) with **zero behavior change** — the desktop app builds, runs, packages, and tests identically afterward.

**Architecture:** npm workspaces (not pnpm — keeps `electron-builder` + native-module rebuilds conventional). Hybrid module resolution keyed to how each consumer runs:
- `@watchtower/shared` is a **built composite package** (`tsc` emits `dist/` + `.d.ts`). Node-runtime consumers (electron main, orchestrator) resolve it via the npm-workspaces `node_modules/@watchtower/shared` symlink → its `package.json` `exports` → `dist/`. They are wired with `tsc` project `references` for build ordering.
- The **renderer (Vite) and vitest** resolve `@watchtower/shared` and `@watchtower/transport` to `…/src` via aliases + tsconfig `paths`, for instant HMR and no stale `dist` reads.
- `@watchtower/transport` is renderer-only — a **pure source alias, never built**.

**Tech Stack:** TypeScript 5.6 (NodeNext for Node, Bundler for renderer), Vite 5, vitest 2, Electron 33, electron-builder 25, npm workspaces.

## Global Constraints

- **Pure restructure — NO behavior, feature, or dependency change.** Only file locations, import specifiers, and build wiring change.
- **`npm test` must stay green at ≥ 617 tests.** No test deleted; only import paths updated.
- **Output directories must not move:** `dist-renderer`, `dist-electron/electron/*`, `dist-orchestrator/orchestrator/*`, `dist-helper` keep their exact current locations and internal layout (electron-builder globs, `afterPack` signing, `loadFile('../../dist-renderer/index.html')`, `package.json` `main: dist-electron/electron/main.js`, and `copy-orch-assets.mjs` all depend on these).
- **Base tooling is npm workspaces** — do not introduce pnpm/yarn.
- **Pre-existing typecheck drift is allowed and must NOT be fixed here:** `rootDir` for `dev/`, MUI v6 `slotProps` on TextField, `useInstances.spawn` return type. No NEW errors beyond these.
- **`shared/`'s internal cross-imports stay relative** (`events.ts`→`./stateModel.js`, `ipcContract.ts`→`./slackConfig.js`, `messagePort.ts`→`./slackConfig.js`, `wsProtocol.ts`→`./ipcContract.js`) — they move together inside the package.
- Package names: `@watchtower/shared`, `@watchtower/transport`. App package: `@watchtower/desktop` (private).
- Czech locale, no i18n, IPC-contract discipline — all unchanged (no module code is rewritten).

## Resolution design note (READ FIRST — mechanics chosen to honor §3 of the spec)

The spec §3 says "add the `paths` entry in `tsconfig.base.json`." This plan places those `paths` in the **renderer and transport tsconfigs only**, NOT in `tsconfig.base.json`. Reason discovered during planning: `electron`/`orchestrator` emit JS and currently rely on `tsc` inferring `rootDir = repo root` (because they `include` `../shared/**/*.ts`). Once `shared` becomes its own package we (a) remove that glob and **must pin `rootDir: ".."`** to preserve the `dist-electron/electron/*` and `dist-orchestrator/orchestrator/*` output layout, and (b) must NOT let `paths`→`src` pull `packages/shared/src/*.ts` back into their program, or `tsc` would try to re-emit shared into `dist-electron`. So Node-emitting projects resolve `@watchtower/shared` via the built `.d.ts` (references + symlink + `exports.types`); only the Bundler/`noEmit` projects (renderer, transport) use `paths`→`src`. This preserves the spec's exact hybrid-resolution goal.

---

## File structure

**Created:**
- `packages/shared/package.json` — `@watchtower/shared`, composite, `exports`→`dist`.
- `packages/shared/tsconfig.json` — composite build config (emits `dist/` + `.d.ts`).
- `packages/shared/src/*.ts` — the 8 moved shared files.
- `packages/transport/package.json` — `@watchtower/transport`, `main`/`exports`→`src` (alias-only).
- `packages/transport/tsconfig.json` — Bundler, `noEmit`, `paths`→src for shared.
- `packages/transport/src/index.ts` — barrel re-exporting the 2 transport functions.
- `packages/transport/src/{selectTransport,webSocketTransport}.ts` — moved.
- `apps/desktop/package.json` — `@watchtower/desktop` (private).
- `tsconfig.json` (repo root) — solution file with `references` for `npx tsc -b`.

**Modified:**
- `package.json` (root) — `workspaces` field; `@watchtower/shared` runtime dep; build/dev/typecheck scripts.
- `tsconfig.base.json` — unchanged compilerOptions (paths go in leaf configs, see note).
- `electron/tsconfig.json`, `orchestrator/tsconfig.json` — `composite`, `rootDir:".."`, drop `../shared` glob, add `references`.
- `client/tsconfig.json` → `apps/desktop/tsconfig.json` — add `paths`→src.
- `client/vite.config.ts` → `apps/desktop/vite.config.ts` — `resolve.alias` + fixed `outDir` depth.
- `vitest.config.ts` (root) — `resolve.alias` for both packages.
- `.gitignore` — add `packages/shared/dist/`, `*.tsbuildinfo`.
- ~108 importer files (shared) + 3 (transport) + ~16 test files (client paths) — import specifiers only.

**Moved (via `git mv`, history preserved):** `shared/*` → `packages/shared/src/`; `client/src/transport/*` → `packages/transport/src/`; `client/*` → `apps/desktop/*`.

---

## A note on "tests" in this plan

This is a **pure restructure with no new behavior**, so the verification surface for every task is the **existing suite + typechecks**, not new unit tests. Each task's green checkpoint is:

```bash
npm test           # ≥ 617 passing, 0 failing
npm run typecheck  # clean except the 3 documented pre-existing drifts
```

Do **not** add new tests. Do **not** "fix" the documented pre-existing typecheck drift.

---

## Task 1: npm workspaces + `@watchtower/shared` package

Batches the workspace conversion, the `shared` package, and **all** shared-import rewrites into one task so the tree ends green (spec §9 — a restructure can't stay green between these sub-steps).

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`
- Move: `shared/*.ts` (8 files) → `packages/shared/src/`
- Modify: `package.json`, `electron/tsconfig.json`, `orchestrator/tsconfig.json`, `vitest.config.ts`, `client/vite.config.ts`, `client/tsconfig.json`, `.gitignore`, create root `tsconfig.json`
- Rewire: ~108 files importing `shared/*` (electron 4, orchestrator 15, client 69, tests 20)

**Interfaces:**
- Produces: package `@watchtower/shared` with subpath exports `@watchtower/shared/<module>.js` for all 8 modules (`events`, `ipcContract`, `layout`, `messagePort`, `slackConfig`, `stateModel`, `tokenUsageFormat`, `wsProtocol`). Node consumers resolve `./dist/<module>.js` + `./dist/<module>.d.ts`; Bundler consumers alias to `packages/shared/src/<module>.ts`.
- Consumes: nothing (first task).

- [ ] **Step 1: Create `packages/shared/` and move the 8 files (preserve history)**

```bash
cd /Users/jan/Projects/Watchtower
mkdir -p packages/shared/src
git mv shared/events.ts shared/ipcContract.ts shared/layout.ts shared/messagePort.ts \
       shared/slackConfig.ts shared/stateModel.ts shared/tokenUsageFormat.ts shared/wsProtocol.ts \
       packages/shared/src/
rmdir shared 2>/dev/null || true
```

Expected: `packages/shared/src/` holds 8 `.ts` files; `shared/` is gone. The files' internal `./*.js` relative imports are unaffected (they move together).

- [ ] **Step 2: Write `packages/shared/package.json`**

```json
{
  "name": "@watchtower/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./*.js": {
      "types": "./dist/*.d.ts",
      "default": "./dist/*.js"
    }
  }
}
```

The `"./*.js"` pattern: a Node import of `@watchtower/shared/ipcContract.js` matches with `*`=`ipcContract` → `dist/ipcContract.js` (+ `.d.ts` for typecheck).

- [ ] **Step 3: Write `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"]
}
```

Inherits NodeNext + ES2022 from base. `composite` makes it a referenceable build target.

- [ ] **Step 4: Add the `workspaces` field and the `@watchtower/shared` runtime dependency to root `package.json`**

In `package.json`, after `"main": …` add:

```json
  "workspaces": ["packages/*", "apps/*"],
```

And add to `"dependencies"` (so `electron-builder` keeps the package in the packaged `node_modules`, and so the orchestrator's emitted JS resolves it at runtime):

```json
    "@watchtower/shared": "*",
```

- [ ] **Step 5: Install to create the workspace symlinks, then rebuild native modules**

```bash
npm install
ls -la node_modules/@watchtower/   # expect: shared -> ../../packages/shared symlink
npm run electron:rebuild
```

Expected: `node_modules/@watchtower/shared` is a symlink to `packages/shared`. `electron-rebuild` succeeds (native `better-sqlite3` / `node-pty` re-link under the workspace `node_modules` — spec §9 risk).

- [ ] **Step 6: Rewire every `shared/*` importer to `@watchtower/shared/*` (scripted)**

The transform is a depth-independent prefix replacement of `(../)+shared/` → `@watchtower/shared/`, preserving the `.js` extension and the named imports. Internal `packages/shared/src/*.ts` files use `./` (not `../shared/`) so they are untouched.

```bash
cd /Users/jan/Projects/Watchtower
# All .ts/.tsx files that still import from a relative shared path:
FILES=$(grep -rlE "from '(\.\./)+shared/" --include='*.ts' --include='*.tsx' \
  electron orchestrator client tests)
echo "$FILES" | tr ' ' '\n'   # review the list
perl -pi -e "s{from '(\.\./)+shared/}{from '\@watchtower/shared/}g" $FILES
# Fix the one extensionless import in tests/shared/wsProtocol.test.ts:
perl -pi -e "s{from '\@watchtower/shared/wsProtocol'}{from '\@watchtower/shared/wsProtocol.js'}g" \
  tests/shared/wsProtocol.test.ts
# Verify zero relative shared imports remain:
grep -rnE "from '(\.\./)+shared/" --include='*.ts' --include='*.tsx' electron orchestrator client tests || echo "OK: none remain"
```

Expected: every `../../shared/foo.js` style import becomes `@watchtower/shared/foo.js`; the final grep prints `OK: none remain`.

- [ ] **Step 7: Update `electron/tsconfig.json` — composite, pin `rootDir`, drop the shared glob, add reference**

Replace the file with:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "../dist-electron",
    "rootDir": "..",
    "composite": true,
    "types": ["node"]
  },
  "include": ["**/*.ts"],
  "exclude": ["preload.ts"],
  "references": [{ "path": "../packages/shared" }]
}
```

`rootDir: ".."` preserves the `dist-electron/electron/*.js` layout (it previously came from the now-removed `../shared` glob — **critical**, or `main.js` would emit to `dist-electron/main.js` and break the app).

- [ ] **Step 8: Update `orchestrator/tsconfig.json` — same treatment**

Replace with:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "../dist-orchestrator",
    "rootDir": "..",
    "composite": true,
    "types": ["node"]
  },
  "include": ["**/*.ts"],
  "references": [{ "path": "../packages/shared" }]
}
```

Preserves `dist-orchestrator/orchestrator/*.js` (consumed by `copy-orch-assets.mjs`).

- [ ] **Step 9: Add the renderer's `paths`→src to `client/tsconfig.json`**

Add a `baseUrl` + `paths` block to `client/tsconfig.json` `compilerOptions` (Bundler + `noEmit`, so resolving to source is safe and gives HMR):

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "../dist-renderer",
    "rootDir": ".",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "noEmit": true,
    "baseUrl": ".",
    "paths": {
      "@watchtower/shared/*": ["../packages/shared/src/*"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx"]
}
```

- [ ] **Step 10: Add the Vite alias for shared in `client/vite.config.ts`**

Add a `resolve.alias` block (Vite maps the `.js` request to the `.ts` source, as it already does for the current relative imports):

```ts
export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@watchtower/shared': path.resolve(__dirname, '../packages/shared/src'),
    },
  },
  server: { port: 5173, strictPort: true },
  build: {
    outDir: path.resolve(__dirname, '../dist-renderer'),
    emptyOutDir: true,
  },
});
```

- [ ] **Step 11: Add the vitest alias for shared in root `vitest.config.ts`**

Replace with:

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@watchtower/shared': path.resolve(__dirname, 'packages/shared/src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: ['default'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
```

- [ ] **Step 12: Create the root solution `tsconfig.json` for `npx tsc -b`**

```json
{
  "files": [],
  "references": [
    { "path": "packages/shared" },
    { "path": "electron" },
    { "path": "orchestrator" }
  ]
}
```

- [ ] **Step 13: Update root `package.json` build/dev/typecheck scripts**

Change these script values (use `tsc -b` so the composite `shared` builds first; typecheck builds shared once then `--noEmit`-checks the rest):

```json
    "dev": "npm run build:main && npm run build:orch && concurrently -k -n vite,main,orch,app -c magenta,blue,cyan,green \"npm:dev:renderer\" \"npm:dev:main\" \"npm:dev:orch\" \"npm:dev:electron\"",
    "dev:main": "tsc -b electron/tsconfig.json --watch --preserveWatchOutput",
    "dev:orch": "tsc -b orchestrator/tsconfig.json --watch --preserveWatchOutput",
    "build:main": "tsc -b electron/tsconfig.json && node electron/buildPreload.mjs",
    "build:orch": "tsc -b orchestrator/tsconfig.json && node scripts/copy-orch-assets.mjs",
    "typecheck": "tsc -b packages/shared/tsconfig.json && tsc -p electron/tsconfig.json --noEmit && tsc -p orchestrator/tsconfig.json --noEmit && tsc -p client/tsconfig.json --noEmit",
```

(`dev:renderer`, `build:renderer`, `build:helper`, `build`, `test`, `dist:mac` unchanged in this task — `client/` paths there are fixed in Task 3.)

- [ ] **Step 14: Update `.gitignore`**

Add (after the existing `dist-*` lines):

```
packages/shared/dist/
*.tsbuildinfo
```

- [ ] **Step 15: Build shared, then run the full verification**

```bash
cd /Users/jan/Projects/Watchtower
npx tsc -b packages/shared/tsconfig.json        # emits packages/shared/dist + .d.ts
ls packages/shared/dist/ipcContract.js packages/shared/dist/ipcContract.d.ts  # exist
npx tsc -b                                       # solution build: shared -> electron -> orchestrator, clean
npm run typecheck                                # clean except the 3 documented drifts
npm test                                         # >= 617 passing, 0 failing
```

Expected: `tsc -b` clean; `typecheck` shows only the documented pre-existing client drift (rootDir `dev/`, MUI `slotProps`, `useInstances.spawn`); `npm test` ≥ 617 green.

**Contingency (paths/references emit conflict):** If `npx tsc -b` reports `TS6305`/`TS6307`/`TS6059` tying `packages/shared/src` into the electron/orchestrator emit, confirm neither `electron/tsconfig.json` nor `orchestrator/tsconfig.json` (nor `tsconfig.base.json`) contains a `@watchtower/shared` `paths` entry — they must resolve shared via the reference's `.d.ts`, not source. Only `client/tsconfig.json` (and later `packages/transport`, `apps/desktop`) carry the `paths`.

- [ ] **Step 16: Commit**

```bash
git add -A
git commit -m "refactor: #70 extract @watchtower/shared workspace package

Convert repo to npm workspaces; move shared/ -> packages/shared as a
composite built package. Node consumers (electron, orchestrator) resolve
via references + node_modules symlink -> dist; renderer/vitest alias to
src. Pin electron/orchestrator rootDir to preserve dist output layout.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `@watchtower/transport` package

**Files:**
- Move: `client/src/transport/{selectTransport,webSocketTransport}.ts` → `packages/transport/src/`
- Create: `packages/transport/src/index.ts`, `packages/transport/package.json`, `packages/transport/tsconfig.json`
- Modify: `client/src/browserStub.ts`, `tests/client/transport/webSocketTransport.test.ts`, `tests/client/transport/selectTransport.test.ts`, `client/vite.config.ts`, `vitest.config.ts`, `client/tsconfig.json`

**Interfaces:**
- Consumes: `@watchtower/shared/{ipcContract,wsProtocol}.js` (already rewired in Task 1; `webSocketTransport.ts` carries those bare imports).
- Produces: barrel `@watchtower/transport` exporting `readWsConfig` (from `selectTransport`) and `createWebSocketTransport` (from `webSocketTransport`). Renderer-only; never built, never at Node runtime.

- [ ] **Step 1: Move the 2 transport files (preserve history)**

```bash
cd /Users/jan/Projects/Watchtower
mkdir -p packages/transport/src
git mv client/src/transport/selectTransport.ts client/src/transport/webSocketTransport.ts \
       packages/transport/src/
rmdir client/src/transport 2>/dev/null || true
```

- [ ] **Step 2: Create the barrel `packages/transport/src/index.ts`**

```ts
export { readWsConfig } from './selectTransport';
export { createWebSocketTransport } from './webSocketTransport';
```

(Extensionless `./` imports — transport is Bundler-resolved, matching the renderer's existing style. `webSocketTransport.ts`'s `@watchtower/shared/*.js` imports are unchanged.)

- [ ] **Step 3: Create `packages/transport/package.json`**

```json
{
  "name": "@watchtower/transport",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts" }
}
```

(Alias-only: points at `src` — only Vite/vitest/tsc-`paths` ever resolve it; never imported at Node runtime.)

- [ ] **Step 4: Create `packages/transport/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "noEmit": true,
    "baseUrl": ".",
    "paths": {
      "@watchtower/shared/*": ["../shared/src/*"]
    }
  },
  "include": ["src/**/*.ts"]
}
```

(`DOM` lib for `WebSocket`; `paths` lets `tsc -p packages/transport --noEmit` resolve shared from source.)

- [ ] **Step 5: Rewire `client/src/browserStub.ts` to the barrel**

Replace its two transport imports:

```ts
import { readWsConfig } from '@watchtower/transport';
import { createWebSocketTransport } from '@watchtower/transport';
```

(Was `import { readWsConfig } from './transport/selectTransport';` and `import { createWebSocketTransport } from './transport/webSocketTransport';`.) Other imports in the file are unchanged.

- [ ] **Step 6: Rewire the 2 transport test files**

In `tests/client/transport/webSocketTransport.test.ts`:
```ts
import { createWebSocketTransport } from '@watchtower/transport';
```
(was `'../../../client/src/transport/webSocketTransport.js'`)

In `tests/client/transport/selectTransport.test.ts`:
```ts
import { readWsConfig } from '@watchtower/transport';
```
(was `'../../../client/src/transport/selectTransport'`)

- [ ] **Step 7: Add the transport alias to `client/vite.config.ts`**

Extend `resolve.alias`:

```ts
  resolve: {
    alias: {
      '@watchtower/shared': path.resolve(__dirname, '../packages/shared/src'),
      '@watchtower/transport': path.resolve(__dirname, '../packages/transport/src'),
    },
  },
```

- [ ] **Step 8: Add the transport alias to root `vitest.config.ts`**

Extend `resolve.alias`:

```ts
  resolve: {
    alias: {
      '@watchtower/shared': path.resolve(__dirname, 'packages/shared/src'),
      '@watchtower/transport': path.resolve(__dirname, 'packages/transport/src'),
    },
  },
```

- [ ] **Step 9: Add the transport `paths` to `client/tsconfig.json`**

Extend its `paths`:

```json
    "paths": {
      "@watchtower/shared/*": ["../packages/shared/src/*"],
      "@watchtower/transport": ["../packages/transport/src/index.ts"]
    }
```

- [ ] **Step 10: Add transport to the `typecheck` script**

In root `package.json`, prepend the transport check to `typecheck` (after the shared build):

```json
    "typecheck": "tsc -b packages/shared/tsconfig.json && tsc -p packages/transport/tsconfig.json --noEmit && tsc -p electron/tsconfig.json --noEmit && tsc -p orchestrator/tsconfig.json --noEmit && tsc -p client/tsconfig.json --noEmit",
```

- [ ] **Step 11: Verify**

```bash
cd /Users/jan/Projects/Watchtower
grep -rn "client/src/transport" --include='*.ts' --include='*.tsx' . || echo "OK: no transport relative imports remain"
npm run typecheck    # clean except the 3 documented drifts
npm test             # >= 617 passing
```

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "refactor: #70 extract @watchtower/transport workspace package

Move client/src/transport -> packages/transport (renderer-only source
alias, no build). Rewire browserStub + transport tests to the barrel;
add Vite/vitest/tsconfig aliases.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `client/` → `apps/desktop/`

Pure directory move + build-path rewiring. The renderer's internal relative imports move together and need no change; only cross-package specifiers (already on `@watchtower/*`) and external references to `client/` change.

**Files:**
- Move: `client/*` → `apps/desktop/*` (`src/`, `index.html`, `vite.config.ts`, `tsconfig.json`)
- Create: `apps/desktop/package.json`
- Modify: `apps/desktop/vite.config.ts` (outDir + alias depth), root `package.json` (renderer scripts + typecheck path), ~16 client-importing test files

**Interfaces:**
- Consumes: `@watchtower/shared/*`, `@watchtower/transport` (already wired).
- Produces: renderer at `apps/desktop/`, still emitting to repo-root `dist-renderer` (electron's `loadFile` + electron-builder globs unchanged).

- [ ] **Step 1: Move the renderer (preserve history)**

```bash
cd /Users/jan/Projects/Watchtower
mkdir -p apps
git mv client apps/desktop
```

Expected: `apps/desktop/{src,index.html,vite.config.ts,tsconfig.json}` exist; `client/` is gone.

- [ ] **Step 2: Create `apps/desktop/package.json`**

```json
{
  "name": "@watchtower/desktop",
  "version": "0.0.0",
  "private": true,
  "type": "module"
}
```

- [ ] **Step 3: Fix `apps/desktop/vite.config.ts` — outDir and alias depths**

The config moved one level deeper (`root/client` → `root/apps/desktop`), so every `../` to repo-root assets needs one more `../`:

```ts
  resolve: {
    alias: {
      '@watchtower/shared': path.resolve(__dirname, '../../packages/shared/src'),
      '@watchtower/transport': path.resolve(__dirname, '../../packages/transport/src'),
    },
  },
  server: { port: 5173, strictPort: true },
  build: {
    outDir: path.resolve(__dirname, '../../dist-renderer'),
    emptyOutDir: true,
  },
```

(`outDir` stays repo-root `dist-renderer` — only the `../` depth changes from `..` to `../..`.)

- [ ] **Step 4: Fix `apps/desktop/tsconfig.json` — extends + paths depths**

It moved one level deeper, so `../tsconfig.base.json` → `../../tsconfig.base.json` and `../packages/*` → `../../packages/*`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "../../dist-renderer",
    "rootDir": ".",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "noEmit": true,
    "baseUrl": ".",
    "paths": {
      "@watchtower/shared/*": ["../../packages/shared/src/*"],
      "@watchtower/transport": ["../../packages/transport/src/index.ts"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx"]
}
```

- [ ] **Step 5: Update root `package.json` renderer scripts + typecheck path**

Change every `client/` reference to `apps/desktop/`:

```json
    "dev:renderer": "vite --config apps/desktop/vite.config.ts",
    "build:renderer": "vite build --config apps/desktop/vite.config.ts",
    "typecheck": "tsc -b packages/shared/tsconfig.json && tsc -p packages/transport/tsconfig.json --noEmit && tsc -p electron/tsconfig.json --noEmit && tsc -p orchestrator/tsconfig.json --noEmit && tsc -p apps/desktop/tsconfig.json --noEmit",
```

- [ ] **Step 6: Rewire client-importing test files (scripted)**

Both `client/` and `apps/desktop/` are reached from `tests/` via a `../`-to-root prefix, so the fix is a literal segment swap `client/src` → `apps/desktop/src` (transport test files already point at `@watchtower/transport` from Task 2, so they're untouched):

```bash
cd /Users/jan/Projects/Watchtower
FILES=$(grep -rl "client/src" --include='*.ts' --include='*.tsx' tests)
echo "$FILES" | tr ' ' '\n'   # review (~16 files)
perl -pi -e "s{client/src}{apps/desktop/src}g" $FILES
grep -rn "client/src" --include='*.ts' --include='*.tsx' tests || echo "OK: no client/src refs remain"
```

- [ ] **Step 7: Verify the build outputs land in the right place**

```bash
cd /Users/jan/Projects/Watchtower
rm -rf dist-renderer
npm run build:renderer
ls dist-renderer/index.html              # exists at repo root (electron loadFile target)
npm run typecheck                        # clean except the 3 documented drifts
npm test                                 # >= 617 passing
grep -rn "'\.\./.*client/" --include='*.ts' --include='*.tsx' . || echo "OK: no client/ relative refs remain"
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: #70 move renderer client/ -> apps/desktop/

Relocate the Electron React renderer into apps/desktop; keep Vite outDir
at repo-root dist-renderer so electron loadFile + electron-builder globs
are untouched. Fix config relative depths and test import paths.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Full verification — build, run, package

No source changes (unless a contingency fires). This task is the acceptance gate (spec §7): real build, dev launch, native-module sanity, and a packaged `.app` that runs identically — specifically proving the orchestrator resolves `@watchtower/shared` at **runtime**, not just typecheck (spec §9 risk).

**Files:** none expected. Contingencies below may touch `package.json` `build.files`.

- [ ] **Step 1: Clean full build**

```bash
cd /Users/jan/Projects/Watchtower
rm -rf dist-electron dist-orchestrator dist-renderer dist-helper packages/shared/dist
npm run build
```

Expected: succeeds. Verify the load-bearing output layout is intact:

```bash
ls dist-electron/electron/main.js          # package.json "main" target
ls dist-electron/electron/preload.cjs      # buildPreload output
ls dist-orchestrator/orchestrator/index.js # orchestrator entry (copy-orch-assets layout)
ls dist-renderer/index.html                # electron loadFile target
ls packages/shared/dist/ipcContract.js     # shared built for runtime resolution
```

- [ ] **Step 2: Prove the orchestrator's emitted JS resolves `@watchtower/shared` at Node runtime**

The orchestrator emits bare `import '@watchtower/shared/…js'`; confirm Node resolves it via the workspace symlink + `exports` (not just tsc paths):

```bash
cd /Users/jan/Projects/Watchtower
grep -rn "@watchtower/shared" dist-orchestrator/orchestrator/ | head -3   # bare specifiers present in emit
node --input-type=module -e "import('@watchtower/shared/ipcContract.js').then(m => console.log('resolved keys:', Object.keys(m).length))"
```

Expected: the dynamic import resolves (prints a key count > 0), proving `node_modules/@watchtower/shared` → `dist` works at runtime.

- [ ] **Step 3: `tsc -b` and typecheck clean**

```bash
npx tsc -b            # solution build clean
npm run typecheck     # clean except the 3 documented pre-existing drifts
```

- [ ] **Step 4: Full test suite green**

```bash
npm test
```

Expected: ≥ 617 passing, 0 failing.

- [ ] **Step 5: `npm run dev` smoke test**

```bash
npm run dev
```

Expected: Vite serves on 5173, electron main + orchestrator tsc-watch compile clean, the app window opens and the orchestrator connects (instances/timetracker load). Quit after confirming. If running headless and the window can't be observed, report that `dev` compiled and served without error and defer the visual check to the user.

- [ ] **Step 6: `npm run dist:mac` and launch the packaged app**

```bash
npm run dist:mac
```

Expected: produces an unsigned `.app`/`.dmg` under `release/`. Launch the `.app`; confirm it runs identically (instances spawn, DB opens, ptys work — exercising the native modules + the packaged orchestrator's runtime `@watchtower/shared` resolution).

**Contingency (packaged orchestrator can't resolve `@watchtower/shared`):** if the packaged app errors with a module-not-found for `@watchtower/shared`, electron-builder did not pack the workspace package. Add to `package.json` `build.files`:
```json
      "packages/shared/dist/**/*",
      "packages/shared/package.json",
```
(and confirm `node_modules/@watchtower/shared` is present/dereferenced in the asar). Rebuild `dist:mac` and re-launch.

- [ ] **Step 7: Final acceptance grep (spec §7)**

```bash
cd /Users/jan/Projects/Watchtower
test ! -d shared && test ! -d client && echo "OK: shared/ and client/ gone"
grep -rnE "from '(\.\./)+shared/" --include='*.ts' --include='*.tsx' . || echo "OK: no relative ../shared imports remain"
```

Expected: both print `OK`.

- [ ] **Step 8: Commit any contingency changes (if Step 6 fired)**

```bash
git add -A
git commit -m "build: #70 pack @watchtower/shared into electron-builder output

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

(If no contingency fired, Task 4 produces no commit — it is the verification gate.)

---

## Self-review against the spec

- **§2 target layout** — Tasks 1–3 create `packages/shared`, `packages/transport`, `apps/desktop`; electron/orchestrator/helper stay put; root `workspaces` field (T1.4); root solution `tsconfig` (T1.12). ✓
- **§3 hybrid resolution** — shared = composite built package, references + symlink→dist for Node, alias→src for Vite/vitest (T1.2/3/7/8/10/11); transport = source alias (T2). The `paths` placement deviation (leaf configs, not base) is documented above with rationale; it preserves the spec's resolution intent. ✓
- **§4 sequence** — T1 (workspaces+shared+all rewrites), T2 (transport), T3 (client→apps/desktop), T4 (references/scripts already folded in + full verification). Each task ends green. ✓
- **§5 tests** — `tests/` stays at root; 20 shared imports rewired (T1.6, incl. the extensionless one), 16 client-path imports rewired (T3.6), 2 transport imports rewired (T2.6); vitest aliases + `pool: forks/singleFork` preserved (T1.11/T2.8). ✓
- **§6 packaging** — output dirs unchanged; `dist:mac` verified in T4.6 with an explicit contingency for the workspace-symlink-in-asar risk. ✓
- **§7 acceptance** — ≥617 tests (every task), `tsc -b`/typecheck clean (T1.15/T4.3), `dev` launches (T4.5), `dist:mac` runs (T4.6), no `shared/`·`client/`·relative-`../shared` remain (T4.7). ✓
- **§9 risks** — native rebuild (T1.5), tsc-emit-vs-bare-specifier proven at runtime (T4.2), interdependent moves batched per package (task boundaries). ✓
