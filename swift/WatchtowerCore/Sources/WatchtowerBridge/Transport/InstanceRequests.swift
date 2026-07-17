import Foundation

// MARK: - Requests (ipcContract.ts: removeInstance / spawnInstance / restartInstance /
// terminalAttach / ptyWrite / ptyResize / terminalFocus / projects:list)

public struct RemoveInstanceRequest: BridgeRequest {
    public static let kind = "removeInstance"
    public struct Response: Decodable, Equatable, Sendable { public let ok: Bool }
    public var instanceId: String
    public init(instanceId: String) { self.instanceId = instanceId }
}

public struct SpawnInstanceRequest: BridgeRequest {
    public static let kind = "spawnInstance"
    public struct Response: Decodable, Equatable, Sendable {
        public let instanceId: String?
        public let error: String?
    }
    public var cwd: String
    public var instanceKind: String
    public init(cwd: String, instanceKind: String) { self.cwd = cwd; self.instanceKind = instanceKind }
}

public struct RestartInstanceRequest: BridgeRequest {
    public static let kind = "restartInstance"
    public struct Response: Decodable, Equatable, Sendable { public let ok: Bool }
    public var instanceId: String
    public init(instanceId: String) { self.instanceId = instanceId }
}

public struct TerminalAttachRequest: BridgeRequest {
    public static let kind = "terminalAttach"
    public struct Response: Decodable, Equatable, Sendable {
        /// Opaque ANSI SerializeAddon snapshot — feed to SwiftTerm as-is.
        public let data: String
        public let cols: Int
        public let rows: Int
    }
    public var instanceId: String
    public init(instanceId: String) { self.instanceId = instanceId }
}

public struct PtyWriteRequest: BridgeRequest {
    public static let kind = "ptyWrite"
    public struct Response: Decodable, Equatable, Sendable { public let ok: Bool }
    public var instanceId: String
    public var data: String
    public init(instanceId: String, data: String) { self.instanceId = instanceId; self.data = data }
}

public struct PtyResizeRequest: BridgeRequest {
    public static let kind = "ptyResize"
    public struct Response: Decodable, Equatable, Sendable { public let ok: Bool }
    public var instanceId: String
    public var cols: Int
    public var rows: Int
    public init(instanceId: String, cols: Int, rows: Int) {
        self.instanceId = instanceId; self.cols = cols; self.rows = rows
    }
}

public struct TerminalFocusRequest: BridgeRequest {
    public static let kind = "terminalFocus"
    public struct Response: Decodable, Equatable, Sendable { public let ok: Bool }
    public var instanceId: String
    public init(instanceId: String) { self.instanceId = instanceId }
}

/// Subset of ipcContract.ts `ProjectViewPayload` — Codable ignores the fields this
/// app doesn't need (color, archived, jiraGlobs, ...).
public struct ProjectDTO: Decodable, Equatable, Sendable {
    public let id: Int
    public let name: String
    public let folderPath: String?
    public init(id: Int, name: String, folderPath: String?) {
        self.id = id; self.name = name; self.folderPath = folderPath
    }
}

public struct ProjectsListRequest: BridgeRequest {
    public static let kind = "projects:list"
    public struct Response: Decodable, Equatable, Sendable { public let projects: [ProjectDTO] }
    public init() {}
}

// MARK: - Push payloads (ptyData / stateChanged / authBlock)

public struct PtyDataPush: Decodable, Equatable, Sendable {
    public let instanceId: String
    public let chunk: String
    public init(instanceId: String, chunk: String) { self.instanceId = instanceId; self.chunk = chunk }
}

public struct StateChangedPush: Decodable, Equatable, Sendable {
    public let instanceId: String
    public let status: String
    public init(instanceId: String, status: String) { self.instanceId = instanceId; self.status = status }
}

public struct AuthBlockPush: Decodable, Equatable, Sendable {
    public let instanceId: String
    public let blocked: Bool
    public let reason: String?
    public init(instanceId: String, blocked: Bool, reason: String?) {
        self.instanceId = instanceId; self.blocked = blocked; self.reason = reason
    }
}
