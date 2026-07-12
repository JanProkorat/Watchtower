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
    }
}
