import XCTest
@testable import WatchtowerCore

final class BillingCacheTests: XCTestCase {
    private func sample() -> BillingDataset {
        BillingDataset(worklogs: [], contracts: [], daysOff: [], projects: [], tasks: [], epics: [],
                       fetchedAt: "2026-06-07T10:00:00Z")
    }
    func testCodecRoundTrip() {
        let data = BillingCacheCodec.encode(sample())
        XCTAssertEqual(BillingCacheCodec.decode(data), sample())
    }
    func testDecodeGarbageReturnsNil() {
        XCTAssertNil(BillingCacheCodec.decode(Data("not json".utf8)))
        XCTAssertNil(BillingCacheCodec.decode(Data("{}".utf8))) // missing required fields
    }
}
