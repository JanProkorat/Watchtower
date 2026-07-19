import XCTest
import ComposableArchitecture
import WatchtowerBridge
@testable import WatchtowerRemote

@MainActor
final class RemoteFeatureTests: XCTestCase {
    private nonisolated func conn() -> Connection {
        Connection(host: "mac.ts.net", port: 7445, token: "t",
                   mac: "01:23:45:67:89:AB", lanIp: "192.168.1.9", wanHost: nil, wanPort: nil)
    }

    func testOnAppearLoadsHostAndCreds() async {
        let store = TestStore(initialState: RemoteFeature.State()) {
            RemoteFeature()
        } withDependencies: {
            $0.connectionStore.load = { self.conn() }
            $0.vncCredentialsStore.load = { VncCredentials(username: "jan", password: "pw") }
        }
        await store.send(.onAppear) {
            $0.host = "mac.ts.net"
            $0.hasMac = true
            $0.credentials = VncCredentials(username: "jan", password: "pw")
            $0.status = .connecting
        }
    }

    func testOnAppearOpensFormWhenNoCreds() async {
        let store = TestStore(initialState: RemoteFeature.State()) {
            RemoteFeature()
        } withDependencies: {
            $0.connectionStore.load = { self.conn() }
            $0.vncCredentialsStore.load = { nil }
        }
        await store.send(.onAppear) {
            $0.host = "mac.ts.net"
            $0.hasMac = true
            // No stored creds: a connect attempt would be doomed, so the form
            // opens instead of status flipping to .connecting.
            $0.credentialFormOpen = true
        }
    }

    func testOnAppearSetsHasMac() async {
        // Connection with a configured MAC: hasMac becomes true.
        let store = TestStore(initialState: RemoteFeature.State()) {
            RemoteFeature()
        } withDependencies: {
            $0.connectionStore.load = { self.conn() }
            $0.vncCredentialsStore.load = { VncCredentials(username: "jan", password: "pw") }
        }
        await store.send(.onAppear) {
            $0.host = "mac.ts.net"
            $0.hasMac = true
            $0.credentials = VncCredentials(username: "jan", password: "pw")
            $0.status = .connecting
        }

        // Connection with no MAC configured: hasMac stays false.
        let noMacConn = Connection(host: "mac.ts.net", port: 7445, token: "t",
                                    mac: nil, lanIp: nil, wanHost: nil, wanPort: nil)
        let store2 = TestStore(initialState: RemoteFeature.State()) {
            RemoteFeature()
        } withDependencies: {
            $0.connectionStore.load = { noMacConn }
            $0.vncCredentialsStore.load = { VncCredentials(username: "jan", password: "pw") }
        }
        await store2.send(.onAppear) {
            $0.host = "mac.ts.net"
            $0.credentials = VncCredentials(username: "jan", password: "pw")
            $0.status = .connecting
        }
    }

    func testRetryTappedBumpsTokenAndConnecting() async {
        let store = TestStore(
            initialState: RemoteFeature.State(host: "mac.ts.net", status: .disconnected, reconnectToken: 2)
        ) {
            RemoteFeature()
        }
        await store.send(.retryTapped) {
            $0.status = .connecting
            $0.reconnectToken = 3
        }
    }

    func testChangeLoginOpensForm() async {
        let store = TestStore(
            initialState: RemoteFeature.State(host: "mac.ts.net", status: .disconnected)
        ) {
            RemoteFeature()
        }
        await store.send(.changeLoginTapped) {
            $0.credentialFormOpen = true
        }
    }

    func testWakeTappedSendsToEachTarget() async {
        let sends = LockIsolated<[(host: String, port: Int, bytes: Int)]>([])
        let store = TestStore(initialState: RemoteFeature.State(host: "mac.ts.net")) {
            RemoteFeature()
        } withDependencies: {
            $0.connectionStore.load = { self.conn() }
            $0.wakeOnLanClient.send = { packet, host, port in
                sends.withValue { $0.append((host, port, packet.count)) }
            }
        }
        await store.send(.wakeTapped) { $0.waking = true }
        await store.receive(\.wakeFinished) { $0.waking = false }
        XCTAssertEqual(sends.value.count, 1)
        XCTAssertEqual(sends.value.first?.host, "192.168.1.9")
        XCTAssertEqual(sends.value.first?.port, 9)
        XCTAssertEqual(sends.value.first?.bytes, 102)
    }

    func testAuthFailedClearsPasswordAndOpensForm() async {
        let store = TestStore(
            initialState: RemoteFeature.State(
                host: "mac.ts.net",
                credentials: VncCredentials(username: "jan", password: "pw"),
                status: .connecting
            )
        ) {
            RemoteFeature()
        }
        await store.send(.vncAuthFailed) {
            $0.status = .disconnected
            $0.credentials.password = ""
            $0.credentialFormOpen = true
            $0.authFailed = true
        }
    }

    func testSubmitCredentialsSavesAndReconnects() async {
        let saved = LockIsolated<VncCredentials?>(nil)
        let store = TestStore(
            initialState: RemoteFeature.State(host: "mac.ts.net", credentialFormOpen: true, authFailed: true)
        ) {
            RemoteFeature()
        } withDependencies: {
            $0.vncCredentialsStore.save = { saved.setValue($0) }
        }
        await store.send(.credentialsUsernameChanged("jan")) { $0.credentials.username = "jan" }
        await store.send(.credentialsPasswordChanged("newpw")) { $0.credentials.password = "newpw" }
        await store.send(.submitCredentials) {
            $0.credentialFormOpen = false
            $0.authFailed = false
            $0.status = .connecting
        }
        XCTAssertEqual(saved.value, VncCredentials(username: "jan", password: "newpw"))
    }

    func testSubmitCredentialsIgnoresEmpty() async {
        let saved = LockIsolated<VncCredentials?>(nil)

        // Whitespace-only username, non-empty password: no-op, form stays open.
        let store = TestStore(
            initialState: RemoteFeature.State(
                host: "mac.ts.net",
                credentials: VncCredentials(username: "   ", password: "pw"),
                credentialFormOpen: true
            )
        ) {
            RemoteFeature()
        } withDependencies: {
            $0.vncCredentialsStore.save = { saved.setValue($0) }
        }
        await store.send(.submitCredentials)
        XCTAssertNil(saved.value)

        // Empty password, non-empty username: also a no-op.
        let store2 = TestStore(
            initialState: RemoteFeature.State(
                host: "mac.ts.net",
                credentials: VncCredentials(username: "jan", password: ""),
                credentialFormOpen: true
            )
        ) {
            RemoteFeature()
        } withDependencies: {
            $0.vncCredentialsStore.save = { saved.setValue($0) }
        }
        await store2.send(.submitCredentials)
        XCTAssertNil(saved.value)
    }
}
