import XCTest
import ComposableArchitecture
@testable import WatchtowerCore

@MainActor
final class ProjectDetailFeatureTests: XCTestCase {
    // MARK: - Fixtures

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

    private func datasetWith(contracts: [ContractRow]) -> BillingDataset {
        BillingDataset(worklogs: [], contracts: contracts, daysOff: [], projects: [], tasks: [], epics: [], fetchedAt: "seed")
    }

    private func seededState(
        projectId: Int = 10,
        initialMonth: String = "2026-06",
        contracts: [ContractRow] = [],
        loadState: BillingFeature.LoadState = .fresh
    ) -> ProjectDetailFeature.State {
        let state = ProjectDetailFeature.State(projectId: projectId, initialMonth: initialMonth)
        state.$dataset.withLock { $0 = datasetWith(contracts: contracts) }
        state.$loadState.withLock { $0 = loadState }
        return state
    }

    // MARK: - 1. monthStepped advances/retreats via the UTC addMonths helper

    func testMonthSteppedAdvancesAcrossYearBoundary() async {
        let initial = seededState(initialMonth: "2025-12")
        let store = TestStore(initialState: initial) { ProjectDetailFeature() }

        await store.send(.monthStepped(1)) {
            $0.month = "2026-01"
        }
    }

    func testMonthSteppedRetreatsAcrossYearBoundary() async {
        let initial = seededState(initialMonth: "2026-01")
        let store = TestStore(initialState: initial) { ProjectDetailFeature() }

        await store.send(.monthStepped(-1)) {
            $0.month = "2025-12"
        }
    }

    // MARK: - 2. addContractTapped presents .create only when editable

    func testAddContractTappedPresentsCreateWhenEditable() async {
        let initial = seededState(projectId: 42, loadState: .fresh)
        let store = TestStore(initialState: initial) { ProjectDetailFeature() }
        // `ContractDrawerFeature.State`'s `.create` mode mints its `id` from
        // a raw `UUID()` (not the controlled `\.uuid` dependency, same as
        // `WorklogFormFeature.State` — see RecordsFeatureTests), so two
        // independently constructed `.create` states never compare equal.
        // Assert on `.mode` (Equatable, id-free) instead of diffing the
        // whole presented state.
        store.exhaustivity = .off(showSkippedAssertions: false)

        await store.send(.addContractTapped)
        XCTAssertEqual(store.state.contractDrawer?.mode, .create(projectId: 42))
        XCTAssertEqual(store.state.contractDrawer?.sharedProjectIds, [])
    }

    func testAddContractTappedNoOpWhenCached() async {
        let initial = seededState(loadState: .cached)
        let store = TestStore(initialState: initial) { ProjectDetailFeature() }

        // No state-mutation closure -> TestStore's exhaustive default fails
        // if `contractDrawer` were set.
        await store.send(.addContractTapped)
    }

    // MARK: - 3. contractRowTapped on a SOLO contract presents .edit with empty sharedProjectIds

    func testContractRowTappedSoloPresentsEditWithEmptySharedProjectIds() async {
        let solo = contractRow(syncId: "c1", projectId: 10, from: "2025-01-01")
        let initial = seededState(contracts: [solo])
        let store = TestStore(initialState: initial) { ProjectDetailFeature() }
        store.exhaustivity = .off(showSkippedAssertions: false)

        await store.send(.contractRowTapped(solo))
        XCTAssertEqual(store.state.contractDrawer?.mode, .edit(solo))
        XCTAssertEqual(store.state.contractDrawer?.sharedProjectIds, [])
    }

    // MARK: - 4. contractRowTapped on a GROUPED contract prefills sharedProjectIds
    // with the OTHER group members' projectIds (Finding-B regression test).

    func testContractRowTappedGroupedPrefillsOtherMembers() async {
        let c10 = contractRow(syncId: "c10", projectId: 10, from: "2025-01-01", groupId: "g1")
        let c20 = contractRow(syncId: "c20", projectId: 20, from: "2025-01-01", groupId: "g1")
        let c30 = contractRow(syncId: "c30", projectId: 30, from: "2025-01-01", groupId: "g1")
        let initial = seededState(contracts: [c10, c20, c30])
        let store = TestStore(initialState: initial) { ProjectDetailFeature() }
        store.exhaustivity = .off(showSkippedAssertions: false)

        await store.send(.contractRowTapped(c10))
        XCTAssertEqual(store.state.contractDrawer?.mode, .edit(c10))
        XCTAssertEqual(store.state.contractDrawer?.sharedProjectIds, [20, 30])
    }

    func testContractRowTappedNoOpWhenCached() async {
        let grouped = contractRow(syncId: "c10", projectId: 10, from: "2025-01-01", groupId: "g1")
        let initial = seededState(contracts: [grouped], loadState: .cached)
        let store = TestStore(initialState: initial) { ProjectDetailFeature() }

        await store.send(.contractRowTapped(grouped))
    }

    // MARK: - 5. contractDrawer dismissal clears the presentation

    func testContractDrawerDismissedClearsPresentation() async {
        var initial = seededState(projectId: 42)
        initial.contractDrawer = ContractDrawerFeature.State(mode: .create(projectId: 42))
        let store = TestStore(initialState: initial) { ProjectDetailFeature() }

        await store.send(.contractDrawer(.presented(.delegate(.dismissed)))) {
            $0.contractDrawer = nil
        }
    }
}
