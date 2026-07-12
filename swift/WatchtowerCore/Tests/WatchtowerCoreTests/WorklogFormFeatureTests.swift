import XCTest
import ComposableArchitecture
@testable import WatchtowerCore

@MainActor
final class WorklogFormFeatureTests: XCTestCase {
    // MARK: - Fixtures

    private let fixedNow = Date(timeIntervalSince1970: 1_780_000_000) // 2026-05-28T... UTC

    private func task(projectId: Int = 10) -> TaskRow {
        TaskRow(
            taskId: 1, syncId: "task-1", epicId: 1, taskNumber: "42", taskTitle: "Do stuff",
            status: "open", estimatedMinutes: nil, description: nil,
            projectId: projectId, projectName: "Proj", projectColor: "#111111",
            projectKind: "work", isBillable: true, jiraStatus: nil
        )
    }

    private func contract(projectId: Int = 10) -> ContractRow {
        ContractRow(
            syncId: "c1", projectId: projectId, effectiveFrom: "2020-01-01", endDate: nil,
            rateType: "hourly", rateAmount: 500, hoursPerDay: 8, mdLimit: nil, contractGroupId: nil
        )
    }

    /// Seeds the shared `billingDataset`/`billingLoadState` keys on a freshly
    /// constructed `State`, mirroring the Task 8 pattern of writing through
    /// the `$`-projection before the value is handed to a `TestStore`.
    private func seededState(
        mode: WorklogFormFeature.State.Mode,
        worklogs: [WorklogRow] = [],
        loadState: BillingFeature.LoadState = .fresh
    ) -> WorklogFormFeature.State {
        let state = WorklogFormFeature.State(mode: mode)
        state.$dataset.withLock {
            $0 = BillingDataset(
                worklogs: worklogs, contracts: [contract()], daysOff: [],
                projects: [], tasks: [task()], epics: [], fetchedAt: "seed"
            )
        }
        state.$loadState.withLock { $0 = loadState }
        return state
    }

    /// `BillingDataset.worklogs` is a `let`, so an expected-state closure
    /// that wants "the same dataset but with a different worklogs array"
    /// must rebuild the whole value — mirrors what `WorklogFormFeature`
    /// itself does via the shared `BillingDataset.replacing(worklogs:)`.
    private func datasetWith(_ worklogs: [WorklogRow]) -> BillingDataset {
        BillingDataset(
            worklogs: worklogs, contracts: [contract()], daysOff: [],
            projects: [], tasks: [task()], epics: [], fetchedAt: "seed"
        )
    }

    private func expectedOptimisticRow(syncId: String, minutes: Double, description: String?) -> WorklogRow {
        WorklogRow(
            syncId: syncId, workDate: "2026-07-12", minutes: minutes, reportedMinutes: nil,
            effectiveMinutes: minutes, earnedAmount: (minutes * 500) / 60.0,
            description: description, projectId: 10, projectName: "Proj", projectColor: "#111111",
            projectKind: "work", isBillable: true, taskNumber: "42", taskTitle: "Do stuff", source: "manual"
        )
    }

    // MARK: - Tests

    func testCreateOptimisticallyInsertsThenConfirms() async {
        let initial = seededState(mode: .create(task: task(), date: "2026-07-12"))
        let inserted = LockIsolated<WorklogInsertPayload?>(nil)

        let store = TestStore(initialState: initial) { WorklogFormFeature() } withDependencies: {
            $0.uuid = .incrementing
            $0.date.now = fixedNow
            $0.billingWriteClient.insertWorklog = { payload in inserted.setValue(payload) }
        }

        let expectedSyncId = UUID(0).uuidString
        let expectedRow = expectedOptimisticRow(syncId: expectedSyncId, minutes: 90, description: nil)

        await store.send(.binding(.set(\.hoursText, "1:30"))) {
            $0.hoursText = "1:30"
        }

        await store.send(.saveTapped) {
            $0.$dataset.withLock { $0 = self.datasetWith([expectedRow]) }
            $0.isSaving = true
            $0.errorMessage = nil
        }

        await store.receive(\.writeFinished) {
            $0.isSaving = false
        }
        await store.receive(\.delegate)

        XCTAssertEqual(inserted.value?.syncId, expectedSyncId)
        XCTAssertEqual(inserted.value?.taskId, 1)
        XCTAssertEqual(inserted.value?.earnedAmount, 750.0)
    }

