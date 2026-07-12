import XCTest
import ComposableArchitecture
@testable import WatchtowerCore

@MainActor
final class AppFeatureTests: XCTestCase {
    private func ds() -> BillingDataset {
        BillingDataset(worklogs: [], contracts: [], daysOff: [], projects: [], tasks: [], epics: [], fetchedAt: "stamp")
    }

    private func ds(worklogDates: [String]) -> BillingDataset {
        let rows = worklogDates.enumerated().map { i, date in
            WorklogRow(syncId: "w\(i)", workDate: date, minutes: 60, reportedMinutes: nil,
                       effectiveMinutes: 60, earnedAmount: nil, description: nil, projectId: 1,
                       projectName: "Alpha", projectColor: nil, projectKind: "work", isBillable: true,
                       taskNumber: nil, taskTitle: nil, source: nil)
        }
        return BillingDataset(worklogs: rows, contracts: [], daysOff: [], projects: [], tasks: [], epics: [], fetchedAt: "stamp")
    }

    func testOnAppearWithNoSessionGoesSignedOut() async {
        let events = AsyncStream<Bool>.makeStream()
        let store = TestStore(initialState: AppFeature.State()) { AppFeature() } withDependencies: {
            $0.supabase.currentSessionExists = { false }
            $0.supabase.authEvents = { events.stream }
            $0.billingCache.load = { nil }
            $0.billingCache.save = { _ in }
            $0.billingClient.fetchBillingDataset = { self.ds() }
            $0.date.now = Date(timeIntervalSince1970: 1_780_000_000)
        }
        store.exhaustivity = .off(showSkippedAssertions: false)
        await store.send(.onAppear)
        await store.receive(\.authEvent) {
            $0.phase = .signedOut(AuthFeature.State())
        }
        await store.send(.tabSelected(.reports)) // keep the long-living stream effect tidy
        events.continuation.finish()
    }

    func testOnAppearTriggersBillingLoad() async {
        // Billing/earnings must load once the auth event flips the phase INTO
        // .signedIn — not on bare onAppear (auth isn't known yet).
        let events = AsyncStream<Bool>.makeStream()
        let cacheLoaded = LockIsolated(false)
        let fetched = LockIsolated(false)
        let store = TestStore(initialState: AppFeature.State()) { AppFeature() } withDependencies: {
            $0.supabase.currentSessionExists = { true }
            $0.supabase.authEvents = { events.stream }
            $0.billingCache.load = { cacheLoaded.setValue(true); return self.ds() }
            $0.billingCache.save = { _ in }
            $0.billingClient.fetchBillingDataset = { fetched.setValue(true); return self.ds() }
            $0.date.now = Date(timeIntervalSince1970: 1_780_000_000)
        }
        store.exhaustivity = .off(showSkippedAssertions: false)

        await store.send(.onAppear)
        await store.receive(\.authEvent) {
            $0.phase = .signedIn
        }
        // The billing load path (cache read + network fetch) runs as part of
        // the effect returned by the signed-in transition, not by onAppear.
        await store.receive(\.billing.cacheLoaded) {
            $0.billing.dataset = self.ds()
            $0.billing.loadState = .cached
            $0.billing.lastUpdated = "stamp"
        }
        await store.receive(\.billing.fetchResponse.success) {
            $0.billing.dataset = self.ds()
            $0.billing.loadState = .fresh
            $0.billing.lastUpdated = "stamp"
        }
        XCTAssertTrue(cacheLoaded.value)
        XCTAssertTrue(fetched.value)

        await store.send(.tabSelected(.reports)) // keep the long-living stream effect tidy
        events.continuation.finish()
    }

    func testAuthEventTrueFiresReportsOnAppearWithNilEarliest() async {
        // Reports must load its "today" seed on the same signed-in
        // transition as billing/earnings; `earliest` isn't known yet since
        // the billing dataset hasn't loaded, so it's sent as nil here.
        let store = TestStore(initialState: AppFeature.State(phase: .signedOut(AuthFeature.State()))) {
            AppFeature()
        } withDependencies: {
            $0.billingCache.load = { nil }
            $0.billingCache.save = { _ in }
            $0.billingClient.fetchBillingDataset = { self.ds() }
            $0.date.now = Date(timeIntervalSince1970: 1_780_000_000)
        }
        store.exhaustivity = .off(showSkippedAssertions: false)
        await store.send(.authEvent(true)) { $0.phase = .signedIn }
        await store.receive(\.reports.onAppear) {
            $0.reports.today = "2026-05-28"
            $0.reports.earliest = nil
        }
    }

