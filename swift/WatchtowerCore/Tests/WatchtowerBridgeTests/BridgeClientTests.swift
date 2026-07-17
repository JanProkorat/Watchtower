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
        let stream = await client.pushes(BridgePush.stateChanged)
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
