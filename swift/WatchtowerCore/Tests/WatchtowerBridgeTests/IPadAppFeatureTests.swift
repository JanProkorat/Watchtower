import XCTest
import ComposableArchitecture
import WatchtowerCore
@testable import WatchtowerBridge

@MainActor
final class IPadAppFeatureTests: XCTestCase {
    func testFirstRunLandsOnSettings() async {
        let store = TestStore(initialState: IPadAppFeature.State()) {
            IPadAppFeature()
        } withDependencies: {
            $0.connectionStore.load = { nil }
            $0.bridge.statusStream = { .finished }
            $0.supabase.currentSessionExists = { false }
            $0.supabase.authEvents = { .finished }
        }
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
        }
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
        }
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
}