    func testCreateRollbackOnWriteError() async {
        let initial = seededState(mode: .create(task: task(), date: "2026-07-12"))

        struct Boom: Error {}
        let store = TestStore(initialState: initial) { WorklogFormFeature() } withDependencies: {
            $0.uuid = .incrementing
            $0.date.now = fixedNow
            $0.billingWriteClient.insertWorklog = { _ in throw Boom() }
        }

        let expectedSyncId = UUID(0).uuidString
        let expectedRow = expectedOptimisticRow(syncId: expectedSyncId, minutes: 60, description: nil)

        await store.send(.binding(.set(\.hoursText, "1:00"))) {
            $0.hoursText = "1:00"
        }

        await store.send(.saveTapped) {
            $0.$dataset.withLock { $0 = self.datasetWith([expectedRow]) }
            $0.isSaving = true
            $0.errorMessage = nil
        }

        await store.receive(\.writeFinished) {
            // Rollback happened inside the effect (via the captured Shared
            // box) before `writeFinished` was sent; TCA's shared-state
            // tracking surfaces that pending change at this checkpoint.
            $0.$dataset.withLock { $0 = self.datasetWith([]) }
            $0.isSaving = false
            $0.errorMessage = "Save failed. Please try again."
        }
    }

    func testInvalidDurationShowsErrorNoWrite() async {
        let initial = seededState(mode: .create(task: task(), date: "2026-07-12"))

        let store = TestStore(initialState: initial) { WorklogFormFeature() } withDependencies: {
            $0.uuid = .incrementing
            $0.date.now = fixedNow
            // Intentionally NOT overriding insertWorklog: if it were called,
            // the unimplemented @DependencyClient closure would XCTFail.
        }

        await store.send(.binding(.set(\.hoursText, "abc"))) {
            $0.hoursText = "abc"
        }
        await store.send(.saveTapped) {
            $0.errorMessage = "Enter a valid duration"
        }
        // No .writeFinished / .delegate expected — nothing else to receive.
    }

    func testNotEditableWhileOfflineShowsErrorNoWrite() async {
        let initial = seededState(mode: .create(task: task(), date: "2026-07-12"), loadState: .cached)

        let store = TestStore(initialState: initial) { WorklogFormFeature() } withDependencies: {
            $0.uuid = .incrementing
            $0.date.now = fixedNow
        }

        await store.send(.binding(.set(\.hoursText, "1:00"))) {
            $0.hoursText = "1:00"
        }
        await store.send(.saveTapped) {
            $0.errorMessage = "Not editable while offline"
        }
    }

    func testDeleteSoftRemoves() async {
        let existing = expectedOptimisticRow(syncId: "existing-1", minutes: 45, description: "note")
        let editRow = WorklogRow(
            syncId: "existing-1", workDate: "2026-07-01", minutes: 45, reportedMinutes: nil,
            effectiveMinutes: 45, earnedAmount: 375.0, description: "note",
            projectId: 10, projectName: "Proj", projectColor: "#111111", projectKind: "work",
            isBillable: true, taskNumber: "42", taskTitle: "Do stuff", source: "manual"
        )
        let initial = seededState(mode: .edit(editRow), worklogs: [existing])

        let deleted = LockIsolated<SoftDeletePayload?>(nil)
        let store = TestStore(initialState: initial) { WorklogFormFeature() } withDependencies: {
            $0.uuid = .incrementing
            $0.date.now = fixedNow
            $0.billingWriteClient.softDeleteWorklog = { syncId, payload in
                XCTAssertEqual(syncId, "existing-1")
                deleted.setValue(payload)
            }
        }

        await store.send(.deleteTapped) {
            $0.$dataset.withLock { $0 = self.datasetWith([]) }
            $0.isSaving = true
            $0.errorMessage = nil
        }

        await store.receive(\.writeFinished) {
            $0.isSaving = false
        }
        await store.receive(\.delegate)

        XCTAssertNotNil(deleted.value)
    }
}
