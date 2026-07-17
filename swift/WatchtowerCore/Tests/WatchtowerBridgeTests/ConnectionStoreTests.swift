import XCTest
@testable import WatchtowerBridge

final class ConnectionStoreTests: XCTestCase {
    private func ephemeralDefaults() -> UserDefaults {
        let suite = "connection-store-tests-\(UUID().uuidString)"
        let d = UserDefaults(suiteName: suite)!
        d.removePersistentDomain(forName: suite)
        return d
    }

    func testLoadReturnsNilWhenEmpty() {
        let store = ConnectionStore.store(defaults: ephemeralDefaults())
        XCTAssertNil(store.load())
    }

    func testSaveThenLoadRoundTrip() {
        let store = ConnectionStore.store(defaults: ephemeralDefaults())
        let conn = Connection(host: "10.0.0.5", port: 7445, token: "tok", mac: "AA:BB:CC:DD:EE:FF")
        store.save(conn)
        XCTAssertEqual(store.load(), conn)
    }

    func testLoadToleratesCorruptData() {
        let defaults = ephemeralDefaults()
        defaults.set(Data("not json".utf8), forKey: ConnectionStore.key)
        let store = ConnectionStore.store(defaults: defaults)
        XCTAssertNil(store.load())
    }
}
