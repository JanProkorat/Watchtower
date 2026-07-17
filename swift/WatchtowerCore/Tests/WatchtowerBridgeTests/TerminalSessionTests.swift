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
