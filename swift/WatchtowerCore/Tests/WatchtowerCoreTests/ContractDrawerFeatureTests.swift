import XCTest
import ComposableArchitecture
@testable import WatchtowerCore

@MainActor
final class ContractDrawerFeatureTests: XCTestCase {
    // MARK: - Fixtures

    private let fixedNow = Date(timeIntervalSince1970: 1_780_000_000) // 2026-05-28T... UTC

    private func contractRow(
        syncId: String, projectId: Int, from: String, end: String? = nil,
        rateType: String = "hourly", rateAmount: Double = 500, hoursPerDay: Double = 8,
        mdLimit: Double? = nil, groupId: String? = nil
    ) -> ContractRow {
        ContractRow(
            syncId: syncId, projectId: projectId, effectiveFrom: from, endDate: end,
            rateType: rateType, rateAmount: rateAmount, hoursPerDay: hoursPerDay,
            mdLimit: mdLimit, contractGroupId: groupId
        )
    }

    private func worklogRow(
        syncId: String, projectId: Int, workDate: String, minutes: Double,
        effectiveMinutes: Double? = nil, earnedAmount: Double? = nil, projectName: String? = nil
    ) -> WorklogRow {
        WorklogRow(
            syncId: syncId, workDate: workDate, minutes: minutes, reportedMinutes: nil,
            effectiveMinutes: effectiveMinutes ?? minutes, earnedAmount: earnedAmount,
            description: nil, projectId: projectId, projectName: projectName ?? "P\(projectId)",
            projectColor: nil, projectKind: "work", isBillable: true,
            taskNumber: nil, taskTitle: nil, source: "manual"
        )
    }

    private func datasetWith(contracts: [ContractRow], worklogs: [WorklogRow]) -> BillingDataset {
        BillingDataset(worklogs: worklogs, contracts: contracts, daysOff: [], projects: [], tasks: [], epics: [], fetchedAt: "seed")
    }

    private func seededState(
        mode: ContractDrawerFeature.State.Mode,
        contracts: [ContractRow],
        worklogs: [WorklogRow] = [],
        loadState: BillingFeature.LoadState = .fresh,
        effectiveFromText: String? = nil,
        endDateText: String? = nil,
        rateType: String? = nil,
        rateAmountText: String? = nil,
        hoursPerDayText: String? = nil,
        mdLimitText: String? = nil,
        sharedProjectIds: Set<Int> = []
    ) -> ContractDrawerFeature.State {
        let state = ContractDrawerFeature.State(
            mode: mode, effectiveFromText: effectiveFromText, endDateText: endDateText,
            rateType: rateType, rateAmountText: rateAmountText, hoursPerDayText: hoursPerDayText,
            mdLimitText: mdLimitText, sharedProjectIds: sharedProjectIds
        )
        state.$dataset.withLock { $0 = datasetWith(contracts: contracts, worklogs: worklogs) }
        state.$loadState.withLock { $0 = loadState }
        return state
    }

    // MARK: - 1. Solo create closes a prior open-ended contract + rebills

    func testSoloCreateClosesPriorAndRebills() async {
        let prior = contractRow(syncId: "c-prior", projectId: 10, from: "2024-01-01", rateAmount: 400)
        // Dated AFTER the new contract's effectiveFrom, so it flips from the
        // (soon-to-be-closed) prior's rate to the new contract's rate.
        let worklog = worklogRow(syncId: "w1", projectId: 10, workDate: "2025-07-01", minutes: 120, earnedAmount: 800)

        let initial = seededState(
            mode: .create(projectId: 10), contracts: [prior], worklogs: [worklog],
            effectiveFromText: "2025-06-01", rateAmountText: "600", hoursPerDayText: "8"
        )

        let endDateUpdated = LockIsolated<(String, ContractEndDatePayload)?>(nil)
        let inserted = LockIsolated<[ContractInsertPayload]?>(nil)

        let store = TestStore(initialState: initial) { ContractDrawerFeature() } withDependencies: {
            $0.uuid = .incrementing
            $0.date.now = fixedNow
            $0.billingWriteClient.updateContractEndDate = { syncId, payload in endDateUpdated.setValue((syncId, payload)) }
            $0.billingWriteClient.insertContracts = { payloads in inserted.setValue(payloads) }
        }

        let expectedSyncId = UUID(0).uuidString
        let closedPrior = contractRow(syncId: "c-prior", projectId: 10, from: "2024-01-01", end: "2025-05-31", rateAmount: 400)
        let newContract = contractRow(syncId: expectedSyncId, projectId: 10, from: "2025-06-01", rateAmount: 600, hoursPerDay: 8)
        let rebilledWorklog = worklogRow(syncId: "w1", projectId: 10, workDate: "2025-07-01", minutes: 120, earnedAmount: 1200)

        await store.send(.saveTapped) {
            $0.$dataset.withLock { $0 = self.datasetWith(contracts: [closedPrior, newContract], worklogs: [rebilledWorklog]) }
            $0.isSaving = true
            $0.errorMessage = nil
        }
        await store.receive(\.writeFinished) { $0.isSaving = false }
        await store.receive(\.delegate)

        XCTAssertEqual(endDateUpdated.value?.0, "c-prior")
        XCTAssertEqual(endDateUpdated.value?.1.endDate, "2025-05-31")
        XCTAssertEqual(inserted.value?.count, 1)
        XCTAssertEqual(inserted.value?.first?.syncId, expectedSyncId)
        XCTAssertEqual(inserted.value?.first?.contractGroupId, nil)
        XCTAssertEqual(inserted.value?.first?.rateAmount, 600)
    }

