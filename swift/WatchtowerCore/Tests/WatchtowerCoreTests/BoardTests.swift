import XCTest
@testable import WatchtowerCore

final class BoardTests: XCTestCase {
    private func task(
        _ id: Int, _ syncId: String, taskNumber: String?, title: String = "Task",
        jiraStatus: String?, projectId: Int = 1, estimatedMinutes: Int? = nil,
        projectColor: String? = nil
    ) -> TaskRow {
        TaskRow(
            taskId: id, syncId: syncId, epicId: 1, taskNumber: taskNumber, taskTitle: title,
            status: "open", estimatedMinutes: estimatedMinutes, description: nil,
            projectId: projectId, projectName: "P\(projectId)", projectColor: projectColor,
            projectKind: "work", isBillable: true, jiraStatus: jiraStatus
        )
    }

    private func worklog(_ taskNumber: String?, minutes: Double, projectId: Int = 1) -> WorklogRow {
        WorklogRow(
            syncId: "w-\(taskNumber ?? "none")-\(minutes)", workDate: "2026-07-01", minutes: minutes,
            reportedMinutes: nil, effectiveMinutes: minutes, earnedAmount: nil, description: nil,
            projectId: projectId, projectName: "P\(projectId)", projectColor: nil, projectKind: "work",
            isBillable: true, taskNumber: taskNumber, taskTitle: nil, source: nil
        )
    }

    // MARK: - Status -> column mapping

    func testColumnForStatusMapsKnownStatuses() {
        XCTAssertEqual(columnForStatus("New"), .todo)
        XCTAssertEqual(columnForStatus("To Do"), .todo)
        XCTAssertEqual(columnForStatus("In Progress"), .doing)
        XCTAssertEqual(columnForStatus("In Review"), .doing)
        XCTAssertEqual(columnForStatus("In Test"), .to_accept)
        XCTAssertEqual(columnForStatus("To Accept"), .to_accept)
        XCTAssertEqual(columnForStatus("Done"), .done)
    }

    func testColumnForStatusUnknownFallsBackToDoing() {
        XCTAssertEqual(columnForStatus("Some Weird Status"), .doing)
        XCTAssertEqual(columnForStatus(nil), .doing)
    }

    // MARK: - Hidden statuses dropped as cards entirely

    func testHiddenStatusesExcludedAsCards() {
        let tasks = [
            task(1, "s1", taskNumber: "T-1", jiraStatus: "Waiting"),
            task(2, "s2", taskNumber: "T-2", jiraStatus: "Done"),
            task(3, "s3", taskNumber: "T-3", jiraStatus: "New"),
        ]
        let board = buildBoard(tasks: tasks, worklogs: [], projectId: nil)
        XCTAssertEqual(board.totalCards, 1)
        XCTAssertEqual(board.columns[.todo]?.map(\.taskNumber), ["T-3"])
        // Waiting/Done never show up in any visible column.
        for column in visibleBoardColumns {
            XCTAssertFalse(board.columns[column]?.contains { $0.taskNumber == "T-1" } ?? false)
            XCTAssertFalse(board.columns[column]?.contains { $0.taskNumber == "T-2" } ?? false)
        }
    }

    func testTasksWithoutJiraStatusAreDropped() {
        let tasks = [task(1, "s1", taskNumber: "T-1", jiraStatus: nil)]
        let board = buildBoard(tasks: tasks, worklogs: [], projectId: nil)
        XCTAssertEqual(board.totalCards, 0)
    }

    // MARK: - Project filter

    func testProjectFilterScopesCards() {
        let tasks = [
            task(1, "s1", taskNumber: "A-1", jiraStatus: "New", projectId: 1),
            task(2, "s2", taskNumber: "B-1", jiraStatus: "New", projectId: 2),
        ]
        let board = buildBoard(tasks: tasks, worklogs: [], projectId: 2)
        XCTAssertEqual(board.totalCards, 1)
        XCTAssertEqual(board.columns[.todo]?.map(\.taskNumber), ["B-1"])
    }

    func testNilProjectFilterIncludesAllProjects() {
        let tasks = [
            task(1, "s1", taskNumber: "A-1", jiraStatus: "New", projectId: 1),
            task(2, "s2", taskNumber: "B-1", jiraStatus: "New", projectId: 2),
        ]
        let board = buildBoard(tasks: tasks, worklogs: [], projectId: nil)
        XCTAssertEqual(board.totalCards, 2)
    }

