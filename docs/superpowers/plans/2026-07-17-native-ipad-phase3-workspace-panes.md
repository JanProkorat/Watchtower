# Native iPad Phase 3 — Workspace Panes (Tiling) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace Phase 2's single-terminal pane with a tiling workspace — a per-group layout tree of split/leaf panes, each leaf hosting its own live terminal, with split/close/resize, a pane picker, ⌘-key pane navigation, and local persistence.

**Architecture:** Pure layout-tree model + ops ported to `WatchtowerBridge` (host-unit-tested), an `InstancesFeature` reducer change from `selectedInstanceId` → a per-group `TabLayout` tree (focused leaf derived), a UserDefaults-backed `WorkspaceLayoutStore`, and a recursive SwiftUI `WorkspacePaneView` that renders the tree with N concurrent `RemoteTerminalView`s + dividers + pane chrome + keyboard shortcuts. No transport/orchestrator changes. The keyboard-accessory bar (on-screen keyboard) is **deferred** (only its pure sequence-mapping helper may be ported later).

**Tech Stack:** Swift/SwiftUI, TCA, SwiftTerm (from Phase 2), XcodeGen. iOS 26 app target (from the Liquid Glass pass).

**Spec:** `docs/superpowers/specs/2026-07-15-native-ipad-swiftui-rewrite-design.md` (Phase 3 row).

## Global Constraints

- **Ports from TS (verbatim behavior):** `packages/shared/src/layout.ts`, `packages/shared/src/workspaceTreeOps.ts`, `packages/shared/src/computePaneRects.ts`, `apps/ipad/src/state/workspaceLayoutModel.ts`, `apps/ipad/src/lib/paneResize.ts`, `apps/ipad/src/lib/paneNav.ts`, `apps/ipad/src/lib/panePicker.ts`. Match their semantics and port their test vectors.
- **Pure logic + reducer → `swift/WatchtowerCore/Sources/WatchtowerBridge/`** (host-testable); **views + gestures → `apps/ipad-native/Watchtower/`** (build-verified). SwiftTerm/glass stay app-target only.
- **Multiple concurrent terminals:** each leaf gets its own `TerminalController`/`TerminalSession`. `BridgeConnection.pushes(kind:)` is a per-subscriber dictionary (confirmed Phase 2) → N per-instance subscribers fan out cleanly; each `TerminalSession` filters by `instanceId`.
- **No behavior change to the transport/orchestrator.** `TerminalSession`/`RemoteTerminalView`/`TerminalController` are reused as-is (one per leaf).
- **English UI; no i18n.** Dark mode only.
- **Deterministic default-leaf id** `"d-<instanceId>"` (NOT random) so an unstored tab's default rebuilt each render keeps a stable SwiftUI `.id` and doesn't remount SwiftTerm. Real splits use fresh ids (`newNodeId()`), guaranteed not to collide with `"d-"`.
- Package tests: `cd swift/WatchtowerCore && swift test` (296 at branch start). App build: `cd apps/ipad-native && [ -f ../iphone-native/Watchtower/Secrets.xcconfig ] && cp ../iphone-native/Watchtower/Secrets.xcconfig Watchtower/Secrets.xcconfig || cp Watchtower/Secrets.sample.xcconfig Watchtower/Secrets.xcconfig; xcodegen generate && xcodebuild -project Watchtower.xcodeproj -scheme Watchtower -destination 'generic/platform=iOS Simulator' -skipMacroValidation -derivedDataPath build CODE_SIGNING_ALLOWED=NO build` → `** BUILD SUCCEEDED **`. Don't commit Secrets.xcconfig/.xcodeproj.
- Work from worktree `/Users/jan/Projects/Watchtower/.claude/worktrees/ipad-native-phase3` (branch `feat/ipad-native-phase3`). Commit per task; trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

