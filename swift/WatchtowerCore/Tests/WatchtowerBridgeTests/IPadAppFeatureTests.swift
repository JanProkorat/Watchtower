import XCTest
import ComposableArchitecture
import WatchtowerCore
@testable import WatchtowerBridge

@MainActor
final class IPadAppFeatureTests: XCTestCase {
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

    func testFirstRunLandsOnSettings() async {
        let store = TestStore(initialState: IPadAppFeature.State()) {
            IPadAppFeature()
        } withDependencies: {
            $0.connectionStore.load = { nil }
            $0.bridge.statusStream = { .finished }
            $0.supabase.currentSessionExists = { false }
            $0.supabase.authEvents = { .finished }
            $0.billingCache.load = { nil }
            $0.billingCache.save = { _ in }
            $0.billingClient.fetchBillingDataset = { self.ds() }
            $0.date.now = Date(timeIntervalSince1970: 1_780_000_000)
        }
        store.exhaustivity = .off(showSkippedAssertions: false)
        await store.send(.onAppear) {
            $0.selectedModule = .settings
        }
        await store.receive(\.authEvent) // false → no state change
        await store.finish()
    }

    func testBootWithSavedConnectionConfiguresBridgeAndProbes() async {
        let saved = Connection(host: "10.0.0.5", port: 7445, token: "tok")
        let configured = LockIsolated<Connection?>(nil)
        let (statusStream, statusCont) = AsyncStream<ConnStatus>.makeStream()
        let store = TestStore(initialState: IPadAppFeature.State()) {
            IPadAppFeature()
        } withDependencies: {
            $0.connectionStore.load = { saved }
            $0.bridge.configure = { configured.setValue($0) }
            $0.bridge.statusStream = { statusStream }
            $0.bridge.send = { kind, _ in
                XCTAssertEqual(kind, "listInstances")
                return Data(
                    #"{"instances":[{"id":"i1","cwd":"/x","status":"working","lastActivityAt":0,"kind":"managed","taskId":null},{"id":"i2","cwd":"/y","status":"idle","lastActivityAt":0,"kind":"managed","taskId":null}]}"#
                        .utf8
                )
            }
            $0.supabase.currentSessionExists = { true }
            $0.supabase.authEvents = { .finished }
            $0.billingCache.load = { nil }
            $0.billingCache.save = { _ in }
            $0.billingClient.fetchBillingDataset = { self.ds() }
            $0.date.now = Date(timeIntervalSince1970: 1_780_000_000)
        }
        store.exhaustivity = .off(showSkippedAssertions: false)
        await store.send(.onAppear)
        await store.receive(\.authEvent) { $0.authPresent = true }
        statusCont.yield(.connecting)
        await store.receive(\.statusChanged) { $0.connStatus = .connecting }
        statusCont.yield(.connected)
        await store.receive(\.statusChanged) { $0.connStatus = .connected }
        await store.receive(\.probeResponse) { $0.instancesOnline = 2 }
        XCTAssertEqual(configured.value, saved)
        statusCont.finish()
        await store.finish()
    }

    func testProbeFailureReportsNil() async {
        let (statusStream, statusCont) = AsyncStream<ConnStatus>.makeStream()
        let store = TestStore(initialState: IPadAppFeature.State()) {
            IPadAppFeature()
        } withDependencies: {
            $0.connectionStore.load = { Connection(host: "h", port: 7445, token: "t") }
            $0.bridge.configure = { _ in }
            $0.bridge.statusStream = { statusStream }
            $0.bridge.send = { _, _ in throw BridgeError.notConnected }
            $0.supabase.currentSessionExists = { false }
            $0.supabase.authEvents = { .finished }
            $0.billingCache.load = { nil }
            $0.billingCache.save = { _ in }
            $0.billingClient.fetchBillingDataset = { self.ds() }
            $0.date.now = Date(timeIntervalSince1970: 1_780_000_000)
        }
        store.exhaustivity = .off(showSkippedAssertions: false)
        await store.send(.onAppear)
        await store.receive(\.authEvent)
        statusCont.yield(.connected)
        await store.receive(\.statusChanged) { $0.connStatus = .connected }
        await store.receive(\.probeResponse) // nil → instancesOnline stays nil
        statusCont.finish()
        await store.finish()
    }

    func testModuleSelection() async {
        let store = TestStore(initialState: IPadAppFeature.State()) {
            IPadAppFeature()
        }
        await store.send(.moduleSelected(.billing)) {
            $0.selectedModule = .billing
        }
    }

    func testSignOutCallsSupabase() async {
        let signedOut = LockIsolated(false)
        let store = TestStore(initialState: IPadAppFeature.State()) {
            IPadAppFeature()
        } withDependencies: {
            $0.supabase.signOut = { signedOut.setValue(true) }
        }
        await store.send(.signOutTapped)
        await store.finish()
        XCTAssertTrue(signedOut.value)
    }

    func testInstancesActionRoutesIntoChild() async {
        let store = TestStore(initialState: IPadAppFeature.State()) {
            IPadAppFeature()
        }
        await store.send(.instances(.instanceSelected("a"))) {
            $0.instances.selectedInstanceId = "a"
            $0.instances.acked = ["a"]
        }
    }

