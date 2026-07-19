# Native iPad Phase 4 — Remote Mac (VNC + Wake-on-LAN) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native "Remote Mac" module to the iPad app — a UIKit VNC screen (RoyalVNCKit) for controlling the Mac, plus a Wake-on-LAN magic-packet sender, with VNC credentials in the Keychain.

**Architecture:** A new host-testable `WatchtowerRemote` SPM target holds all pure/testable logic — the WoL magic-packet builder + targets, the VNC key map (as raw X11 `UInt32` keysyms), a Keychain-backed `VncCredentialsStore`, a `WakeOnLanClient` UDP dependency, and the `RemoteFeature` TCA reducer (VNC connection-status + creds-form + wake state machine). RoyalVNCKit and the UIKit `VncViewController` (+ momentum scrolling, gestures, framebuffer rendering) live **app-target-only** in `apps/ipad-native/Watchtower/Remote/`, wrapped for SwiftUI by a `UIViewControllerRepresentable` and driven by a standalone `StoreOf<RemoteFeature>` — mirroring how SwiftTerm's `RemoteTerminalView` is app-target-only. This keeps `swift test` (macOS host) independent of RoyalVNCKit.

**Tech Stack:** Swift/SwiftUI, TCA (ComposableArchitecture), RoyalVNCKit (app target only), Network.framework (UDP WoL), Security.framework (Keychain), XcodeGen. iOS 26 iPad target.

**Spec:** `docs/superpowers/specs/2026-07-15-native-ipad-swiftui-rewrite-design.md` (Phase 4 row, line 113) + the prior native design `docs/superpowers/specs/2026-07-07-native-royalvnc-remote-mac-design.md` (UX contract). Issue #207.

**Port sources (match behavior verbatim):** `apps/ipad/ios/App/App/VncViewController.swift` (VNC VC + `VncKeyMap` + momentum), `apps/ipad/ios/App/App/WakePlugin.swift` (UDP send), `apps/ipad/src/lib/wakeOnLan.ts` (magic-packet builder), `apps/ipad/src/state/wake.ts` (`wakeTargets`), `apps/ipad/src/state/vncCreds.ts` (creds shape), `apps/ipad/src/components/RemoteMacView.tsx` (auth-fail/close UX).

## Global Constraints

- **Target split (host-test safety):** pure/testable logic → new `WatchtowerRemote` SPM target (`swift/WatchtowerCore/Sources/WatchtowerRemote/`, host-tested by `swift test`). **RoyalVNCKit and all UIKit view code (VncViewController, gestures, momentum, framebuffer render) → app target `apps/ipad-native/Watchtower/Remote/` only** (build-verified). `WatchtowerRemote` MUST NOT depend on RoyalVNCKit.
- **Dependency direction (no cycles):** `WatchtowerRemote` depends on `WatchtowerBridge` (for `Connection`, `ParsedMac`, `parseMac`, `ConnectionStore`) + `ComposableArchitecture`. `WatchtowerBridge` MUST NOT depend on `WatchtowerRemote`. `RemoteFeature` is a **standalone store** created in the app's `.remote` view — it is NOT composed into `IPadAppFeature` (the only app-shell interaction, `openRemoteForAuth`, already just sets `selectedModule = .remote`).
- **VNC settings (port verbatim, do NOT regress):** `port: 5900`, `inputMode: .forwardKeyboardShortcutsIfNotInUseLocally` (**NEVER `.none`** — RoyalVNCKit gates the entire input-send path behind `inputMode != .none`). `isShared: true`, `isScalingEnabled: false`, `useDisplayLink: false`, `isClipboardRedirectionEnabled: false`, `colorDepth: .depth24Bit`, `frameEncodings: VNCFrameEncodingType.defaultFrameEncodings`.
- **Momentum-scroll constants (port verbatim):** `wheelStepPx = 3`, single-burst cap `12` steps, `momentumMinStart = 120`, `momentumMinStop = 16`, `momentumDecayPerSec = 0.05` (frame-rate-independent exponential decay via `CADisplayLink`). Two-finger `UIPanGestureRecognizer` `minimumNumberOfTouches = 2`, `maximumNumberOfTouches = 2`, `allowedScrollTypesMask = .all`, and `oneFingerPan.require(toFail: twoFingerPan)`. Natural scroll: drag down (dy>0) → wheel up. #160 momentum follow-up is OUT of scope (port current behavior only).
- **WoL (port verbatim):** magic packet = **102 bytes** = 6×`0xFF` + 16×(6-byte MAC). `wakeTargets`: LAN → `(lanIp, port 9)`; WAN → `(wanHost, wanPort ?? 9)`. UDP unicast via `NWConnection` (`.udp`), dedicated serial queue, send on `.ready`, reject on `.failed`, **5s timeout backstop**. Unicast only — no broadcast, no multicast entitlement.
- **VNC credentials → Keychain** (`kSecClassGenericPassword`), service string `"watchtower.vnc.creds"` — a deliberate upgrade from the Capacitor app's plaintext `Preferences`. Creds are the macOS account **short username + login password** (RFB type-30 Apple auth), distinct from `Connection.token`.
- **Auth-failure / close UX (port verbatim):** RFB auth reject surfaces as `VNCError.isAuthenticationError` on the `.disconnected` state (no dedicated hook) → clear the saved password, reopen the credential form with an error banner. Other disconnect → status shown, no auto-navigation. Clean close / user back → return to the module (dismiss).
- **UI text is English** (native iPad app is English — unlike the Capacitor `apps/ipad`). Dark mode only.
- **Package tests:** `cd swift/WatchtowerCore && swift test` (**361 at branch start**, 0 failures). **App build:** `cd apps/ipad-native && [ -f ../iphone-native/Watchtower/Secrets.xcconfig ] && cp ../iphone-native/Watchtower/Secrets.xcconfig Watchtower/Secrets.xcconfig || cp Watchtower/Secrets.sample.xcconfig Watchtower/Secrets.xcconfig; xcodegen generate && xcodebuild -project Watchtower.xcodeproj -scheme Watchtower -destination 'generic/platform=iOS Simulator' -skipMacroValidation -derivedDataPath build CODE_SIGNING_ALLOWED=NO build` → `** BUILD SUCCEEDED **`. Do NOT commit `Secrets.xcconfig` / `Watchtower.xcodeproj`.
- **RoyalVNCKit pin:** package `https://github.com/royalapplications/royalvnc`, product `RoyalVNCKit`, pin the resolved revision `337197afdb32020d3dfdb7d058989115b740cdc4` (transitive: a `CryptoSwift` fork + `Cstb`). Added to the app target via `apps/ipad-native/project.yml` (mirroring the `SwiftTerm` entry) — NOT to `Package.swift`.
- Work from worktree `/Users/jan/Projects/Watchtower/.claude/worktrees/ipad-native-phase4` (branch `feat/ipad-native-phase4`, off `main` incl. Phase 3). Commit per task; trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