### Task 1: Layout tree model + pure ops (port of layout.ts + workspaceTreeOps.ts)

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerBridge/Workspace/WorkspaceTree.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerBridgeTests/WorkspaceTreeTests.swift`

**Interfaces produced:**
- `typealias NodeId = String`
- `enum SplitDir: String, Codable, Sendable { case row, col }`
- `indirect enum WorkspaceNode: Equatable, Sendable { case leaf(id: NodeId, tabId: String); case split(id: NodeId, dir: SplitDir, sizes: [Double], children: [WorkspaceNode]) }` with `var id: NodeId`.
- Constructors: `func makeLeaf(_ id: NodeId, _ tabId: String) -> WorkspaceNode`; `func makeSplit(_ id: NodeId, _ dir: SplitDir, _ children: [WorkspaceNode], sizes: [Double]? = nil) -> WorkspaceNode` (defaults to `evenSizes(children.count)`); `func evenSizes(_ n: Int) -> [Double]` (each `100/n`, last child absorbs the rounding remainder so the sum is exactly 100).
- Queries: `findLeafById(_:_ id:)`, `findLeafByTabId(_:_ tabId:)` (first pre-order match), `firstLeafInPreOrder(_:)`, `collectTabIds(_:)`, `containsTabId(_:_ tabId:)`.
- Mutations (all pure, return a new tree): `splitLeaf(_ node:, targetLeafId:, dir:, position:, newTabId:) -> WorkspaceNode` (position `enum InsertPosition { case before, after }`; **guarded**: if `containsTabId(node, newTabId)` returns the SAME node value — callers detect the no-op by equality); `unmountLeaf(_ node:, leafId:) -> WorkspaceNode?` (collapse rules below); `setSizes(_ node:, splitId:, sizes:) -> WorkspaceNode`; `replaceLeafTab(_ node:, leafId:, newTabId:) -> WorkspaceNode`.

**Collapse rules for `unmountLeaf` (port exactly):** remove the leaf; then per surviving children count: 0 → return `nil` (last pane closed); 1 → return that single surviving child directly (the split node disappears — no 1-child split ever exists); 2+ → keep the split but rebalance to `evenSizes(count)`.

- [ ] **Step 1: Write the failing tests** — port the vectors from `tests/shared/workspaceTreeOps.test.ts`. Cover: `evenSizes` remainder (e.g. `evenSizes(3)` sums to 100.0); split a leaf before/after → 2-child 50/50 split; split guard (splitting an already-mounted tabId returns an equal node); `unmountLeaf` 0/1/2+ survivor collapse rules (incl. survivor promotion); `setSizes`; `replaceLeafTab`; `findLeafByTabId` first-match; `firstLeafInPreOrder`; `containsTabId`. Run `cd swift/WatchtowerCore && swift test --filter WorkspaceTreeTests` → RED.

- [ ] **Step 2: Implement `WorkspaceTree.swift`** per the interfaces + collapse rules. `WorkspaceNode` is an `indirect enum`; recursion via `children.map`. `var id` switches on the case.

- [ ] **Step 3: GREEN** — filtered tests pass; full `swift test` → no regressions (296 + new).

- [ ] **Step 4: Commit** `git commit -m "feat(ipad-native): workspace layout tree model + pure ops (Phase 3)"`.

---

### Task 2: iPad layout layer + persistence (port of workspaceLayoutModel.ts + useWorkspaceLayout store)

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerBridge/Workspace/WorkspaceLayout.swift`
- Create: `swift/WatchtowerCore/Sources/WatchtowerBridge/Workspace/WorkspaceLayoutStore.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerBridgeTests/WorkspaceLayoutTests.swift`