    func testAuthEventTrueFiresRecordsOnAppear() async {
        // Records (like billing/earnings/reports) must load its month-cursor
        // seed on the same signed-in transition — `records.onAppear` only
        // touches `date.now`, no network dependency involved.
        let store = TestStore(initialState: AppFeature.State(phase: .signedOut(AuthFeature.State()))) {
            AppFeature()
        } withDependencies: {
            $0.billingCache.load = { nil }
            $0.billingCache.save = { _ in }
            $0.billingClient.fetchBillingDataset = { self.ds() }
            $0.date.now = Date(timeIntervalSince1970: 1_780_000_000)
        }
        store.exhaustivity = .off(showSkippedAssertions: false)
        await store.send(.authEvent(true)) { $0.phase = .signedIn }
        await store.receive(\.records.onAppear) {
            $0.records.worklogMonth = "2026-05"
            $0.records.gridMonth = "2026-05"
            $0.records.timeOffFocus = "2026-05"
        }
    }

    func testFirstBillingDatasetReseedsReportsEarliest() async {
        // The sign-in transition fires `.reports(.onAppear(earliest: nil))`
        // before the billing dataset has loaded. Once a dataset first
        // arrives — here via the cache-load path, which lands before the
        // network fetch — AppFeature re-seeds Reports with the minimum
        // worklog `workDate` so the "all" preset's lower bound reflects real
        // data. The second dataset arrival (the network fetch) must NOT
        // re-fire the reseed: `state.billing.dataset` is already non-nil by
        // then.
        let dataset = ds(worklogDates: ["2025-03-01", "2025-01-01", "2025-06-15"])
        let events = AsyncStream<Bool>.makeStream()
        let store = TestStore(initialState: AppFeature.State()) { AppFeature() } withDependencies: {
            $0.supabase.currentSessionExists = { true }
            $0.supabase.authEvents = { events.stream }
            $0.billingCache.load = { dataset }
            $0.billingCache.save = { _ in }
            $0.billingClient.fetchBillingDataset = { dataset }
            $0.date.now = Date(timeIntervalSince1970: 1_780_000_000)
        }
        store.exhaustivity = .off(showSkippedAssertions: false)

        await store.send(.onAppear)
        await store.receive(\.authEvent) { $0.phase = .signedIn }
        await store.receive(\.reports.onAppear) {
            $0.reports.today = "2026-05-28"
            $0.reports.earliest = nil
        }
        await store.receive(\.billing.cacheLoaded) {
            $0.billing.dataset = dataset
            $0.billing.loadState = .cached
            $0.billing.lastUpdated = "stamp"
        }
        await store.receive(\.reports.onAppear) {
            $0.reports.earliest = "2025-01-01"
        }
        await store.receive(\.billing.fetchResponse.success) {
            $0.billing.dataset = dataset
            $0.billing.loadState = .fresh
            $0.billing.lastUpdated = "stamp"
        }

        await store.send(.tabSelected(.reports)) // keep the long-living stream effect tidy
        events.continuation.finish()
    }

    func testSignedOutDoesNotLoadBilling() async {
        // When the auth event resolves signed-out, no billing fetch/cache
        // read should run — onAppear alone must not trigger a load, and
        // neither should the signedOut transition.
        let events = AsyncStream<Bool>.makeStream()
        let cacheLoaded = LockIsolated(false)
        let fetched = LockIsolated(false)
        let store = TestStore(initialState: AppFeature.State()) { AppFeature() } withDependencies: {
            $0.supabase.currentSessionExists = { false }
            $0.supabase.authEvents = { events.stream }
            $0.billingCache.load = { cacheLoaded.setValue(true); return nil }
            $0.billingCache.save = { _ in }
            $0.billingClient.fetchBillingDataset = { fetched.setValue(true); return self.ds() }
            $0.date.now = Date(timeIntervalSince1970: 1_780_000_000)
        }
        store.exhaustivity = .off(showSkippedAssertions: false)

        await store.send(.onAppear)
        await store.receive(\.authEvent) {
            $0.phase = .signedOut(AuthFeature.State())
        }
        XCTAssertFalse(cacheLoaded.value)
        XCTAssertFalse(fetched.value)

        await store.send(.tabSelected(.reports)) // keep the long-living stream effect tidy
        events.continuation.finish()
    }