### Task 1: WatchtowerRemote target + Wake-on-LAN (magic packet, targets, UDP client)

**Files:**
- Modify: `swift/WatchtowerCore/Package.swift` (add `WatchtowerRemote` target + product + `WatchtowerRemoteTests` test target)
- Create: `swift/WatchtowerCore/Sources/WatchtowerRemote/WakeOnLan.swift`
- Create: `swift/WatchtowerCore/Sources/WatchtowerRemote/WakeOnLanClient.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerRemoteTests/WakeOnLanTests.swift`

**Interfaces:**
- Consumes: `ParsedMac { public let bytes: [UInt8] }` and `func parseMac(_:) -> ParsedMac?` and `struct Connection { var lanIp: String?; var wanHost: String?; var wanPort: Int? ... }` — all from `WatchtowerBridge`.
- Produces:
  - `func buildMagicPacket(_ mac: ParsedMac) -> [UInt8]` — 102 bytes: `[0xFF]*6` + `mac.bytes` repeated 16×.
  - `struct WakeTarget: Equatable, Sendable { public let host: String; public let port: Int }`
  - `func wakeTargets(_ connection: Connection) -> [WakeTarget]` — LAN `(lanIp, 9)` first if `lanIp` non-nil; WAN `(wanHost, wanPort ?? 9)` if `wanHost` non-nil.
  - `@DependencyClient struct WakeOnLanClient: Sendable { public var send: @Sendable (_ packet: [UInt8], _ host: String, _ port: Int) async throws -> Void }` + `DependencyKey` (`liveValue` uses `NWConnection`) + `DependencyValues.wakeOnLanClient`.

- [ ] **Step 1: Add the SPM target.** In `swift/WatchtowerCore/Package.swift`, add to `products`: `.library(name: "WatchtowerRemote", targets: ["WatchtowerRemote"])`. Add to `targets`:

```swift
.target(
    name: "WatchtowerRemote",
    dependencies: [
        "WatchtowerBridge",
        .product(name: "ComposableArchitecture", package: "swift-composable-architecture"),
    ]
),
.testTarget(
    name: "WatchtowerRemoteTests",
    dependencies: ["WatchtowerRemote"]
),
```

Create the source dir with a placeholder so SwiftPM resolves: create `swift/WatchtowerCore/Sources/WatchtowerRemote/WakeOnLan.swift` (next step) and `Tests/WatchtowerRemoteTests/WakeOnLanTests.swift`.

- [ ] **Step 2: Write the failing tests** `Tests/WatchtowerRemoteTests/WakeOnLanTests.swift`:

```swift
import XCTest
import WatchtowerBridge
@testable import WatchtowerRemote

final class WakeOnLanTests: XCTestCase {
    func testMagicPacketLayout() {
        let mac = parseMac("01:23:45:67:89:AB")!
        let pkt = buildMagicPacket(mac)
        XCTAssertEqual(pkt.count, 102)
        XCTAssertEqual(Array(pkt.prefix(6)), [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
        // 16 repeats of the 6-byte MAC follow the 6x 0xFF prefix.
        for i in 0..<16 {
            let start = 6 + i * 6
            XCTAssertEqual(Array(pkt[start..<start+6]), [0x01, 0x23, 0x45, 0x67, 0x89, 0xAB])
        }
    }

    func testWakeTargetsLanAndWan() {
        let c = Connection(host: "h", port: 7445, token: "t",
                           mac: "01:23:45:67:89:AB", lanIp: "192.168.1.9",
                           wanHost: "home.example.net", wanPort: 1234)
        XCTAssertEqual(wakeTargets(c), [
            WakeTarget(host: "192.168.1.9", port: 9),
            WakeTarget(host: "home.example.net", port: 1234),
        ])
    }

    func testWakeTargetsWanPortDefaultsToNine() {
        let c = Connection(host: "h", port: 7445, token: "t",
                           mac: nil, lanIp: nil, wanHost: "home.example.net", wanPort: nil)
        XCTAssertEqual(wakeTargets(c), [WakeTarget(host: "home.example.net", port: 9)])
    }

    func testWakeTargetsEmptyWhenNoAddresses() {
        let c = Connection(host: "h", port: 7445, token: "t",
                           mac: nil, lanIp: nil, wanHost: nil, wanPort: nil)
        XCTAssertTrue(wakeTargets(c).isEmpty)
    }
}
```

Run `cd swift/WatchtowerCore && swift test --filter WakeOnLanTests` → RED (symbols not defined). **Verify the `Connection` init parameter names/order against `WatchtowerBridge/Connection/Connection.swift` before running; adjust the literals if they differ.**

- [ ] **Step 3: Implement `WakeOnLan.swift`:**

```swift
import Foundation
import WatchtowerBridge

/// 102-byte Wake-on-LAN magic packet: 6x 0xFF sync stream + 16 repeats of the MAC.
/// Port of apps/ipad/src/lib/wakeOnLan.ts.
public func buildMagicPacket(_ mac: ParsedMac) -> [UInt8] {
    var pkt = [UInt8](repeating: 0xFF, count: 6)
    for _ in 0..<16 { pkt.append(contentsOf: mac.bytes) }
    return pkt
}

public struct WakeTarget: Equatable, Sendable {
    public let host: String
    public let port: Int
    public init(host: String, port: Int) { self.host = host; self.port = port }
}

/// LAN target uses the fixed discard port 9; WAN/DDNS uses wanPort or 9.
/// Port of apps/ipad/src/state/wake.ts wakeTargets.
public func wakeTargets(_ connection: Connection) -> [WakeTarget] {
    var targets: [WakeTarget] = []
    if let lan = connection.lanIp { targets.append(WakeTarget(host: lan, port: 9)) }
    if let wan = connection.wanHost { targets.append(WakeTarget(host: wan, port: connection.wanPort ?? 9)) }
    return targets
}
```

- [ ] **Step 4: Implement `WakeOnLanClient.swift`** (live UDP send; the reducer tests it with a mock, so no host test here — the live path is on-device-verified):

```swift
import Foundation
import Network
import Dependencies
import DependenciesMacros

/// Fires one UDP datagram (the magic packet) at host:port. Unicast only.
/// Port of apps/ipad/ios/App/App/WakePlugin.swift.
@DependencyClient
public struct WakeOnLanClient: Sendable {
    public var send: @Sendable (_ packet: [UInt8], _ host: String, _ port: Int) async throws -> Void
}

public enum WakeOnLanError: Error { case invalidPort, connectionFailed(String), timeout }

extension WakeOnLanClient: DependencyKey {
    public static let liveValue = WakeOnLanClient(
        send: { packet, host, port in
            guard let nwPort = NWEndpoint.Port(rawValue: UInt16(exactly: port) ?? 0), port >= 1, port <= 65535
            else { throw WakeOnLanError.invalidPort }
            let conn = NWConnection(host: NWEndpoint.Host(host), port: nwPort, using: .udp)
            let queue = DispatchQueue(label: "cz.watchtower.wake")
            try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
                let finished = LockIsolated(false)
                func settle(_ result: Result<Void, Error>) {
                    finished.withValue { done in
                        guard !done else { return }
                        done = true
                        conn.cancel()
                        cont.resume(with: result)
                    }
                }
                conn.stateUpdateHandler = { state in
                    switch state {
                    case .ready:
                        conn.send(content: Data(packet), completion: .contentProcessed { err in
                            settle(err.map { .failure(WakeOnLanError.connectionFailed("\($0)")) } ?? .success(()))
                        })
                    case let .failed(err):
                        settle(.failure(WakeOnLanError.connectionFailed("\(err)")))
                    default:
                        break // .waiting can persist for an unreachable DDNS host; timeout backstops it.
                    }
                }
                queue.asyncAfter(deadline: .now() + 5) { settle(.failure(WakeOnLanError.timeout)) }
                conn.start(queue: queue)
            }
        }
    )
}

public extension DependencyValues {
    var wakeOnLanClient: WakeOnLanClient {
        get { self[WakeOnLanClient.self] }
        set { self[WakeOnLanClient.self] = newValue }
    }
}
```

