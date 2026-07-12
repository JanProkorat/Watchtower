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
}
