import XCTest
import ComposableArchitecture
@testable import WatchtowerRemote

final class VncCredentialsTests: XCTestCase {
    func testCodableRoundTrip() throws {
        let creds = VncCredentials(username: "jan", password: "s3cret")
        let data = try JSONEncoder().encode(creds)
        let decoded = try JSONDecoder().decode(VncCredentials.self, from: data)
        XCTAssertEqual(decoded, creds)
    }

    func testInMemoryStoreOverrideRoundTrips() {
        // Proves the @DependencyClient surface is usable with a test double
        // (the pattern the RemoteFeature tests rely on).
        let box = LockIsolated<VncCredentials?>(nil)
        let store = VncCredentialsStore(
            load: { box.value },
            save: { box.setValue($0) },
            clear: { box.setValue(nil) }
        )
        XCTAssertNil(store.load())
        store.save(VncCredentials(username: "a", password: "b"))
        XCTAssertEqual(store.load(), VncCredentials(username: "a", password: "b"))
        store.clear()
        XCTAssertNil(store.load())
    }
}
