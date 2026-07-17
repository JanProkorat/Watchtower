import Foundation

/// A managed Claude Code / shell session on the Mac. Domain value type; the
/// wire DTO (Task 2's BridgeInstance) maps into this.
public struct Instance: Equatable, Sendable, Identifiable {
    public var id: String
    public var cwd: String
    /// InstanceStatus wire string — kept raw (not an enum) so an unrecognized
    /// server status never crashes a decode. Compare against InstanceAttention sets.
    public var status: String
    public var lastActivityAt: Double
    /// InstanceKind wire string ("claude" | "shell").
    public var kind: String
    public var taskId: Int?

    public init(id: String, cwd: String, status: String, lastActivityAt: Double, kind: String, taskId: Int?) {
        self.id = id; self.cwd = cwd; self.status = status
        self.lastActivityAt = lastActivityAt; self.kind = kind; self.taskId = taskId
    }
}

public struct ProjectSummary: Equatable, Sendable, Identifiable {
    public var id: Int
    public var name: String
    public var folderPath: String?
    public init(id: Int, name: String, folderPath: String?) {
        self.id = id; self.name = name; self.folderPath = folderPath
    }
}

public struct ProjectGroup: Equatable, Sendable, Identifiable {
    public var projectId: Int?
    public var label: String
    public var folderPath: String?
    public var instanceIds: [String]
    public var id: String { projectId.map(String.init) ?? "__other__" }
    public init(projectId: Int?, label: String, folderPath: String?, instanceIds: [String]) {
        self.projectId = projectId; self.label = label
        self.folderPath = folderPath; self.instanceIds = instanceIds
    }
}

public enum InstanceAttention {
    /// Statuses that surface an amber tab/bell dot (idle-notify excluded — passive).
    public static let actionNeeded: Set<String> = ["waiting-permission", "waiting-input", "crashed"]
    /// Statuses considered "live" (spawn/restart modal filters restartable = not live).
    public static let live: Set<String> = ["spawning", "working", "waiting-permission", "waiting-input", "idle-notify"]
}