    // MARK: - Logged minutes summed by taskNumber

    func testLoggedMinutesSummedByTaskNumber() {
        let tasks = [task(1, "s1", taskNumber: "T-1", jiraStatus: "New")]
        let worklogs = [
            worklog("T-1", minutes: 60),
            worklog("T-1", minutes: 30),
            worklog("T-2", minutes: 999), // different task, must not bleed in
            worklog(nil, minutes: 15), // no taskNumber, ignored
        ]
        let board = buildBoard(tasks: tasks, worklogs: worklogs, projectId: nil)
        XCTAssertEqual(board.columns[.todo]?.first?.loggedMinutes, 90)
    }

    func testLoggedMinutesDefaultsToZeroWhenNoMatchingWorklogs() {
        let tasks = [task(1, "s1", taskNumber: "T-1", jiraStatus: "New")]
        let board = buildBoard(tasks: tasks, worklogs: [worklog("OTHER", minutes: 60)], projectId: nil)
        XCTAssertEqual(board.columns[.todo]?.first?.loggedMinutes, 0)
    }

    // MARK: - Natural-numeric sort

    func testNaturalNumericSortWithinColumn() {
        let tasks = [
            task(1, "s1", taskNumber: "PROJ-10", jiraStatus: "New"),
            task(2, "s2", taskNumber: "PROJ-2", jiraStatus: "New"),
            task(3, "s3", taskNumber: "PROJ-1", jiraStatus: "New"),
        ]
        let board = buildBoard(tasks: tasks, worklogs: [], projectId: nil)
        // Natural order: PROJ-1, PROJ-2, PROJ-10 — not lexicographic
        // ("PROJ-1" < "PROJ-10" < "PROJ-2").
        XCTAssertEqual(board.columns[.todo]?.map(\.taskNumber), ["PROJ-1", "PROJ-2", "PROJ-10"])
    }

    func testNaturalSortAcrossColumnsIsIndependent() {
        let tasks = [
            task(1, "s1", taskNumber: "T-20", jiraStatus: "New"), // todo
            task(2, "s2", taskNumber: "T-3", jiraStatus: "New"), // todo
            task(3, "s3", taskNumber: "T-100", jiraStatus: "In Progress"), // doing
            task(4, "s4", taskNumber: "T-9", jiraStatus: "In Progress"), // doing
        ]
        let board = buildBoard(tasks: tasks, worklogs: [], projectId: nil)
        XCTAssertEqual(board.columns[.todo]?.map(\.taskNumber), ["T-3", "T-20"])
        XCTAssertEqual(board.columns[.doing]?.map(\.taskNumber), ["T-9", "T-100"])
    }

    // MARK: - Done column never rendered

    func testDoneColumnNotInVisibleColumns() {
        XCTAssertFalse(visibleBoardColumns.contains(.done))
        XCTAssertEqual(visibleBoardColumns, [.todo, .doing, .to_accept])
    }

    func testUnknownStatusLandsInDoingColumn() {
        let tasks = [task(1, "s1", taskNumber: "T-1", jiraStatus: "Blocked")]
        let board = buildBoard(tasks: tasks, worklogs: [], projectId: nil)
        XCTAssertEqual(board.columns[.doing]?.map(\.taskNumber), ["T-1"])
    }

    // MARK: - Card fields

    func testCardFieldsMapFromTaskRow() {
        let tasks = [
            task(
                1, "sync-abc", taskNumber: "T-1", title: "Fix the bug", jiraStatus: "New",
                estimatedMinutes: 120, projectColor: "#ff0000"
            ),
        ]
        let board = buildBoard(tasks: tasks, worklogs: [], projectId: nil)
        let card = try! XCTUnwrap(board.columns[.todo]?.first)
        XCTAssertEqual(card.id, "sync-abc")
        XCTAssertEqual(card.taskTitle, "Fix the bug")
        XCTAssertEqual(card.jiraStatus, "New")
        XCTAssertEqual(card.projectColor, "#ff0000")
        XCTAssertEqual(card.estimateMinutes, 120)
    }
}
