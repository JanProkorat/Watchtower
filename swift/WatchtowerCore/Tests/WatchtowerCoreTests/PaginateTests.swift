import XCTest
@testable import WatchtowerCore

// Swift tuples don't conform to Equatable, so `[(Int, Int)]` can't be compared
// with XCTAssertEqual directly — wrap call args in a tiny Equatable struct
// instead. This is a test-only compile fix; the pagination semantics being
// asserted are unchanged from the brief.
private struct PageCall: Equatable {
    let from: Int
    let to: Int
}

final class PaginateTests: XCTestCase {
    func testStopsWhenPartialPage() async throws {
        // 2500 items, page size 1000 → pages of 1000,1000,500 then stop.
        let all = Array(0..<2500)
        var calls: [PageCall] = []
        let out: [Int] = try await fetchAllPaged(pageSize: 1000) { from, to in
            calls.append(PageCall(from: from, to: to))
            guard from < all.count else { return [] }
            return Array(all[from...min(to, all.count - 1)])
        }
        XCTAssertEqual(out, all)
        XCTAssertEqual(calls, [
            PageCall(from: 0, to: 999),
            PageCall(from: 1000, to: 1999),
            PageCall(from: 2000, to: 2999),
        ]) // last page 500<1000 → stop
    }
    func testEmpty() async throws {
        let out: [Int] = try await fetchAllPaged(pageSize: 1000) { _, _ in [] }
        XCTAssertEqual(out, [])
    }
}
