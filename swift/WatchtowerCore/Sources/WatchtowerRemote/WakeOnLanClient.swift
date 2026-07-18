import Foundation
import Network
import ComposableArchitecture

/// Fires one UDP datagram (the magic packet) at host:port. Unicast only.
/// Port of apps/ipad/ios/App/App/WakePlugin.swift.
@DependencyClient
public struct WakeOnLanClient: Sendable {
    public var send: @Sendable (_ packet: [UInt8], _ host: String, _ port: Int) async throws -> Void
}

public enum WakeOnLanError: Error, Sendable, Equatable { case invalidPort, connectionFailed(String), timeout }

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