    // MARK: - 2. Solo create with an overlapping window aborts, no write, no patch

    func testSoloCreateOverlapAbortsNoWrite() async {
        let existing = contractRow(syncId: "c-existing", projectId: 10, from: "2025-01-01", end: "2025-12-31")
        let initial = seededState(
            mode: .create(projectId: 10), contracts: [existing],
            effectiveFromText: "2025-06-01", rateAmountText: "600", hoursPerDayText: "8"
        )

        let store = TestStore(initialState: initial) { ContractDrawerFeature() } withDependencies: {
            $0.uuid = .incrementing
            $0.date.now = fixedNow
            // Intentionally NOT overriding insertContracts/updateContractEndDate:
            // if either were called, the unimplemented @DependencyClient closure
            // would XCTFail — proving no write effect fires.
        }

        await store.send(.saveTapped) {
            $0.errorMessage = "Rate overlaps with an existing contract from 2025-01-01 to 2025-12-31"
        }
        // No .writeFinished / .delegate — no optimistic patch, no write.
    }

    // MARK: - 3. Group create where ONE member conflicts aborts the whole group

    func testGroupCreateOneConflictAbortsWholeGroup() async {
        let conflict20 = contractRow(syncId: "c20", projectId: 20, from: "2025-01-01", end: "2025-12-31")
        let initial = seededState(
            mode: .create(projectId: 10), contracts: [conflict20],
            effectiveFromText: "2025-06-01", rateAmountText: "300", hoursPerDayText: "8",
            sharedProjectIds: [20, 30]
        )

        let store = TestStore(initialState: initial) { ContractDrawerFeature() } withDependencies: {
            $0.uuid = .incrementing
            $0.date.now = fixedNow
            // Not overriding insertContracts/updateContractEndDate — a call
            // would XCTFail, proving nothing was written for ANY member.
        }

        await store.send(.saveTapped) {
            $0.errorMessage = "Project #20: Rate overlaps with an existing contract from 2025-01-01 to 2025-12-31"
        }
        // No dataset patch expected either — TestStore's exhaustive default
        // would fail if $dataset had actually changed.
    }

    // MARK: - 4. Group create all-clear inserts all rows with the same contractGroupId, rebills all targets

