import XCTest
import ComposableArchitecture
@testable import WatchtowerCore

@MainActor
final class RecordsFeatureTests: XCTestCase {
    func testOnAppearSeedsMonthsUTC() async {
        let store = TestStore(initialState: RecordsFeature.State()) { RecordsFeature() } withDependencies: {
            $0.date.now = Date(timeIntervalSince1970: 1_780_000_000) // 2026-05 UTC
        }
        await store.send(.onAppear) { $0.worklogMonth = "2026-05"; $0.gridMonth = "2026-05"; $0.timeOffFocus = "2026-05" }
    }
    func testSteppingAndToggles() async {
        let store = TestStore(initialState: RecordsFeature.State(worklogMonth: "2026-06", gridMonth: "2026-06", timeOffFocus: "2026-06")) {
            RecordsFeature()
        }
        await store.send(.sectionChanged(.grid)) { $0.section = .grid }
        await store.send(.worklogMonthStepped(-1)) { $0.worklogMonth = "2026-05" }
        await store.send(.gridProjectToggled(3)) { $0.gridProjectIds = [3] }
        await store.send(.gridProjectToggled(3)) { $0.gridProjectIds = [] }
        await store.send(.taskQueryChanged("abc")) { $0.taskQuery = "abc" }
        await store.send(.boardProjectChanged(9)) { $0.boardProjectId = 9 }
    }

    // MARK: - Fixtures (Task 12)

    private let fixedNow = Date(timeIntervalSince1970: 1_780_000_000) // 2026-05 UTC

    private func task(taskId: Int = 1, syncId: String = "task-1", projectId: Int = 10) -> TaskRow {
        TaskRow(
            taskId: taskId, syncId: syncId, epicId: 1, taskNumber: "42", taskTitle: "Do stuff",
            status: "open", estimatedMinutes: nil, description: nil,
            projectId: projectId, projectName: "Proj", projectColor: "#111111",
            projectKind: "work", isBillable: true, jiraStatus: nil
        )
    }

    private func worklog(syncId: String = "wl-1", workDate: String = "2026-07-01", projectId: Int = 10) -> WorklogRow {
        WorklogRow(
            syncId: syncId, workDate: workDate, minutes: 60, reportedMinutes: nil,
            effectiveMinutes: 60, earnedAmount: 500, description: nil,
            projectId: projectId, projectName: "Proj", projectColor: "#111111",
            projectKind: "work", isBillable: true, taskNumber: "42", taskTitle: "Do stuff", source: "manual"
        )
    }

    private func contract(projectId: Int = 10) -> ContractRow {
        ContractRow(
            syncId: "c1", projectId: projectId, effectiveFrom: "2020-01-01", endDate: nil,
            rateType: "hourly", rateAmount: 500, hoursPerDay: 8, mdLimit: nil, contractGroupId: nil
        )
    }

    private func dataset(daysOff: [DayOffRow] = [], tasks: [TaskRow] = []) -> BillingDataset {
        BillingDataset(
            worklogs: [], contracts: [contract()], daysOff: daysOff,
            projects: [], tasks: tasks, epics: [], fetchedAt: "seed"
        )
    }

    /// Seeds the shared `billingDataset`/`billingLoadState` keys, mirroring
    /// the Task 8/10 pattern of writing through the `$`-projection before
    /// the value is handed to a `TestStore`.
    private func seededState(
        daysOff: [DayOffRow] = [],
        tasks: [TaskRow] = [],
        loadState: BillingFeature.LoadState = .fresh
    ) -> RecordsFeature.State {
        let state = RecordsFeature.State()
        state.$dataset.withLock { $0 = dataset(daysOff: daysOff, tasks: tasks) }
        state.$loadState.withLock { $0 = loadState }
        return state
    }

    // MARK: - Presentation: worklog form

    func testAddWorklogTappedPopulatesFormThenDismissClears() async {
        let t = task()
        let initial = seededState(tasks: [t])
        let store = TestStore(initialState: initial) { RecordsFeature() } withDependencies: {
            $0.date.now = fixedNow
        }
        // `WorklogFormFeature.State`'s `.create` mode mints its `id` from a
        // raw `UUID()` (not the controlled `\.uuid` dependency), so two
        // independently constructed `.create` states never compare equal —
        // assert on `.mode` (which IS Equatable and id-free) instead of
        // diffing the whole presented state.
        store.exhaustivity = .off(showSkippedAssertions: false)

        await store.send(.addWorklogTapped(date: "2026-07-12", task: t))
        XCTAssertEqual(store.state.worklogForm?.mode, .create(task: t, date: "2026-07-12"))

        await store.send(.worklogForm(.presented(.delegate(.dismissed))))
        XCTAssertNil(store.state.worklogForm)
    }

