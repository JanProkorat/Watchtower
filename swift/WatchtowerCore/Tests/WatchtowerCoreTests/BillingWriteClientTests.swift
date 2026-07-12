import XCTest
import ComposableArchitecture
@testable import WatchtowerCore

/// `BillingWriteClient` performs live Supabase writes, which aren't
/// host-testable here. This suite only proves the `@DependencyClient`
/// scaffolding: `testValue`'s unimplemented closures exist and are
/// overridable, since Milestone 3's reducer tests depend on stubbing every
/// closure listed below to exercise the write flow without a network call.
final class BillingWriteClientTests: XCTestCase {
    func testValueClosuresAreOverridable() async throws {
        var client = BillingWriteClient.testValue
        client.findDayOffSyncId = { date in
            XCTAssertEqual(date, "2026-07-12")
            return "stub-sync-id"
        }
        client.insertTask = { payload in
            XCTAssertEqual(payload.number, "42")
            return 42
        }

        let syncId = try await client.findDayOffSyncId("2026-07-12")
        XCTAssertEqual(syncId, "stub-sync-id")

        let newId = try await client.insertTask(
            TaskInsertPayload(
                syncId: "sync-1",
                epicId: 1,
                number: "42",
                title: "Task",
                status: "open",
                estimatedMinutes: nil,
                description: nil,
                deletedAt: nil,
                updatedAt: "2026-07-12T00:00:00Z"
            )
        )
        XCTAssertEqual(newId, 42)
    }
}
