import XCTest
import ComposableArchitecture
@testable import WatchtowerCore

@MainActor
final class TaskFormFeatureTests: XCTestCase {
    // MARK: - Fixtures

    private let fixedNow = Date(timeIntervalSince1970: 1_780_000_000) // 2026-05-28T... UTC

    private func epic(epicId: Int = 1, projectId: Int = 10) -> EpicRow {
        EpicRow(epicId: epicId, name: "Epic", projectId: projectId, status: "open")
    }

    private func project(id: Int = 10) -> ProjectRow {
        ProjectRow(id: id, name: "Proj", color: "#111111", kind: "work", isBillable: true)
    }

    private func task(taskId: Int = 1, syncId: String = "task-1", epicId: Int = 1, status: String = "open") -> TaskRow {
        TaskRow(
            taskId: taskId, syncId: syncId, epicId: epicId, taskNumber: "42", taskTitle: "Do stuff",
            status: status, estimatedMinutes: nil, description: nil,
            projectId: 10, projectName: "Proj", projectColor: "#111111",
            projectKind: "work", isBillable: true, jiraStatus: nil
        )
    }

    /// Seeds the shared `billingDataset`/`billingLoadState` keys on a freshly
    /// constructed `State`, mirroring `WorklogFormFeatureTests`'s pattern —
    /// write through the `$`-projection before handing the state to a
    /// `TestStore`. Every `create` test needs an epic + project seeded so
    /// the epic->project chain resolves.
    private func seededState(
        mode: TaskFormFeature.State.Mode,
        tasks: [TaskRow] = [],
        loadState: BillingFeature.LoadState = .fresh
    ) -> TaskFormFeature.State {
        let state = TaskFormFeature.State(mode: mode)
        state.$dataset.withLock {
            $0 = BillingDataset(
                worklogs: [], contracts: [], daysOff: [],
                projects: [project()], tasks: tasks, epics: [epic()], fetchedAt: "seed"
            )
        }
        state.$loadState.withLock { $0 = loadState }
        return state
    }

    /// `BillingDataset.tasks` is a `let`, so an expected-state closure that
    /// wants "the same dataset but with a different tasks array" must
    /// rebuild the whole value — mirrors what `TaskFormFeature` itself does
    /// via the shared `BillingDataset.replacing(tasks:)`.
    private func datasetWith(_ tasks: [TaskRow]) -> BillingDataset {
        BillingDataset(
            worklogs: [], contracts: [], daysOff: [],
            projects: [project()], tasks: tasks, epics: [epic()], fetchedAt: "seed"
        )
    }

    private func expectedOptimisticRow(taskId: Int, syncId: String, title: String) -> TaskRow {
        TaskRow(
            taskId: taskId, syncId: syncId, epicId: 1, taskNumber: "",
            taskTitle: title, status: "open", estimatedMinutes: nil, description: nil,
            projectId: 10, projectName: "Proj", projectColor: "#111111",
            projectKind: "work", isBillable: true, jiraStatus: nil
        )
    }

    // MARK: - Tests

    func testCreateOptimisticInsertThenIdSwapOnConfirm() async {
        let initial = seededState(mode: .create(epicId: 1))
        let inserted = LockIsolated<TaskInsertPayload?>(nil)

        let store = TestStore(initialState: initial) { TaskFormFeature() } withDependencies: {
            $0.uuid = .incrementing
            $0.date.now = fixedNow
            $0.billingWriteClient.insertTask = { payload in
                inserted.setValue(payload)
                return 42
            }
        }

        let expectedSyncId = UUID(0).uuidString
        let placeholderRow = expectedOptimisticRow(taskId: 0, syncId: expectedSyncId, title: "New Task")
        let confirmedRow = expectedOptimisticRow(taskId: 42, syncId: expectedSyncId, title: "New Task")

        await store.send(.binding(.set(\.titleText, "New Task"))) {
            $0.titleText = "New Task"
        }

        await store.send(.saveTapped) {
            $0.$dataset.withLock { $0 = self.datasetWith([placeholderRow]) }
            $0.isSaving = true
            $0.errorMessage = nil
        }

        await store.receive(\.writeFinished) {
            // The real id swap happens inside the same effect that resolved
            // insertTask, before writeFinished is sent — TCA surfaces the
            // pending shared-state change at this checkpoint.
            $0.$dataset.withLock { $0 = self.datasetWith([confirmedRow]) }
            $0.isSaving = false
        }
        await store.receive(\.delegate)

        XCTAssertEqual(inserted.value?.syncId, expectedSyncId)
        XCTAssertEqual(inserted.value?.epicId, 1)
        XCTAssertEqual(inserted.value?.title, "New Task")
    }