    func testAddWorklogTappedWithNoTaskIsNoOp() async {
        let initial = seededState()
        let store = TestStore(initialState: initial) { RecordsFeature() } withDependencies: {
            $0.date.now = fixedNow
        }
        await store.send(.addWorklogTapped(date: "2026-07-12", task: nil))
    }

    func testWorklogRowTappedPopulatesEditForm() async {
        let row = worklog()
        let initial = seededState()
        let store = TestStore(initialState: initial) { RecordsFeature() } withDependencies: {
            $0.date.now = fixedNow
        }
        store.exhaustivity = .off(showSkippedAssertions: false)

        await store.send(.worklogRowTapped(row))
        XCTAssertEqual(store.state.worklogForm?.mode, .edit(row))
    }

    func testGridCellTappedResolvesTaskForCreateAndNoOpsWhenTaskMissing() async {
        let t = task(taskId: 5)
        let initial = seededState(tasks: [t])
        let store = TestStore(initialState: initial) { RecordsFeature() } withDependencies: {
            $0.date.now = fixedNow
        }
        store.exhaustivity = .off(showSkippedAssertions: false)

        // Unknown taskId -> no-op, no form presented.
        await store.send(.gridCellTapped(taskId: 999, date: "2026-07-03", existing: nil))
        XCTAssertNil(store.state.worklogForm)

        // Known taskId, no existing worklog -> create mode with the resolved task.
        await store.send(.gridCellTapped(taskId: 5, date: "2026-07-03", existing: nil))
        XCTAssertEqual(store.state.worklogForm?.mode, .create(task: t, date: "2026-07-03"))
    }

    func testGridCellTappedWithExistingRowOpensEditForm() async {
        let row = worklog()
        let initial = seededState()
        let store = TestStore(initialState: initial) { RecordsFeature() } withDependencies: {
            $0.date.now = fixedNow
        }
        store.exhaustivity = .off(showSkippedAssertions: false)

        await store.send(.gridCellTapped(taskId: 1, date: row.workDate, existing: row))
        XCTAssertEqual(store.state.worklogForm?.mode, .edit(row))
    }

    // MARK: - Presentation: task form

    func testAddTaskTappedPopulatesFormThenDismissClears() async {
        let initial = seededState()
        let store = TestStore(initialState: initial) { RecordsFeature() } withDependencies: {
            $0.date.now = fixedNow
        }
        store.exhaustivity = .off(showSkippedAssertions: false)

        await store.send(.addTaskTapped(epicId: 7))
        XCTAssertEqual(store.state.taskForm?.mode, .create(epicId: 7))

        await store.send(.taskForm(.presented(.delegate(.dismissed))))
        XCTAssertNil(store.state.taskForm)
    }

    func testTaskRowTappedPopulatesEditForm() async {
        let row = task()
        let initial = seededState()
        let store = TestStore(initialState: initial) { RecordsFeature() } withDependencies: {
            $0.date.now = fixedNow
        }
        store.exhaustivity = .off(showSkippedAssertions: false)

        await store.send(.taskRowTapped(row))
        XCTAssertEqual(store.state.taskForm?.mode, .edit(row))
    }

    // MARK: - Day-off: 3-tier `sync_id` resolution

    func testSetDayOffReusesTombstonedSyncId() async {
        let upserted = LockIsolated<DayOffUpsertPayload?>(nil)
        let initial = seededState(daysOff: [])
        let store = TestStore(initialState: initial) { RecordsFeature() } withDependencies: {
            $0.date.now = fixedNow
            $0.uuid = .incrementing
            $0.billingWriteClient.findDayOffSyncId = { date in
                XCTAssertEqual(date, "2026-07-15")
                return "old-sync-id"
            }
            $0.billingWriteClient.upsertDayOff = { payload in upserted.setValue(payload) }
        }
        store.exhaustivity = .off(showSkippedAssertions: false)

        await store.send(.setDayOff(date: "2026-07-15", kind: "vacation"))
        await store.receive(\.setDayOffResolved) {
            $0.$dataset.withLock {
                $0 = self.dataset(daysOff: [DayOffRow(date: "2026-07-15", kind: "vacation", syncId: "old-sync-id")])
            }
        }
        await store.finish()

        XCTAssertEqual(upserted.value?.syncId, "old-sync-id")
        XCTAssertEqual(upserted.value?.date, "2026-07-15")
        XCTAssertEqual(upserted.value?.kind, "vacation")
    }