**Interfaces produced (consumes Task 1):**
- `struct TabLayout: Codable, Equatable, Sendable { var root: WorkspaceNode; var focusedLeafId: NodeId? }` (make `WorkspaceNode`/`SplitDir` `Codable` — add conformance in Task 1's file or here; the indirect enum needs a manual/derived Codable — a `kind` discriminator is simplest).
- `typealias WorkspaceState = [String: TabLayout]` (keyed by group tab-key).
- `func tiledDefaultLayout(instanceIds: [String], focusedInstanceId: String) -> TabLayout` (tiles all as an even `row`; 1 instance → single leaf; focus the given id if present else first).
- `func defaultTabLayout(instanceId: String) -> TabLayout` (single leaf, **id `"d-\(instanceId)"`**).
- `func splitPane(_ layout:, targetLeafId:, dir:, position:, instanceId:) -> TabLayout` (wraps `splitLeaf`; refused → returns `layout` unchanged; else focus the new leaf).
- `func closePane(_ layout:, leafId:, fallbackInstanceId:) -> TabLayout` (wraps `unmountLeaf`; nil → `defaultTabLayout(fallback)`; else keep focus if the leaf survives, else `firstLeafInPreOrder`).
- `func resizeSplitSizes(_ layout:, splitId:, sizes:) -> TabLayout`; `func replacePane(_ layout:, leafId:, instanceId:) -> TabLayout`; `func focusPane(_ layout:, leafId:) -> TabLayout`.
- `func appendPaneRight(_ layout:, instanceId:) -> TabLayout` (refuse if mounted; row-root → append child + re-even; else wrap root in a new row split 50/50 with new pane right; focus new).
- `func mountedInstanceIds(_ layout: TabLayout) -> [String]`.
- `@DependencyClient WorkspaceLayoutStore { var load: @Sendable () -> WorkspaceState = {[:]} ; var save: @Sendable (WorkspaceState) -> Void }` + `.store(defaults:)` seam + `DependencyValues.workspaceLayoutStore`; key `"watchtower.ipad.workspace.tiling.v1"`; JSON via `JSONEncoder`/`JSONDecoder`; corrupt/missing → `[:]` (mirror `ConnectionStore`).

- [ ] **Step 1: Write failing tests** — port vectors from `tests/ipad/workspaceLayoutModel.test.ts`: `defaultTabLayout` deterministic id; `tiledDefaultLayout` (1 vs N); `splitPane` focus + refuse-when-mounted; `closePane` last-pane fallback + focus-move; `appendPaneRight` (row-append+even vs wrap); `mountedInstanceIds`; Codable round-trip of a nested `TabLayout`; `WorkspaceLayoutStore` empty→[:], save→load round-trip, corrupt→[:]. RED.

- [ ] **Step 2: Implement** the three files. For `WorkspaceNode` Codable use a `kind`-discriminated container (`"leaf"`/`"split"`).

- [ ] **Step 3: GREEN** — filtered + full `swift test`.

- [ ] **Step 4: Commit** `git commit -m "feat(ipad-native): workspace layout layer + UserDefaults store (Phase 3)"`.

---

### Task 3: Pure UI-math helpers — resize, nav, picker, rects

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerBridge/Workspace/PaneMath.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerBridgeTests/PaneMathTests.swift`

**Interfaces produced:**
- `func sizesAfterDrag(_ sizes: [Double], dividerIndex: Int, deltaPercent: Double, min: Double = 8) -> [Double]` — only the two panes flanking `dividerIndex` change; clamp `newA` into `[min, (a+b)-min]` (port of `paneResize.ts`).
- `struct PaneRect: Equatable, Sendable { var x, y, w, h: Double }`; `func computePaneRects(_ root: WorkspaceNode, width: Double, height: Double, gap: Double) -> [NodeId: PaneRect]` (distribute along `dir` proportional to `sizes`, subtract `gap*(n-1)`; recurse) — port of `computePaneRects.ts`; used for divider hit-rects + `adjacentLeaf`.
- `func adjacentLeaf(_ rects: [NodeId: PaneRect], focusedLeafId: NodeId, dir: NavDir) -> NodeId?` (`enum NavDir { case left, right, up, down }`) — leaf-center scoring `primary + cross*2`, filter strictly in `dir`, `nil` if none. **Caller passes a leaf-only rect map.**
- `func availableInstancesForPicker(groupInstanceIds: [String], mountedInstanceIds: [String]) -> [String]` — order-preserving set difference (port of `panePicker.ts`).

- [ ] **Step 1: Failing tests** — port `tests/shared/computePaneRects.test.ts` + `tests/ipad/paneResize`/`paneNav`/`panePicker` vectors: resize clamps both panes at min; rects sum with gaps; nav picks aligned neighbour + returns nil off-edge; picker difference preserves order. RED.

- [ ] **Step 2: Implement `PaneMath.swift`.**

- [ ] **Step 3: GREEN** — filtered + full suite.

- [ ] **Step 4: Commit** `git commit -m "feat(ipad-native): pane resize/nav/picker/rects math (Phase 3)"`.

---

### Task 4: InstancesFeature — tree state, actions, persistence, spawn→appendRight

**Files:**
- Modify: `swift/WatchtowerCore/Sources/WatchtowerBridge/Features/InstancesFeature.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerBridgeTests/InstancesFeatureTests.swift`

**Interfaces / behavior:**
- Add `@Dependency(\.workspaceLayoutStore)`. State: add `var layouts: WorkspaceState = [:]`. Keep `selectedInstanceId` as a **derived** convenience (computed from the active group's `TabLayout.focusedLeafId` → leaf tabId) for the toolbar/authBlock consumers — or replace its writes; either way `instanceSelected` now sets focus in the active group's layout.
- Active group key: reuse the group's `id` from `groupInstancesByProject` (`ProjectGroup.id`) as the tab-key. Add `var activeGroupId: String?` (the currently-shown group tab) if not already present; default to the first group.
- Actions (new): `paneSplit(leafId: NodeId, dir: SplitDir, position: InsertPosition, instanceId: String)`, `paneClosed(leafId: NodeId)`, `paneResized(splitId: NodeId, sizes: [Double])`, `paneFocused(leafId: NodeId)`, `paneReplaced(leafId: NodeId, instanceId: String)`, `layoutsLoaded(WorkspaceState)`. Each applies the matching `WorkspaceLayout` function to `layouts[activeGroupId]` and persists (fire-and-forget `workspaceLayoutStore.save`, or a debounced effect — a plain save on each mutation is acceptable for MVP, mirroring ConnectionStore's synchronous save).
- `onAppear`: also `layoutsLoaded(workspaceLayoutStore.load())`; when a group is first shown with no stored layout, seed `tiledDefaultLayout(group.instanceIds, focusedInstanceId:)` (ensureTab).
- `spawn(.presented(.spawned(id)))`: replace `selectedInstanceId = id` with `appendPaneRight` into the active group's layout (matches iPad `App.tsx`), then persist.
- Keep all Phase-2 behavior (grouping, attention, authBlock, `@Presents` spawn) intact.

- [ ] **Step 1: Write/extend TestStore tests** — assert: `onAppear` loads layouts + seeds a default tiled layout for the active group; `paneSplit` mutates the tree + persists (LockIsolated capture on `workspaceLayoutStore.save`); `paneClosed` collapses/last-pane-fallback; `paneFocused` updates focus + derived `selectedInstanceId`; `spawned` appends a pane. Refuse-when-mounted split is a no-op. RED first.

- [ ] **Step 2: Implement** the reducer changes. Derive `selectedInstanceId` (or keep a stored mirror updated on focus). Persist on each mutation.

- [ ] **Step 3: GREEN** — filtered + full `swift test` (no regressions; the Phase-2 InstancesFeature tests must still pass — adapt any that asserted the old `selectedInstanceId` write semantics, keeping them meaningful).

- [ ] **Step 4: Commit** `git commit -m "feat(ipad-native): InstancesFeature tiling state + actions + persistence (Phase 3)"`.

---

### Task 5: WorkspacePaneView — recursive tiling UI + per-leaf terminals + chrome + shortcuts

**Files:**
- Create: `apps/ipad-native/Watchtower/Views/WorkspacePaneView.swift`
- Create: `apps/ipad-native/Watchtower/Views/PanePickerView.swift`
- Modify: `apps/ipad-native/Watchtower/Views/InstancesView.swift`

**Interfaces:** consumes `WorkspaceNode`/`TabLayout`/`SplitDir`, `sizesAfterDrag`, `adjacentLeaf`+`computePaneRects`, `availableInstancesForPicker`, `RemoteTerminalView` (Phase 2), the new InstancesFeature actions, glass helpers (`floatingGlass`).

- [ ] **Step 1: Recursive pane view + terminals**

Create `WorkspacePaneView(node: WorkspaceNode, ...)`: switch on the node —
  - `.leaf(id, tabId)`: `RemoteTerminalView(instanceId: tabId).id(tabId)` (opaque; stable id so SwiftTerm isn't remounted) wrapped in pane chrome (a small top-right glass button cluster: split-right → `paneSplit(.row,.after)`, split-down → `paneSplit(.col,.after)`, close → `paneClosed`; a top-edge focus ring when this leaf == focusedLeafId; tap → `paneFocused`).
  - `.split(id, dir, sizes, children)`: an `HStack`(row)/`VStack`(col) laying out each child in a `GeometryReader`-measured fraction of `sizes`, with a draggable divider between children (drag delta→percent via the container size → `sizesAfterDrag` → `paneResized`). Recurse `WorkspacePaneView` per child.

Split triggering an empty target (or the "+ New pane" affordance) presents `PanePickerView` (a glass overlay listing `availableInstancesForPicker(group.instanceIds, mountedInstanceIds(layout))`) whose selection supplies the `instanceId` to `paneSplit`.

- [ ] **Step 2: Keyboard shortcuts** — attach `.keyboardShortcut`/a key handler for ⌘D (split-row-after focused), ⌘⇧D (split-col-after), ⌘W (close focused), ⌘⌥←/→/↑/↓ (`adjacentLeaf` over the leaf-only `computePaneRects` map for the current container size → `paneFocused`). (SwiftUI `.keyboardShortcut` on hidden buttons, or a `.onKeyPress` handler.)

- [ ] **Step 3: Wire into InstancesView** — replace the single-pane `detail` (`RemoteTerminalView(instanceId: selectedInstanceId)`) with `WorkspacePaneView` driven by `layouts[activeGroupId]?.root`; empty-state when the active group has no instances. Group tab tap sets `activeGroupId` (+ ensures its default layout). Keep toolbar (+New, Remove, authBlock banner) — Remove now targets the focused leaf's instance.

- [ ] **Step 4: Build** → `** BUILD SUCCEEDED **`.

- [ ] **Step 5: Commit** `git commit -m "feat(ipad-native): recursive tiling WorkspacePaneView + pane picker + shortcuts (Phase 3)"`.

---

### Task 6: Verification

**Files:** none (operational).

- [ ] **Step 1:** `cd swift/WatchtowerCore && swift test` green (296 + all new Phase-3 tests) — the tree/layout/math/reducer logic is fully covered here (this phase is heavily unit-testable, unlike pure-visual passes).
- [ ] **Step 2:** App BUILD SUCCEEDED; launch on the iOS 26 iPad sim; confirm no startup crash with the new tiling wiring; screenshot the empty-state / pane picker where visible.
- [ ] **Step 3 (needs live Mac):** on device/with a Mac bridge — split a pane (⌘D + chrome button), verify two live terminals stream concurrently; resize the divider; ⌘⌥-arrows move focus; close a pane (collapse); spawn → appends a pane; layout persists across relaunch. Record deviations; fix individually.

---

## Plan self-review (completed at authoring time)

- **Spec coverage (Phase 3 row):** layout tree pure-logic port → T1+T2; pane resize → T3; pane picker → T3+T5; pane navigation (⌘-keys) → T5; layout persisted locally → T2+T4; recursive tiling render + N terminals → T5. Keyboard-accessory bar **deferred** (user decision) — noted, not built.
- **Concurrency:** N per-leaf `TerminalSession`s validated by Phase 2's per-subscriber `pushes` dict (Global Constraints) — no transport change.
- **No-remount:** deterministic `"d-"` leaf ids + stable `.id(tabId)` on `RemoteTerminalView` prevent SwiftTerm remounts (Global Constraints + T5).
- **Type consistency:** `WorkspaceNode`/`SplitDir`/`NodeId`/`TabLayout`/`WorkspaceState`/`InsertPosition`/`NavDir`/`PaneRect` + all op names are spelled identically across T1–T5.
- **Regression:** Phase-2 `InstancesFeature` tests adapted (T4) rather than deleted; full `swift test` green gate in T1–T4 + T6.
- **Verification model:** pure logic + reducer are TDD (T1–T4); views are build-verified (T5); live multi-terminal tiling is on-device (T6, needs a Mac).
