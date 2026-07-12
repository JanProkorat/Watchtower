import XCTest
@testable import WatchtowerCore

final class BucketsTests: XCTestCase {
    func testBucketKeyDayMonth() {
        XCTAssertEqual(bucketKey("2026-06-07", .day), "2026-06-07")
        XCTAssertEqual(bucketKey("2026-06-07", .month), "2026-06")
    }
    func testBucketKeyWeek() {
        // 2026-01-01 is Thursday → week 00 (before first Monday 2026-01-05)
        XCTAssertEqual(bucketKey("2026-01-01", .week), "2026-W00")
        XCTAssertEqual(bucketKey("2026-01-04", .week), "2026-W00") // Sunday, still pre-first-Monday
        XCTAssertEqual(bucketKey("2026-01-05", .week), "2026-W01") // first Monday
        XCTAssertEqual(bucketKey("2026-01-12", .week), "2026-W02")
    }
    func testEnumerateBucketsWeek() {
        XCTAssertEqual(enumerateBuckets("2026-01-01", "2026-01-14", .week), ["2026-W00", "2026-W01", "2026-W02"])
    }
    func testEnumerateBucketsDayInclusive() {
        XCTAssertEqual(enumerateBuckets("2026-06-06", "2026-06-08", .day), ["2026-06-06", "2026-06-07", "2026-06-08"])
    }
}
