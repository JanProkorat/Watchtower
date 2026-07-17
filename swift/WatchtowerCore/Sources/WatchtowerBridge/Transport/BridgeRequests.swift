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
