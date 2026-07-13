import Foundation

/// Merged Kanban board column. Port of `packages/shared/src/billing/board/board.ts`'s
/// `BoardColumn` — read-only aggregation shared by iPad/iPhone.
public enum BoardColumn: String, CaseIterable, Equatable, Sendable {
    case todo
    case doing
    case to_accept
    case done
}

/// Raw Jira status → merged board column. Ported verbatim from
/// `board.ts`'s `STATUS_TO_COLUMN` (itself ported from the desktop
/// `orchestrator/services/jiraBoard.ts`) so the board groups cards
/// exactly like the desktop app.
let statusToColumn: [String: BoardColumn] = [
    "New": .todo,
    "To Do": .todo,
    "In Progress": .doing,
    "In Review": .doing,
    "In Test": .to_accept,
    "To Accept": .to_accept,
    "Done": .done,
]

/// Statuses hidden from the board even if Jira still surfaces them.
public let hiddenBoardStatuses: Set<String> = ["Waiting", "Done"]

/// Unknown-but-not-hidden statuses fall here (matches desktop jiraBoard).
private let defaultBoardColumn: BoardColumn = .doing

/// Columns shown, in order. `done` is excluded — finished work leaves the board.
public let visibleBoardColumns: [BoardColumn] = [.todo, .doing, .to_accept]

/// Maps a raw Jira status to its board column. Nil or unmapped statuses fall
/// back to `.doing` (`DEFAULT_COLUMN` in board.ts).
public func columnForStatus(_ jiraStatus: String?) -> BoardColumn {
    guard let jiraStatus, let column = statusToColumn[jiraStatus] else {
        return defaultBoardColumn
    }
    return column
}

/// A single Kanban card. Port of `board.ts`'s `BoardCard` — `column` and
/// `projectId`/`projectName` are dropped here since `BoardData.columns` is
/// already keyed by column, and the board is always scoped to a single
/// project's card set on this client.
public struct BoardCard: Equatable, Identifiable, Sendable {
    public let id: String
    public let taskNumber: String?
    public let taskTitle: String
    public let jiraStatus: String
    public let projectColor: String?
    public let loggedMinutes: Double
    public let estimateMinutes: Double?

    public init(
        id: String, taskNumber: String?, taskTitle: String, jiraStatus: String,
        projectColor: String?, loggedMinutes: Double, estimateMinutes: Double?
    ) {
        self.id = id
        self.taskNumber = taskNumber
        self.taskTitle = taskTitle
        self.jiraStatus = jiraStatus
        self.projectColor = projectColor
        self.loggedMinutes = loggedMinutes
        self.estimateMinutes = estimateMinutes
    }
}

/// Result of `buildBoard` — mirrors `board.ts`'s `BoardResult`, minus the
/// per-column titles (a client-side/localization concern).
public struct BoardData: Equatable, Sendable {
    public let columns: [BoardColumn: [BoardCard]]
    public let totalCards: Int

    public init(columns: [BoardColumn: [BoardCard]], totalCards: Int) {
        self.columns = columns
        self.totalCards = totalCards
    }
}

/// Builds the read-only board from the tasks + worklogs the client already
/// holds (Supabase billing dataset). A task appears only if it carries a
/// `jiraStatus` (i.e. it was pulled from a board); hidden statuses (`Waiting`,
/// `Done`) and the `done` column are dropped. Logged time per card is summed
/// from worklogs by `taskNumber`. Pure — no I/O. Port of `board.ts`'s
/// `buildBoard`.
public func buildBoard(tasks: [TaskRow], worklogs: [WorklogRow], projectId: Int?) -> BoardData {
    var loggedByTask: [String: Double] = [:]
    for w in worklogs {
        guard let taskNumber = w.taskNumber else { continue }
        loggedByTask[taskNumber, default: 0] += w.minutes
    }

    var entries: [(column: BoardColumn, card: BoardCard)] = []
    for t in tasks {
        guard let jiraStatus = t.jiraStatus else { continue } // not on a board
        if hiddenBoardStatuses.contains(jiraStatus) { continue } // Waiting / Done
        if let projectId, t.projectId != projectId { continue }
        let column = columnForStatus(jiraStatus)
        if column == .done { continue } // finished work is not shown

        let logged = t.taskNumber.flatMap { loggedByTask[$0] } ?? 0
        let card = BoardCard(
            id: t.syncId,
            taskNumber: t.taskNumber,
            taskTitle: t.taskTitle,
            jiraStatus: jiraStatus,
            projectColor: t.projectColor,
            loggedMinutes: logged,
            estimateMinutes: t.estimatedMinutes.map(Double.init)
        )
        entries.append((column, card))
    }

    // Natural-numeric sort within each column so FIE-19000 precedes FIE-19100.
    entries.sort { a, b in
        (a.card.taskNumber ?? "").localizedStandardCompare(b.card.taskNumber ?? "") == .orderedAscending
    }

    var columns: [BoardColumn: [BoardCard]] = [:]
    for column in visibleBoardColumns {
        columns[column] = entries.filter { $0.column == column }.map(\.card)
    }

    return BoardData(columns: columns, totalCards: entries.count)
}
