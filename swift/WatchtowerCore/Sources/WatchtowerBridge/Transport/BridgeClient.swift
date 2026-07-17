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
