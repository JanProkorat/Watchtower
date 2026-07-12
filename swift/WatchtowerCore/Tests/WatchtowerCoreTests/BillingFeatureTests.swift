import XCTest
import ComposableArchitecture
@testable import WatchtowerCore

@MainActor
final class BillingFeatureTests: XCTestCase {
    private func ds(_ stamp: String) -> BillingDataset {
        BillingDataset(worklogs: [], contracts: [], daysOff: [], projects: [], tasks: [], epics: [], fetchedAt: stamp)
    }

    func testOnAppearCacheHitThenFreshFetch() async {
        let saved = LockIsolated<BillingDataset?>(nil)
        let store = TestStore(initialState: BillingFeature.State()) { BillingFeature() } withDependencies: {
            $0.billingCache.load = { self.ds("cached") }
            $0.billingCache.save = { saved.setValue($0) }
            $0.billingClient.fetchBillingDataset = { self.ds("fresh") }
        }
        store.exhaustivity = .off(showSkippedAssertions: false)
        await store.send(.onAppear)
        await store.receive(\.cacheLoaded) {
            $0.dataset = self.ds("cached"); $0.loadState = .cached; $0.lastUpdated = "cached"
        }
        await store.receive(\.fetchResponse.success) {
            $0.dataset = self.ds("fresh"); $0.loadState = .fresh; $0.lastUpdated = "fresh"
        }
        XCTAssertEqual(saved.value, ds("fresh"))
    }

    func testFetchErrorWithCacheStaysCached() async {
        struct Boom: Error {}
        let store = TestStore(initialState: BillingFeature.State()) { BillingFeature() } withDependencies: {
            $0.billingClient.fetchBillingDataset = { throw Boom() }
        }
        store.exhaustivity = .off(showSkippedAssertions: false)

        // Seed a cached dataset directly via the cacheLoaded action (simulating
        // a prior successful cache read), then drive a failing fetch and assert
        // the cached dataset survives with loadState == .cached.
        await store.send(.cacheLoaded(ds("cached"))) {
            $0.dataset = self.ds("cached"); $0.loadState = .cached; $0.lastUpdated = "cached"
        }
        await store.send(.refreshRequested)
        await store.receive(\.refreshResponse) {
            $0.dataset = self.ds("cached")
            $0.loadState = .cached
            $0.lastUpdated = "cached"
        }
    }

    func testFetchErrorWithNoCacheGoesOffline() async {
        struct Boom: Error {}
        let store = TestStore(initialState: BillingFeature.State()) { BillingFeature() } withDependencies: {
            $0.billingClient.fetchBillingDataset = { throw Boom() }
        }
        store.exhaustivity = .off(showSkippedAssertions: false)

        await store.send(.refreshRequested)
        await store.receive(\.refreshResponse) {
            $0.dataset = nil
            $0.loadState = .offline
            $0.lastUpdated = nil
        }
    }

    func testRefreshShowsToastThenExpires() async {
        let clock = TestClock()
        let store = TestStore(initialState: BillingFeature.State()) { BillingFeature() } withDependencies: {
            $0.billingClient.fetchBillingDataset = { self.ds("refreshed") }
            $0.billingCache.save = { _ in }
            $0.continuousClock = clock
        }
        store.exhaustivity = .off(showSkippedAssertions: false)

        await store.send(.refreshRequested)
        await store.receive(\.refreshResponse) {
            $0.dataset = self.ds("refreshed")
            $0.loadState = .fresh
            $0.lastUpdated = "refreshed"
            $0.showRefreshToast = true
        }
        await clock.advance(by: .seconds(2.2))
        await store.receive(\.toastExpired) {
            $0.showRefreshToast = false
        }
    }
}