    func testOpenRemoteForAuthSelectsRemoteModule() async {
        let store = TestStore(initialState: IPadAppFeature.State()) {
            IPadAppFeature()
        }
        await store.send(.openRemoteForAuth) {
            $0.selectedModule = .remote
        }
    }

    // MARK: - Billing/dashboard reducer composition (Phase 5, Task 1)

    func testOnAppearFansOutBillingEarningsReportsRecords() async {
        // The iPad shell isn't auth-gated (unlike the iPhone AppFeature) —
        // billing/earnings/reports/records must load unconditionally as part
        // of the existing onAppear merge, alongside the connection/bridge/auth
        // effects, without needing a signed-in transition first.
        let store = TestStore(initialState: IPadAppFeature.State()) {
            IPadAppFeature()
        } withDependencies: {
            $0.connectionStore.load = { nil }
            $0.bridge.statusStream = { .finished }
            $0.supabase.currentSessionExists = { false }
            $0.supabase.authEvents = { .finished }
            $0.billingCache.load = { nil }
            $0.billingCache.save = { _ in }
            $0.billingClient.fetchBillingDataset = { self.ds() }
            $0.date.now = Date(timeIntervalSince1970: 1_780_000_000)
        }
        store.exhaustivity = .off(showSkippedAssertions: false)

        // Non-exhaustive `receive` skips forward past unrelated received
        // actions (e.g. `authEvent`, which arrives from the concurrent auth
        // stream with no guaranteed ordering against these), but the ones we
        // DO name must still be named in their true relative arrival order —
        // an unreceived action's mutation never lands in `store.state`, and
        // `store.finish()` alone does not retroactively apply it. The four
        // `.send(...)` sibling effects in `onAppear`'s merge are processed in
        // their declared array order (billing, earnings, reports, records).
        await store.send(.onAppear) {
            $0.selectedModule = .settings
        }
        await store.receive(\.billing.onAppear)
        await store.receive(\.earnings.onAppear) {
            $0.earnings.selectedMonth = "2026-05"
        }
        await store.receive(\.reports.onAppear) {
            $0.reports.today = "2026-05-28"
            $0.reports.earliest = nil
        }
        await store.receive(\.records.onAppear) {
            $0.records.worklogMonth = "2026-05"
            $0.records.gridMonth = "2026-05"
            $0.records.timeOffFocus = "2026-05"
        }
        // Billing's cache-load and network-fetch race; accept either
        // interleaving, then converge on the fresh dataset.
        for _ in 0..<2 {
            await store.receive { action in
                if case .billing(.cacheLoaded) = action { return true }
                if case .billing(.fetchResponse) = action { return true }
                return false
            }
        }
        XCTAssertEqual(store.state.billing.dataset, self.ds())
        XCTAssertEqual(store.state.billing.loadState, .fresh)
        await store.finish()
    }

    func testFirstBillingDatasetReseedsReportsEarliest() async {
        // The onAppear fan-out sends `.reports(.onAppear(earliest: nil))`
        // before the billing dataset has loaded (it isn't known yet). Once a
        // dataset first arrives (cache-load or network fetch, whichever wins
        // the race), IPadAppFeature re-seeds Reports with the minimum
        // worklog `workDate` so the "all" preset's lower bound reflects real
        // data. The second dataset arrival must NOT re-fire the reseed:
        // `state.billing.dataset` is already non-nil by then.
        let dataset = ds(worklogDates: ["2025-03-01", "2025-01-01", "2025-06-15"])
        let store = TestStore(initialState: IPadAppFeature.State()) {
            IPadAppFeature()
        } withDependencies: {
            $0.connectionStore.load = { nil }
            $0.bridge.statusStream = { .finished }
            $0.supabase.currentSessionExists = { false }
            $0.supabase.authEvents = { .finished }
            $0.billingCache.load = { dataset }
            $0.billingCache.save = { _ in }
            $0.billingClient.fetchBillingDataset = { dataset }
            $0.date.now = Date(timeIntervalSince1970: 1_780_000_000)
        }
        store.exhaustivity = .off(showSkippedAssertions: false)

        await store.send(.onAppear)
        await store.receive(\.billing.onAppear)
        await store.receive(\.earnings.onAppear)
        await store.receive(\.reports.onAppear) {
            $0.reports.today = "2026-05-28"
            $0.reports.earliest = nil
        }
        await store.receive(\.records.onAppear)

        await store.receive { action in
            if case .billing(.cacheLoaded) = action { return true }
            if case .billing(.fetchResponse) = action { return true }
            return false
        }
        await store.receive(\.reports.onAppear) {
            $0.reports.earliest = "2025-01-01"
        }
        await store.receive { action in
            if case .billing(.cacheLoaded) = action { return true }
            if case .billing(.fetchResponse) = action { return true }
            return false
        }

        XCTAssertEqual(store.state.billing.dataset, dataset)
        XCTAssertEqual(store.state.billing.loadState, .fresh)
        XCTAssertEqual(store.state.reports.earliest, "2025-01-01")
        await store.finish()
    }
}