    func testGroupCreateAllClearInsertsAllAndRebills() async {
        let w10 = worklogRow(syncId: "w10", projectId: 10, workDate: "2025-07-01", minutes: 60)
        let w20 = worklogRow(syncId: "w20", projectId: 20, workDate: "2025-07-01", minutes: 60)
        let w30 = worklogRow(syncId: "w30", projectId: 30, workDate: "2025-07-01", minutes: 60)

        let initial = seededState(
            mode: .create(projectId: 10), contracts: [], worklogs: [w10, w20, w30],
            effectiveFromText: "2025-06-01", rateAmountText: "300", hoursPerDayText: "8",
            sharedProjectIds: [20, 30]
        )

        let inserted = LockIsolated<[ContractInsertPayload]?>(nil)
        let store = TestStore(initialState: initial) { ContractDrawerFeature() } withDependencies: {
            $0.uuid = .incrementing
            $0.date.now = fixedNow
            $0.billingWriteClient.insertContracts = { payloads in inserted.setValue(payloads) }
        }

        let groupId = UUID(3).uuidString // 3 member syncIds minted first (indices 0,1,2), then the group id
        let c10 = contractRow(syncId: UUID(0).uuidString, projectId: 10, from: "2025-06-01", rateAmount: 300, groupId: groupId)
        let c20 = contractRow(syncId: UUID(1).uuidString, projectId: 20, from: "2025-06-01", rateAmount: 300, groupId: groupId)
        let c30 = contractRow(syncId: UUID(2).uuidString, projectId: 30, from: "2025-06-01", rateAmount: 300, groupId: groupId)
        let rebilled10 = worklogRow(syncId: "w10", projectId: 10, workDate: "2025-07-01", minutes: 60, earnedAmount: 300)
        let rebilled20 = worklogRow(syncId: "w20", projectId: 20, workDate: "2025-07-01", minutes: 60, earnedAmount: 300)
        let rebilled30 = worklogRow(syncId: "w30", projectId: 30, workDate: "2025-07-01", minutes: 60, earnedAmount: 300)

        await store.send(.saveTapped) {
            $0.$dataset.withLock { $0 = self.datasetWith(contracts: [c10, c20, c30], worklogs: [rebilled10, rebilled20, rebilled30]) }
            $0.isSaving = true
            $0.errorMessage = nil
        }
        await store.receive(\.writeFinished) { $0.isSaving = false }
        await store.receive(\.delegate)

        XCTAssertEqual(inserted.value?.count, 3)
        XCTAssertEqual(Set(inserted.value?.map(\.contractGroupId) ?? []), [groupId])
        XCTAssertEqual(inserted.value?.map(\.projectId), [10, 20, 30])
    }

    // MARK: - 5. Delete solo soft-removes + rebills

    func testDeleteSoloSoftRemovesAndRebills() async {
        let existing = contractRow(syncId: "c1", projectId: 10, from: "2025-01-01", rateAmount: 500)
        let worklog = worklogRow(syncId: "w1", projectId: 10, workDate: "2025-07-01", minutes: 60, earnedAmount: 500)
        let initial = seededState(mode: .edit(existing), contracts: [existing], worklogs: [worklog])

        let deleted = LockIsolated<(String, SoftDeletePayload)?>(nil)
        let store = TestStore(initialState: initial) { ContractDrawerFeature() } withDependencies: {
            $0.uuid = .incrementing
            $0.date.now = fixedNow
            $0.billingWriteClient.deleteContract = { syncId, payload in deleted.setValue((syncId, payload)) }
        }

        // No contract left after removal -> the worklog can no longer be billed.
        let rebilledWorklog = worklogRow(syncId: "w1", projectId: 10, workDate: "2025-07-01", minutes: 60, earnedAmount: nil)

        await store.send(.deleteTapped) {
            $0.$dataset.withLock { $0 = self.datasetWith(contracts: [], worklogs: [rebilledWorklog]) }
            $0.isSaving = true
            $0.errorMessage = nil
        }
        await store.receive(\.writeFinished) { $0.isSaving = false }
        await store.receive(\.delegate)

        XCTAssertEqual(deleted.value?.0, "c1")
    }

    // MARK: - 6. Delete group calls deleteContractGroup + rebills every former member

    func testDeleteGroupCallsDeleteContractGroupAndRebillsAllMembers() async {
        let c10 = contractRow(syncId: "c10", projectId: 10, from: "2025-01-01", rateAmount: 500, groupId: "grp-1")
        let c20 = contractRow(syncId: "c20", projectId: 20, from: "2025-01-01", rateAmount: 500, groupId: "grp-1")
        let w10 = worklogRow(syncId: "w10", projectId: 10, workDate: "2025-07-01", minutes: 60, earnedAmount: 500)
        let w20 = worklogRow(syncId: "w20", projectId: 20, workDate: "2025-07-01", minutes: 60, earnedAmount: 500)

        let initial = seededState(mode: .edit(c10), contracts: [c10, c20], worklogs: [w10, w20])

        let deletedGroup = LockIsolated<(String, SoftDeletePayload)?>(nil)
        let store = TestStore(initialState: initial) { ContractDrawerFeature() } withDependencies: {
            $0.uuid = .incrementing
            $0.date.now = fixedNow
            $0.billingWriteClient.deleteContractGroup = { groupId, payload in deletedGroup.setValue((groupId, payload)) }
        }

        let rebilled10 = worklogRow(syncId: "w10", projectId: 10, workDate: "2025-07-01", minutes: 60, earnedAmount: nil)
        let rebilled20 = worklogRow(syncId: "w20", projectId: 20, workDate: "2025-07-01", minutes: 60, earnedAmount: nil)

        await store.send(.deleteTapped) {
            $0.$dataset.withLock { $0 = self.datasetWith(contracts: [], worklogs: [rebilled10, rebilled20]) }
            $0.isSaving = true
            $0.errorMessage = nil
        }
        await store.receive(\.writeFinished) { $0.isSaving = false }
        await store.receive(\.delegate)

        XCTAssertEqual(deletedGroup.value?.0, "grp-1")
    }

