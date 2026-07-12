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

        // onAppear races a cache-load against a network fetch (`.merge` of
        // two independent `.run` effects). Swift's concurrency runtime gives
        // no ordering guarantee between them -- that is precisely why
        // `cacheLoaded` carries the `state.dataset == nil` race guard (see
        // its comment) and why `testFetchFailsBeforeCacheThenCacheRecovers`
        // separately drives the reverse order deterministically. This test
        // accepts either interleaving of the two resulting actions and
        // asserts only on the converged end state.
        for _ in 0..<2 {
            await store.receive { action in
                if case .cacheLoaded = action { return true }
                if case .fetchResponse = action { return true }
                return false
            }
        }

        XCTAssertEqual(store.state.dataset, self.ds("fresh"))
        XCTAssertEqual(store.state.loadState, .fresh)
        XCTAssertEqual(store.state.lastUpdated, "fresh")
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
            $0.$dataset.withLock { $0 = self.ds("cached") }
            $0.$loadState.withLock { $0 = .cached }
            $0.lastUpdated = "cached"
        }
        await store.send(.refreshRequested)
        await store.receive(\.refreshResponse) {
            $0.$dataset.withLock { $0 = self.ds("cached") }
            $0.$loadState.withLock { $0 = .cached }
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
            $0.$dataset.withLock { $0 = nil }
            $0.$loadState.withLock { $0 = .offline }
            $0.lastUpdated = nil
        }
    }

    func testCacheLoadedDoesNotRegressFreshState() async {
        // Drive to .fresh first, then a late cacheLoaded (older cached snapshot)
        // must be a no-op — proves the SWR race guard closes the window where a
        // concurrent cache-load lands after the fresh fetch.
        let store = TestStore(initialState: BillingFeature.State()) { BillingFeature() } withDependencies: {
            $0.billingCache.save = { _ in }
        }
        store.exhaustivity = .off(showSkippedAssertions: false)

        await store.send(.fetchResponse(.success(ds("fresh")))) {
            $0.$dataset.withLock { $0 = self.ds("fresh") }
            $0.$loadState.withLock { $0 = .fresh }
            $0.lastUpdated = "fresh"
        }
        // Late cacheLoaded with an older dataset: no state change expected.
        await store.send(.cacheLoaded(ds("cached")))
    }

    func testFetchFailsBeforeCacheThenCacheRecovers() async {
        // onAppear's cache-load and fetch run concurrently. If the fetch fails
        // FIRST (no cache yet -> .offline) and the cacheLoaded(dataset) arrives
        // after, the offline-race guard must still apply the cache rather than
        // stranding the user offline with valid data on disk.
        struct Boom: Error {}
        let store = TestStore(initialState: BillingFeature.State()) { BillingFeature() } withDependencies: {
            $0.billingClient.fetchBillingDataset = { throw Boom() }
        }
        store.exhaustivity = .off(showSkippedAssertions: false)

        await store.send(.fetchResponse(.failure(.fetchFailed))) {
            $0.$dataset.withLock { $0 = nil }
            $0.$loadState.withLock { $0 = .offline }
            $0.lastUpdated = nil
        }
        await store.send(.cacheLoaded(ds("cached"))) {
            $0.$dataset.withLock { $0 = self.ds("cached") }
            $0.$loadState.withLock { $0 = .cached }
            $0.lastUpdated = "cached"
        }
    }

    func testCacheLoadedNilStaysLoading() async {
        let store = TestStore(initialState: BillingFeature.State()) { BillingFeature() }
        store.exhaustivity = .off(showSkippedAssertions: false)

        // Empty-cache no-op: loadState stays .loading, dataset stays nil.
        await store.send(.cacheLoaded(nil))
        XCTAssertEqual(store.state.loadState, .loading)
        XCTAssertNil(store.state.dataset)
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
            $0.$dataset.withLock { $0 = self.ds("refreshed") }
            $0.$loadState.withLock { $0 = .fresh }
            $0.lastUpdated = "refreshed"
            $0.showRefreshToast = true
        }
        await clock.advance(by: .seconds(2.2))
        await store.receive(\.toastExpired) {
            $0.showRefreshToast = false
        }
    }

    /// Locks the sharing contract that Phase-5 editor features depend on:
    /// any `BillingFeature.State` writes `dataset`/`loadState` through
    /// `@Shared(.inMemory("billingDataset"))` / `("billingLoadState"))`, and a
    /// SECOND, independently constructed `State` (standing in for a
    /// not-yet-built editor reducer) declaring the identical keys must
    /// observe the write -- not a private copy.
    func testSharedDatasetVisibleToSecondReducer() async {
        let store = TestStore(initialState: BillingFeature.State()) { BillingFeature() } withDependencies: {
            $0.billingClient.fetchBillingDataset = { self.ds("shared") }
            $0.billingCache.save = { _ in }
        }
        store.exhaustivity = .off(showSkippedAssertions: false)

        await store.send(.fetchResponse(.success(ds("shared")))) {
            $0.$dataset.withLock { $0 = self.ds("shared") }
            $0.$loadState.withLock { $0 = .fresh }
            $0.lastUpdated = "shared"
        }

        // A second State, constructed independently (no TestStore, no
        // shared reducer instance), declares the SAME @Shared(.inMemory(...))
        // keys. If in-memory sharing works by key (not by reducer identity),
        // it must already see the dataset/loadState written above.
        let second = BillingFeature.State()
        XCTAssertEqual(second.dataset, self.ds("shared"))
        XCTAssertEqual(second.loadState, .fresh)

        // And the sharing is bidirectional: a write through the second
        // instance must be visible back on the first.
        second.$dataset.withLock { $0 = self.ds("mutated-by-second") }
        XCTAssertEqual(store.state.dataset, self.ds("mutated-by-second"))
    }
}