*(Use `LockIsolated` from `ComposableArchitecture`/`ConcurrencyExtras` — already available in the package. If `import Dependencies`/`DependenciesMacros` don't resolve standalone, `import ComposableArchitecture` instead, matching `ConnectionStore.swift`.)*

- [ ] **Step 5: GREEN** — `swift test --filter WakeOnLanTests` passes; full `cd swift/WatchtowerCore && swift test` → 361 + 4 new, no regressions.

- [ ] **Step 6: Commit** `git commit -m "feat(ipad-native): WatchtowerRemote target + Wake-on-LAN packet/targets/UDP client (Phase 4)"`.

---

### Task 2: VncKeyMap (pure X11 keysyms)

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerRemote/VncKeyMap.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerRemoteTests/VncKeyMapTests.swift`

**Interfaces:**
- Produces:
  - `enum VncSpecialKey: Equatable, Sendable { case returnKey, backspace, tab, escape, left, up, right, down }`
  - `enum VncKeyMap { static func keysym(for special: VncSpecialKey) -> UInt32; static func keysym(forScalar scalar: Unicode.Scalar) -> UInt32? }`
  - Keysyms return raw X11 values (`UInt32`); the app target wraps them in `VNCKeyCode(_:)`. This keeps the map RoyalVNCKit-free and host-testable.

- [ ] **Step 1: Write the failing tests** `VncKeyMapTests.swift`:

```swift
import XCTest
@testable import WatchtowerRemote

final class VncKeyMapTests: XCTestCase {
    func testSpecialKeysyms() {
        XCTAssertEqual(VncKeyMap.keysym(for: .returnKey), 0xFF0D)
        XCTAssertEqual(VncKeyMap.keysym(for: .backspace), 0xFF08)
        XCTAssertEqual(VncKeyMap.keysym(for: .tab), 0xFF09)
        XCTAssertEqual(VncKeyMap.keysym(for: .escape), 0xFF1B)
        XCTAssertEqual(VncKeyMap.keysym(for: .left), 0xFF51)
        XCTAssertEqual(VncKeyMap.keysym(for: .up), 0xFF52)
        XCTAssertEqual(VncKeyMap.keysym(for: .right), 0xFF53)
        XCTAssertEqual(VncKeyMap.keysym(for: .down), 0xFF54)
    }

    func testPrintableScalarMapsToCodePoint() {
        XCTAssertEqual(VncKeyMap.keysym(forScalar: Unicode.Scalar("a")), 0x61)
        XCTAssertEqual(VncKeyMap.keysym(forScalar: Unicode.Scalar(" ")), 0x20)
        XCTAssertEqual(VncKeyMap.keysym(forScalar: Unicode.Scalar(0xFF)!), 0xFF)
    }

    func testOutOfRangeScalarReturnsNil() {
        XCTAssertNil(VncKeyMap.keysym(forScalar: Unicode.Scalar(0x1F)!)) // below 0x20
        XCTAssertNil(VncKeyMap.keysym(forScalar: Unicode.Scalar(0x100)!)) // above 0xFF
    }
}
```

Run `swift test --filter VncKeyMapTests` → RED.

- [ ] **Step 2: Implement `VncKeyMap.swift`:**

```swift
import Foundation

/// Special (non-printable) keys the VNC screen maps to X11 keysyms.
public enum VncSpecialKey: Equatable, Sendable {
    case returnKey, backspace, tab, escape, left, up, right, down
}

/// X11 keysym mapping for RFB key events. Returns raw UInt32 keysyms; the app-target
/// VncViewController wraps them in RoyalVNCKit's VNCKeyCode. Port of VncKeyMap in
/// apps/ipad/ios/App/App/VncViewController.swift.
public enum VncKeyMap {
    public static func keysym(for special: VncSpecialKey) -> UInt32 {
        switch special {
        case .returnKey: return 0xFF0D
        case .backspace: return 0xFF08
        case .tab: return 0xFF09
        case .escape: return 0xFF1B
        case .left: return 0xFF51
        case .up: return 0xFF52
        case .right: return 0xFF53
        case .down: return 0xFF54
        }
    }

    /// Printable Latin-1 range maps 1:1 to its keysym (code point). Anything else → nil.
    public static func keysym(forScalar scalar: Unicode.Scalar) -> UInt32? {
        let v = scalar.value
        guard v >= 0x20 && v <= 0xFF else { return nil }
        return v
    }
}
```

- [ ] **Step 3: GREEN** — filtered + full `swift test` (361 + Task 1 + these).

- [ ] **Step 4: Commit** `git commit -m "feat(ipad-native): VncKeyMap X11 keysyms (Phase 4)"`.

---

### Task 3: VNC credentials + Keychain store

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerRemote/VncCredentialsStore.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerRemoteTests/VncCredentialsTests.swift`

**Interfaces:**
- Produces:
  - `struct VncCredentials: Codable, Equatable, Sendable { public var username: String; public var password: String }`
  - `@DependencyClient struct VncCredentialsStore: Sendable { public var load: @Sendable () -> VncCredentials? = { nil }; public var save: @Sendable (VncCredentials) -> Void; public var clear: @Sendable () -> Void }` + `DependencyKey` (live = Keychain `kSecClassGenericPassword`, service `"watchtower.vnc.creds"`) + `DependencyValues.vncCredentialsStore`.

- [ ] **Step 1: Write the failing test** `VncCredentialsTests.swift` — Codable round-trip only (the live Keychain path is verified on-device; the reducer tests use an in-memory mock store). This asserts the JSON shape used for the Keychain blob:

```swift
import XCTest
@testable import WatchtowerRemote

final class VncCredentialsTests: XCTestCase {
    func testCodableRoundTrip() throws {
        let creds = VncCredentials(username: "jan", password: "s3cret")
        let data = try JSONEncoder().encode(creds)
        let decoded = try JSONDecoder().decode(VncCredentials.self, from: data)
        XCTAssertEqual(decoded, creds)
    }

    func testInMemoryStoreOverrideRoundTrips() {
        // Proves the @DependencyClient surface is usable with a test double
        // (the pattern the RemoteFeature tests rely on).
        let box = LockIsolated<VncCredentials?>(nil)
        let store = VncCredentialsStore(
            load: { box.value },
            save: { box.setValue($0) },
            clear: { box.setValue(nil) }
        )
        XCTAssertNil(store.load())
        store.save(VncCredentials(username: "a", password: "b"))
        XCTAssertEqual(store.load(), VncCredentials(username: "a", password: "b"))
        store.clear()
        XCTAssertNil(store.load())
    }
}
```

*(Use `LockIsolated` via `import ComposableArchitecture`.)* Run `swift test --filter VncCredentialsTests` → RED.

- [ ] **Step 2: Implement `VncCredentialsStore.swift`** — first Keychain code in the repo (greenfield):

```swift
import Foundation
import Security
import ComposableArchitecture

/// macOS Screen Sharing account short-username + login password (RFB type-30 auth),
/// distinct from Connection.token. Port of apps/ipad/src/state/vncCreds.ts, upgraded
/// from plaintext Preferences to the Keychain.
public struct VncCredentials: Codable, Equatable, Sendable {
    public var username: String
    public var password: String
    public init(username: String, password: String) {
        self.username = username; self.password = password
    }
}

@DependencyClient
public struct VncCredentialsStore: Sendable {
    public var load: @Sendable () -> VncCredentials? = { nil }
    public var save: @Sendable (VncCredentials) -> Void
    public var clear: @Sendable () -> Void
}

extension VncCredentialsStore: DependencyKey {
    static let service = "watchtower.vnc.creds"

    public static let liveValue = VncCredentialsStore(
        load: {
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecReturnData as String: true,
                kSecMatchLimit as String: kSecMatchLimitOne,
            ]
            var out: CFTypeRef?
            guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess,
                  let data = out as? Data,
                  let creds = try? JSONDecoder().decode(VncCredentials.self, from: data)
            else { return nil }
            return creds
        },
        save: { creds in
            guard let data = try? JSONEncoder().encode(creds) else { return }
            let base: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
            ]
            SecItemDelete(base as CFDictionary) // idempotent overwrite
            var add = base
            add[kSecValueData as String] = data
            SecItemAdd(add as CFDictionary, nil)
        },
        clear: {
            let base: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
            ]
            SecItemDelete(base as CFDictionary)
        }
    )
}

public extension DependencyValues {
    var vncCredentialsStore: VncCredentialsStore {
        get { self[VncCredentialsStore.self] }
        set { self[VncCredentialsStore.self] = newValue }
    }
}
```

- [ ] **Step 3: GREEN** — filtered + full `swift test`.

- [ ] **Step 4: Commit** `git commit -m "feat(ipad-native): VNC credentials Keychain store (Phase 4)"`.

---

### Task 4: RemoteFeature reducer (VNC status + creds form + wake state machine)

**Files:**
- Create: `swift/WatchtowerCore/Sources/WatchtowerRemote/RemoteFeature.swift`
- Test: `swift/WatchtowerCore/Tests/WatchtowerRemoteTests/RemoteFeatureTests.swift`

**Interfaces:**
- Consumes: `WakeOnLanClient`, `VncCredentialsStore`, `buildMagicPacket`, `wakeTargets`, `parseMac`, `ConnectionStore` (`@Dependency(\.connectionStore)` from `WatchtowerBridge`, `load() -> Connection?`).
- Produces (the app-target `RemoteView` drives these):
  - `enum VncStatus: String, Equatable, Sendable { case idle, connecting, connected, disconnected }`
  - `RemoteFeature.State` (see below) and `RemoteFeature.Action`.
  - The app target reads `state.host`/`state.credentials` to configure `VncViewController` and sends `.vncStateChanged(_:)`, `.vncAuthFailed`, `.vncClosed` back.

- [ ] **Step 1: Write the failing TestStore tests** `RemoteFeatureTests.swift`. Cover: `onAppear` loads creds + host from the connection; `wakeTapped` sends a magic packet to every target (capture via `LockIsolated`); `vncAuthFailed` clears the saved password + opens the creds form; `submitCredentials` saves + clears the form + returns to `connecting`; `vncStateChanged(.connected)` closes the form. Example (adapt exact field names to the implementation as you write it):

```swift
import XCTest
import ComposableArchitecture
import WatchtowerBridge
@testable import WatchtowerRemote

@MainActor
final class RemoteFeatureTests: XCTestCase {
    private func conn() -> Connection {
        Connection(host: "mac.ts.net", port: 7445, token: "t",
                   mac: "01:23:45:67:89:AB", lanIp: "192.168.1.9", wanHost: nil, wanPort: nil)
    }

    func testOnAppearLoadsHostAndCreds() async {
        let store = TestStore(initialState: RemoteFeature.State()) { RemoteFeature() }
        withDependencies: {
            $0.connectionStore.load = { self.conn() }
            $0.vncCredentialsStore.load = { VncCredentials(username: "jan", password: "pw") }
        }
        await store.send(.onAppear) {
            $0.host = "mac.ts.net"
            $0.credentials = VncCredentials(username: "jan", password: "pw")
            $0.status = .connecting
        }
    }

    func testWakeTappedSendsToEachTarget() async {
        let sends = LockIsolated<[(host: String, port: Int, bytes: Int)]>([])
        let store = TestStore(initialState: RemoteFeature.State(host: "mac.ts.net")) { RemoteFeature() }
        withDependencies: {
            $0.connectionStore.load = { self.conn() }
            $0.wakeOnLanClient.send = { packet, host, port in
                sends.withValue { $0.append((host, port, packet.count)) }
            }
        }
        await store.send(.wakeTapped) { $0.waking = true }
        await store.receive(\.wakeFinished) { $0.waking = false }
        XCTAssertEqual(sends.value.count, 1)
        XCTAssertEqual(sends.value.first?.host, "192.168.1.9")
        XCTAssertEqual(sends.value.first?.port, 9)
        XCTAssertEqual(sends.value.first?.bytes, 102)
    }

    func testAuthFailedClearsPasswordAndOpensForm() async {
        let store = TestStore(
            initialState: RemoteFeature.State(
                host: "mac.ts.net",
                credentials: VncCredentials(username: "jan", password: "pw"),
                status: .connecting
            )
        ) { RemoteFeature() }
        await store.send(.vncAuthFailed) {
            $0.status = .disconnected
            $0.credentials.password = ""
            $0.credentialFormOpen = true
            $0.authFailed = true
        }
    }

    func testSubmitCredentialsSavesAndReconnects() async {
        let saved = LockIsolated<VncCredentials?>(nil)
        let store = TestStore(
            initialState: RemoteFeature.State(host: "mac.ts.net", credentialFormOpen: true, authFailed: true)
        ) { RemoteFeature() }
        withDependencies: {
            $0.vncCredentialsStore.save = { saved.setValue($0) }
        }
        await store.send(.credentialsUsernameChanged("jan")) { $0.credentials.username = "jan" }
        await store.send(.credentialsPasswordChanged("newpw")) { $0.credentials.password = "newpw" }
        await store.send(.submitCredentials) {
            $0.credentialFormOpen = false
            $0.authFailed = false
            $0.status = .connecting
        }
        XCTAssertEqual(saved.value, VncCredentials(username: "jan", password: "newpw"))
    }
}
```

Run `swift test --filter RemoteFeatureTests` → RED.

- [ ] **Step 2: Implement `RemoteFeature.swift`:**

```swift
import Foundation
import ComposableArchitecture
import WatchtowerBridge

public enum VncStatus: String, Equatable, Sendable {
    case idle, connecting, connected, disconnected
}

@Reducer
public struct RemoteFeature {
    @ObservableState
    public struct State: Equatable {
        public var host: String = ""
        public var credentials = VncCredentials(username: "", password: "")
        public var status: VncStatus = .idle
        public var credentialFormOpen = false
        public var authFailed = false
        public var waking = false

        public init(
            host: String = "",
            credentials: VncCredentials = VncCredentials(username: "", password: ""),
            status: VncStatus = .idle,
            credentialFormOpen: Bool = false,
            authFailed: Bool = false,
            waking: Bool = false
        ) {
            self.host = host; self.credentials = credentials; self.status = status
            self.credentialFormOpen = credentialFormOpen; self.authFailed = authFailed; self.waking = waking
        }
    }

    public enum Action: Equatable {
        case onAppear
        case wakeTapped
        case wakeFinished
        case vncStateChanged(VncStatus)
        case vncAuthFailed
        case vncClosed
        case credentialsUsernameChanged(String)
        case credentialsPasswordChanged(String)
        case submitCredentials
    }

    @Dependency(\.connectionStore) var connectionStore
    @Dependency(\.vncCredentialsStore) var vncCredentialsStore
    @Dependency(\.wakeOnLanClient) var wakeOnLanClient

    public init() {}

    public var body: some ReducerOf<Self> {
        Reduce { state, action in
            switch action {
            case .onAppear:
                if let c = connectionStore.load() { state.host = c.host }
                if let creds = vncCredentialsStore.load() { state.credentials = creds }
                state.status = .connecting
                return .none

            case .wakeTapped:
                guard let c = connectionStore.load(), let mac = c.mac.flatMap(parseMac) else { return .none }
                state.waking = true
                let packet = buildMagicPacket(mac)
                let targets = wakeTargets(c)
                return .run { send in
                    for t in targets {
                        try? await wakeOnLanClient.send(packet, t.host, t.port) // per-target failure is expected off-network
                    }
                    await send(.wakeFinished)
                }

            case .wakeFinished:
                state.waking = false
                return .none

            case let .vncStateChanged(status):
                state.status = status
                if status == .connected { state.credentialFormOpen = false; state.authFailed = false }
                return .none

            case .vncAuthFailed:
                state.status = .disconnected
                state.credentials.password = ""
                state.credentialFormOpen = true
                state.authFailed = true
                return .none

            case .vncClosed:
                state.status = .disconnected
                return .none

            case let .credentialsUsernameChanged(u):
                state.credentials.username = u
                return .none

            case let .credentialsPasswordChanged(p):
                state.credentials.password = p
                return .none

            case .submitCredentials:
                vncCredentialsStore.save(state.credentials)
                state.credentialFormOpen = false
                state.authFailed = false
                state.status = .connecting
                return .none
            }
        }
    }
}
```

- [ ] **Step 3: GREEN** — filtered + full `swift test`.

- [ ] **Step 4: Commit** `git commit -m "feat(ipad-native): RemoteFeature reducer (VNC status + creds + wake) (Phase 4)"`.

---

### Task 5: VncViewController — RoyalVNCKit VNC screen (app target, port verbatim)

**Files:**
- Modify: `apps/ipad-native/project.yml` (add RoyalVNCKit package + dependency)
- Create: `apps/ipad-native/Watchtower/Remote/VncViewController.swift`

**Interfaces:**
- Consumes: `RoyalVNCKit` (`VNCConnection`, `VNCConnection.Settings`, `VNCConnectionDelegate`, `VNCKeyCode`, `VNCMouseWheel`, `VNCUsernamePasswordCredential`, `VNCPasswordCredential`, `VNCError.isAuthenticationError`, `VNCFrameEncodingType`), `VncKeyMap`/`VncSpecialKey` (from `WatchtowerRemote`).
- Produces: `final class VncViewController: UIViewController` with settable `host: String`, `username: String`, `password: String`, and callbacks `onState: ((VncStatus) -> Void)?`, `onAuthFailed: (() -> Void)?`, `onClosed: (() -> Void)?`. Public `func connect()` / `func teardown()`.

- [ ] **Step 1: Add RoyalVNCKit to `project.yml`.** Under `packages:` add (mirroring the `SwiftTerm` entry):

```yaml
  RoyalVNCKit:
    url: https://github.com/royalapplications/royalvnc
    revision: 337197afdb32020d3dfdb7d058989115b740cdc4
```

Under `targets: Watchtower: dependencies:` add:

```yaml
      - package: WatchtowerCore
        product: WatchtowerRemote
      - package: RoyalVNCKit
        product: RoyalVNCKit
```

Run `cd apps/ipad-native && xcodegen generate` and confirm it succeeds (SPM resolves RoyalVNCKit).

- [ ] **Step 2: Implement `VncViewController.swift`** — port `apps/ipad/ios/App/App/VncViewController.swift` verbatim, with these adaptations: replace the closure `onState: ((String)->Void)?` with `onState: ((VncStatus)->Void)?` (map RoyalVNCKit statuses to `VncStatus`); use `VncKeyMap.keysym(...)` (from `WatchtowerRemote`) and wrap results in `VNCKeyCode(_:)`; map `UIKey.keyCode` special keys to `VncSpecialKey`; drop all Capacitor references. Preserve verbatim: the `VNCConnection.Settings` block (Global Constraints — `inputMode: .forwardKeyboardShortcutsIfNotInUseLocally`, `port: 5900`), the `framebufferPoint(from:)` aspect-fit math, the two-finger pan + `allowedScrollTypesMask = .all` + `require(toFail:)` wiring, the `flushWheel`/`startMomentum`/`momentumTick`/`stopMomentum` momentum logic with all constants (`wheelStepPx = 3`, burst cap `12`, `momentumMinStart = 120`, `momentumMinStop = 16`, `momentumDecayPerSec = 0.05`), the hidden `UITextField` keyboard-catcher, the `pressesBegan`/`pressesEnded` hardware-key handling, and the credential delegate (`VNCUsernamePasswordCredential` when `authenticationType.requiresUsername`, else `VNCPasswordCredential`). On `.disconnected`: if `(state.error as? VNCError)?.isAuthenticationError == true` → `onAuthFailed?()` then `onClosed?()`; else `onState?(.disconnected)`.

  *(This is a large ~verbatim UIKit port. Read the source file end-to-end first. Do NOT introduce behavior changes beyond the adaptations above.)*

- [ ] **Step 3: Build** → the full app-build command (Global Constraints) → `** BUILD SUCCEEDED **`. (Confirms RoyalVNCKit links and the VC compiles. The VC isn't wired into a screen yet — that's Task 6.)

- [ ] **Step 4: Commit** `git commit -m "feat(ipad-native): VncViewController RoyalVNCKit screen + momentum (Phase 4)"`.

---

### Task 6: RemoteView + wire the .remote module + Info.plist

**Files:**
- Create: `apps/ipad-native/Watchtower/Remote/RemoteView.swift`
- Modify: `apps/ipad-native/Watchtower/Views/AppShellView.swift` (replace the `.remote` `PlaceholderView`)
- Modify: `apps/ipad-native/Watchtower/Info.plist` (ATS + local-network usage)

**Interfaces:**
- Consumes: `RemoteFeature` (standalone store), `VncViewController`, `RemoteFeature.State`/`Action`.
- Produces: `struct RemoteView: View` (owns `@State private var store = StoreOf<RemoteFeature>(...)` or is passed one) containing a `VncControllerRepresentable: UIViewControllerRepresentable` wrapping `VncViewController`, plus the creds-form overlay, wake button, and status chrome.

- [ ] **Step 1: Implement `RemoteView.swift`.** A `UIViewControllerRepresentable` (`VncControllerRepresentable`) wrapping `VncViewController`: in `makeUIViewController`, set `host`/`username`/`password` from `store.state`, wire `onState = { store.send(.vncStateChanged($0)) }`, `onAuthFailed = { store.send(.vncAuthFailed) }`, `onClosed = { store.send(.vncClosed) }`, call `connect()`; in `static func dismantleUIViewController`, call `teardown()` (mirror `RemoteTerminalView`/`TerminalController`). `RemoteView` shows: the representable when `store.host` is non-empty and `!store.credentialFormOpen`; a credential form (username/password `TextField`s → `.credentialsUsernameChanged`/`.credentialsPasswordChanged`, submit → `.submitCredentials`) with an English error banner ("Sign-in failed — check your macOS account short name and password.") when `store.authFailed`; a toolbar/overlay **Wake Mac** button (`.wakeTapped`, disabled while `store.waking`); and a status label from `store.status`. `.onAppear { store.send(.onAppear) }`. Re-key the representable with `.id(store.credentials)` so submitting new creds rebuilds the VC and reconnects (matches the Capacitor `useEffect([creds])` re-present).

- [ ] **Step 2: Wire `.remote` in `AppShellView.swift`.** Replace the `case .remote:` `PlaceholderView(...)` with `RemoteView(store: Self.remoteStore)` — add a `static let remoteStore = Store(initialState: RemoteFeature.State()) { RemoteFeature() }` alongside the app store (standalone, per Global Constraints), or create it inline in the shell view's `@State`. Import `WatchtowerRemote`.

- [ ] **Step 3: Info.plist.** Add (English copy):

```xml
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
</dict>
<key>NSLocalNetworkUsageDescription</key>
<string>Watchtower connects to your Mac over the local network for screen sharing and wake-on-LAN.</string>
```

*(If `Info.plist` is generated by xcodegen from `project.yml`, add these under the target's `info: properties:` in `project.yml` instead — check which the app uses before editing.)*

- [ ] **Step 4: Build** → `** BUILD SUCCEEDED **`.

- [ ] **Step 5: Commit** `git commit -m "feat(ipad-native): RemoteView + wire Remote Mac module + local-network Info.plist (Phase 4)"`.

---

### Task 7: Verification

**Files:** none (operational).

- [ ] **Step 1:** `cd swift/WatchtowerCore && swift test` → green (361 + all new Phase-4 tests: WakeOnLan 4, VncKeyMap 3, VncCredentials 2, RemoteFeature 4).
- [ ] **Step 2:** App `** BUILD SUCCEEDED **`; install + launch on the iOS 26 iPad sim; select the **Remote Mac** module; confirm no crash and the screen renders (VNC will show a connecting/disconnected status with no live Mac). Screenshot it.
- [ ] **Step 3 (needs a live Mac):** on device — enable macOS Screen Sharing; connect to `host:5900`, verify framebuffer renders and mouse/keyboard/two-finger scroll + momentum work; enter wrong creds → auth-fail reopens the form with the error banner; **Wake Mac** sends the magic packet to LAN + WAN targets (verify with a packet capture or a sleeping Mac). Record deviations; fix individually. (Apple-Silicon + USB-Ethernet WoL caveat: the NIC powers off on sleep — see `docs/runbooks/wake-on-lan.md`.)

---

## Plan self-review (completed at authoring time)

- **Spec coverage (Phase 4 row):** `VncViewController` + `VncKeyMap` + momentum → T2 (keymap) + T5 (VC/momentum); WoL UDP sender + magic-packet builder (Swift, unit-tested) → T1; creds in Keychain → T3; VNC auth-failure/close UX → T4 (reducer) + T6 (form). New `WatchtowerRemote` target → T1. RoyalVNCKit isolated to the app target (approved deviation for host-test safety — RoyalVNCKit is not a `WatchtowerRemote` dependency; it lives in `apps/ipad-native` with the VC).
- **Dependency direction:** `WatchtowerRemote` → `WatchtowerBridge` only; `RemoteFeature` is a standalone store (not composed into `IPadAppFeature`) → no cycle. `openRemoteForAuth` already sets `.remote` (Phase 1), needs no RemoteFeature coupling.
- **Type consistency:** `VncStatus`, `VncCredentials`, `VncSpecialKey`, `WakeTarget`, `WakeOnLanClient`, `VncCredentialsStore`, `RemoteFeature.Action` cases spelled identically across T1–T6. Keysyms are `UInt32` in `WatchtowerRemote`, wrapped in `VNCKeyCode` only in the app target (T5).
- **Verification model:** WoL packet/targets, keymap, creds codable, and the full RemoteFeature state machine are host-tested (T1–T4); the RoyalVNCKit VC + gestures + momentum + Keychain live path are build-verified (T5–T6) and on-device-verified (T7 Step 3).
- **Regression:** no changes to `WatchtowerBridge`/`WatchtowerCore` behavior; `IPadAppFeature` only swaps the `.remote` placeholder for the real view. Full `swift test` green gate in T1–T4 + T7.
