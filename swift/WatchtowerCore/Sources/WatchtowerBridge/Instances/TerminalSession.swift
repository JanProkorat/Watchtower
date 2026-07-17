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