    func testSetDayOffMintsFreshIdWhenNoRowExistsAtAll() async {
        let initial = seededState(daysOff: [])
        let store = TestStore(initialState: initial) { RecordsFeature() } withDependencies: {
            $0.date.now = fixedNow
            $0.uuid = .incrementing
            $0.billingWriteClient.findDayOffSyncId = { _ in nil }
            $0.billingWriteClient.upsertDayOff = { _ in }
        }
        store.exhaustivity = .off(showSkippedAssertions: false)

        let mintedId = UUID(0).uuidString // first (only) uuid() call along this path

        await store.send(.setDayOff(date: "2026-08-01", kind: "sick"))
        await store.receive(\.setDayOffResolved) {
            $0.$dataset.withLock {
                $0 = self.dataset(daysOff: [DayOffRow(date: "2026-08-01", kind: "sick", syncId: mintedId)])
            }
        }
        await store.finish()
    }

    func testSetDayOffReusesVisibleRowWithoutCallingLookup() async {
        let existing = DayOffRow(date: "2026-07-20", kind: "sick", syncId: "visible-1")
        let initial = seededState(daysOff: [existing])
        let store = TestStore(initialState: initial) { RecordsFeature() } withDependencies: {
            $0.date.now = fixedNow
            $0.uuid = .incrementing
            $0.billingWriteClient.findDayOffSyncId = { _ in
                XCTFail("tier 1 (visible cached row) must not call findDayOffSyncId")
                return nil
            }
            $0.billingWriteClient.upsertDayOff = { _ in }
        }
        store.exhaustivity = .off(showSkippedAssertions: false)

        await store.send(.setDayOff(date: "2026-07-20", kind: "vacation")) {
            $0.$dataset.withLock {
                $0 = self.dataset(daysOff: [DayOffRow(date: "2026-07-20", kind: "vacation", syncId: "visible-1")])
            }
        }
        await store.finish()
    }

    func testClearDayOffOptimisticallyRemovesAndRollsBackOnFailure() async {
        struct Boom: Error {}
        let existing = DayOffRow(date: "2026-07-25", kind: "vacation", syncId: "clear-1")
        let initial = seededState(daysOff: [existing])
        let store = TestStore(initialState: initial) { RecordsFeature() } withDependencies: {
            $0.date.now = fixedNow
            $0.billingWriteClient.deleteDayOff = { date, _ in
                XCTAssertEqual(date, "2026-07-25")
                throw Boom()
            }
        }
        store.exhaustivity = .off(showSkippedAssertions: false)

        await store.send(.clearDayOff(date: "2026-07-25")) {
            $0.$dataset.withLock { $0 = self.dataset(daysOff: []) }
        }
        await store.finish()

        XCTAssertEqual(store.state.dataset, self.dataset(daysOff: [existing]))
    }

    func testNotEditableNoOpsForDayOffMutations() async {
        let existing = DayOffRow(date: "2026-07-30", kind: "vacation", syncId: "cached-1")
        let initial = seededState(daysOff: [existing], loadState: .cached)
        let store = TestStore(initialState: initial) { RecordsFeature() } withDependencies: {
            $0.date.now = fixedNow
            $0.billingWriteClient.findDayOffSyncId = { _ in
                XCTFail("must not write while not editable")
                return nil
            }
            $0.billingWriteClient.upsertDayOff = { _ in XCTFail("must not write while not editable") }
            $0.billingWriteClient.deleteDayOff = { _, _ in XCTFail("must not write while not editable") }
        }
        store.exhaustivity = .off(showSkippedAssertions: false)

        await store.send(.setDayOff(date: "2026-07-30", kind: "sick"))
        await store.send(.clearDayOff(date: "2026-07-30"))
    }
}
