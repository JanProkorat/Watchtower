import XCTest
import ComposableArchitecture
@testable import WatchtowerCore

@MainActor
final class EarningsFeatureTests: XCTestCase {
    func testOnAppearSeedsCurrentMonthUTC() async {
        let store = TestStore(initialState: EarningsFeature.State()) { EarningsFeature() } withDependencies: {
            $0.date.now = Date(timeIntervalSince1970: 1_780_000_000) // 2026-05-28T... UTC
        }
        await store.send(.onAppear) { $0.selectedMonth = "2026-05" }
    }
    func testMonthStepping() async {
        let store = TestStore(initialState: EarningsFeature.State(selectedMonth: "2026-01")) { EarningsFeature() }
        await store.send(.monthStepped(-1)) { $0.selectedMonth = "2025-12" }
        await store.send(.monthStepped(1)) { $0.selectedMonth = "2026-01" }
    }

    // MARK: - ProjectDetail presentation (Task 17)

    func testOpenProjectTappedPresentsProjectDetailSeededWithSelectedMonth() async {
        let store = TestStore(initialState: EarningsFeature.State(selectedMonth: "2026-03")) { EarningsFeature() }

        await store.send(.openProjectTapped(42)) {
            $0.projectDetail = ProjectDetailFeature.State(projectId: 42, initialMonth: "2026-03")
        }
    }

    func testProjectDetailDismissedClearsPresentation() async {
        var initial = EarningsFeature.State(selectedMonth: "2026-03")
        initial.projectDetail = ProjectDetailFeature.State(projectId: 42, initialMonth: "2026-03")
        let store = TestStore(initialState: initial) { EarningsFeature() }

        await store.send(.projectDetail(.dismiss)) {
            $0.projectDetail = nil
        }
    }
}