    func testAuthEventTrueFlipsToSignedIn() async {
        // The signed-in transition also kicks off the billing/earnings load
        // (Fix 2); stub those dependencies and relax exhaustivity since this
        // test's focus is the phase transition, not the load itself.
        let store = TestStore(initialState: AppFeature.State(phase: .signedOut(AuthFeature.State()))) {
            AppFeature()
        } withDependencies: {
            $0.billingCache.load = { nil }
            $0.billingCache.save = { _ in }
            $0.billingClient.fetchBillingDataset = { self.ds() }
            $0.date.now = Date(timeIntervalSince1970: 1_780_000_000)
        }
        store.exhaustivity = .off(showSkippedAssertions: false)
        await store.send(.authEvent(true)) { $0.phase = .signedIn }
    }

    func testAuthEventFalseFlipsToSignedOut() async {
        let store = TestStore(initialState: AppFeature.State(phase: .signedIn)) { AppFeature() }
        await store.send(.authEvent(false)) { $0.phase = .signedOut(AuthFeature.State()) }
    }

    func testTabSelection() async {
        let store = TestStore(initialState: AppFeature.State(phase: .signedIn)) { AppFeature() }
        await store.send(.tabSelected(.earnings)) { $0.selectedTab = .earnings }
    }

    func testSignOutCallsDependency() async {
        let signedOut = LockIsolated(false)
        let store = TestStore(initialState: AppFeature.State(phase: .signedIn)) { AppFeature() } withDependencies: {
            $0.supabase.signOut = { signedOut.setValue(true) }
        }
        await store.send(.signOutTapped)
        XCTAssertTrue(signedOut.value)
    }

    func testAuthEventTrueWhileSignedInIsNoOp() async {
        let store = TestStore(initialState: AppFeature.State(phase: .signedIn)) { AppFeature() }
        // No trailing assert closure: phase must stay .signedIn (guard no-op).
        await store.send(.authEvent(true))
    }

    func testAuthEventFalseWhileSignedOutPreservesAuthState() async {
        let typed = AuthFeature.State(email: "typed@x.cz", password: "pw")
        let store = TestStore(initialState: AppFeature.State(phase: .signedOut(typed))) { AppFeature() }
        // No trailing assert closure: the guard must NOT clobber the in-progress
        // AuthFeature.State by resetting to a fresh .signedOut(AuthFeature.State()).
        await store.send(.authEvent(false))
    }

    func testAuthActionRoutedToEmbeddedAuthFeature() async {
        let store = TestStore(initialState: AppFeature.State(phase: .signedOut(AuthFeature.State()))) {
            AppFeature()
        }
        await store.send(.auth(.binding(.set(\.email, "typed@x.cz")))) {
            $0.phase = .signedOut(AuthFeature.State(email: "typed@x.cz"))
        }
    }

    func testOnAppearForwardsStreamEvents() async {
        let events = AsyncStream<Bool>.makeStream()
        let store = TestStore(initialState: AppFeature.State()) { AppFeature() } withDependencies: {
            $0.supabase.currentSessionExists = { false }
            $0.supabase.authEvents = { events.stream }
            $0.billingCache.load = { nil }
            $0.billingCache.save = { _ in }
            $0.billingClient.fetchBillingDataset = { self.ds() }
            $0.date.now = Date(timeIntervalSince1970: 1_780_000_000)
        }
        store.exhaustivity = .off(showSkippedAssertions: false)
        await store.send(.onAppear)
        await store.receive(\.authEvent) {
            $0.phase = .signedOut(AuthFeature.State())
        }
        events.continuation.yield(true)
        await store.receive(\.authEvent) {
            $0.phase = .signedIn
        }
        events.continuation.finish()
    }
}
