import XCTest
import ComposableArchitecture
@testable import WatchtowerCore

@MainActor
final class ReportsFeatureTests: XCTestCase {
    func testOnAppearSeedsTodayUTCAndDerivesRange() async {
        let store = TestStore(initialState: ReportsFeature.State()) { ReportsFeature() } withDependencies: {
            $0.date.now = Date(timeIntervalSince1970: 1_780_000_000) // 2026-05-28 UTC
        }
        await store.send(.onAppear(earliest: "2025-01-01")) {
            $0.today = "2026-05-28"; $0.earliest = "2025-01-01"
        }
        XCTAssertEqual(store.state.range.to, "2026-05-28")
        XCTAssertEqual(store.state.range.from, "2026-04-29") // 30d default → today-29
        XCTAssertEqual(store.state.granularity, .day)
    }
    func testPresetResetsGranularityChoice() async {
        let store = TestStore(initialState: ReportsFeature.State(preset: .d30, granularityChoice: .week, today: "2026-05-28")) {
            ReportsFeature()
        }
        await store.send(.granularityChanged(.month)) { $0.granularityChoice = .month }
        await store.send(.presetChanged(.year)) { $0.preset = .year; $0.granularityChoice = nil }
        XCTAssertEqual(store.state.granularity, .month) // year default
    }

    // MARK: - ProjectDetail presentation (Task 17)
    //
    // Seeded with `today`'s month, NOT the report range's start month —
    // mirrors the React reference: `ReportsView.onOpenProject(id)` has no
    // month param, so `BillingArea.openProject` passes `month: undefined`,
    // and `ProjectDetailView` falls back to `today.slice(0, 7)`
    // (packages/module-timetracker/src/billing/ProjectDetailView.tsx:407).

    func testOpenProjectTappedPresentsProjectDetailSeededWithTodaysMonth() async {
        let store = TestStore(initialState: ReportsFeature.State(preset: .d30, today: "2026-05-28")) {
            ReportsFeature()
        }

        await store.send(.openProjectTapped(7)) {
            $0.projectDetail = ProjectDetailFeature.State(projectId: 7, initialMonth: "2026-05")
        }
    }

    func testProjectDetailDismissedClearsPresentation() async {
        var initial = ReportsFeature.State(preset: .d30, today: "2026-05-28")
        initial.projectDetail = ProjectDetailFeature.State(projectId: 7, initialMonth: "2026-05")
        let store = TestStore(initialState: initial) { ReportsFeature() }

        await store.send(.projectDetail(.dismiss)) {
            $0.projectDetail = nil
        }
    }
}
