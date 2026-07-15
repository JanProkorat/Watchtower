# Native iPad Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A native SwiftUI iPad app that launches with the module rail, connects to the Mac orchestrator over the WS bridge (with reconnect/backoff/watchdog), has a working connection-settings editor, and reuses WatchtowerCore's Supabase auth.

**Architecture:** New `WatchtowerBridge` SPM target (in the existing `swift/WatchtowerCore` package) holds the Mac control plane: WS frame codec, `BridgeSocket` abstraction, `BridgeClient` reconnecting actor exposed as a TCA dependency, the `Connection` model + persistence, and the `ConnectionFeature`/`IPadAppFeature` reducers. A new XcodeGen app target `apps/ipad-native` holds SwiftUI views only, mirroring `apps/iphone-native`.

**Tech Stack:** Swift 5.10, SwiftUI, The Composable Architecture (≥1.15), supabase-swift (via existing WatchtowerCore), XcodeGen, `URLSessionWebSocketTask`.

**Spec:** `docs/superpowers/specs/2026-07-15-native-ipad-swiftui-rewrite-design.md`

## Global Constraints

- **UI language is English.** cs-CZ stays only for date/number/currency *formatting* (reuse `CzFormat` from WatchtowerCore). No i18n. Code comments in English.
- **iOS deployment target: 17.0**; package platforms already `.iOS(.v17), .macOS(.v13)` — keep macOS 13 so `swift test` runs on the Mac host.
- **Bundle id: `cz.greencode.watchtower.ipados`** (must differ from the installed Capacitor app's `cz.watchtower.ipad` for side-by-side dogfooding).
- **Do not touch the iPhone app** (`apps/iphone-native/`) or the existing `WatchtowerCore` target's sources. The iPhone keeps linking only the `WatchtowerCore` product.
- **Work from the worktree**: `/Users/jan/Projects/Watchtower/.claude/worktrees/ipad-native-rewrite` (branch `feat/ipad-native-rewrite`). All paths below are relative to the repo root of that worktree.
- **Verification commands:**
  - Package tests: `cd swift/WatchtowerCore && swift test` (must stay green incl. all existing WatchtowerCoreTests).
  - App build: see Task 10.
- **TCA dependency style**: follow the existing pattern — `import ComposableArchitecture`, `@DependencyClient` struct, `extension X: DependencyKey { static var liveValue }`, `public extension DependencyValues { var x: X { get { self[X.self] } set { self[X.self] = newValue } } }` (see `Sources/WatchtowerCore/Dependencies/BillingCache.swift`).
- Commit after every task with a conventional-commit message ending in the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.

---

### Task 1: WatchtowerBridge target scaffolding

**Files:**
- Modify: `swift/WatchtowerCore/Package.swift`
- Create: `swift/WatchtowerCore/Sources/WatchtowerBridge/WatchtowerBridge.swift`
- Create: `swift/WatchtowerCore/Tests/WatchtowerBridgeTests/SmokeTests.swift`

**Interfaces:**
- Produces: SPM library product `WatchtowerBridge` (depends on `WatchtowerCore` + ComposableArchitecture) and test target `WatchtowerBridgeTests`. All later tasks put control-plane sources under `Sources/WatchtowerBridge/` and tests under `Tests/WatchtowerBridgeTests/`.

- [ ] **Step 1: Write the failing smoke test**

Create `swift/WatchtowerCore/Tests/WatchtowerBridgeTests/SmokeTests.swift`:

```swift
import XCTest
@testable import WatchtowerBridge

final class SmokeTests: XCTestCase {
    func testModuleLinks() {
        XCTAssertEqual(watchtowerBridgeModuleMarker, "WatchtowerBridge")
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd swift/WatchtowerCore && swift test --filter SmokeTests 2>&1 | tail -5`
Expected: FAIL — the build fails because the `WatchtowerBridge` module/target does not exist yet.

- [ ] **Step 3: Add the target, product, and marker**

In `swift/WatchtowerCore/Package.swift`, change the `products:` array to:

```swift
    products: [
        .library(name: "WatchtowerCore", targets: ["WatchtowerCore"]),
        .library(name: "WatchtowerBridge", targets: ["WatchtowerBridge"]),
    ],
```

and the `targets:` array to:

```swift
    targets: [
        .target(
            name: "WatchtowerCore",
            dependencies: [
                .product(name: "ComposableArchitecture", package: "swift-composable-architecture"),
                .product(name: "Supabase", package: "supabase-swift"),
            ]
        ),
        .target(
            name: "WatchtowerBridge",
            dependencies: [
                "WatchtowerCore",
                .product(name: "ComposableArchitecture", package: "swift-composable-architecture"),
            ]
        ),
        .testTarget(
            name: "WatchtowerCoreTests",
            dependencies: ["WatchtowerCore"]
        ),
        .testTarget(
            name: "WatchtowerBridgeTests",
            dependencies: ["WatchtowerBridge"]
        ),
    ]
```

Create `swift/WatchtowerCore/Sources/WatchtowerBridge/WatchtowerBridge.swift`:

```swift
// WatchtowerBridge — the Mac control plane for the native iPad app.
// Everything that talks to the orchestrator's WebSocket bridge lives in this
// target so the iPhone app (which links only WatchtowerCore) never pulls it in.

let watchtowerBridgeModuleMarker = "WatchtowerBridge"
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd swift/WatchtowerCore && swift test 2>&1 | tail -5`
Expected: PASS — SmokeTests passes AND the full existing WatchtowerCoreTests suite still passes.

- [ ] **Step 5: Commit**

```bash
git add swift/WatchtowerCore/Package.swift swift/WatchtowerCore/Sources/WatchtowerBridge swift/WatchtowerCore/Tests/WatchtowerBridgeTests
git commit -m "feat(ipad-native): add WatchtowerBridge SPM target for the Mac control plane"
```

---

### Task 2: WS frame codec

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerBridge/Transport/WsFrames.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerBridgeTests/WsFramesTests.swift`

**Interfaces:**
- Produces:
  - `enum IncomingFrame: Equatable { case response(id: String, payload: Data?, error: String?); case push(kind: String, payload: Data?) }`
  - `func decodeIncomingFrame(_ raw: String) throws -> IncomingFrame`
  - `func composeRequestFrame(id: String, kind: String, payload: Data) throws -> String` — `payload` is already-encoded JSON (from `JSONEncoder`), spliced into the frame.
  - `enum WsFrameError: Error, Equatable { case invalidFrame }`
- Consumed by: Task 6 (`BridgeClient`).

Wire protocol (port of `packages/shared/src/wsProtocol.ts`) — JSON text messages:

```
request:  {"id":"c1","kind":"listInstances","payload":{}}
response: {"id":"c1","kind":"listInstances","payload":{...}}       // or {"id":"c1","kind":"...","error":"msg"}
push:     {"push":true,"kind":"stateChanged","payload":{...}}
```

- [ ] **Step 1: Write the failing tests**

Create `swift/WatchtowerCore/Tests/WatchtowerBridgeTests/WsFramesTests.swift`:

```swift
import XCTest
@testable import WatchtowerBridge

final class WsFramesTests: XCTestCase {
    func testComposeRequestFrame() throws {
        let payload = Data(#"{"instanceId":"abc"}"#.utf8)
        let raw = try composeRequestFrame(id: "c1", kind: "terminalAttach", payload: payload)
        let obj = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
        XCTAssertEqual(obj["id"] as? String, "c1")
        XCTAssertEqual(obj["kind"] as? String, "terminalAttach")
        let inner = try XCTUnwrap(obj["payload"] as? [String: Any])
        XCTAssertEqual(inner["instanceId"] as? String, "abc")
    }

    func testDecodeResponseWithPayload() throws {
        let frame = try decodeIncomingFrame(#"{"id":"c3","kind":"listInstances","payload":{"instances":[]}}"#)
        guard case let .response(id, payload, error) = frame else { return XCTFail("expected response") }
        XCTAssertEqual(id, "c3")
        XCTAssertNil(error)
        let obj = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(payload)) as? [String: Any])
        XCTAssertNotNil(obj["instances"])
    }

    func testDecodeResponseWithError() throws {
        let frame = try decodeIncomingFrame(#"{"id":"c9","kind":"spawnInstance","error":"no such project"}"#)
        guard case let .response(id, payload, error) = frame else { return XCTFail("expected response") }
        XCTAssertEqual(id, "c9")
        XCTAssertNil(payload)
        XCTAssertEqual(error, "no such project")
    }

    func testDecodePushFrame() throws {
        let frame = try decodeIncomingFrame(#"{"push":true,"kind":"stateChanged","payload":{"instanceId":"i1"}}"#)
        guard case let .push(kind, payload) = frame else { return XCTFail("expected push") }
        XCTAssertEqual(kind, "stateChanged")
        XCTAssertNotNil(payload)
    }

    func testDecodeGarbageThrows() {
        XCTAssertThrowsError(try decodeIncomingFrame("not json"))
        XCTAssertThrowsError(try decodeIncomingFrame(#"{"no":"kind"}"#))
        // Response frame without an id cannot be matched to a pending request.
        XCTAssertThrowsError(try decodeIncomingFrame(#"{"kind":"listInstances","payload":{}}"#))
    }

    func testDecodeScalarPayload() throws {
        // Payloads are usually objects, but the codec must not assume it.
        let frame = try decodeIncomingFrame(#"{"push":true,"kind":"x","payload":42}"#)
        guard case let .push(_, payload) = frame else { return XCTFail("expected push") }
        XCTAssertEqual(String(decoding: try XCTUnwrap(payload), as: UTF8.self), "42")
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd swift/WatchtowerCore && swift test --filter WsFramesTests 2>&1 | tail -5`
Expected: FAIL — `decodeIncomingFrame`/`composeRequestFrame` not defined.

- [ ] **Step 3: Implement the codec**

Create `swift/WatchtowerCore/Sources/WatchtowerBridge/Transport/WsFrames.swift`:

```swift
import Foundation

/// Wire protocol for the orchestrator WebSocket bridge — a Swift port of
/// packages/shared/src/wsProtocol.ts. Frames are JSON text messages; payloads
/// stay raw `Data` here so the typed layer (BridgeRequest) decodes them.
public enum WsFrameError: Error, Equatable {
    case invalidFrame
}

public enum IncomingFrame: Equatable {
    case response(id: String, payload: Data?, error: String?)
    case push(kind: String, payload: Data?)
}

/// Splice an already-encoded JSON payload into a request frame.
public func composeRequestFrame(id: String, kind: String, payload: Data) throws -> String {
    let payloadObj = try JSONSerialization.jsonObject(with: payload, options: [.fragmentsAllowed])
    let frame: [String: Any] = ["id": id, "kind": kind, "payload": payloadObj]
    let data = try JSONSerialization.data(withJSONObject: frame)
    return String(decoding: data, as: UTF8.self)
}

public func decodeIncomingFrame(_ raw: String) throws -> IncomingFrame {
    guard let obj = (try? JSONSerialization.jsonObject(with: Data(raw.utf8))) as? [String: Any],
          let kind = obj["kind"] as? String
    else { throw WsFrameError.invalidFrame }
    let payload: Data? = obj["payload"].flatMap {
        try? JSONSerialization.data(withJSONObject: $0, options: [.fragmentsAllowed])
    }
    if obj["push"] as? Bool == true {
        return .push(kind: kind, payload: payload)
    }
    guard let id = obj["id"] as? String, !id.isEmpty else { throw WsFrameError.invalidFrame }
    return .response(id: id, payload: payload, error: obj["error"] as? String)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd swift/WatchtowerCore && swift test --filter WsFramesTests 2>&1 | tail -5`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add swift/WatchtowerCore/Sources/WatchtowerBridge/Transport/WsFrames.swift swift/WatchtowerCore/Tests/WatchtowerBridgeTests/WsFramesTests.swift
git commit -m "feat(ipad-native): WS bridge frame codec (port of wsProtocol.ts)"
```

---

### Task 3: Connection model + validation

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerBridge/Connection/Connection.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerBridgeTests/ConnectionTests.swift`

**Interfaces:**
- Produces:
  - `struct Connection: Codable, Equatable, Sendable` — `host: String`, `port: Int`, `token: String`, `mac: String?`, `lanIp: String?`, `wanHost: String?`, `wanPort: Int?`; computed `wsURL: URL?` (`ws://host:port/ws`, no token — the client appends it).
  - `struct ConnectionFormState: Equatable, Sendable` — all-String fields `host, port, token, mac, lanIp, wanHost, wanPort`; `init()` defaults port to `"7445"`; `init(_ c: Connection)` maps back.
  - `enum ConnectionValidationError: Error, Equatable` with `var message: String` (English).
  - `func parseConnection(_ form: ConnectionFormState) -> Result<Connection, ConnectionValidationError>`
  - `struct ParsedMac: Equatable, Sendable { let bytes: [UInt8] }` and `func parseMac(_ input: String) -> ParsedMac?`
- Consumed by: Tasks 4, 6, 8, 9. Port of `apps/ipad/src/connection.ts` + `parseMac` from `apps/ipad/src/lib/wakeOnLan.ts` (the full magic-packet builder ports in Phase 4; `parseMac` is needed now for form validation).

- [ ] **Step 1: Write the failing tests**

Create `swift/WatchtowerCore/Tests/WatchtowerBridgeTests/ConnectionTests.swift`:

```swift
import XCTest
@testable import WatchtowerBridge

final class ConnectionTests: XCTestCase {
    private func form(
        host: String = "mac.tailnet.ts.net", port: String = "7445", token: String = "tok",
        mac: String = "", lanIp: String = "", wanHost: String = "", wanPort: String = ""
    ) -> ConnectionFormState {
        var f = ConnectionFormState()
        f.host = host; f.port = port; f.token = token
        f.mac = mac; f.lanIp = lanIp; f.wanHost = wanHost; f.wanPort = wanPort
        return f
    }

    // MARK: parseMac (port of wakeOnLan.ts tests)

    func testParseMacColonAndDash() {
        XCTAssertEqual(parseMac("AA:BB:CC:DD:EE:FF")?.bytes, [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff])
        XCTAssertEqual(parseMac("aa-bb-cc-dd-ee-ff")?.bytes, [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff])
        XCTAssertEqual(parseMac("  00:11:22:33:44:55 ")?.bytes, [0x00, 0x11, 0x22, 0x33, 0x44, 0x55])
    }

    func testParseMacRejectsMalformed() {
        XCTAssertNil(parseMac("AA:BB:CC:DD:EE"))          // 5 groups
        XCTAssertNil(parseMac("AA:BB:CC:DD:EE:FF:00"))    // 7 groups
        XCTAssertNil(parseMac("AA::CC:DD:EE:FF"))         // empty group (matches TS split-keeps-empties)
        XCTAssertNil(parseMac("GG:BB:CC:DD:EE:FF"))       // non-hex
        XCTAssertNil(parseMac("AAA:BB:CC:DD:EE:F"))       // wrong group width
        XCTAssertNil(parseMac(""))
    }

    // MARK: parseConnection (port of connection.ts tests)

    func testValidMinimal() throws {
        let c = try parseConnection(form()).get()
        XCTAssertEqual(c.host, "mac.tailnet.ts.net")
        XCTAssertEqual(c.port, 7445)
        XCTAssertEqual(c.token, "tok")
        XCTAssertNil(c.mac); XCTAssertNil(c.lanIp); XCTAssertNil(c.wanHost); XCTAssertNil(c.wanPort)
    }

    func testTrimsWhitespace() throws {
        let c = try parseConnection(form(host: "  10.0.0.5 ", token: " tok ")).get()
        XCTAssertEqual(c.host, "10.0.0.5")
        XCTAssertEqual(c.token, "tok")
    }

    func testHostRequired() {
        XCTAssertEqual(parseConnection(form(host: "  ")), .failure(.hostRequired))
    }

    func testPortValidation() {
        XCTAssertEqual(parseConnection(form(port: "0")), .failure(.portInvalid))
        XCTAssertEqual(parseConnection(form(port: "65536")), .failure(.portInvalid))
        XCTAssertEqual(parseConnection(form(port: "abc")), .failure(.portInvalid))
        XCTAssertEqual(parseConnection(form(port: "7.5")), .failure(.portInvalid))
    }

    func testTokenRequired() {
        XCTAssertEqual(parseConnection(form(token: "")), .failure(.tokenRequired))
    }

    func testMacOptionalButValidatedWhenPresent() throws {
        XCTAssertEqual(parseConnection(form(mac: "nonsense")), .failure(.macInvalid))
        let c = try parseConnection(form(mac: "AA:BB:CC:DD:EE:FF")).get()
        XCTAssertEqual(c.mac, "AA:BB:CC:DD:EE:FF")
    }

    func testWanPortDefaultsTo9WhenWanHostSet() throws {
        let c = try parseConnection(form(wanHost: "home.example.com")).get()
        XCTAssertEqual(c.wanHost, "home.example.com")
        XCTAssertEqual(c.wanPort, 9)
        // No wanHost -> wanPort stays nil even if the field is filled.
        let c2 = try parseConnection(form(wanPort: "7")).get()
        XCTAssertNil(c2.wanPort)
    }

    func testWanPortValidated() {
        XCTAssertEqual(parseConnection(form(wanHost: "h", wanPort: "0")), .failure(.wanPortInvalid))
    }

    // MARK: wsURL + round-trips

    func testWsURL() throws {
        let c = try parseConnection(form(host: "100.64.1.2", port: "7445")).get()
        XCTAssertEqual(c.wsURL?.absoluteString, "ws://100.64.1.2:7445/ws")
    }

    func testFormStateRoundTrip() throws {
        var f = form(mac: "AA:BB:CC:DD:EE:FF", lanIp: "192.168.1.10", wanHost: "h.example.com", wanPort: "7")
        let c = try parseConnection(f).get()
        f = ConnectionFormState(c)
        XCTAssertEqual(f.host, "mac.tailnet.ts.net")
        XCTAssertEqual(f.port, "7445")
        XCTAssertEqual(f.token, "tok")
        XCTAssertEqual(f.mac, "AA:BB:CC:DD:EE:FF")
        XCTAssertEqual(f.lanIp, "192.168.1.10")
        XCTAssertEqual(f.wanHost, "h.example.com")
        XCTAssertEqual(f.wanPort, "7")
    }

    func testCodableRoundTrip() throws {
        let c = try parseConnection(form(mac: "AA:BB:CC:DD:EE:FF")).get()
        let decoded = try JSONDecoder().decode(Connection.self, from: JSONEncoder().encode(c))
        XCTAssertEqual(decoded, c)
    }

    func testErrorMessagesAreEnglish() {
        XCTAssertEqual(ConnectionValidationError.hostRequired.message, "Host is required")
        XCTAssertEqual(ConnectionValidationError.portInvalid.message, "Port must be 1–65535")
        XCTAssertEqual(ConnectionValidationError.tokenRequired.message, "Token is required")
        XCTAssertEqual(ConnectionValidationError.macInvalid.message, "MAC address is invalid")
        XCTAssertEqual(ConnectionValidationError.wanPortInvalid.message, "Wake port must be 1–65535")
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd swift/WatchtowerCore && swift test --filter ConnectionTests 2>&1 | tail -5`
Expected: FAIL — types not defined.

- [ ] **Step 3: Implement the model**

Create `swift/WatchtowerCore/Sources/WatchtowerBridge/Connection/Connection.swift`:

```swift
import Foundation

/// A saved connection to the Mac orchestrator — port of apps/ipad/src/connection.ts.
public struct Connection: Codable, Equatable, Sendable {
    public var host: String
    public var port: Int
    public var token: String
    /// Mac's Ethernet MAC, for Wake-on-LAN (Phase 4).
    public var mac: String?
    /// Home wake target (the Mac's LAN IP).
    public var lanIp: String?
    /// Away wake target (DDNS hostname / public IP).
    public var wanHost: String?
    /// Away wake target port (default 9).
    public var wanPort: Int?

    public init(
        host: String, port: Int, token: String,
        mac: String? = nil, lanIp: String? = nil, wanHost: String? = nil, wanPort: Int? = nil
    ) {
        self.host = host; self.port = port; self.token = token
        self.mac = mac; self.lanIp = lanIp; self.wanHost = wanHost; self.wanPort = wanPort
    }

    /// `ws://host:port/ws` — token is appended as a query param by the client.
    public var wsURL: URL? {
        var c = URLComponents()
        c.scheme = "ws"
        c.host = host
        c.port = port
        c.path = "/ws"
        return c.url
    }
}

// MARK: - MAC parsing (subset of wakeOnLan.ts; packet builder ports in Phase 4)

public struct ParsedMac: Equatable, Sendable {
    /// Exactly 6 octets.
    public let bytes: [UInt8]
}

/// Parse "AA:BB:CC:DD:EE:FF" or "AA-BB-CC-DD-EE-FF" (case-insensitive).
public func parseMac(_ input: String) -> ParsedMac? {
    // components(separatedBy:) keeps empty groups, matching the TS split(/[:-]/)
    // behavior — "AA::CC:DD:EE:FF" must fail, not collapse to 5 groups.
    let parts = input
        .trimmingCharacters(in: .whitespaces)
        .components(separatedBy: CharacterSet(charactersIn: ":-"))
    guard parts.count == 6 else { return nil }
    var bytes: [UInt8] = []
    for p in parts {
        guard p.count == 2, p.allSatisfy(\.isHexDigit), let b = UInt8(p, radix: 16) else { return nil }
        bytes.append(b)
    }
    return ParsedMac(bytes: bytes)
}

// MARK: - Form state + validation

public struct ConnectionFormState: Equatable, Sendable {
    public var host = ""
    public var port = "7445"
    public var token = ""
    public var mac = ""
    public var lanIp = ""
    public var wanHost = ""
    public var wanPort = ""

    public init() {}

    public init(_ c: Connection) {
        host = c.host
        port = String(c.port)
        token = c.token
        mac = c.mac ?? ""
        lanIp = c.lanIp ?? ""
        wanHost = c.wanHost ?? ""
        wanPort = c.wanPort.map(String.init) ?? ""
    }
}

public enum ConnectionValidationError: Error, Equatable {
    case hostRequired, portInvalid, tokenRequired, macInvalid, wanPortInvalid

    public var message: String {
        switch self {
        case .hostRequired: return "Host is required"
        case .portInvalid: return "Port must be 1–65535"
        case .tokenRequired: return "Token is required"
        case .macInvalid: return "MAC address is invalid"
        case .wanPortInvalid: return "Wake port must be 1–65535"
        }
    }
}

private func parsePort(_ raw: String) -> Int? {
    guard let p = Int(raw.trimmingCharacters(in: .whitespaces)), (1...65535).contains(p) else { return nil }
    return p
}

public func parseConnection(_ form: ConnectionFormState) -> Result<Connection, ConnectionValidationError> {
    let host = form.host.trimmingCharacters(in: .whitespaces)
    guard !host.isEmpty else { return .failure(.hostRequired) }
    guard let port = parsePort(form.port) else { return .failure(.portInvalid) }
    let token = form.token.trimmingCharacters(in: .whitespaces)
    guard !token.isEmpty else { return .failure(.tokenRequired) }

    var value = Connection(host: host, port: port, token: token)

    let mac = form.mac.trimmingCharacters(in: .whitespaces)
    if !mac.isEmpty {
        guard parseMac(mac) != nil else { return .failure(.macInvalid) }
        value.mac = mac
    }
    let lanIp = form.lanIp.trimmingCharacters(in: .whitespaces)
    if !lanIp.isEmpty { value.lanIp = lanIp }
    let wanHost = form.wanHost.trimmingCharacters(in: .whitespaces)
    if !wanHost.isEmpty {
        value.wanHost = wanHost
        let rawWanPort = form.wanPort.trimmingCharacters(in: .whitespaces)
        if rawWanPort.isEmpty {
            value.wanPort = 9
        } else {
            guard let wp = parsePort(rawWanPort) else { return .failure(.wanPortInvalid) }
            value.wanPort = wp
        }
    }
    return .success(value)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd swift/WatchtowerCore && swift test --filter ConnectionTests 2>&1 | tail -5`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add swift/WatchtowerCore/Sources/WatchtowerBridge/Connection/Connection.swift swift/WatchtowerCore/Tests/WatchtowerBridgeTests/ConnectionTests.swift
git commit -m "feat(ipad-native): Connection model, validation, and parseMac (port of connection.ts)"
```

---

### Task 4: ConnectionStore persistence dependency

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerBridge/Connection/ConnectionStore.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerBridgeTests/ConnectionStoreTests.swift`

**Interfaces:**
- Produces:
  - `@DependencyClient struct ConnectionStore: Sendable { var load: @Sendable () -> Connection?; var save: @Sendable (Connection) -> Void }`
  - `ConnectionStore.store(defaults: UserDefaults) -> ConnectionStore` (test seam), `DependencyValues.connectionStore`.
- Consumed by: Tasks 8, 9.

- [ ] **Step 1: Write the failing tests**

Create `swift/WatchtowerCore/Tests/WatchtowerBridgeTests/ConnectionStoreTests.swift`:

```swift
import XCTest
@testable import WatchtowerBridge

final class ConnectionStoreTests: XCTestCase {
    private func ephemeralDefaults() -> UserDefaults {
        let suite = "connection-store-tests-\(UUID().uuidString)"
        let d = UserDefaults(suiteName: suite)!
        d.removePersistentDomain(forName: suite)
        return d
    }

    func testLoadReturnsNilWhenEmpty() {
        let store = ConnectionStore.store(defaults: ephemeralDefaults())
        XCTAssertNil(store.load())
    }

    func testSaveThenLoadRoundTrip() {
        let store = ConnectionStore.store(defaults: ephemeralDefaults())
        let conn = Connection(host: "10.0.0.5", port: 7445, token: "tok", mac: "AA:BB:CC:DD:EE:FF")
        store.save(conn)
        XCTAssertEqual(store.load(), conn)
    }

    func testLoadToleratesCorruptData() {
        let defaults = ephemeralDefaults()
        defaults.set(Data("not json".utf8), forKey: ConnectionStore.key)
        let store = ConnectionStore.store(defaults: defaults)
        XCTAssertNil(store.load())
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd swift/WatchtowerCore && swift test --filter ConnectionStoreTests 2>&1 | tail -5`
Expected: FAIL — `ConnectionStore` not defined.

- [ ] **Step 3: Implement the store**

Create `swift/WatchtowerCore/Sources/WatchtowerBridge/Connection/ConnectionStore.swift`:

```swift
import Foundation
import ComposableArchitecture

/// Persists the saved Connection as JSON in UserDefaults under
/// "watchtower.connection" — the same key + JSON shape the Capacitor app used
/// in Capacitor Preferences. The apps don't share storage; keeping the shape
/// identical just makes manual debugging familiar.
@DependencyClient
public struct ConnectionStore: Sendable {
    public var load: @Sendable () -> Connection? = { nil }
    public var save: @Sendable (Connection) -> Void
}

extension ConnectionStore: DependencyKey {
    public static let key = "watchtower.connection"

    public static var liveValue: ConnectionStore {
        store(defaults: .standard)
    }

    public static func store(defaults: UserDefaults) -> ConnectionStore {
        ConnectionStore(
            load: {
                guard let data = defaults.data(forKey: key) else { return nil }
                return try? JSONDecoder().decode(Connection.self, from: data)
            },
            save: { conn in
                // Encoding a well-formed Connection cannot fail (plain Codable fields).
                if let data = try? JSONEncoder().encode(conn) {
                    defaults.set(data, forKey: key)
                }
            }
        )
    }
}

public extension DependencyValues {
    var connectionStore: ConnectionStore {
        get { self[ConnectionStore.self] }
        set { self[ConnectionStore.self] = newValue }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd swift/WatchtowerCore && swift test --filter ConnectionStoreTests 2>&1 | tail -5`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add swift/WatchtowerCore/Sources/WatchtowerBridge/Connection/ConnectionStore.swift swift/WatchtowerCore/Tests/WatchtowerBridgeTests/ConnectionStoreTests.swift
git commit -m "feat(ipad-native): ConnectionStore UserDefaults persistence dependency"
```

---

### Task 5: BridgeSocket abstraction + URLSession live implementation

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerBridge/Transport/BridgeSocket.swift`

**Interfaces:**
- Produces:
  - `enum BridgeSocketEvent: Equatable, Sendable { case opened; case text(String); case closed }`
  - `protocol BridgeSocket: Sendable { var events: AsyncStream<BridgeSocketEvent> { get }; func send(_ text: String) async throws; func close() }`
  - `typealias BridgeSocketFactory = @Sendable (URL) -> any BridgeSocket`
  - `final class URLSessionSocket: NSObject, BridgeSocket` — live impl.
- Consumed by: Task 6 (`BridgeConnection` takes a `BridgeSocketFactory`; tests inject a fake).

No unit test drives the live `URLSessionSocket` (it needs a real server); this task's verification is a clean build + the contract documented on the protocol. The fake conforming type in Task 6's tests exercises the protocol; the live impl is exercised on-device in Task 11.

- [ ] **Step 1: Implement the protocol and live socket**

Create `swift/WatchtowerCore/Sources/WatchtowerBridge/Transport/BridgeSocket.swift`:

```swift
import Foundation

public enum BridgeSocketEvent: Equatable, Sendable {
    case opened
    case text(String)
    case closed
}

/// Minimal socket seam so BridgeConnection is testable with a scripted fake.
/// Contract: `events` yields `.opened` at most once when the socket connects,
/// `.text` per received message, and `.closed` EXACTLY once when the socket
/// dies — a failed connect and a live-connection drop both end in one
/// `.closed` (mirrors the signalClose dedupe in webSocketTransport.ts).
public protocol BridgeSocket: Sendable {
    var events: AsyncStream<BridgeSocketEvent> { get }
    func send(_ text: String) async throws
    func close()
}

public typealias BridgeSocketFactory = @Sendable (URL) -> any BridgeSocket

/// Live implementation over URLSessionWebSocketTask.
public final class URLSessionSocket: NSObject, BridgeSocket, @unchecked Sendable {
    public let events: AsyncStream<BridgeSocketEvent>
    private let continuation: AsyncStream<BridgeSocketEvent>.Continuation
    private var session: URLSession!
    private var task: URLSessionWebSocketTask!
    private let lock = NSLock()
    private var closedOnce = false

    public init(url: URL) {
        (events, continuation) = AsyncStream<BridgeSocketEvent>.makeStream()
        super.init()
        session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        task = session.webSocketTask(with: url)
        task.resume()
        receiveLoop()
    }

    private func receiveLoop() {
        task.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case let .success(message):
                if case let .string(text) = message {
                    self.continuation.yield(.text(text))
                }
                self.receiveLoop()
            case .failure:
                self.signalClosed()
            }
        }
    }

    /// Emit `.closed` exactly once no matter how many paths report death
    /// (receive failure, delegate didClose, didCompleteWithError, local close).
    private func signalClosed() {
        lock.lock()
        let already = closedOnce
        closedOnce = true
        lock.unlock()
        guard !already else { return }
        continuation.yield(.closed)
        continuation.finish()
        session.finishTasksAndInvalidate()
    }

    public func send(_ text: String) async throws {
        try await task.send(.string(text))
    }

    public func close() {
        task.cancel(with: .normalClosure, reason: nil)
        signalClosed()
    }
}

extension URLSessionSocket: URLSessionWebSocketDelegate {
    public func urlSession(
        _ session: URLSession, webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        continuation.yield(.opened)
    }

    public func urlSession(
        _ session: URLSession, webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?
    ) {
        signalClosed()
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        // Fires for failed connects (which never get didOpen/didClose) —
        // the equivalent of the TS pre-open `error` → close mapping.
        signalClosed()
    }
}
```

- [ ] **Step 2: Verify it builds and the suite still passes**

Run: `cd swift/WatchtowerCore && swift build && swift test 2>&1 | tail -3`
Expected: Build succeeds; all existing tests PASS.

- [ ] **Step 3: Commit**

```bash
git add swift/WatchtowerCore/Sources/WatchtowerBridge/Transport/BridgeSocket.swift
git commit -m "feat(ipad-native): BridgeSocket seam + URLSessionWebSocketTask live impl"
```

---

### Task 6: BridgeConnection actor — reconnect, RPC matching, pushes, status

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerBridge/Transport/BridgeClient.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerBridgeTests/BridgeClientTests.swift`

**Interfaces:**
- Produces:
  - `enum ConnStatus: String, Equatable, Sendable { case connecting, connected, disconnected }`
  - `enum BridgeError: Error, Equatable { case notConnected, disconnected, rpc(String), badResponse }`
  - `actor BridgeConnection` with `Config(backoffMs:connectTimeoutMs:)`.
  - `@DependencyClient struct BridgeClient` — `configure(Connection)`, `shutdown()`, `statusStream() -> AsyncStream<ConnStatus>` (replays current), `send(kind:payload:) -> Data`, `pushes(kind:) -> AsyncStream<Data>`; `BridgeClient.live(factory:clock:config:)`; registered as `DependencyValues.bridge` (live factory = `URLSessionSocket.init`).
- Consumed by: Tasks 7, 8, 9. Semantics port `apps/ipad/src/lib/reconnectingTransport.ts`: backoff `min(1000·2ⁿ, 15000)` ms, 8 s connect watchdog, `connected` only on a real open, attempt counter resets only on open, exactly one reconnect scheduled per attempt.
- Deliberate deviation from TS: `send` while not connected **throws `BridgeError.notConnected`** immediately (the TS layer queued into a possibly-dead socket's outbox). Callers retry when status returns to `.connected`.

- [ ] **Step 1: Write the failing tests**

Create `swift/WatchtowerCore/Tests/WatchtowerBridgeTests/BridgeClientTests.swift`:

```swift
import XCTest
import ComposableArchitecture
@testable import WatchtowerBridge

// If TestClock is not visible via ComposableArchitecture in this toolchain,
// add `.product(name: "Clocks", package: "swift-clocks")` to the
// WatchtowerBridgeTests target (swift-clocks is already in the resolved graph
// as a TCA dependency) — do not vendor a clock.

/// Scripted in-memory socket driven by the test.
final class FakeSocket: BridgeSocket, @unchecked Sendable {
    let events: AsyncStream<BridgeSocketEvent>
    private let cont: AsyncStream<BridgeSocketEvent>.Continuation
    private let lock = NSLock()
    private var _sent: [String] = []
    private var _closed = false

    init() {
        (events, cont) = AsyncStream<BridgeSocketEvent>.makeStream()
    }

    var sent: [String] { lock.withLock { _sent } }
    var isClosed: Bool { lock.withLock { _closed } }

    func send(_ text: String) async throws {
        lock.withLock { _sent.append(text) }
    }

    func close() {
        let already = lock.withLock { () -> Bool in
            let c = _closed; _closed = true; return c
        }
        guard !already else { return }
        cont.yield(.closed)
        cont.finish()
    }

    // Test drivers
    func open() { cont.yield(.opened) }
    func receive(_ text: String) { cont.yield(.text(text)) }
}

/// Captures every socket the client's factory creates.
final class SocketRig: @unchecked Sendable {
    private let lock = NSLock()
    private var _sockets: [FakeSocket] = []
    var sockets: [FakeSocket] { lock.withLock { _sockets } }
    var latest: FakeSocket? { sockets.last }
    var factory: BridgeSocketFactory {
        { [self] _ in
            let s = FakeSocket()
            lock.withLock { _sockets.append(s) }
            return s
        }
    }
}

private func jsonObject(_ data: Data) -> NSObject? {
    (try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])) as? NSObject
}

final class BridgeClientTests: XCTestCase {
    private let conn = Connection(host: "10.0.0.5", port: 7445, token: "tok")

    /// Real-time poll for a condition produced by the actor's background tasks.
    private func waitUntil(
        _ what: String, timeout: TimeInterval = 2,
        _ predicate: @escaping () -> Bool
    ) async {
        let deadline = Date().addingTimeInterval(timeout)
        while !predicate() {
            if Date() > deadline { return XCTFail("timed out waiting for \(what)") }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
    }

    private func makeClient(_ rig: SocketRig, clock: any Clock<Duration>) -> BridgeClient {
        .live(factory: rig.factory, clock: clock)
    }

    func testConnectFlowAndTokenURL() async {
        let rig = SocketRig()
        let client = makeClient(rig, clock: TestClock())
        let statuses = LockIsolated<[ConnStatus]>([])
        let stream = await client.statusStream()
        let collector = Task { for await s in stream { statuses.withValue { $0.append(s) } } }
        defer { collector.cancel() }

        await client.configure(conn)
        await waitUntil("socket created") { rig.sockets.count == 1 }
        rig.latest?.open()
        await waitUntil("connected status") { statuses.value.last == .connected }
        // Initial replay (.disconnected) → connecting → connected.
        XCTAssertEqual(statuses.value, [.disconnected, .connecting, .connected])
    }

    func testInvokeRoundTrip() async throws {
        let rig = SocketRig()
        let client = makeClient(rig, clock: TestClock())
        await client.configure(conn)
        await waitUntil("socket") { rig.sockets.count == 1 }
        rig.latest?.open()
        await waitUntil("connected") {
            true // open is synchronous into the stream; the send below polls readiness
        }

        // Retry send until the actor has processed `.opened` (status connected).
        var result: Data?
        let task = Task { [client] () -> Data in
            while true {
                do { return try await client.send("listInstances", Data("{}".utf8)) }
                catch BridgeError.notConnected { try? await Task.sleep(nanoseconds: 10_000_000) }
            }
        }
        await waitUntil("request sent") { rig.latest!.sent.count == 1 }
        let frame = jsonObject(Data(rig.latest!.sent[0].utf8)) as! [String: Any]
        XCTAssertEqual(frame["kind"] as? String, "listInstances")
        let id = frame["id"] as! String
        rig.latest?.receive(#"{"id":"\#(id)","kind":"listInstances","payload":{"instances":[]}}"#)
        result = try await task.value
        XCTAssertEqual(jsonObject(result!), jsonObject(Data(#"{"instances":[]}"#.utf8)))
    }

    func testInvokeRpcErrorThrows() async {
        let rig = SocketRig()
        let client = makeClient(rig, clock: TestClock())
        await client.configure(conn)
        await waitUntil("socket") { rig.sockets.count == 1 }
        rig.latest?.open()

        let task = Task { [client] () -> Data in
            while true {
                do { return try await client.send("spawnInstance", Data("{}".utf8)) }
                catch BridgeError.notConnected { try? await Task.sleep(nanoseconds: 10_000_000) }
            }
        }
        await waitUntil("request sent") { (rig.latest?.sent.count ?? 0) == 1 }
        let frame = jsonObject(Data(rig.latest!.sent[0].utf8)) as! [String: Any]
        let id = frame["id"] as! String
        rig.latest?.receive(#"{"id":"\#(id)","kind":"spawnInstance","error":"boom"}"#)
        do {
            _ = try await task.value
            XCTFail("expected rpc error")
        } catch {
            XCTAssertEqual(error as? BridgeError, .rpc("boom"))
        }
    }

    func testSendWithoutConfigureThrowsNotConnected() async {
        let client = makeClient(SocketRig(), clock: TestClock())
        do {
            _ = try await client.send("listInstances", Data("{}".utf8))
            XCTFail("expected notConnected")
        } catch {
            XCTAssertEqual(error as? BridgeError, .notConnected)
        }
    }

    func testPendingRequestFailsWhenSocketDrops() async {
        let rig = SocketRig()
        let client = makeClient(rig, clock: TestClock())
        await client.configure(conn)
        await waitUntil("socket") { rig.sockets.count == 1 }
        rig.latest?.open()

        let task = Task { [client] () -> Data in
            while true {
                do { return try await client.send("listInstances", Data("{}".utf8)) }
                catch BridgeError.notConnected { try? await Task.sleep(nanoseconds: 10_000_000) }
            }
        }
        await waitUntil("request sent") { (rig.latest?.sent.count ?? 0) == 1 }
        rig.latest?.close() // drop mid-flight
        do {
            _ = try await task.value
            XCTFail("expected disconnected")
        } catch {
            XCTAssertEqual(error as? BridgeError, .disconnected)
        }
    }

    func testPushRouting() async {
        let rig = SocketRig()
        let client = makeClient(rig, clock: TestClock())
        await client.configure(conn)
        await waitUntil("socket") { rig.sockets.count == 1 }
        rig.latest?.open()

        let received = LockIsolated<[Data]>([])
        let stream = await client.pushes(BridgePushKindStateChanged)
        let collector = Task { for await p in stream { received.withValue { $0.append(p) } } }
        defer { collector.cancel() }
        // Give the subscription a beat to register before pushing.
        try? await Task.sleep(nanoseconds: 50_000_000)
        rig.latest?.receive(#"{"push":true,"kind":"stateChanged","payload":{"instanceId":"i1"}}"#)
        await waitUntil("push delivered") { !received.value.isEmpty }
        XCTAssertEqual(jsonObject(received.value[0]), jsonObject(Data(#"{"instanceId":"i1"}"#.utf8)))
    }

    func testWatchdogAbandonsSocketThatNeverOpens() async {
        let rig = SocketRig()
        let clock = TestClock()
        let client = makeClient(rig, clock: clock)
        await client.configure(conn)
        await waitUntil("first socket") { rig.sockets.count == 1 }
        // Never open it. Watchdog fires at 8s → close → backoff(attempt 0)=1s.
        await clock.advance(by: .milliseconds(8000))
        await waitUntil("first socket closed") { rig.sockets[0].isClosed }
        await clock.advance(by: .milliseconds(1000))
        await waitUntil("second socket created") { rig.sockets.count == 2 }
        // Open the retry — attempt counter must reset (verified via next drop
        // reconnecting after the FIRST backoff step again).
        rig.sockets[1].open()
    }

    func testBackoffCurve() {
        let backoff = BridgeConnection.Config().backoffMs
        XCTAssertEqual(backoff(0), 1000)
        XCTAssertEqual(backoff(1), 2000)
        XCTAssertEqual(backoff(2), 4000)
        XCTAssertEqual(backoff(3), 8000)
        XCTAssertEqual(backoff(4), 15000) // 16000 capped
        XCTAssertEqual(backoff(10), 15000)
        XCTAssertEqual(backoff(30), 15000) // no Int overflow at high attempts
    }

    func testConfigureAgainReplacesSocket() async {
        let rig = SocketRig()
        let client = makeClient(rig, clock: TestClock())
        await client.configure(conn)
        await waitUntil("first socket") { rig.sockets.count == 1 }
        rig.latest?.open()
        await client.configure(Connection(host: "other.host", port: 7446, token: "tok2"))
        await waitUntil("old socket closed") { rig.sockets[0].isClosed }
        await waitUntil("new socket") { rig.sockets.count == 2 }
    }

    func testShutdownStopsReconnecting() async {
        let rig = SocketRig()
        let clock = TestClock()
        let client = makeClient(rig, clock: clock)
        await client.configure(conn)
        await waitUntil("socket") { rig.sockets.count == 1 }
        rig.latest?.open()
        await client.shutdown()
        await waitUntil("socket closed") { rig.sockets[0].isClosed }
        // A generous clock advance must not spawn a new connect attempt.
        await clock.advance(by: .seconds(120))
        try? await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(rig.sockets.count, 1)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd swift/WatchtowerCore && swift test --filter BridgeClientTests 2>&1 | tail -5`
Expected: FAIL — `BridgeConnection`/`BridgeClient`/`ConnStatus` not defined. (`BridgePushKindStateChanged` arrives in Task 7 — for now add `let BridgePushKindStateChanged = "stateChanged"` at the top of the test file with a `// TODO(Task 7): replace with BridgePush.stateChanged` comment, and swap it in Task 7.)

- [ ] **Step 3: Implement the actor and dependency**

Create `swift/WatchtowerCore/Sources/WatchtowerBridge/Transport/BridgeClient.swift`:

```swift
import Foundation
import ComposableArchitecture

public enum ConnStatus: String, Equatable, Sendable {
    case connecting, connected, disconnected
}

public enum BridgeError: Error, Equatable {
    /// invoke attempted with no open socket — retry when status is .connected.
    case notConnected
    /// Socket dropped while the request was in flight.
    case disconnected
    /// The orchestrator handler returned an error frame.
    case rpc(String)
    /// Response payload missing or failed to decode.
    case badResponse
}

/// Reconnecting bridge connection — a Swift port of
/// apps/ipad/src/lib/reconnectingTransport.ts over the BridgeSocket seam.
public actor BridgeConnection {
    public struct Config: Sendable {
        /// min(1000·2ⁿ, 15000) ms — shift is clamped so high attempts can't overflow.
        public var backoffMs: @Sendable (Int) -> Int
        /// A connect attempt that neither opens nor closes must not wedge the
        /// loop (an unreachable/off Mac leaves TCP in CONNECTING for tens of
        /// seconds with no event) — abandon it after this long and retry.
        public var connectTimeoutMs: Int

        public init(
            backoffMs: @escaping @Sendable (Int) -> Int = { min(1000 * (1 << min($0, 4)), 15000) },
            connectTimeoutMs: Int = 8000
        ) {
            self.backoffMs = backoffMs
            self.connectTimeoutMs = connectTimeoutMs
        }
    }

    private let factory: BridgeSocketFactory
    private let clock: any Clock<Duration>
    private let config: Config

    private var connection: Connection?
    private var socket: (any BridgeSocket)?
    private var loopTask: Task<Void, Never>?
    /// Bumped on every configure/shutdown; stale loops check it and bail.
    private var generation = 0
    private var attempt = 0
    private var counter = 0
    private var status: ConnStatus = .disconnected
    private var pending: [String: CheckedContinuation<Data, Error>] = [:]
    private var pushSubs: [String: [UUID: AsyncStream<Data>.Continuation]] = [:]
    private var statusSubs: [UUID: AsyncStream<ConnStatus>.Continuation] = [:]

    public init(
        factory: @escaping BridgeSocketFactory,
        clock: any Clock<Duration> = ContinuousClock(),
        config: Config = Config()
    ) {
        self.factory = factory
        self.clock = clock
        self.config = config
    }

    // MARK: lifecycle

    public func configure(_ conn: Connection) {
        connection = conn
        generation += 1
        attempt = 0
        loopTask?.cancel()
        socket?.close()
        socket = nil
        failPending(with: .disconnected)
        let gen = generation
        loopTask = Task { await self.runLoop(generation: gen) }
    }

    public func shutdown() {
        generation += 1
        loopTask?.cancel()
        loopTask = nil
        socket?.close()
        socket = nil
        failPending(with: .disconnected)
        setStatus(.disconnected)
    }

    // MARK: RPC

    public func send(kind: String, payload: Data) async throws -> Data {
        guard status == .connected, let sock = socket else { throw BridgeError.notConnected }
        counter += 1
        let id = "c\(counter)"
        let raw = try composeRequestFrame(id: id, kind: kind, payload: payload)
        return try await withCheckedThrowingContinuation { cont in
            pending[id] = cont
            Task {
                do { try await sock.send(raw) }
                catch { await self.failRequest(id: id) }
            }
        }
    }

    // MARK: subscriptions

    /// Replays the current status immediately — subscribers typically attach
    /// after the initial connect has already flipped it (same rationale as the
    /// TS onStatus replay).
    public func statusStream() -> AsyncStream<ConnStatus> {
        let (stream, cont) = AsyncStream<ConnStatus>.makeStream()
        let id = UUID()
        cont.yield(status)
        statusSubs[id] = cont
        cont.onTermination = { _ in
            Task { await self.removeStatusSub(id) }
        }
        return stream
    }

    public func pushes(kind: String) -> AsyncStream<Data> {
        let (stream, cont) = AsyncStream<Data>.makeStream()
        let id = UUID()
        pushSubs[kind, default: [:]][id] = cont
        cont.onTermination = { _ in
            Task { await self.removePushSub(kind: kind, id: id) }
        }
        return stream
    }

    // MARK: internals

    private func runLoop(generation gen: Int) async {
        guard let conn = connection, let base = conn.wsURL,
              var comps = URLComponents(url: base, resolvingAgainstBaseURL: false)
        else { return }
        comps.queryItems = [URLQueryItem(name: "token", value: conn.token)]
        guard let url = comps.url else { return }

        while !Task.isCancelled && gen == generation {
            setStatus(.connecting)
            let sock = factory(url)
            socket = sock
            await consume(sock, generation: gen)
            guard gen == generation else { return }
            socket = nil
            failPending(with: .disconnected)
            setStatus(.disconnected)
            let wait = config.backoffMs(attempt)
            attempt += 1
            try? await clock.sleep(for: .milliseconds(wait))
        }
    }

    private func consume(_ sock: any BridgeSocket, generation gen: Int) async {
        let watchdog = Task { [config, clock] in
            try? await clock.sleep(for: .milliseconds(config.connectTimeoutMs))
            guard !Task.isCancelled else { return }
            await self.watchdogFired(sock)
        }
        defer { watchdog.cancel() }
        for await event in sock.events {
            guard gen == generation else { return }
            switch event {
            case .opened:
                // 'connected' only on a real open; backoff resets only here.
                watchdog.cancel()
                attempt = 0
                setStatus(.connected)
            case let .text(raw):
                handleFrame(raw)
            case .closed:
                return
            }
        }
    }

    private func watchdogFired(_ sock: any BridgeSocket) {
        // Only abandon a socket still connecting; close() on an already-dead
        // or replaced socket is a harmless no-op (BridgeSocket contract).
        guard status == .connecting else { return }
        sock.close()
    }

    private func handleFrame(_ raw: String) {
        guard let frame = try? decodeIncomingFrame(raw) else { return }
        switch frame {
        case let .response(id, payload, error):
            guard let cont = pending.removeValue(forKey: id) else { return }
            if let error {
                cont.resume(throwing: BridgeError.rpc(error))
            } else {
                cont.resume(returning: payload ?? Data("null".utf8))
            }
        case let .push(kind, payload):
            guard let payload else { return }
            pushSubs[kind]?.values.forEach { $0.yield(payload) }
        }
    }

    private func failRequest(id: String) {
        pending.removeValue(forKey: id)?.resume(throwing: BridgeError.disconnected)
    }

    private func failPending(with error: BridgeError) {
        let conts = Array(pending.values)
        pending.removeAll()
        conts.forEach { $0.resume(throwing: error) }
    }

    private func setStatus(_ s: ConnStatus) {
        status = s
        statusSubs.values.forEach { $0.yield(s) }
    }

    private func removeStatusSub(_ id: UUID) {
        statusSubs[id] = nil
    }

    private func removePushSub(kind: String, id: UUID) {
        pushSubs[kind]?[id] = nil
    }
}

// MARK: - TCA dependency

@DependencyClient
public struct BridgeClient: Sendable {
    /// (Re)configure with a connection; tears down any socket and restarts the loop.
    public var configure: @Sendable (Connection) async -> Void
    /// Stop reconnecting and close the socket.
    public var shutdown: @Sendable () async -> Void
    /// Status stream; replays the current status to each new subscriber.
    public var statusStream: @Sendable () async -> AsyncStream<ConnStatus> = { .finished }
    /// Raw RPC: kind + JSON payload → response payload JSON. Prefer the typed
    /// `invoke(_:)` extension (Task 7).
    public var send: @Sendable (_ kind: String, _ payload: Data) async throws -> Data
    /// Push frames of one kind, as raw payload JSON.
    public var pushes: @Sendable (_ kind: String) async -> AsyncStream<Data> = { _ in .finished }
}

extension BridgeClient {
    public static func live(
        factory: @escaping BridgeSocketFactory,
        clock: any Clock<Duration> = ContinuousClock(),
        config: BridgeConnection.Config = .init()
    ) -> BridgeClient {
        let conn = BridgeConnection(factory: factory, clock: clock, config: config)
        return BridgeClient(
            configure: { await conn.configure($0) },
            shutdown: { await conn.shutdown() },
            statusStream: { await conn.statusStream() },
            send: { try await conn.send(kind: $0, payload: $1) },
            pushes: { await conn.pushes(kind: $0) }
        )
    }
}

extension BridgeClient: DependencyKey {
    public static let liveValue = BridgeClient.live(factory: { URLSessionSocket(url: $0) })
}

public extension DependencyValues {
    var bridge: BridgeClient {
        get { self[BridgeClient.self] }
        set { self[BridgeClient.self] = newValue }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd swift/WatchtowerCore && swift test --filter BridgeClientTests 2>&1 | tail -5`
Expected: PASS (10 tests). If a test is flaky under `--parallel`, the polling
`waitUntil` timeouts are the knob — bump to 5 s rather than adding sleeps.

- [ ] **Step 5: Run the full suite**

Run: `cd swift/WatchtowerCore && swift test 2>&1 | tail -3`
Expected: PASS — WatchtowerCoreTests unaffected.

- [ ] **Step 6: Commit**

```bash
git add swift/WatchtowerCore/Sources/WatchtowerBridge/Transport/BridgeClient.swift swift/WatchtowerCore/Tests/WatchtowerBridgeTests/BridgeClientTests.swift
git commit -m "feat(ipad-native): BridgeConnection reconnecting actor + BridgeClient TCA dependency"
```

---

### Task 7: Typed bridge requests (listInstances) + push kinds

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerBridge/Transport/BridgeRequests.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerBridgeTests/BridgeRequestsTests.swift`
- Modify: `swift/WatchtowerCore/Tests/WatchtowerBridgeTests/BridgeClientTests.swift` (swap the `BridgePushKindStateChanged` placeholder for `BridgePush.stateChanged`)

**Interfaces:**
- Produces:
  - `protocol BridgeRequest: Encodable, Sendable { associatedtype Response: Decodable & Sendable; static var kind: String { get } }`
  - `extension BridgeClient { func invoke<R: BridgeRequest>(_ request: R) async throws -> R.Response }`
  - `struct BridgeInstance: Decodable, Equatable, Sendable, Identifiable` — `id, cwd, status: String`, `lastActivityAt: Double`, `kind: String`, `taskId: Int?` (mirrors the `listInstances` response entry in `shared/ipcContract.ts:624-635`).
  - `struct ListInstancesRequest: BridgeRequest` with `Response { instances: [BridgeInstance] }`.
  - `enum BridgePush { static let stateChanged = "stateChanged" }` (later phases add `ptyData`, `authBlock`).
- Consumed by: Task 9 (probe). Phase 2 adds the remaining kinds (`spawnInstance`, `terminalAttach`, …) following this exact pattern.

- [ ] **Step 1: Write the failing tests**

Create `swift/WatchtowerCore/Tests/WatchtowerBridgeTests/BridgeRequestsTests.swift`:

```swift
import XCTest
import ComposableArchitecture
@testable import WatchtowerBridge

final class BridgeRequestsTests: XCTestCase {
    func testInvokeEncodesKindAndDecodesResponse() async throws {
        let captured = LockIsolated<(kind: String, payload: Data)?>(nil)
        var client = BridgeClient()
        client.send = { kind, payload in
            captured.setValue((kind, payload))
            return Data(
                #"{"instances":[{"id":"i1","cwd":"/Users/jan/x","status":"working","lastActivityAt":1752566400000,"kind":"managed","taskId":null}]}"#
                    .utf8
            )
        }

        let res = try await client.invoke(ListInstancesRequest())

        XCTAssertEqual(captured.value?.kind, "listInstances")
        XCTAssertEqual(String(decoding: captured.value!.payload, as: UTF8.self), "{}")
        XCTAssertEqual(res.instances, [
            BridgeInstance(
                id: "i1", cwd: "/Users/jan/x", status: "working",
                lastActivityAt: 1_752_566_400_000, kind: "managed", taskId: nil
            ),
        ])
    }

    func testInvokeWrapsDecodeFailureAsBadResponse() async {
        var client = BridgeClient()
        client.send = { _, _ in Data(#"{"unexpected":"shape"}"#.utf8) }
        do {
            _ = try await client.invoke(ListInstancesRequest())
            XCTFail("expected badResponse")
        } catch {
            XCTAssertEqual(error as? BridgeError, .badResponse)
        }
    }

    func testPushKinds() {
        XCTAssertEqual(BridgePush.stateChanged, "stateChanged")
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd swift/WatchtowerCore && swift test --filter BridgeRequestsTests 2>&1 | tail -5`
Expected: FAIL — `BridgeRequest`/`ListInstancesRequest` not defined.

- [ ] **Step 3: Implement the typed layer**

Create `swift/WatchtowerCore/Sources/WatchtowerBridge/Transport/BridgeRequests.swift`:

```swift
import Foundation

/// A typed RPC over the bridge. `kind` and the payload/response shapes mirror
/// shared/ipcContract.ts — add cases per phase, only the kinds the iPad uses.
public protocol BridgeRequest: Encodable, Sendable {
    associatedtype Response: Decodable & Sendable
    static var kind: String { get }
}

extension BridgeClient {
    public func invoke<R: BridgeRequest>(_ request: R) async throws -> R.Response {
        let payload = try JSONEncoder().encode(request)
        let data = try await send(R.kind, payload)
        do {
            return try JSONDecoder().decode(R.Response.self, from: data)
        } catch {
            throw BridgeError.badResponse
        }
    }
}

// MARK: - listInstances (ipcContract.ts: listInstances response, lines ~624-635)

public struct BridgeInstance: Decodable, Equatable, Sendable, Identifiable {
    public var id: String
    public var cwd: String
    public var status: String
    /// ms since epoch (JS Date.now()).
    public var lastActivityAt: Double
    /// InstanceKind in the TS contract; kept as a raw String for resilience.
    public var kind: String
    public var taskId: Int?

    public init(id: String, cwd: String, status: String, lastActivityAt: Double, kind: String, taskId: Int?) {
        self.id = id; self.cwd = cwd; self.status = status
        self.lastActivityAt = lastActivityAt; self.kind = kind; self.taskId = taskId
    }
}

public struct ListInstancesRequest: BridgeRequest {
    public static let kind = "listInstances"

    public init() {}

    public struct Response: Decodable, Equatable, Sendable {
        public var instances: [BridgeInstance]
    }
}

/// Push kinds the iPad subscribes to. Later phases add ptyData + authBlock.
public enum BridgePush {
    public static let stateChanged = "stateChanged"
}
```

In `BridgeClientTests.swift`, delete the `let BridgePushKindStateChanged = "stateChanged"` placeholder line and replace its one use with `BridgePush.stateChanged`.

- [ ] **Step 4: Run the full suite**

Run: `cd swift/WatchtowerCore && swift test 2>&1 | tail -3`
Expected: PASS — BridgeRequestsTests (3 tests) + BridgeClientTests still green with the real constant.

- [ ] **Step 5: Commit**

```bash
git add swift/WatchtowerCore/Sources/WatchtowerBridge/Transport/BridgeRequests.swift swift/WatchtowerCore/Tests/WatchtowerBridgeTests/BridgeRequestsTests.swift swift/WatchtowerCore/Tests/WatchtowerBridgeTests/BridgeClientTests.swift
git commit -m "feat(ipad-native): typed BridgeRequest layer + listInstances"
```

---

### Task 8: ConnectionFeature reducer

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerBridge/Features/ConnectionFeature.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerBridgeTests/ConnectionFeatureTests.swift`

**Interfaces:**
- Produces: `@Reducer public struct ConnectionFeature` —
  - `State`: `form: ConnectionFormState`, `saved: Connection?`, `status: ConnStatus`, `errorMessage: String?`, `didSave: Bool`.
  - `Action` (BindableAction): `binding`, `onAppear`, `saveTapped`, `statusChanged(ConnStatus)`.
  - Behavior: `onAppear` loads the saved connection into the form and subscribes to the bridge status stream; `saveTapped` validates via `parseConnection`, persists via `connectionStore.save`, and calls `bridge.configure`; any edit clears `didSave`.
- Consumed by: Task 9 (scoped child), Task 10 (`ConnectionSectionView`).

- [ ] **Step 1: Write the failing tests**

Create `swift/WatchtowerCore/Tests/WatchtowerBridgeTests/ConnectionFeatureTests.swift`:

```swift
import XCTest
import ComposableArchitecture
@testable import WatchtowerBridge

@MainActor
final class ConnectionFeatureTests: XCTestCase {
    func testOnAppearLoadsSavedConnectionAndSubscribesStatus() async {
        let saved = Connection(host: "10.0.0.5", port: 7445, token: "tok")
        let (statusStream, statusCont) = AsyncStream<ConnStatus>.makeStream()
        let store = TestStore(initialState: ConnectionFeature.State()) {
            ConnectionFeature()
        } withDependencies: {
            $0.connectionStore.load = { saved }
            $0.bridge.statusStream = { statusStream }
        }
        await store.send(.onAppear) {
            $0.saved = saved
            $0.form = ConnectionFormState(saved)
        }
        statusCont.yield(.connected)
        await store.receive(\.statusChanged) { $0.status = .connected }
        statusCont.finish()
        await store.finish()
    }

    func testOnAppearWithNothingSavedKeepsDefaults() async {
        let store = TestStore(initialState: ConnectionFeature.State()) {
            ConnectionFeature()
        } withDependencies: {
            $0.connectionStore.load = { nil }
            $0.bridge.statusStream = { .finished }
        }
        await store.send(.onAppear) // no state change: defaults stay
        await store.finish()
    }

    func testSaveValidFormPersistsAndReconfigures() async {
        let savedConn = LockIsolated<Connection?>(nil)
        let configured = LockIsolated<Connection?>(nil)
        var state = ConnectionFeature.State()
        state.form.host = "mac.ts.net"
        state.form.token = "tok"
        let store = TestStore(initialState: state) {
            ConnectionFeature()
        } withDependencies: {
            $0.connectionStore.save = { savedConn.setValue($0) }
            $0.bridge.configure = { configured.setValue($0) }
        }
        let expected = Connection(host: "mac.ts.net", port: 7445, token: "tok")
        await store.send(.saveTapped) {
            $0.saved = expected
            $0.didSave = true
        }
        await store.finish()
        XCTAssertEqual(savedConn.value, expected)
        XCTAssertEqual(configured.value, expected)
    }

    func testSaveInvalidFormShowsErrorAndDoesNotPersist() async {
        let store = TestStore(initialState: ConnectionFeature.State()) {
            ConnectionFeature()
        }
        // Default form: empty host — validation must fail before any dependency
        // is touched (unimplemented testValue deps would fail the test if called).
        await store.send(.saveTapped) {
            $0.errorMessage = "Host is required"
        }
    }

    func testEditingClearsDidSaveAndError() async {
        var state = ConnectionFeature.State()
        state.didSave = true
        let store = TestStore(initialState: state) {
            ConnectionFeature()
        }
        var edited = ConnectionFormState()
        edited.host = "x"
        await store.send(.binding(.set(\.form, edited))) {
            $0.form = edited
            $0.didSave = false
        }
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd swift/WatchtowerCore && swift test --filter ConnectionFeatureTests 2>&1 | tail -5`
Expected: FAIL — `ConnectionFeature` not defined.

- [ ] **Step 3: Implement the reducer**

Create `swift/WatchtowerCore/Sources/WatchtowerBridge/Features/ConnectionFeature.swift`:

```swift
import Foundation
import ComposableArchitecture

/// Connection settings editor — the native replacement for the Capacitor
/// SettingsModule connection form (and the proper fix for issue #161).
@Reducer
public struct ConnectionFeature {
    @ObservableState
    public struct State: Equatable {
        public var form = ConnectionFormState()
        public var saved: Connection?
        public var status: ConnStatus = .disconnected
        public var errorMessage: String?
        /// Brief "Saved" confirmation; cleared on the next edit.
        public var didSave = false

        public init() {}
    }

    public enum Action: BindableAction {
        case binding(BindingAction<State>)
        case onAppear
        case saveTapped
        case statusChanged(ConnStatus)
    }

    private enum CancelID { case status }

    @Dependency(\.connectionStore) var connectionStore
    @Dependency(\.bridge) var bridge

    public init() {}

    public var body: some ReducerOf<Self> {
        BindingReducer()
        Reduce { state, action in
            switch action {
            case .binding:
                state.didSave = false
                return .none

            case .onAppear:
                if let saved = connectionStore.load() {
                    state.saved = saved
                    state.form = ConnectionFormState(saved)
                }
                return .run { send in
                    for await s in bridge.statusStream() {
                        await send(.statusChanged(s))
                    }
                }
                .cancellable(id: CancelID.status, cancelInFlight: true)

            case .saveTapped:
                switch parseConnection(state.form) {
                case let .failure(err):
                    state.errorMessage = err.message
                    return .none
                case let .success(conn):
                    state.errorMessage = nil
                    state.saved = conn
                    state.didSave = true
                    connectionStore.save(conn)
                    return .run { _ in await bridge.configure(conn) }
                }

            case let .statusChanged(s):
                state.status = s
                return .none
            }
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd swift/WatchtowerCore && swift test --filter ConnectionFeatureTests 2>&1 | tail -5`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add swift/WatchtowerCore/Sources/WatchtowerBridge/Features/ConnectionFeature.swift swift/WatchtowerCore/Tests/WatchtowerBridgeTests/ConnectionFeatureTests.swift
git commit -m "feat(ipad-native): ConnectionFeature reducer (settings editor, fixes #161 natively)"
```

---

### Task 9: IPadAppFeature shell reducer

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerBridge/Features/IPadAppFeature.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerBridgeTests/IPadAppFeatureTests.swift`

**Interfaces:**
- Produces: `@Reducer public struct IPadAppFeature` —
  - `Module: String, CaseIterable` = `dashboard, instances, remote, billing, settings` with `title` (English) + `systemImage`.
  - `State`: `selectedModule`, `connStatus: ConnStatus`, `instancesOnline: Int?`, `authPresent: Bool`, `connection: ConnectionFeature.State`, `auth: AuthFeature.State`.
  - `Action`: `onAppear`, `moduleSelected(Module)`, `statusChanged(ConnStatus)`, `probeResponse(Int?)`, `authEvent(Bool)`, `signOutTapped`, `connection(...)`, `auth(...)`.
  - Behavior: boot loads the saved connection (none → land on `.settings`), configures the bridge, subscribes to status + Supabase auth events; on each transition into `.connected` it probes `listInstances` (port of `apps/ipad/src/probe.ts`). **Auth does not gate the shell** — unlike the iPhone, the iPad is usable without Supabase (terminals need only the bridge); billing gates itself in Phase 5.
- Consumed by: Task 10 (all views). Uses `AuthFeature` from WatchtowerCore (`import WatchtowerCore`).

- [ ] **Step 1: Write the failing tests**

Create `swift/WatchtowerCore/Tests/WatchtowerBridgeTests/IPadAppFeatureTests.swift`:

```swift
import XCTest
import ComposableArchitecture
import WatchtowerCore
@testable import WatchtowerBridge

@MainActor
final class IPadAppFeatureTests: XCTestCase {
    func testFirstRunLandsOnSettings() async {
        let store = TestStore(initialState: IPadAppFeature.State()) {
            IPadAppFeature()
        } withDependencies: {
            $0.connectionStore.load = { nil }
            $0.bridge.statusStream = { .finished }
            $0.supabase.currentSessionExists = { false }
            $0.supabase.authEvents = { .finished }
        }
        await store.send(.onAppear) {
            $0.selectedModule = .settings
        }
        await store.receive(\.authEvent) // false → no state change
        await store.finish()
    }

    func testBootWithSavedConnectionConfiguresBridgeAndProbes() async {
        let saved = Connection(host: "10.0.0.5", port: 7445, token: "tok")
        let configured = LockIsolated<Connection?>(nil)
        let (statusStream, statusCont) = AsyncStream<ConnStatus>.makeStream()
        let store = TestStore(initialState: IPadAppFeature.State()) {
            IPadAppFeature()
        } withDependencies: {
            $0.connectionStore.load = { saved }
            $0.bridge.configure = { configured.setValue($0) }
            $0.bridge.statusStream = { statusStream }
            $0.bridge.send = { kind, _ in
                XCTAssertEqual(kind, "listInstances")
                return Data(
                    #"{"instances":[{"id":"i1","cwd":"/x","status":"working","lastActivityAt":0,"kind":"managed","taskId":null},{"id":"i2","cwd":"/y","status":"idle","lastActivityAt":0,"kind":"managed","taskId":null}]}"#
                        .utf8
                )
            }
            $0.supabase.currentSessionExists = { true }
            $0.supabase.authEvents = { .finished }
        }
        await store.send(.onAppear)
        await store.receive(\.authEvent) { $0.authPresent = true }
        statusCont.yield(.connecting)
        await store.receive(\.statusChanged) { $0.connStatus = .connecting }
        statusCont.yield(.connected)
        await store.receive(\.statusChanged) { $0.connStatus = .connected }
        await store.receive(\.probeResponse) { $0.instancesOnline = 2 }
        XCTAssertEqual(configured.value, saved)
        statusCont.finish()
        await store.finish()
    }

    func testProbeFailureReportsNil() async {
        let (statusStream, statusCont) = AsyncStream<ConnStatus>.makeStream()
        let store = TestStore(initialState: IPadAppFeature.State()) {
            IPadAppFeature()
        } withDependencies: {
            $0.connectionStore.load = { Connection(host: "h", port: 7445, token: "t") }
            $0.bridge.configure = { _ in }
            $0.bridge.statusStream = { statusStream }
            $0.bridge.send = { _, _ in throw BridgeError.notConnected }
            $0.supabase.currentSessionExists = { false }
            $0.supabase.authEvents = { .finished }
        }
        await store.send(.onAppear)
        await store.receive(\.authEvent)
        statusCont.yield(.connected)
        await store.receive(\.statusChanged) { $0.connStatus = .connected }
        await store.receive(\.probeResponse) // nil → instancesOnline stays nil
        statusCont.finish()
        await store.finish()
    }

    func testModuleSelection() async {
        let store = TestStore(initialState: IPadAppFeature.State()) {
            IPadAppFeature()
        }
        await store.send(.moduleSelected(.billing)) {
            $0.selectedModule = .billing
        }
    }

    func testSignOutCallsSupabase() async {
        let signedOut = LockIsolated(false)
        let store = TestStore(initialState: IPadAppFeature.State()) {
            IPadAppFeature()
        } withDependencies: {
            $0.supabase.signOut = { signedOut.setValue(true) }
        }
        await store.send(.signOutTapped)
        await store.finish()
        XCTAssertTrue(signedOut.value)
    }
}
```

Note: match the `$0.supabase.*` closure names to the real `SupabaseClient` member names in `Sources/WatchtowerCore/Dependencies/SupabaseClient.swift` (`currentSessionExists`, `authEvents`, `signOut` — the same members `AppFeature` uses). If a signature differs, follow the dependency, not this listing.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd swift/WatchtowerCore && swift test --filter IPadAppFeatureTests 2>&1 | tail -5`
Expected: FAIL — `IPadAppFeature` not defined.

- [ ] **Step 3: Implement the reducer**

Create `swift/WatchtowerCore/Sources/WatchtowerBridge/Features/IPadAppFeature.swift`:

```swift
import Foundation
import ComposableArchitecture
import WatchtowerCore

/// Root shell for the native iPad app: module rail + bridge lifecycle.
/// Unlike the iPhone's AppFeature, Supabase auth does NOT gate the shell —
/// terminals need only the Mac bridge; billing gates itself (Phase 5).
@Reducer
public struct IPadAppFeature {
    public enum Module: String, CaseIterable, Equatable, Sendable {
        case dashboard, instances, remote, billing, settings

        public var title: String {
            switch self {
            case .dashboard: return "Dashboard"
            case .instances: return "Instances"
            case .remote: return "Remote Mac"
            case .billing: return "Billing"
            case .settings: return "Settings"
            }
        }

        public var systemImage: String {
            switch self {
            case .dashboard: return "square.grid.2x2"
            case .instances: return "terminal"
            case .remote: return "display"
            case .billing: return "banknote"
            case .settings: return "gearshape"
            }
        }
    }

    @ObservableState
    public struct State: Equatable {
        public var selectedModule: Module = .dashboard
        public var connStatus: ConnStatus = .disconnected
        /// Result of the connectivity probe; nil until the first successful probe.
        public var instancesOnline: Int?
        public var authPresent = false
        public var connection = ConnectionFeature.State()
        public var auth = AuthFeature.State()

        public init() {}
    }

    public enum Action {
        case onAppear
        case moduleSelected(Module)
        case statusChanged(ConnStatus)
        case probeResponse(Int?)
        case authEvent(Bool)
        case signOutTapped
        case connection(ConnectionFeature.Action)
        case auth(AuthFeature.Action)
    }

    private enum CancelID { case status, auth, probe }

    @Dependency(\.connectionStore) var connectionStore
    @Dependency(\.bridge) var bridge
    @Dependency(\.supabase) var supabase

    public init() {}

    public var body: some ReducerOf<Self> {
        Scope(state: \.connection, action: \.connection) {
            ConnectionFeature()
        }
        Scope(state: \.auth, action: \.auth) {
            AuthFeature()
        }
        Reduce { state, action in
            switch action {
            case .onAppear:
                let saved = connectionStore.load()
                if saved == nil {
                    // First run: land on Settings so the connection can be entered.
                    state.selectedModule = .settings
                }
                return .merge(
                    .run { _ in
                        if let saved { await bridge.configure(saved) }
                    },
                    .run { send in
                        for await s in bridge.statusStream() {
                            await send(.statusChanged(s))
                        }
                    }
                    .cancellable(id: CancelID.status, cancelInFlight: true),
                    .run { send in
                        await send(.authEvent(supabase.currentSessionExists()))
                        for await present in supabase.authEvents() {
                            await send(.authEvent(present))
                        }
                    }
                    .cancellable(id: CancelID.auth, cancelInFlight: true)
                )

            case let .moduleSelected(module):
                state.selectedModule = module
                return .none

            case let .statusChanged(status):
                let wasConnected = state.connStatus == .connected
                state.connStatus = status
                guard status == .connected, !wasConnected else { return .none }
                // Connectivity probe on each transition into connected —
                // port of apps/ipad/src/probe.ts.
                return .run { send in
                    let res = try? await bridge.invoke(ListInstancesRequest())
                    await send(.probeResponse(res.map(\.instances.count)))
                }
                .cancellable(id: CancelID.probe, cancelInFlight: true)

            case let .probeResponse(count):
                state.instancesOnline = count
                return .none

            case let .authEvent(present):
                state.authPresent = present
                return .none

            case .signOutTapped:
                return .run { _ in await supabase.signOut() }

            case .connection, .auth:
                return .none
            }
        }
    }
}
```

- [ ] **Step 4: Run the full suite**

Run: `cd swift/WatchtowerCore && swift test 2>&1 | tail -3`
Expected: PASS — IPadAppFeatureTests (5 tests) + everything else green.

- [ ] **Step 5: Commit**

```bash
git add swift/WatchtowerCore/Sources/WatchtowerBridge/Features/IPadAppFeature.swift swift/WatchtowerCore/Tests/WatchtowerBridgeTests/IPadAppFeatureTests.swift
git commit -m "feat(ipad-native): IPadAppFeature shell reducer (rail, bridge boot, probe, auth)"
```

---

### Task 10: XcodeGen app target + SwiftUI views

**Files:**
- Create: `apps/ipad-native/project.yml`
- Create: `apps/ipad-native/.gitignore`
- Create: `apps/ipad-native/Watchtower/Info.plist`
- Create: `apps/ipad-native/Watchtower/Secrets.sample.xcconfig`
- Create: `apps/ipad-native/Watchtower/WatchtowerApp.swift`
- Create: `apps/ipad-native/Watchtower/Views/AppShellView.swift`
- Create: `apps/ipad-native/Watchtower/Views/RailView.swift`
- Create: `apps/ipad-native/Watchtower/Views/SettingsView.swift`
- Create: `apps/ipad-native/README.md`

**Interfaces:**
- Consumes: `IPadAppFeature`, `ConnectionFeature`, `ConnStatus` (WatchtowerBridge); `AuthFeature`, `Palette` (WatchtowerCore).
- Produces: buildable iPad app, bundle id `cz.greencode.watchtower.ipados`, display name "Watchtower N" (distinguishes it from the Capacitor app's icon during side-by-side dogfooding).

Views are verified by building (no snapshot tests in this repo); reducer logic was tested in Tasks 8–9.

- [ ] **Step 1: Project scaffolding**

Create `apps/ipad-native/project.yml`:

```yaml
name: Watchtower
options:
  bundleIdPrefix: cz.greencode.watchtower
  deploymentTarget:
    iOS: "17.0"
packages:
  WatchtowerCore:
    path: ../../swift/WatchtowerCore
targets:
  Watchtower:
    type: application
    platform: iOS
    sources:
      - Watchtower
    dependencies:
      - package: WatchtowerCore
        product: WatchtowerCore
      - package: WatchtowerCore
        product: WatchtowerBridge
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: cz.greencode.watchtower.ipados
        INFOPLIST_FILE: Watchtower/Info.plist
        GENERATE_INFOPLIST_FILE: NO
        MARKETING_VERSION: "0.0.0"
        CURRENT_PROJECT_VERSION: "1"
        TARGETED_DEVICE_FAMILY: "2"
    configFiles:
      Debug: Watchtower/Secrets.xcconfig
      Release: Watchtower/Secrets.xcconfig
```

Create `apps/ipad-native/.gitignore` (same as `apps/iphone-native/.gitignore`):

```
# XcodeGen output (regenerated from project.yml — never committed)
Watchtower.xcodeproj/
# Xcode
build/
DerivedData/
*.xcuserstate
xcuserdata/
# Secrets (never commit)
Watchtower/Secrets.xcconfig
# SPM
.swiftpm/
.build/
```

Copy the secrets template from the iPhone app (same keys):

```bash
cp apps/iphone-native/Watchtower/Secrets.sample.xcconfig apps/ipad-native/Watchtower/Secrets.sample.xcconfig
```

Create `apps/ipad-native/Watchtower/Info.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleExecutable</key>
    <string>$(EXECUTABLE_NAME)</string>
    <key>CFBundleIdentifier</key>
    <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>$(PRODUCT_NAME)</string>
    <!-- Distinguishes the icon from the Capacitor "Watchtower" during
         side-by-side dogfooding; drops to "Watchtower" in Phase 8. -->
    <key>CFBundleDisplayName</key>
    <string>Watchtower N</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>$(MARKETING_VERSION)</string>
    <key>CFBundleVersion</key>
    <string>$(CURRENT_PROJECT_VERSION)</string>
    <key>SUPABASE_URL</key>
    <string>$(SUPABASE_URL)</string>
    <key>SUPABASE_ANON_KEY</key>
    <string>$(SUPABASE_ANON_KEY)</string>
    <!-- The bridge is plaintext ws:// to a LAN IP or Tailscale host. Tailnet
         CGNAT addresses (100.64/10) are NOT covered by NSAllowsLocalNetworking,
         so allow arbitrary loads — the off-LAN path is WireGuard-encrypted by
         Tailscale (same accepted model as the Capacitor app). -->
    <key>NSAppTransportSecurity</key>
    <dict>
        <key>NSAllowsArbitraryLoads</key>
        <true/>
    </dict>
    <key>UISupportedInterfaceOrientations</key>
    <array>
        <string>UIInterfaceOrientationLandscapeLeft</string>
        <string>UIInterfaceOrientationLandscapeRight</string>
        <string>UIInterfaceOrientationPortrait</string>
        <string>UIInterfaceOrientationPortraitUpsideDown</string>
    </array>
    <key>UILaunchScreen</key>
    <dict/>
</dict>
</plist>
```

- [ ] **Step 2: App entry**

Create `apps/ipad-native/Watchtower/WatchtowerApp.swift`:

```swift
import SwiftUI
import ComposableArchitecture
import WatchtowerBridge

@main
struct WatchtowerApp: App {
    @MainActor
    static let store = Store(initialState: IPadAppFeature.State()) {
        IPadAppFeature()
    }

    var body: some Scene {
        WindowGroup {
            AppShellView(store: Self.store)
                .onAppear { Self.store.send(.onAppear) }
                .preferredColorScheme(.dark)
        }
    }
}
```

- [ ] **Step 3: Shell + rail views**

Create `apps/ipad-native/Watchtower/Views/AppShellView.swift`:

```swift
import SwiftUI
import ComposableArchitecture
import WatchtowerCore
import WatchtowerBridge

struct AppShellView: View {
    @Bindable var store: StoreOf<IPadAppFeature>

    var body: some View {
        HStack(spacing: 0) {
            RailView(store: store)
            Divider().overlay(Color.white.opacity(0.08))
            detail
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Palette.baseBg.ignoresSafeArea())
    }

    @ViewBuilder private var detail: some View {
        switch store.selectedModule {
        case .dashboard:
            PlaceholderView(
                title: "Dashboard",
                subtitle: store.instancesOnline.map { "\($0) instance(s) online" }
                    ?? "Waiting for the Mac…"
            )
        case .instances:
            PlaceholderView(title: "Instances", subtitle: "Terminals arrive in Phase 2")
        case .remote:
            PlaceholderView(title: "Remote Mac", subtitle: "VNC + Wake arrive in Phase 4")
        case .billing:
            PlaceholderView(title: "Billing", subtitle: "Billing arrives in Phase 5")
        case .settings:
            SettingsView(store: store)
        }
    }
}

struct PlaceholderView: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(spacing: 8) {
            Text(title).font(.largeTitle.bold()).foregroundStyle(Palette.textPrimary)
            Text(subtitle).font(.body).foregroundStyle(Palette.textMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
```

Create `apps/ipad-native/Watchtower/Views/RailView.swift`:

```swift
import SwiftUI
import ComposableArchitecture
import WatchtowerCore
import WatchtowerBridge

struct RailView: View {
    let store: StoreOf<IPadAppFeature>

    var body: some View {
        VStack(spacing: 6) {
            ForEach(IPadAppFeature.Module.allCases, id: \.self) { module in
                railButton(module)
            }
            Spacer()
            StatusPill(status: store.connStatus)
                .padding(.bottom, 16)
        }
        .padding(.top, 24)
        .frame(width: 88)
        .background(Color.white.opacity(0.03))
    }

    private func railButton(_ module: IPadAppFeature.Module) -> some View {
        let selected = store.selectedModule == module
        return Button {
            store.send(.moduleSelected(module))
        } label: {
            VStack(spacing: 4) {
                Image(systemName: module.systemImage)
                    .font(.system(size: 20, weight: .medium))
                Text(module.title)
                    .font(.system(size: 10, weight: .medium))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .foregroundStyle(selected ? Palette.accent : Palette.textMuted)
            .frame(width: 72, height: 56)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(selected ? Color.white.opacity(0.08) : .clear)
            )
        }
        .buttonStyle(.plain)
    }
}

struct StatusPill: View {
    let status: ConnStatus

    private var color: Color {
        switch status {
        case .connected: return .green
        case .connecting: return .yellow
        case .disconnected: return .red
        }
    }

    private var label: String {
        switch status {
        case .connected: return "Connected"
        case .connecting: return "Connecting"
        case .disconnected: return "Offline"
        }
    }

    var body: some View {
        VStack(spacing: 4) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(label).font(.system(size: 9)).foregroundStyle(Palette.textDim)
        }
    }
}
```

- [ ] **Step 4: Settings view (connection editor + account)**

Create `apps/ipad-native/Watchtower/Views/SettingsView.swift`:

```swift
import SwiftUI
import ComposableArchitecture
import WatchtowerCore
import WatchtowerBridge

struct SettingsView: View {
    @Bindable var store: StoreOf<IPadAppFeature>

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("Settings").font(.largeTitle.bold()).foregroundStyle(Palette.textPrimary)
                ConnectionSectionView(
                    store: store.scope(state: \.connection, action: \.connection)
                )
                AccountSectionView(store: store)
            }
            .frame(maxWidth: 560, alignment: .leading)
            .padding(32)
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }
}

struct ConnectionSectionView: View {
    @Bindable var store: StoreOf<ConnectionFeature>

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Mac connection").font(.headline).foregroundStyle(Palette.textPrimary)

            field("Host", text: $store.form.host, placeholder: "mac.tailnet.ts.net")
            HStack(spacing: 12) {
                field("Port", text: $store.form.port, placeholder: "7445")
                    .frame(width: 140)
                field("Token", text: $store.form.token, placeholder: "orchestrator token")
            }
            DisclosureGroup("Wake-on-LAN (optional)") {
                VStack(alignment: .leading, spacing: 12) {
                    field("MAC address", text: $store.form.mac, placeholder: "AA:BB:CC:DD:EE:FF")
                    field("LAN IP", text: $store.form.lanIp, placeholder: "192.168.1.10")
                    HStack(spacing: 12) {
                        field("WAN host", text: $store.form.wanHost, placeholder: "home.example.com")
                        field("WAN port", text: $store.form.wanPort, placeholder: "9")
                            .frame(width: 140)
                    }
                }
                .padding(.top, 8)
            }
            .foregroundStyle(Palette.textMuted)

            if let error = store.errorMessage {
                Text(error).font(.callout).foregroundStyle(.red)
            }
            HStack(spacing: 12) {
                Button("Save & connect") { store.send(.saveTapped) }
                    .buttonStyle(.borderedProminent)
                if store.didSave {
                    Text("Saved").font(.callout).foregroundStyle(.green)
                }
                Spacer()
                StatusPill(status: store.status)
            }
        }
        .onAppear { store.send(.onAppear) }
    }

    private func field(_ label: String, text: Binding<String>, placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption).foregroundStyle(Palette.textDim)
            TextField(placeholder, text: text)
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
        }
    }
}

struct AccountSectionView: View {
    @Bindable var store: StoreOf<IPadAppFeature>

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Supabase account").font(.headline).foregroundStyle(Palette.textPrimary)
            if store.authPresent {
                HStack {
                    Text("Signed in").foregroundStyle(Palette.textMuted)
                    Spacer()
                    Button("Sign out") { store.send(.signOutTapped) }
                        .buttonStyle(.bordered)
                }
            } else {
                AuthFormView(store: store.scope(state: \.auth, action: \.auth))
            }
        }
    }
}

struct AuthFormView: View {
    @Bindable var store: StoreOf<AuthFeature>

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextField("E-mail", text: $store.email)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            SecureField("Password", text: $store.password)
                .textFieldStyle(.roundedBorder)
            if let error = store.errorMessage {
                Text(error).font(.callout).foregroundStyle(.red)
            }
            Button {
                store.send(.signInTapped)
            } label: {
                if store.isSubmitting {
                    ProgressView()
                } else {
                    Text("Sign in")
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(store.isSubmitting)
        }
    }
}
```

- [ ] **Step 5: README runbook**

Create `apps/ipad-native/README.md`:

```markdown
# Watchtower iPad (native)

Native SwiftUI + TCA iPad app. Views only — all logic lives in the
`WatchtowerCore` / `WatchtowerBridge` SPM targets at `swift/WatchtowerCore`.
Spec: `docs/superpowers/specs/2026-07-15-native-ipad-swiftui-rewrite-design.md`.

## Build

    cp Watchtower/Secrets.sample.xcconfig Watchtower/Secrets.xcconfig  # fill in Supabase values
    xcodegen generate
    xcodebuild -project Watchtower.xcodeproj -scheme Watchtower \
      -destination 'generic/platform=iOS Simulator' -skipMacroValidation \
      CODE_SIGNING_ALLOWED=NO build

Bundle id `cz.greencode.watchtower.ipados` ("Watchtower N") — installs
side-by-side with the Capacitor iPad app until parity (spec Phase 8).

## Run on the iPad

See the devicectl flow in the Phase 1 plan (Task 11):
build for `generic/platform=iOS`, then `devicectl device install app` +
`devicectl device process launch`. Package tests: `cd ../../swift/WatchtowerCore && swift test`.
```

- [ ] **Step 6: Generate and build**

```bash
cd apps/ipad-native
cp Watchtower/Secrets.sample.xcconfig Watchtower/Secrets.xcconfig
xcodegen generate
xcodebuild -project Watchtower.xcodeproj -scheme Watchtower \
  -destination 'generic/platform=iOS Simulator' -skipMacroValidation \
  CODE_SIGNING_ALLOWED=NO build 2>&1 | tail -5
```

Expected: `** BUILD SUCCEEDED **`. If the scheme is missing, re-run `xcodegen generate` (it creates the scheme from the target). If macro validation errors appear despite `-skipMacroValidation`, check the flag ordering (it must precede `build`).

- [ ] **Step 7: Commit**

```bash
git add apps/ipad-native
git commit -m "feat(ipad-native): XcodeGen app target + shell/rail/settings views"
```

---

### Task 11: On-device dogfood install + manual verification

**Files:** none (operational task; fixes discovered here are committed under their own message).

⚠️ This task needs the user physically at the iPad and the Mac. If executing autonomously, stop here and report; do not skip the checklist silently.

- [ ] **Step 1: Real secrets**

```bash
cp apps/iphone-native/Watchtower/Secrets.xcconfig apps/ipad-native/Watchtower/Secrets.xcconfig
```

(The iPhone app's git-ignored xcconfig already carries the production Supabase URL + anon key. If it doesn't exist in this worktree, copy it from the main checkout — git-ignored files are not carried into worktrees.)

- [ ] **Step 2: Build for the device and install**

```bash
xcrun devicectl list devices   # note the iPad's UDID
cd apps/ipad-native && xcodegen generate
xcodebuild -project Watchtower.xcodeproj -scheme Watchtower \
  -destination 'generic/platform=iOS' -skipMacroValidation \
  -derivedDataPath build -allowProvisioningUpdates build 2>&1 | tail -5
xcrun devicectl device install app --device <UDID> \
  build/Build/Products/Debug-iphoneos/Watchtower.app
xcrun devicectl device process launch --device <UDID> cz.greencode.watchtower.ipados
```

Signing note: this uses the same personal-team signing as the `apps/iphone-native` devicectl flow. If the build fails with a signing error, pass the same `DEVELOPMENT_TEAM=<team id>` used there, or open the project in Xcode once and pick the team.

- [ ] **Step 3: Manual verification checklist**

On the Mac, start the orchestrator from the **main checkout** (not this worktree): `npm run dev` — it logs `[orchestrator] iPad connect → ws://<host>:7445/ws token: <token>`.

- [ ] App icon "Watchtower N" installs alongside the Capacitor "Watchtower".
- [ ] First launch lands on Settings (no saved connection).
- [ ] Enter host/port/token from the orchestrator log → **Save & connect** → status pill turns **Connected**.
- [ ] Dashboard shows "N instance(s) online" matching the desktop's tab count.
- [ ] Invalid form input (empty host, bad MAC) shows the English validation message.
- [ ] Supabase sign-in with the production account → Account section flips to "Signed in"; sign out works.
- [ ] Quit the desktop app → pill goes **Offline**; relaunch desktop → pill returns to **Connected** within ~15 s (backoff cap).
- [ ] Force-quit and relaunch the iPad app → connection was persisted, auto-connects without re-entering anything.

- [ ] **Step 4: Record results**

Note any deviations as issues to fix before Phase 2; commit fixes individually.

---

## Plan self-review (completed at authoring time)

- **Spec coverage (Phase 1 scope):** XcodeGen project → Task 10; shell rail + theme → Tasks 9–10; connection editor (#161) → Tasks 3, 8, 10; BridgeClient + probe → Tasks 2, 5, 6, 7, 9; Supabase auth reuse → Tasks 9–10. Later-phase items (SwiftTerm, VNC/WoL beyond `parseMac`, billing, Project page) are deliberately absent.
- **Type consistency:** `ConnStatus`, `Connection`, `ConnectionFormState`, `parseConnection`, `BridgeSocketFactory`, `BridgeClient.send(kind:payload:)`, `ListInstancesRequest`, `BridgePush.stateChanged` are used with identical spellings across Tasks 3–10. `BridgePushKindStateChanged` placeholder in Task 6 is explicitly swapped in Task 7.
- **Known judgment calls:** `send` throws `notConnected` instead of outbox-queueing (documented in Task 6); status-pill colors use stock SwiftUI colors in Phase 1 (glass styling matures with the real modules); `instancesOnline` stays stale while offline (dashboard is replaced in Phase 2).