    // MARK: - 7. Not editable while cached -> no write

    func testNotEditableWhileCachedShowsErrorNoWrite() async {
        let existing = contractRow(syncId: "c1", projectId: 10, from: "2025-01-01", rateAmount: 500)
        let initial = seededState(
            mode: .create(projectId: 10), contracts: [existing], loadState: .cached,
            effectiveFromText: "2025-06-01", rateAmountText: "600", hoursPerDayText: "8"
        )

        let store = TestStore(initialState: initial) { ContractDrawerFeature() } withDependencies: {
            $0.uuid = .incrementing
            $0.date.now = fixedNow
        }

        await store.send(.saveTapped) {
            $0.errorMessage = "Not editable while offline"
        }
    }

    // MARK: - 8. Group update: dropping a member soft-deletes it, retained member is updated, both rebilled
    //
    // Resolves the reconciliation ambiguity flagged in the task brief: unlike
    // the TS hook (`projectIds.length > 0 ? projectIds : currentProjectIds`,
    // where an EMPTY array means "no membership change" because the real UI
    // never calls it with one), this port treats `sharedProjectIds` as always
    // being the full desired membership. An empty set on an edit of a grouped
    // contract means "drop every other member" — see the report for the full
    // writeup of why this is a safe, low-risk divergence.

    func testGroupUpdateDropsMemberAndRebillsBoth() async {
        let c10 = contractRow(syncId: "c10", projectId: 10, from: "2025-01-01", rateAmount: 500, groupId: "g1")
        let c20 = contractRow(syncId: "c20", projectId: 20, from: "2025-01-01", rateAmount: 500, groupId: "g1")
        let w10 = worklogRow(syncId: "w10", projectId: 10, workDate: "2025-07-01", minutes: 60, earnedAmount: 500)
        let w20 = worklogRow(syncId: "w20", projectId: 20, workDate: "2025-07-01", minutes: 60, earnedAmount: 500)

        let initial = seededState(
            mode: .edit(c10), contracts: [c10, c20], worklogs: [w10, w20],
            effectiveFromText: "2025-01-01", rateAmountText: "700", hoursPerDayText: "8",
            sharedProjectIds: [] // user removed project 20 from the share list
        )

        let deletedMember = LockIsolated<(String, SoftDeletePayload)?>(nil)
        let updated = LockIsolated<(String, ContractUpdatePayload)?>(nil)
        let store = TestStore(initialState: initial) { ContractDrawerFeature() } withDependencies: {
            $0.uuid = .incrementing
            $0.date.now = fixedNow
            $0.billingWriteClient.deleteContract = { syncId, payload in deletedMember.setValue((syncId, payload)) }
            $0.billingWriteClient.updateContract = { syncId, payload in updated.setValue((syncId, payload)) }
        }

        let updatedC10 = contractRow(syncId: "c10", projectId: 10, from: "2025-01-01", rateAmount: 700, groupId: "g1")
        let rebilled10 = worklogRow(syncId: "w10", projectId: 10, workDate: "2025-07-01", minutes: 60, earnedAmount: 700)
        let rebilled20 = worklogRow(syncId: "w20", projectId: 20, workDate: "2025-07-01", minutes: 60, earnedAmount: nil)

        await store.send(.saveTapped) {
            $0.$dataset.withLock { $0 = self.datasetWith(contracts: [updatedC10], worklogs: [rebilled10, rebilled20]) }
            $0.isSaving = true
            $0.errorMessage = nil
        }
        await store.receive(\.writeFinished) { $0.isSaving = false }
        await store.receive(\.delegate)

        XCTAssertEqual(deletedMember.value?.0, "c20")
        XCTAssertEqual(updated.value?.0, "c10")
        XCTAssertEqual(updated.value?.1.rateAmount, 700)
    }
}
