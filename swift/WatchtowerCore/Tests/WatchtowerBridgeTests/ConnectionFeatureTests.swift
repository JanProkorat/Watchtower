import XCTest
import ComposableArchitecture
@testable import WatchtowerBridge

@MainActor
final class ConnectionFeatureTests: XCTestCase {
    func testOnAppearLoadsSavedConnectionAndSubscribesStatus() async {
        let saved = Connection(host: "10.0.0.5", port: 7445, token: "tok")
        let (statusStream, statusCont) = AsyncStream<ConnStatus>.makeStream()
        let store = TestStore(initialState: ConnectionFeature.State()) {
            ConnectionFeature()
        } withDependencies: {
            $0.connectionStore.load = { saved }
            $0.bridge.statusStream = { statusStream }
        }
        await store.send(.onAppear) {
            $0.saved = saved
            $0.form = ConnectionFormState(saved)
        }
        statusCont.yield(.connected)
        await store.receive(\.statusChanged) { $0.status = .connected }
        statusCont.finish()
        await store.finish()
    }

    func testOnAppearWithNothingSavedKeepsDefaults() async {
        let store = TestStore(initialState: ConnectionFeature.State()) {
            ConnectionFeature()
        } withDependencies: {
            $0.connectionStore.load = { nil }
            $0.bridge.statusStream = { .finished }
        }
        await store.send(.onAppear) // no state change: defaults stay
        await store.finish()
    }

    func testSaveValidFormPersistsAndReconfigures() async {
        let savedConn = LockIsolated<Connection?>(nil)
        let configured = LockIsolated<Connection?>(nil)
        var state = ConnectionFeature.State()
        state.form.host = "mac.ts.net"
        state.form.token = "tok"
        let store = TestStore(initialState: state) {
            ConnectionFeature()
        } withDependencies: {
            $0.connectionStore.save = { savedConn.setValue($0) }
            $0.bridge.configure = { configured.setValue($0) }
        }
        let expected = Connection(host: "mac.ts.net", port: 7445, token: "tok")
        await store.send(.saveTapped) {
            $0.saved = expected
            $0.didSave = true
        }
        await store.finish()
        XCTAssertEqual(savedConn.value, expected)
        XCTAssertEqual(configured.value, expected)
    }

    func testSaveInvalidFormShowsErrorAndDoesNotPersist() async {
        let store = TestStore(initialState: ConnectionFeature.State()) {
            ConnectionFeature()
        }
        // Default form: empty host — validation must fail before any dependency
        // is touched (unimplemented testValue deps would fail the test if called).
        await store.send(.saveTapped) {
            $0.errorMessage = "Host is required"
        }
    }

    func testEditingClearsDidSaveAndError() async {
        var state = ConnectionFeature.State()
        state.didSave = true
        let store = TestStore(initialState: state) {
            ConnectionFeature()
        }
        var edited = ConnectionFormState()
        edited.host = "x"
        await store.send(.binding(.set(\.form, edited))) {
            $0.form = edited
            $0.didSave = false
        }
    }
}
