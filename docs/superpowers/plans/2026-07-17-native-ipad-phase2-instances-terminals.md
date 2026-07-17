# Native iPad Phase 2 — Instances + Terminals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A native iPad Instances module: a project-grouped tab strip of Claude Code instances with attention marks, a live SwiftTerm terminal pane wired to the Mac orchestrator over the WS bridge (attach + scrollback replay, streaming output, keystrokes, resize, focus), a spawn/restart modal, an auth-block advisory banner, and remove-instance — all over the `WatchtowerBridge`/`BridgeClient` transport shipped in Phase 1.

**Architecture:** All control-plane logic (typed requests, the attach controller, the `InstancesFeature`/`SpawnFeature`/`TerminalSessionFeature` reducers, pure grouping/attention ports) lives in the `WatchtowerBridge` SPM target and is unit-/TestStore-tested on the macOS host. The SwiftUI views + the SwiftTerm `UIViewRepresentable` live in the `apps/ipad-native` app target (iOS-only; SwiftTerm is an app-target dependency the iPhone never links). This phase is **single-pane** — one terminal for the selected instance; tiling/split panes and the keyboard-accessory bar are Phase 3.

**Tech Stack:** Swift 5.10, SwiftUI, The Composable Architecture (already resolved at 1.26 in Phase 1), SwiftTerm 1.14.0 (new, app-target only), XcodeGen, `URLSessionWebSocketTask` (via Phase 1's `BridgeClient`).

**Spec:** `docs/superpowers/specs/2026-07-15-native-ipad-swiftui-rewrite-design.md` (Phase 2 row of §3).

## Global Constraints

- **UI language is English.** cs-CZ only for date/number/currency *formatting* (N/A this phase). No i18n. Code comments in English.
- **iOS deployment target 17.0**; package platforms stay `.iOS(.v17), .macOS(.v13)` — keep macOS 13 so `swift test` runs on the host.
- **Do not touch the iPhone app** (`apps/iphone-native/`) or the existing `WatchtowerCore` target sources. New logic goes in `WatchtowerBridge`; new views in `apps/ipad-native`.
- **SwiftTerm links the app target only** (add to `apps/ipad-native/project.yml`, never to `WatchtowerBridge`/`WatchtowerCore` — the iPhone app must not pull it in).
- **Reuse Phase 1 transport verbatim:** `BridgeClient.send(kind:payload:) -> Data`, `BridgeClient.pushes(kind:) -> AsyncStream<Data>`, `BridgeClient.statusStream() -> AsyncStream<ConnStatus>`, and the typed `invoke(_:)` extension + `BridgeRequest`/`BridgePush` from Task 7 of Phase 1. `listInstances` (`ListInstancesRequest`/`BridgeInstance`) and `BridgePush.stateChanged` already exist — extend, don't duplicate.
- **Wire contract is authoritative** (verified against `packages/shared/src/ipcContract.ts` + the orchestrator): frames are `{id,kind,payload}` request / `{id,kind,payload?,error?}` response / `{push:true,kind,payload}` push. Enums: `InstanceStatus = spawning|working|waiting-permission|waiting-input|idle-notify|finished|crashed|suspended|resuming`; `InstanceKind = claude|shell`. Decode `status` defensively (unknown string → keep as raw String, never crash).
- **Work from the worktree** `/Users/jan/Projects/Watchtower/.claude/worktrees/ipad-native-phase2` (branch `feat/ipad-native-phase2`, off `origin/main` which already contains Phase 1). All paths below are relative to that worktree root.
- **Verification commands:**
  - Package tests: `cd swift/WatchtowerCore && swift test` (must stay green incl. all Phase 1 tests — 256 at branch start).
  - App build: `cd apps/ipad-native && xcodegen generate && xcodebuild -project Watchtower.xcodeproj -scheme Watchtower -destination 'generic/platform=iOS Simulator' -skipMacroValidation CODE_SIGNING_ALLOWED=NO build` → `** BUILD SUCCEEDED **`.
- **TCA style:** follow Phase 1 — `@Reducer`, `@ObservableState`, `@CasePathable`+`@dynamicMemberLookup` on nested enums, `@Dependency`, `@DependencyClient`, `@Shared(.inMemory(...))` only if cross-reducer sharing is needed. TestStore tests deterministic (test dependencies; no real sockets).
- Commit after every task with a conventional-commit message + trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

### Task 1: Pure instance / grouping / attention logic

Port the framework-free TS transforms so they can be unit-tested on the host with no TCA/socket involvement.

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerBridge/Instances/InstanceModel.swift`
- Create: `swift/WatchtowerCore/Sources/WatchtowerBridge/Instances/InstanceGrouping.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerBridgeTests/InstanceGroupingTests.swift`

**Interfaces:**
- Produces:
  - `struct Instance: Equatable, Sendable, Identifiable { id: String; cwd: String; status: String; lastActivityAt: Double; kind: String; taskId: Int? }` (mirrors `BridgeInstance` from Phase 1 — this is the domain value; Task 2's DTO maps into it).
  - `struct ProjectSummary: Equatable, Sendable, Identifiable { id: Int; name: String; folderPath: String? }`
  - `struct ProjectGroup: Equatable, Sendable, Identifiable { projectId: Int?; label: String; folderPath: String?; instanceIds: [String]; var id: String { projectId.map(String.init) ?? "__other__" } }`
  - `func groupInstancesByProject(_ instances: [Instance], projects: [ProjectSummary]) -> [ProjectGroup]` — match `instance.cwd == project.folderPath`; unmatched → trailing `projectId: nil, label: "Other"` group; omit empty project groups; preserve project order then Other last.
  - `enum InstanceAttention { static let actionNeeded: Set<String> = ["waiting-permission", "waiting-input", "crashed"]; static let live: Set<String> = ["spawning","working","waiting-permission","waiting-input","idle-notify"] }`
  - `func acknowledgedNeedingAttention(instances: [Instance], acked: Set<String>) -> Set<String>` — ids whose status ∈ actionNeeded and not in `acked` (drives tab/bell dots).
  - `func reconcileAcked(_ acked: Set<String>, instances: [Instance]) -> Set<String>` — drop an acked id once its instance leaves `actionNeeded` (so a later re-entry re-notifies). Port of `reconcileAcked`.
  - `func applyAuthBlock(_ prev: Set<String>, instanceId: String, blocked: Bool) -> Set<String>` — add/remove id; return `prev` unchanged when no-op. Port of `authBlockStore.ts`.

- [ ] **Step 1: Write the failing tests**

Create `swift/WatchtowerCore/Tests/WatchtowerBridgeTests/InstanceGroupingTests.swift`:

```swift
import XCTest
@testable import WatchtowerBridge

final class InstanceGroupingTests: XCTestCase {
    private func inst(_ id: String, cwd: String, status: String = "working") -> Instance {
        Instance(id: id, cwd: cwd, status: status, lastActivityAt: 0, kind: "claude", taskId: nil)
    }
    private func proj(_ id: Int, _ name: String, _ path: String?) -> ProjectSummary {
        ProjectSummary(id: id, name: name, folderPath: path)
    }

    func testGroupsByFolderPathMatch() {
        let groups = groupInstancesByProject(
            [inst("a", cwd: "/x"), inst("b", cwd: "/y"), inst("c", cwd: "/x")],
            projects: [proj(1, "X", "/x"), proj(2, "Y", "/y")]
        )
        XCTAssertEqual(groups.map(\.label), ["X", "Y"])
        XCTAssertEqual(groups[0].instanceIds, ["a", "c"])
        XCTAssertEqual(groups[1].instanceIds, ["b"])
    }

    func testUnmatchedGoToOtherGroupLast() {
        let groups = groupInstancesByProject(
            [inst("a", cwd: "/x"), inst("z", cwd: "/nowhere")],
            projects: [proj(1, "X", "/x")]
        )
        XCTAssertEqual(groups.map(\.label), ["X", "Other"])
        XCTAssertNil(groups[1].projectId)
        XCTAssertEqual(groups[1].instanceIds, ["z"])
    }

    func testEmptyProjectGroupsOmitted() {
        let groups = groupInstancesByProject(
            [inst("a", cwd: "/x")],
            projects: [proj(1, "X", "/x"), proj(2, "Y", "/y")]
        )
        XCTAssertEqual(groups.map(\.label), ["X"])
    }

    func testProjectWithNilFolderPathNeverMatches() {
        let groups = groupInstancesByProject(
            [inst("a", cwd: "/x")],
            projects: [proj(1, "NoPath", nil)]
        )
        XCTAssertEqual(groups.map(\.label), ["Other"])
    }

    func testAttentionRespectsAckAndStatus() {
        let insts = [inst("a", cwd: "/x", status: "waiting-permission"),
                     inst("b", cwd: "/x", status: "working"),
                     inst("c", cwd: "/x", status: "crashed")]
        XCTAssertEqual(acknowledgedNeedingAttention(instances: insts, acked: []), ["a", "c"])
        XCTAssertEqual(acknowledgedNeedingAttention(instances: insts, acked: ["a"]), ["c"])
    }

    func testReconcileDropsAckWhenInstanceLeavesAttention() {
        let insts = [inst("a", cwd: "/x", status: "working")] // no longer needs attention
        XCTAssertEqual(reconcileAcked(["a", "gone"], instances: insts), [])
    }

    func testReconcileKeepsAckWhileStillNeedingAttention() {
        let insts = [inst("a", cwd: "/x", status: "waiting-input")]
        XCTAssertEqual(reconcileAcked(["a"], instances: insts), ["a"])
    }

    func testApplyAuthBlockAddRemoveAndNoop() {
        XCTAssertEqual(applyAuthBlock([], instanceId: "a", blocked: true), ["a"])
        XCTAssertEqual(applyAuthBlock(["a"], instanceId: "a", blocked: false), [])
        // no-op returns the same set
        XCTAssertEqual(applyAuthBlock(["a"], instanceId: "a", blocked: true), ["a"])
        XCTAssertEqual(applyAuthBlock([], instanceId: "a", blocked: false), [])
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd swift/WatchtowerCore && swift test --filter InstanceGroupingTests 2>&1 | tail -5`
Expected: FAIL — types not defined.

- [ ] **Step 3: Implement the model**

Create `swift/WatchtowerCore/Sources/WatchtowerBridge/Instances/InstanceModel.swift`:

```swift
import Foundation

/// A managed Claude Code / shell session on the Mac. Domain value type; the
/// wire DTO (Task 2's BridgeInstance) maps into this.
public struct Instance: Equatable, Sendable, Identifiable {
    public var id: String
    public var cwd: String
    /// InstanceStatus wire string — kept raw (not an enum) so an unrecognized
    /// server status never crashes a decode. Compare against InstanceAttention sets.
    public var status: String
    public var lastActivityAt: Double
    /// InstanceKind wire string ("claude" | "shell").
    public var kind: String
    public var taskId: Int?

    public init(id: String, cwd: String, status: String, lastActivityAt: Double, kind: String, taskId: Int?) {
        self.id = id; self.cwd = cwd; self.status = status
        self.lastActivityAt = lastActivityAt; self.kind = kind; self.taskId = taskId
    }
}

public struct ProjectSummary: Equatable, Sendable, Identifiable {
    public var id: Int
    public var name: String
    public var folderPath: String?
    public init(id: Int, name: String, folderPath: String?) {
        self.id = id; self.name = name; self.folderPath = folderPath
    }
}

public struct ProjectGroup: Equatable, Sendable, Identifiable {
    public var projectId: Int?
    public var label: String
    public var folderPath: String?
    public var instanceIds: [String]
    public var id: String { projectId.map(String.init) ?? "__other__" }
    public init(projectId: Int?, label: String, folderPath: String?, instanceIds: [String]) {
        self.projectId = projectId; self.label = label
        self.folderPath = folderPath; self.instanceIds = instanceIds
    }
}

public enum InstanceAttention {
    /// Statuses that surface an amber tab/bell dot (idle-notify excluded — passive).
    public static let actionNeeded: Set<String> = ["waiting-permission", "waiting-input", "crashed"]
    /// Statuses considered "live" (spawn/restart modal filters restartable = not live).
    public static let live: Set<String> = ["spawning", "working", "waiting-permission", "waiting-input", "idle-notify"]
}
```

Create `swift/WatchtowerCore/Sources/WatchtowerBridge/Instances/InstanceGrouping.swift`:

```swift
import Foundation

/// Group instances under their project (matched by cwd == folderPath); unmatched
/// instances collect in a trailing "Other" group. Empty project groups are omitted.
/// Port of packages/shared/src/groupInstances.ts.
public func groupInstancesByProject(_ instances: [Instance], projects: [ProjectSummary]) -> [ProjectGroup] {
    var groups: [ProjectGroup] = []
    var claimed = Set<String>()
    for project in projects {
        guard let path = project.folderPath else { continue }
        let ids = instances.filter { $0.cwd == path }.map(\.id)
        guard !ids.isEmpty else { continue }
        ids.forEach { claimed.insert($0) }
        groups.append(ProjectGroup(projectId: project.id, label: project.name, folderPath: path, instanceIds: ids))
    }
    let orphans = instances.filter { !claimed.contains($0.id) }.map(\.id)
    if !orphans.isEmpty {
        groups.append(ProjectGroup(projectId: nil, label: "Other", folderPath: nil, instanceIds: orphans))
    }
    return groups
}

/// Ids that should show an attention dot: status needs action and not acknowledged.
public func acknowledgedNeedingAttention(instances: [Instance], acked: Set<String>) -> Set<String> {
    Set(instances.filter { InstanceAttention.actionNeeded.contains($0.status) && !acked.contains($0.id) }.map(\.id))
}

/// Drop an acked id once its instance no longer needs attention (so re-entry re-notifies).
/// Port of reconcileAcked: keep an ack only while its instance is still in the attention set.
public func reconcileAcked(_ acked: Set<String>, instances: [Instance]) -> Set<String> {
    let stillNeeding = Set(instances.filter { InstanceAttention.actionNeeded.contains($0.status) }.map(\.id))
    return acked.intersection(stillNeeding)
}

/// Fold an authBlock push into the blocked-id set; returns prev unchanged on no-op.
/// Port of authBlockStore.ts applyAuthBlock.
public func applyAuthBlock(_ prev: Set<String>, instanceId: String, blocked: Bool) -> Set<String> {
    if blocked == prev.contains(instanceId) { return prev }
    var next = prev
    if blocked { next.insert(instanceId) } else { next.remove(instanceId) }
    return next
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd swift/WatchtowerCore && swift test --filter InstanceGroupingTests 2>&1 | tail -5`
Expected: PASS (8 tests). Then full `swift test 2>&1 | tail -5` → no regressions.

- [ ] **Step 5: Commit**

```bash
git add swift/WatchtowerCore/Sources/WatchtowerBridge/Instances swift/WatchtowerCore/Tests/WatchtowerBridgeTests/InstanceGroupingTests.swift
git commit -m "feat(ipad-native): pure instance grouping + attention + authBlock logic (Phase 2)"
```

---

### Task 2: Typed bridge requests + push kinds for instances/terminal

Extend Phase 1's typed layer (`BridgeRequests.swift`, `BridgePush`) with every instance/terminal kind. Reuse the existing `BridgeRequest` protocol + `BridgeClient.invoke(_:)`.

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerBridge/Transport/InstanceRequests.swift`
- Modify: `swift/WatchtowerCore/Sources/WatchtowerBridge/Transport/WsFrames.swift`-adjacent push constants — actually add push kinds where Phase 1 defined `BridgePush` (find it: `grep -rn "enum BridgePush\|BridgePush.stateChanged" swift/WatchtowerCore/Sources/WatchtowerBridge`). Add `ptyData` and `authBlock` alongside `stateChanged`.
- Test: `swift/WatchtowerCore/Tests/WatchtowerBridgeTests/InstanceRequestsTests.swift`

**Interfaces:**
- Consumes: `BridgeRequest` protocol, `BridgeClient.invoke`, `BridgeInstance`/`ListInstancesRequest` (Phase 1).
- Produces (all `Codable`; requests conform to `BridgeRequest` with `static let kind` + `associatedtype Response: Decodable`):
  - `RemoveInstanceRequest(instanceId: String)` → `Response { ok: Bool }`, kind `"removeInstance"`.
  - `SpawnInstanceRequest(cwd: String, instanceKind: String)` → `Response { instanceId: String?; error: String? }`, kind `"spawnInstance"`. (Encode only `cwd` + `instanceKind`; omit `args`.)
  - `RestartInstanceRequest(instanceId: String)` → `Response { ok: Bool }` (Bool, may be false), kind `"restartInstance"`.
  - `TerminalAttachRequest(instanceId: String)` → `Response { data: String; cols: Int; rows: Int }`, kind `"terminalAttach"`. (`data` = opaque ANSI SerializeAddon snapshot — feed to SwiftTerm as-is.)
  - `PtyWriteRequest(instanceId: String, data: String)` → `Response { ok: Bool }`, kind `"ptyWrite"`.
  - `PtyResizeRequest(instanceId: String, cols: Int, rows: Int)` → `Response { ok: Bool }`, kind `"ptyResize"`.
  - `TerminalFocusRequest(instanceId: String)` → `Response { ok: Bool }`, kind `"terminalFocus"`.
  - `ProjectsListRequest()` → `Response { projects: [ProjectDTO] }` where `ProjectDTO { id: Int; name: String; folderPath: String? }`, kind `"projects:list"`. (ProjectDTO decodes a subset — the server row has more fields; Codable ignores unknown keys.)
  - Push kinds added to `BridgePush`: `static let ptyData = "ptyData"`, `static let authBlock = "authBlock"`.
  - Push payload DTOs: `PtyDataPush { instanceId: String; chunk: String }`, `StateChangedPush { instanceId: String; status: String }`, `AuthBlockPush { instanceId: String; blocked: Bool; reason: String? }`.

- [ ] **Step 1: Verify the `projects:list` wire shape before coding**

Run: `grep -n "projects:list" packages/shared/src/ipcContract.ts` and read the response payload. Confirm the field name is `folderPath` (camelCase) and the list key is `projects`. If the real key differs, adjust `ProjectDTO`/`ProjectsListRequest.Response` accordingly. (Codable tolerates extra fields, so only the three names used must match.)

- [ ] **Step 2: Write the failing tests**

Create `swift/WatchtowerCore/Tests/WatchtowerBridgeTests/InstanceRequestsTests.swift`:

```swift
import XCTest
@testable import WatchtowerBridge

final class InstanceRequestsTests: XCTestCase {
    private func jsonObject(_ data: Data) -> [String: Any]? {
        (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    func testKindsAreCorrect() {
        XCTAssertEqual(RemoveInstanceRequest.kind, "removeInstance")
        XCTAssertEqual(SpawnInstanceRequest.kind, "spawnInstance")
        XCTAssertEqual(RestartInstanceRequest.kind, "restartInstance")
        XCTAssertEqual(TerminalAttachRequest.kind, "terminalAttach")
        XCTAssertEqual(PtyWriteRequest.kind, "ptyWrite")
        XCTAssertEqual(PtyResizeRequest.kind, "ptyResize")
        XCTAssertEqual(TerminalFocusRequest.kind, "terminalFocus")
        XCTAssertEqual(ProjectsListRequest.kind, "projects:list")
        XCTAssertEqual(BridgePush.ptyData, "ptyData")
        XCTAssertEqual(BridgePush.authBlock, "authBlock")
    }

    func testSpawnEncodesCwdAndKind() throws {
        let data = try JSONEncoder().encode(SpawnInstanceRequest(cwd: "/x", instanceKind: "claude"))
        let obj = try XCTUnwrap(jsonObject(data))
        XCTAssertEqual(obj["cwd"] as? String, "/x")
        XCTAssertEqual(obj["instanceKind"] as? String, "claude")
        XCTAssertNil(obj["args"]) // omitted
    }

    func testPtyWriteEncodesFields() throws {
        let data = try JSONEncoder().encode(PtyWriteRequest(instanceId: "i1", data: "ls\n"))
        let obj = try XCTUnwrap(jsonObject(data))
        XCTAssertEqual(obj["instanceId"] as? String, "i1")
        XCTAssertEqual(obj["data"] as? String, "ls\n")
    }

    func testTerminalAttachResponseDecodes() throws {
        let json = #"{"data":"[32mhi[0m","cols":120,"rows":30}"#
        let res = try JSONDecoder().decode(TerminalAttachRequest.Response.self, from: Data(json.utf8))
        XCTAssertEqual(res.cols, 120); XCTAssertEqual(res.rows, 30)
        XCTAssertFalse(res.data.isEmpty)
    }

    func testSpawnResponseDecodesNullAndError() throws {
        let ok = try JSONDecoder().decode(SpawnInstanceRequest.Response.self,
                                          from: Data(#"{"instanceId":"i9"}"#.utf8))
        XCTAssertEqual(ok.instanceId, "i9"); XCTAssertNil(ok.error)
        let fail = try JSONDecoder().decode(SpawnInstanceRequest.Response.self,
                                            from: Data(#"{"instanceId":null,"error":"boom"}"#.utf8))
        XCTAssertNil(fail.instanceId); XCTAssertEqual(fail.error, "boom")
    }

    func testRestartResponseAllowsFalse() throws {
        let r = try JSONDecoder().decode(RestartInstanceRequest.Response.self, from: Data(#"{"ok":false}"#.utf8))
        XCTAssertFalse(r.ok)
    }

    func testProjectsListDecodesSubset() throws {
        // Server sends extra fields; only id/name/folderPath must decode.
        let json = #"{"projects":[{"id":1,"name":"X","folderPath":"/x","kind":"work","archived":false}]}"#
        let res = try JSONDecoder().decode(ProjectsListRequest.Response.self, from: Data(json.utf8))
        XCTAssertEqual(res.projects, [ProjectDTO(id: 1, name: "X", folderPath: "/x")])
    }

    func testPushPayloadsDecode() throws {
        let pd = try JSONDecoder().decode(PtyDataPush.self, from: Data(#"{"instanceId":"i1","chunk":"abc"}"#.utf8))
        XCTAssertEqual(pd, PtyDataPush(instanceId: "i1", chunk: "abc"))
        let ab = try JSONDecoder().decode(AuthBlockPush.self, from: Data(#"{"instanceId":"i1","blocked":true,"reason":"saml"}"#.utf8))
        XCTAssertEqual(ab, AuthBlockPush(instanceId: "i1", blocked: true, reason: "saml"))
        let sc = try JSONDecoder().decode(StateChangedPush.self, from: Data(#"{"instanceId":"i1","status":"working"}"#.utf8))
        XCTAssertEqual(sc, StateChangedPush(instanceId: "i1", status: "working"))
    }
}
```

- [ ] **Step 3: Run to verify failure**

Run: `cd swift/WatchtowerCore && swift test --filter InstanceRequestsTests 2>&1 | tail -5` → FAIL (types undefined).

- [ ] **Step 4: Implement**

Create `swift/WatchtowerCore/Sources/WatchtowerBridge/Transport/InstanceRequests.swift` (match the exact `BridgeRequest` protocol shape Phase 1 defined — inspect `BridgeRequests.swift` first for the required members; the sketch below assumes `protocol BridgeRequest: Encodable { associatedtype Response: Decodable; static var kind: String { get } }`):

```swift
import Foundation

// MARK: Requests

public struct RemoveInstanceRequest: BridgeRequest {
    public static let kind = "removeInstance"
    public struct Response: Decodable, Equatable { public let ok: Bool }
    public var instanceId: String
    public init(instanceId: String) { self.instanceId = instanceId }
}

public struct SpawnInstanceRequest: BridgeRequest {
    public static let kind = "spawnInstance"
    public struct Response: Decodable, Equatable { public let instanceId: String?; public let error: String? }
    public var cwd: String
    public var instanceKind: String
    public init(cwd: String, instanceKind: String) { self.cwd = cwd; self.instanceKind = instanceKind }
}

public struct RestartInstanceRequest: BridgeRequest {
    public static let kind = "restartInstance"
    public struct Response: Decodable, Equatable { public let ok: Bool }
    public var instanceId: String
    public init(instanceId: String) { self.instanceId = instanceId }
}

public struct TerminalAttachRequest: BridgeRequest {
    public static let kind = "terminalAttach"
    public struct Response: Decodable, Equatable {
        public let data: String; public let cols: Int; public let rows: Int
    }
    public var instanceId: String
    public init(instanceId: String) { self.instanceId = instanceId }
}

public struct PtyWriteRequest: BridgeRequest {
    public static let kind = "ptyWrite"
    public struct Response: Decodable, Equatable { public let ok: Bool }
    public var instanceId: String; public var data: String
    public init(instanceId: String, data: String) { self.instanceId = instanceId; self.data = data }
}

public struct PtyResizeRequest: BridgeRequest {
    public static let kind = "ptyResize"
    public struct Response: Decodable, Equatable { public let ok: Bool }
    public var instanceId: String; public var cols: Int; public var rows: Int
    public init(instanceId: String, cols: Int, rows: Int) {
        self.instanceId = instanceId; self.cols = cols; self.rows = rows
    }
}

public struct TerminalFocusRequest: BridgeRequest {
    public static let kind = "terminalFocus"
    public struct Response: Decodable, Equatable { public let ok: Bool }
    public var instanceId: String
    public init(instanceId: String) { self.instanceId = instanceId }
}

public struct ProjectDTO: Decodable, Equatable, Sendable {
    public let id: Int; public let name: String; public let folderPath: String?
    public init(id: Int, name: String, folderPath: String?) { self.id = id; self.name = name; self.folderPath = folderPath }
}

public struct ProjectsListRequest: BridgeRequest {
    public static let kind = "projects:list"
    public struct Response: Decodable, Equatable { public let projects: [ProjectDTO] }
    public init() {}
}

// MARK: Push payloads

public struct PtyDataPush: Decodable, Equatable, Sendable {
    public let instanceId: String; public let chunk: String
    public init(instanceId: String, chunk: String) { self.instanceId = instanceId; self.chunk = chunk }
}
public struct StateChangedPush: Decodable, Equatable, Sendable {
    public let instanceId: String; public let status: String
    public init(instanceId: String, status: String) { self.instanceId = instanceId; self.status = status }
}
public struct AuthBlockPush: Decodable, Equatable, Sendable {
    public let instanceId: String; public let blocked: Bool; public let reason: String?
    public init(instanceId: String, blocked: Bool, reason: String?) {
        self.instanceId = instanceId; self.blocked = blocked; self.reason = reason
    }
}
```

Add to the existing `BridgePush` enum (in whatever file Phase 1 declared it):

```swift
public extension BridgePush {
    static let ptyData = "ptyData"
    static let authBlock = "authBlock"
}
```

(If `BridgePush` is a caseless enum of `static let`s in one file, add the two constants there directly instead of an extension. `stateChanged` already exists — do not redeclare it.)

- [ ] **Step 5: Run to verify pass**

Run: `cd swift/WatchtowerCore && swift test --filter InstanceRequestsTests 2>&1 | tail -5` → PASS (8 tests). Then full `swift test` → no regressions.

- [ ] **Step 6: Commit**

```bash
git add swift/WatchtowerCore/Sources/WatchtowerBridge swift/WatchtowerCore/Tests/WatchtowerBridgeTests/InstanceRequestsTests.swift
git commit -m "feat(ipad-native): typed instance/terminal bridge requests + push kinds (Phase 2)"
```

---

### Task 3: TerminalAttach controller (subscribe → buffer → drain, re-attach on reconnect)

Port `attachTerminal.ts`'s race-safe ordering as a testable actor that feeds a sink, and add the reconnect improvement (re-attach with scrollback replay on `disconnected → connected`).

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerBridge/Instances/TerminalSession.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerBridgeTests/TerminalSessionTests.swift`

**Interfaces:**
- Consumes: `BridgeClient` (`invoke`, `pushes(BridgePush.ptyData)`, `statusStream`), `TerminalAttachRequest`, `PtyDataPush`.
- Produces:
  - `protocol TerminalSink: AnyObject, Sendable { func write(_ text: String); func clear() }` — the live SwiftTerm view conforms in the app target (`write` = `feed`, `clear` = reset before a re-attach replay).
  - `actor TerminalSession` with `init(bridge: BridgeClient, instanceId: String)`, `func start(sink: TerminalSink) async`, `func stop()`. `start` performs the attach dance: subscribe to `ptyData` (filtered by instanceId) and buffer; `invoke(TerminalAttachRequest)`; `sink.clear()` then `sink.write(response.data)` if non-empty; drain buffered chunks in order; go live. Also observes `statusStream`; on a transition **into** `.connected` after having been non-connected, re-run the attach dance (clear + replay + resume) — closing the Capacitor gap where a mounted pane never re-attached.
- Consumed by: Task 6 (the app-target controller drives it) — but the actor itself is transport-only and host-testable with a fake bridge + fake sink.

- [ ] **Step 1: Write the failing tests**

Create `swift/WatchtowerCore/Tests/WatchtowerBridgeTests/TerminalSessionTests.swift`. Use a fake `BridgeClient` built from closures (Phase 1's `@DependencyClient BridgeClient` is a struct of closures — construct one directly with stubs), and a recording sink:

```swift
import XCTest
import ComposableArchitecture
@testable import WatchtowerBridge

final class RecordingSink: TerminalSink, @unchecked Sendable {
    private let lock = NSLock()
    private var _writes: [String] = []
    private var _clears = 0
    var writes: [String] { lock.withLock { _writes } }
    var clears: Int { lock.withLock { _clears } }
    func write(_ text: String) { lock.withLock { _writes.append(text) } }
    func clear() { lock.withLock { _clears += 1 } }
}

final class TerminalSessionTests: XCTestCase {
    private func waitUntil(_ what: String, timeout: TimeInterval = 2, _ p: @escaping () -> Bool) async {
        let deadline = Date().addingTimeInterval(timeout)
        while !p() { if Date() > deadline { return XCTFail("timeout: \(what)") }
            try? await Task.sleep(nanoseconds: 10_000_000) }
    }

    /// Attach: buffered chunks that arrive during the invoke() await are drained
    /// AFTER the snapshot, in order, exactly once.
    func testAttachReplaysSnapshotThenDrainsBufferedChunks() async {
        let (ptyStream, ptyCont) = AsyncStream<Data>.makeStream()
        let (statusStream, _) = AsyncStream<ConnStatus>.makeStream()
        let attachGate = LockIsolated(false)
        let bridge = BridgeClient(
            configure: { _ in }, shutdown: {},
            statusStream: { statusStream },
            send: { kind, _ in
                guard kind == "terminalAttach" else { return Data("{}".utf8) }
                // Emit a live chunk while the attach is "in flight", then resolve.
                ptyCont.yield(Data(#"{"instanceId":"i1","chunk":"LIVE"}"#.utf8))
                while !attachGate.value { try? await Task.sleep(nanoseconds: 5_000_000) }
                return Data(#"{"data":"SNAP","cols":80,"rows":24}"#.utf8)
            },
            pushes: { kind in kind == BridgePush.ptyData ? ptyStream : .finished }
        )
        let sink = RecordingSink()
        let session = TerminalSession(bridge: bridge, instanceId: "i1")
        Task { await session.start(sink: sink) }
        // Let the subscription + in-flight chunk register, then release the attach.
        try? await Task.sleep(nanoseconds: 50_000_000)
        attachGate.setValue(true)
        await waitUntil("drained") { sink.writes == ["SNAP", "LIVE"] }
        XCTAssertEqual(sink.clears, 1)
        await session.stop()
    }

    /// Live chunks after attach are written straight through, and chunks for
    /// other instances are ignored.
    func testLiveChunksFilteredByInstanceId() async {
        let (ptyStream, ptyCont) = AsyncStream<Data>.makeStream()
        let (statusStream, _) = AsyncStream<ConnStatus>.makeStream()
        let bridge = BridgeClient(
            configure: { _ in }, shutdown: {}, statusStream: { statusStream },
            send: { _, _ in Data(#"{"data":"","cols":80,"rows":24}"#.utf8) },
            pushes: { kind in kind == BridgePush.ptyData ? ptyStream : .finished }
        )
        let sink = RecordingSink()
        let session = TerminalSession(bridge: bridge, instanceId: "i1")
        Task { await session.start(sink: sink) }
        try? await Task.sleep(nanoseconds: 60_000_000) // let it go live (empty snapshot → no snapshot write)
        ptyCont.yield(Data(#"{"instanceId":"other","chunk":"X"}"#.utf8))
        ptyCont.yield(Data(#"{"instanceId":"i1","chunk":"Y"}"#.utf8))
        await waitUntil("live write") { sink.writes == ["Y"] }
        await session.stop()
    }

    /// A transition into .connected after the initial attach triggers a fresh
    /// attach (clear + replay) — the reconnect improvement.
    func testReconnectReattaches() async {
        let (ptyStream, _) = AsyncStream<Data>.makeStream()
        let (statusStream, statusCont) = AsyncStream<ConnStatus>.makeStream()
        let attachCount = LockIsolated(0)
        let bridge = BridgeClient(
            configure: { _ in }, shutdown: {}, statusStream: { statusStream },
            send: { kind, _ in
                if kind == "terminalAttach" { attachCount.withValue { $0 += 1 } }
                return Data(#"{"data":"SNAP","cols":80,"rows":24}"#.utf8)
            },
            pushes: { kind in kind == BridgePush.ptyData ? ptyStream : .finished }
        )
        let sink = RecordingSink()
        let session = TerminalSession(bridge: bridge, instanceId: "i1")
        Task { await session.start(sink: sink) }
        await waitUntil("first attach") { attachCount.value == 1 }
        statusCont.yield(.disconnected)
        statusCont.yield(.connected)
        await waitUntil("re-attach") { attachCount.value == 2 }
        XCTAssertEqual(sink.clears, 2) // cleared before each replay
        await session.stop()
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd swift/WatchtowerCore && swift test --filter TerminalSessionTests 2>&1 | tail -8` → FAIL (`TerminalSession`/`TerminalSink` undefined).

- [ ] **Step 3: Implement**

Create `swift/WatchtowerCore/Sources/WatchtowerBridge/Instances/TerminalSession.swift`:

```swift
import Foundation

/// Live output target for a terminal (the SwiftTerm view in the app target).
public protocol TerminalSink: AnyObject, Sendable {
    func write(_ text: String)
    /// Reset before a (re-)attach snapshot replay so scrollback isn't duplicated.
    func clear()
}

/// Owns one instance's terminal attachment: race-safe snapshot+live merge
/// (port of attachTerminal.ts) plus re-attach on reconnect (improvement over
/// the Capacitor app, which left a mounted pane un-reattached after a drop).
public actor TerminalSession {
    private let bridge: BridgeClient
    private let instanceId: String
    private weak var sink: TerminalSink?

    private var live = false
    private var buffer: [String] = []
    private var ptyTask: Task<Void, Never>?
    private var statusTask: Task<Void, Never>?
    private var wasConnected = true // first .connected after start shouldn't double-attach

    public init(bridge: BridgeClient, instanceId: String) {
        self.bridge = bridge
        self.instanceId = instanceId
    }

    public func start(sink: TerminalSink) async {
        self.sink = sink
        ptyTask = Task { [weak self] in
            guard let self else { return }
            for await raw in await self.bridge.pushes(BridgePush.ptyData) {
                if let push = try? JSONDecoder().decode(PtyDataPush.self, from: raw) {
                    await self.onPtyData(push)
                }
            }
        }
        statusTask = Task { [weak self] in
            guard let self else { return }
            for await status in await self.bridge.statusStream() {
                await self.onStatus(status)
            }
        }
        await attach()
    }

    public func stop() {
        ptyTask?.cancel(); ptyTask = nil
        statusTask?.cancel(); statusTask = nil
        sink = nil
    }

    private func onPtyData(_ push: PtyDataPush) {
        guard push.instanceId == instanceId else { return }
        if live { sink?.write(push.chunk) } else { buffer.append(push.chunk) }
    }

    private func onStatus(_ status: ConnStatus) async {
        let nowConnected = status == .connected
        defer { wasConnected = nowConnected }
        if nowConnected && !wasConnected { await attach() } // reconnect → replay
    }

    /// Subscribe-before-fetch is guaranteed because ptyTask started before this
    /// call; here we set not-live, run the snapshot, then drain + go live.
    private func attach() async {
        live = false
        buffer.removeAll()
        guard let res = try? await bridge.invoke(TerminalAttachRequest(instanceId: instanceId)) else {
            // Attach failed (e.g. dropped mid-flight); a later .connected retries.
            return
        }
        sink?.clear()
        if !res.data.isEmpty { sink?.write(res.data) }
        for chunk in buffer { sink?.write(chunk) }
        buffer.removeAll()
        live = true
    }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd swift/WatchtowerCore && swift test --filter TerminalSessionTests 2>&1 | tail -8` → PASS (3 tests). Then full `swift test` → no regressions. If timing-flaky, re-run 3× — do not weaken assertions; investigate actor scheduling.

- [ ] **Step 5: Commit**

```bash
git add swift/WatchtowerCore/Sources/WatchtowerBridge/Instances/TerminalSession.swift swift/WatchtowerCore/Tests/WatchtowerBridgeTests/TerminalSessionTests.swift
git commit -m "feat(ipad-native): TerminalSession actor — attach/replay + reconnect re-attach (Phase 2)"
```

---

### Task 4: InstancesFeature reducer

Owns the instances + projects lists, the live refetch on `stateChanged`, grouping, tab selection, the ack overlay, the selected instance, and the authBlock set.

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerBridge/Features/InstancesFeature.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerBridgeTests/InstancesFeatureTests.swift`

**Interfaces:**
- Consumes: `BridgeClient`, `ListInstancesRequest`/`BridgeInstance`, `ProjectsListRequest`/`ProjectDTO`, `StateChangedPush`, `AuthBlockPush`, and Task 1's pure helpers + `Instance`/`ProjectSummary`/`ProjectGroup`.
- Produces `@Reducer InstancesFeature` with:
  - `@ObservableState State { instances: [Instance] = []; projects: [ProjectSummary] = []; acked: Set<String> = []; blocked: Set<String> = []; selectedInstanceId: String? = nil; var groups: [ProjectGroup] { groupInstancesByProject(instances, projects: projects) }; var attentionIds: Set<String> { acknowledgedNeedingAttention(instances: instances, acked: acked) } }`
  - `Action { onAppear; refresh; instancesLoaded([Instance]); projectsLoaded([ProjectSummary]); stateChangedTick; instanceSelected(String); authBlockChanged(instanceId: String, blocked: Bool) }`
  - Behavior: `onAppear` loads projects once + refreshes instances + subscribes to `stateChanged` (→ `refresh`) and `authBlock` pushes; `refresh` invokes `listInstances`; `instanceSelected` sets `selectedInstanceId` and acks it (`acked.insert`); `instancesLoaded` stores + `reconcileAcked`; `authBlockChanged` folds via `applyAuthBlock`.
- Consumed by: Task 7 (view) and `IPadAppFeature` (Task 7 wires it under `Module.instances`).

- [ ] **Step 1: Write the failing tests** (TestStore; stub `bridge.send` per kind, drive pushes via a stream). Cover: onAppear loads projects+instances and subscribes; stateChanged tick triggers refresh; instanceSelected acks; authBlock folds; grouping derived property. Full test file:

```swift
import XCTest
import ComposableArchitecture
@testable import WatchtowerBridge

@MainActor
final class InstancesFeatureTests: XCTestCase {
    private func listPayload(_ ids: [String], cwd: String = "/x") -> Data {
        let items = ids.map { #"{"id":"\#($0)","cwd":"\#(cwd)","status":"working","lastActivityAt":0,"kind":"claude","taskId":null}"# }
        return Data(#"{"instances":[\#(items.joined(separator: ","))]}"#.utf8)
    }

    func testOnAppearLoadsProjectsAndInstances() async {
        let store = TestStore(initialState: InstancesFeature.State()) { InstancesFeature() } withDependencies: {
            $0.bridge.statusStream = { .finished }
            $0.bridge.pushes = { _ in .finished }
            $0.bridge.send = { kind, _ in
                switch kind {
                case "projects:list": return Data(#"{"projects":[{"id":1,"name":"X","folderPath":"/x"}]}"#.utf8)
                case "listInstances": return self.listPayload(["a"])
                default: return Data("{}".utf8)
                }
            }
        }
        await store.send(.onAppear)
        await store.receive(\.projectsLoaded) { $0.projects = [ProjectSummary(id: 1, name: "X", folderPath: "/x")] }
        await store.receive(\.instancesLoaded) {
            $0.instances = [Instance(id: "a", cwd: "/x", status: "working", lastActivityAt: 0, kind: "claude", taskId: nil)]
        }
        XCTAssertEqual(store.state.groups.map(\.label), ["X"])
        await store.send(.onAppear).finish() // drain long-running push subscriptions
    }

    func testInstanceSelectedAcks() async {
        let store = TestStore(
            initialState: InstancesFeature.State(
                instances: [Instance(id: "a", cwd: "/x", status: "waiting-input", lastActivityAt: 0, kind: "claude", taskId: nil)]
            )
        ) { InstancesFeature() }
        XCTAssertEqual(store.state.attentionIds, ["a"])
        await store.send(.instanceSelected("a")) { $0.selectedInstanceId = "a"; $0.acked = ["a"] }
        XCTAssertEqual(store.state.attentionIds, []) // acked clears the dot
    }

    func testAuthBlockFolds() async {
        let store = TestStore(initialState: InstancesFeature.State()) { InstancesFeature() }
        await store.send(.authBlockChanged(instanceId: "a", blocked: true)) { $0.blocked = ["a"] }
        await store.send(.authBlockChanged(instanceId: "a", blocked: false)) { $0.blocked = [] }
    }
}
```

- [ ] **Step 2:** Run → FAIL. `cd swift/WatchtowerCore && swift test --filter InstancesFeatureTests 2>&1 | tail -8`

- [ ] **Step 3: Implement** `InstancesFeature.swift`. Map DTOs → domain (`BridgeInstance`→`Instance`, `ProjectDTO`→`ProjectSummary`). Use `CancelID` enum with `.state`, `.auth` for the two push subscriptions (cancellable, `cancelInFlight: true`). `onAppear` returns `.merge(loadProjects, .send(.refresh), subscribeState, subscribeAuth)`. Reference `IPadAppFeature`'s onAppear (Phase 1) for the subscription pattern. Decode `listInstances` via `ListInstancesRequest.Response`; on `instancesLoaded` set `state.instances` then `state.acked = reconcileAcked(state.acked, instances:)`.

- [ ] **Step 4:** Run → PASS (3 tests) + full `swift test` green.

- [ ] **Step 5: Commit** `git commit -m "feat(ipad-native): InstancesFeature reducer (list/group/attention/authBlock) (Phase 2)"`

---

### Task 5: SpawnFeature reducer

The spawn/restart modal logic: project picker (folderPath-bearing only), instance-kind toggle, restartable list (non-live instances in the chosen project), and the `spawnInstance`/`restartInstance` calls.

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerBridge/Features/SpawnFeature.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerBridgeTests/SpawnFeatureTests.swift`

**Interfaces:**
- Consumes: `BridgeClient`, `SpawnInstanceRequest`, `RestartInstanceRequest`, `Instance`/`ProjectSummary`, `InstanceAttention.live`.
- Produces `@Reducer SpawnFeature` with `State { projects; instances; selectedProjectId: Int?; instanceKind: String = "claude"; errorMessage: String?; isSubmitting: Bool; var spawnableProjects: [ProjectSummary] { projects.filter { $0.folderPath != nil } }; var restartable: [Instance] { guard selected project folderPath; instances.filter { $0.cwd == path && !InstanceAttention.live.contains($0.status) } } }` and `Action { projectSelected(Int); kindSelected(String); spawnTapped; restartTapped(String); spawnResponse(Result<String?, ...>) / spawnFailed(String) / spawned(String); dismissed }`. `spawnTapped` guards a selected spawnable project, sets `isSubmitting`, invokes `spawnInstance`; a `nil` instanceId or `error` sets `errorMessage`; success emits `spawned(id)` (the parent uses it to select + dismiss).
- Consumed by: Task 7 (modal view + wiring into InstancesFeature/IPadAppFeature).

- [ ] **Step 1: Write the failing tests** (TestStore): valid spawn → invokes spawnInstance, success → `spawned(id)`; server `{instanceId:null,error}` → sets errorMessage, no `spawned`; restartable filter excludes live instances; kind toggle. Include a `LockIsolated` capture asserting the spawn payload's cwd+kind. (Full code — write real assertions, no stubs that assert nothing.)

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Implement** `SpawnFeature.swift` per the interface. Model the fallible spawn as a payload-level check (`response.instanceId` nil/`error`), not a thrown error (`invoke` only throws on transport/rpc/decode failure — catch that too and surface `errorMessage`).

- [ ] **Step 4:** Run → PASS + full suite green.

- [ ] **Step 5: Commit** `git commit -m "feat(ipad-native): SpawnFeature reducer (spawn/restart modal logic) (Phase 2)"`

---

### Task 6: SwiftTerm dependency + RemoteTerminalView (app target)

Add SwiftTerm to the app target, wrap `TerminalView` in a `UIViewRepresentable`, and bridge it to `TerminalSession` (feed ← ptyData replay/live; send → ptyWrite; sizeChanged → ptyResize; focus → terminalFocus + becomeFirstResponder).

**Files:**
- Modify: `apps/ipad-native/project.yml` (add SwiftTerm package + product dep on the app target only).
- Create: `apps/ipad-native/Watchtower/Terminal/TerminalController.swift`
- Create: `apps/ipad-native/Watchtower/Terminal/RemoteTerminalView.swift`

**Interfaces:**
- Consumes: `TerminalSession`, `TerminalSink`, `BridgeClient`, `PtyWriteRequest`, `PtyResizeRequest`, `TerminalFocusRequest` (WatchtowerBridge); `SwiftTerm.TerminalView`/`TerminalViewDelegate` (v1.14.0).
- Produces: `@MainActor final class TerminalController: TerminalSink` — owns the `TerminalView`, conforms `TerminalSink` (`write` → `terminalView.feed(text:)`, `clear` → `terminalView.getTerminal().resetToInitialState()` + `terminalView.feed(text: "\u{1b}c")` full reset), owns a `TerminalSession`, and implements `TerminalViewDelegate.send`→`ptyWrite`, `sizeChanged`→`ptyResize`, focus→`terminalFocus`. `RemoteTerminalView: UIViewRepresentable` produces the `TerminalView`, calls `becomeFirstResponder()`, and `.task`-starts the session.

- [ ] **Step 1: Add SwiftTerm to the app target**

Edit `apps/ipad-native/project.yml` — add under `packages:` and the target's `dependencies:`:

```yaml
packages:
  WatchtowerCore:
    path: ../../swift/WatchtowerCore
  SwiftTerm:
    url: https://github.com/migueldeicaza/SwiftTerm
    from: "1.14.0"
targets:
  Watchtower:
    # ...existing...
    dependencies:
      - package: WatchtowerCore
        product: WatchtowerCore
      - package: WatchtowerCore
        product: WatchtowerBridge
      - package: SwiftTerm
        product: SwiftTerm
```

- [ ] **Step 2: Implement the controller**

Create `apps/ipad-native/Watchtower/Terminal/TerminalController.swift`:

```swift
import Foundation
import SwiftTerm
import ComposableArchitecture
import WatchtowerBridge

/// Bridges a SwiftTerm TerminalView to a WatchtowerBridge TerminalSession.
/// feed ← ptyData (snapshot replay + live); send → ptyWrite; sizeChanged → ptyResize.
@MainActor
final class TerminalController: NSObject, TerminalSink, TerminalViewDelegate {
    let terminalView: TerminalView
    private let instanceId: String
    private let bridge: BridgeClient
    private var session: TerminalSession?

    init(instanceId: String, bridge: BridgeClient) {
        self.terminalView = TerminalView(frame: .zero)
        self.instanceId = instanceId
        self.bridge = bridge
        super.init()
        terminalView.terminalDelegate = self
    }

    func startIfNeeded() {
        guard session == nil else { return }
        let session = TerminalSession(bridge: bridge, instanceId: instanceId)
        self.session = session
        Task { await session.start(sink: self) }
    }

    func stop() { let s = session; session = nil; Task { await s?.stop() } }

    // MARK: TerminalSink (feed is thread-safe; SwiftTerm hops its own redraw to main)
    nonisolated func write(_ text: String) { terminalView.feed(text: text) }
    nonisolated func clear() { terminalView.feed(text: "\u{1b}c") } // RIS full reset before replay

    // MARK: TerminalViewDelegate
    nonisolated func send(source: TerminalView, data: ArraySlice<UInt8>) {
        let s = String(decoding: data, as: UTF8.self)
        Task { _ = try? await bridge.invoke(PtyWriteRequest(instanceId: instanceId, data: s)) }
    }
    nonisolated func sizeChanged(source: TerminalView, newCols: Int, newRows: Int) {
        Task { _ = try? await bridge.invoke(PtyResizeRequest(instanceId: instanceId, cols: newCols, rows: newRows)) }
    }
    func focus() { Task { _ = try? await bridge.invoke(TerminalFocusRequest(instanceId: instanceId)) } }

    // Unused delegate methods (11-method protocol in SwiftTerm 1.14.0)
    nonisolated func setTerminalTitle(source: TerminalView, title: String) {}
    nonisolated func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
    nonisolated func scrolled(source: TerminalView, position: Double) {}
    nonisolated func requestOpenLink(source: TerminalView, link: String, params: [String: String]) {}
    nonisolated func bell(source: TerminalView) {}
    nonisolated func clipboardCopy(source: TerminalView, content: Data) {}
    nonisolated func clipboardRead(source: TerminalView) -> Data? { nil }
    nonisolated func iTermContent(source: TerminalView, content: ArraySlice<UInt8>) {}
    nonisolated func rangeChanged(source: TerminalView, startY: Int, endY: Int) {}
}
```

> Implementer note: `TerminalSink` requires `Sendable`. `TerminalController` is `@MainActor`; if the `nonisolated` `write`/`clear` + `Sendable` conformance fights the compiler, mark the class `@unchecked Sendable` and keep `feed` calls (SwiftTerm's `feed` is documented thread-safe). Verify the exact `TerminalViewDelegate` method set against the resolved SwiftTerm version at build time and stub all of them.

- [ ] **Step 3: Implement the representable**

Create `apps/ipad-native/Watchtower/Terminal/RemoteTerminalView.swift`:

```swift
import SwiftUI
import SwiftTerm
import ComposableArchitecture
import WatchtowerBridge

struct RemoteTerminalView: UIViewRepresentable {
    let instanceId: String
    @Dependency(\.bridge) var bridge

    func makeCoordinator() -> TerminalController {
        TerminalController(instanceId: instanceId, bridge: bridge)
    }

    func makeUIView(context: Context) -> TerminalView {
        let controller = context.coordinator
        controller.startIfNeeded()
        DispatchQueue.main.async {
            _ = controller.terminalView.becomeFirstResponder() // bring up keyboard + receive keys
            controller.focus()
        }
        return controller.terminalView
    }

    func updateUIView(_ uiView: TerminalView, context: Context) {}

    static func dismantleUIView(_ uiView: TerminalView, coordinator: TerminalController) {
        coordinator.stop()
    }
}
```

- [ ] **Step 4: Build**

Run:
```bash
cd apps/ipad-native && xcodegen generate && \
xcodebuild -project Watchtower.xcodeproj -scheme Watchtower \
  -destination 'generic/platform=iOS Simulator' -skipMacroValidation CODE_SIGNING_ALLOWED=NO build 2>&1 | tail -6
```
Expected: `** BUILD SUCCEEDED **`. (SwiftTerm resolves from SPM; first build fetches it.) If the delegate protocol differs from the sketch, fix the view/controller to match the resolved SwiftTerm API — do not modify WatchtowerBridge.

- [ ] **Step 5: Commit**

```bash
git add apps/ipad-native/project.yml apps/ipad-native/Watchtower/Terminal
git commit -m "feat(ipad-native): SwiftTerm RemoteTerminalView + TerminalController (Phase 2)"
```

---

### Task 7: Instances UI + wire into IPadAppFeature

Replace the `Module.instances` placeholder with the real module: project-grouped tab strip (attention dots), the terminal pane for the selected instance, a spawn/restart modal, remove (native confirm), and a global authBlock banner.

**Files:**
- Modify: `swift/WatchtowerCore/Sources/WatchtowerBridge/Features/IPadAppFeature.swift` — embed `InstancesFeature` (`Scope(state:\.instances, action:\.instances)`), and give the authBlock banner action a path to select `.remote`.
- Modify: `apps/ipad-native/Watchtower/Views/AppShellView.swift` — route `.instances` to the new `InstancesView` (replace the placeholder).
- Create: `apps/ipad-native/Watchtower/Views/InstancesView.swift` (tab strip + terminal pane + toolbar: spawn, remove).
- Create: `apps/ipad-native/Watchtower/Views/SpawnModalView.swift`.
- Test: extend `swift/WatchtowerCore/Tests/WatchtowerBridgeTests/IPadAppFeatureTests.swift` — assert `InstancesFeature` is scoped and an authBlock-banner action selects `.remote`.

**Interfaces:**
- Consumes: `InstancesFeature`, `SpawnFeature`, `RemoteTerminalView`, `RemoveInstanceRequest`, `Palette`.
- Produces: `InstancesView`, `SpawnModalView`; `IPadAppFeature.State` gains `instances: InstancesFeature.State` and its `Action` gains `case instances(InstancesFeature.Action)`.

- [ ] **Step 1: Wire the reducer (TDD in WatchtowerBridge)**

Add to `IPadAppFeatureTests.swift` a test that sending `.instances(.instanceSelected("a"))` routes into the child (state changes on `state.instances.selectedInstanceId`), and that the authBlock banner action (e.g. `.openRemoteForAuth`) sets `selectedModule = .remote`. Run → FAIL.

- [ ] **Step 2: Implement the reducer wiring**

In `IPadAppFeature.swift`: add `var instances = InstancesFeature.State()` to `State`; add `case instances(InstancesFeature.Action)` and `case openRemoteForAuth` to `Action`; add `Scope(state: \.instances, action: \.instances) { InstancesFeature() }` to the body; handle `.openRemoteForAuth` → `state.selectedModule = .remote`. Run → PASS + full suite green. Commit.

- [ ] **Step 3: Build the SwiftUI views**

Create `SpawnModalView.swift` (project radio list from `spawnableProjects`, kind toggle claude/shell, "Restartovat"→ restartable list, Spawn button, error text, submitting spinner) bound to a `StoreOf<SpawnFeature>`. Create `InstancesView.swift`: a horizontal tab strip over `store.groups` with an amber dot when `group.instanceIds.contains(where: store.attentionIds.contains)`; tapping a group selects its active-or-first instance (`store.send(.instanceSelected(id))`); the detail shows `RemoteTerminalView(instanceId:)` for `store.selectedInstanceId`, else an empty-state; a toolbar with "+ New" (presents `SpawnModalView`) and a "Remove" button that shows a native `.confirmationDialog` → on confirm `bridge.invoke(RemoveInstanceRequest(...))` (fire-and-forget; the resulting `stateChanged('finished')` push refreshes the list). A global authBlock banner: when `!store.instances.blocked.isEmpty`, show a top banner "Mac is waiting for a login" with an "Open Remote Mac" button → `store.send(.openRemoteForAuth)`.

- [ ] **Step 4: Route the module + build**

In `AppShellView.swift`, replace the `.instances` placeholder case with `InstancesView(store: store.scope(state: \.instances, action: \.instances))`. Build:
```bash
cd apps/ipad-native && xcodegen generate && \
xcodebuild -project Watchtower.xcodeproj -scheme Watchtower \
  -destination 'generic/platform=iOS Simulator' -skipMacroValidation CODE_SIGNING_ALLOWED=NO build 2>&1 | tail -6
```
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 5: Commit**

```bash
git add swift/WatchtowerCore/Sources/WatchtowerBridge/Features/IPadAppFeature.swift swift/WatchtowerCore/Tests/WatchtowerBridgeTests/IPadAppFeatureTests.swift apps/ipad-native/Watchtower/Views
git commit -m "feat(ipad-native): Instances module UI — tab strip, terminal pane, spawn, remove, authBlock banner (Phase 2)"
```

---

### Task 8: On-device / simulator verification

**Files:** none (operational). ⚠️ Live terminal streaming needs a running Mac orchestrator + a real token; if executing autonomously, do the buildable/launch checks and report, then hand the live checklist to the user.

- [ ] **Step 1:** Build + launch on the iPad simulator (reuse the Phase 1 flow: create/boot an iPad sim, copy `apps/iphone-native/Watchtower/Secrets.xcconfig` → `apps/ipad-native/Watchtower/Secrets.xcconfig`, `xcodegen generate`, build for `generic/platform=iOS Simulator`, install, launch, screenshot). Confirm the Instances tab renders (empty-state offline) without crashing.
- [ ] **Step 2 (needs Mac):** With `npm run dev` running on the Mac, enter the connection in Settings → connect → open Instances: tab strip groups by project; select an instance → terminal shows scrollback then live output; type → echoes; resize the window → reflows; spawn a new instance → appears + auto-selects; remove → disappears; trigger an auth-blocking command on the Mac → banner appears.
- [ ] **Step 3:** Record deviations as follow-ups; commit any fixes individually.

---

## Plan self-review (completed at authoring time)

- **Spec coverage (Phase 2 row):** tab strip grouped by project + attention → Tasks 1,4,7; SwiftTerm pane wired to terminalAttach/ptyData/ptyWrite/ptyResize/terminalFocus with scrollback replay → Tasks 2,3,6,7; spawn/restart modal → Tasks 5,7; authBlock gate → Tasks 1,4,7; remove instance → Tasks 2,7. Tiling/pane-picker/keyboard-accessory are correctly deferred to Phase 3 (not in this plan).
- **Type consistency:** `Instance`, `ProjectSummary`, `ProjectGroup`, `TerminalSink`, `TerminalSession`, `BridgePush.ptyData`, `TerminalAttachRequest.Response{data,cols,rows}`, `PtyDataPush{instanceId,chunk}` are spelled identically across Tasks 1–7. `BridgeInstance`/`ListInstancesRequest`/`BridgePush.stateChanged` reuse Phase 1 (not redeclared).
- **Known judgment calls (flag to reviewer):** (1) reconnect re-attach is an intentional improvement over the Capacitor app — covered by a test; (2) remove uses a native `.confirmationDialog` rather than the Capacitor two-tap arm button — deliberate; (3) `clear()` uses an ESC-c RIS reset before replay to avoid duplicated scrollback across re-attach; (4) `projects:list` DTO decodes a subset of the server row (Task 2 Step 1 verifies the field names). (5) SwiftTerm delegate is an 11-method protocol as of 1.14.0 — verify against the resolved version at build.
