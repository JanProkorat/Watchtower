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

    /// Regression for the actor-reentrancy bug: the initial attach()'s
    /// `await bridge.invoke(...)` suspends, and a reconnect flap
    /// (.disconnected -> .connected) lands *inside* that suspension and
    /// fires a second, superseding attach(). The second attach resolves
    /// first and goes live; a live chunk "C" then arrives. Only afterwards
    /// does the stale first attach's invoke() resolve. Without the
    /// generation guard, the stale attach unconditionally calls
    /// sink.clear() (wiping "C") and writes its own outdated snapshot
    /// ("SNAP1") — this test asserts neither happens.
    func testSupersededAttachDoesNotClobberNewerAttach() async {
        let (ptyStream, ptyCont) = AsyncStream<Data>.makeStream()
        let (statusStream, statusCont) = AsyncStream<ConnStatus>.makeStream()
        let attachGate = LockIsolated(false) // gates only the FIRST terminalAttach call
        let attachCallCount = LockIsolated(0)
        let bridge = BridgeClient(
            configure: { _ in }, shutdown: {},
            statusStream: { statusStream },
            send: { kind, _ in
                guard kind == "terminalAttach" else { return Data("{}".utf8) }
                let callNum: Int = attachCallCount.withValue { $0 += 1; return $0 }
                if callNum == 1 {
                    // Stale attach: block until released, well after the second
                    // (superseding) attach has already gone live.
                    while !attachGate.value { try? await Task.sleep(nanoseconds: 5_000_000) }
                    return Data(#"{"data":"SNAP1","cols":80,"rows":24}"#.utf8)
                }
                return Data(#"{"data":"SNAP2","cols":80,"rows":24}"#.utf8)
            },
            pushes: { kind in kind == BridgePush.ptyData ? ptyStream : .finished }
        )
        let sink = RecordingSink()
        let session = TerminalSession(bridge: bridge, instanceId: "i1")
        Task { await session.start(sink: sink) }

        // Wait for the first (stale) attach's invoke to register and gate.
        await waitUntil("first attach in flight") { attachCallCount.value == 1 }

        // Reconnect flap while the first attach is still in-flight: triggers a
        // second, superseding attach().
        statusCont.yield(.disconnected)
        statusCont.yield(.connected)

        // Let the second attach resolve (no gate) and go live.
        await waitUntil("second attach live") { sink.writes.contains("SNAP2") }

        // A live chunk arrives in the window between the second attach going
        // live and the stale first attach resuming.
        ptyCont.yield(Data(#"{"instanceId":"i1","chunk":"C"}"#.utf8))
        await waitUntil("live chunk delivered") { sink.writes.contains("C") }

        // Now release the stale first attach's invoke().
        attachGate.setValue(true)
        await waitUntil("stale attach settled") { attachCallCount.value == 2 } // sanity: both calls happened
        try? await Task.sleep(nanoseconds: 100_000_000) // let the stale attach's continuation run to completion

        // Fixed behavior: the stale attach bails as soon as it notices it was
        // superseded — it must never clear the sink again or write its own
        // outdated snapshot, and the live chunk must survive.
        XCTAssertEqual(sink.clears, 1, "stale attach must not re-clear after being superseded")
        XCTAssertFalse(sink.writes.contains("SNAP1"), "stale attach must not replay its outdated snapshot")
        XCTAssertTrue(sink.writes.contains("C"), "the live chunk must not be lost")

        await session.stop()
    }
}
