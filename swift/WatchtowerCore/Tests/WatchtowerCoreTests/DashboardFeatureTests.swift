import XCTest
import ComposableArchitecture
@testable import WatchtowerCore

@MainActor
final class DashboardFeatureTests: XCTestCase {
    func testRefreshShowsThenHidesToast() async {
        let clock = TestClock()
        let store = TestStore(initialState: DashboardFeature.State()) { DashboardFeature() } withDependencies: {
            $0.continuousClock = clock
        }
        await store.send(.refreshFinished) { $0.showToast = true }
        await clock.advance(by: .seconds(2.2))
        await store.receive(\.toastExpired) { $0.showToast = false }
    }
}