    func testCreateRollbackOnWriteError() async {
        let initial = seededState(mode: .create(epicId: 1))

        struct Boom: Error {}
        let store = TestStore(initialState: initial) { TaskFormFeature() } withDependencies: {
            $0.uuid = .incrementing
            $0.date.now = fixedNow
            $0.billingWriteClient.insertTask = { _ in throw Boom() }
        }

        let expectedSyncId = UUID(0).uuidString
        let placeholderRow = expectedOptimisticRow(taskId: 0, syncId: expectedSyncId, title: "New Task")

        await store.send(.binding(.set(\.titleText, "New Task"))) {
            $0.titleText = "New Task"
        }

        await store.send(.saveTapped) {
            $0.$dataset.withLock { $0 = self.datasetWith([placeholderRow]) }
            $0.isSaving = true
            $0.errorMessage = nil
        }

        await store.receive(\.writeFinished) {
            $0.$dataset.withLock { $0 = self.datasetWith([]) }
            $0.isSaving = false
            $0.errorMessage = "Save failed. Please try again."
        }
    }

    func testEditOfDoneTaskBlockedNoWrite() async {
        let doneRow = task(status: "done")
        let initial = seededState(mode: .edit(doneRow), tasks: [doneRow])

        let store = TestStore(initialState: initial) { TaskFormFeature() } withDependencies: {
            $0.uuid = .incrementing
            $0.date.now = fixedNow
            // Intentionally NOT overriding updateTask: if it were called,
            // the unimplemented @DependencyClient closure would XCTFail.
        }

        await store.send(.saveTapped) {
            $0.errorMessage = "Task is closed (Done)"
        }
        // No .writeFinished / .delegate expected — nothing else to receive,
        // and no $dataset patch either.
    }

    func testDeleteOfDoneTaskBlockedNoWrite() async {
        let doneRow = task(status: "done")
        let initial = seededState(mode: .edit(doneRow), tasks: [doneRow])

        let store = TestStore(initialState: initial) { TaskFormFeature() } withDependencies: {
            $0.uuid = .incrementing
            $0.date.now = fixedNow
            // Intentionally NOT overriding deleteTask.
        }

        await store.send(.deleteTapped) {
            $0.errorMessage = "Task is closed (Done)"
        }
    }

    func testCreateWithUnresolvableEpicShowsProjectNotFound() async {
        let initial = seededState(mode: .create(epicId: 999))

        let store = TestStore(initialState: initial) { TaskFormFeature() } withDependencies: {
            $0.uuid = .incrementing
            $0.date.now = fixedNow
            // Intentionally NOT overriding insertTask.
        }

        await store.send(.binding(.set(\.titleText, "New Task"))) {
            $0.titleText = "New Task"
        }
        await store.send(.saveTapped) {
            $0.errorMessage = "Project not found"
        }
    }

    func testNotEditableWhileOfflineShowsErrorNoWrite() async {
        let initial = seededState(mode: .create(epicId: 1), loadState: .cached)

        let store = TestStore(initialState: initial) { TaskFormFeature() } withDependencies: {
            $0.uuid = .incrementing
            $0.date.now = fixedNow
        }

        await store.send(.binding(.set(\.titleText, "New Task"))) {
            $0.titleText = "New Task"
        }
        await store.send(.saveTapped) {
            $0.errorMessage = "Not editable while offline"
        }
    }
}
