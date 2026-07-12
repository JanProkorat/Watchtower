import XCTest
@testable import WatchtowerCore

/// Minimal type-erasing Encodable wrapper so `enc(_:)` below can accept any
/// concrete payload type without generic-parameter plumbing in the test body.
private struct AnyEncodable: Encodable {
    private let encodeFunc: (Encoder) throws -> Void
    init<T: Encodable>(_ wrapped: T) {
        encodeFunc = wrapped.encode
    }
    func encode(to encoder: Encoder) throws {
        try encodeFunc(encoder)
    }
}

final class BillingWriteMappingTests: XCTestCase {
    private func enc(_ v: Encodable) -> [String: Any] {
        let d = try! JSONEncoder().encode(AnyEncodable(v))
        return (try! JSONSerialization.jsonObject(with: d)) as! [String: Any]
    }

    /// Builds a WorklogRow using the real memberwise init from BillingModels.swift.
    /// `earned` maps to earnedAmount; effectiveMinutes mirrors minutes (reportedMinutes nil).
    private func makeWorklog(projectId: Int, minutes: Double, earned: Double?) -> WorklogRow {
        WorklogRow(
            syncId: "w-\(projectId)-\(minutes)",
            workDate: "2026-03-01",
            minutes: minutes,
            reportedMinutes: nil,
            effectiveMinutes: minutes,
            earnedAmount: earned,
            description: nil,
            projectId: projectId,
            projectName: "Project \(projectId)",
            projectColor: nil,
            projectKind: "work",
            isBillable: true,
            taskNumber: nil,
            taskTitle: nil,
            source: "manual"
        )
    }

    func testComputeDerivedForWriteFiltersByProject() {
        let contracts = [
            ContractRow(syncId: "a", projectId: 1, effectiveFrom: "2026-01-01", endDate: nil, rateType: "hourly", rateAmount: 100, hoursPerDay: 8, mdLimit: nil, contractGroupId: nil),
            ContractRow(syncId: "b", projectId: 2, effectiveFrom: "2026-01-01", endDate: nil, rateType: "hourly", rateAmount: 999, hoursPerDay: 8, mdLimit: nil, contractGroupId: nil),
        ]
        let r = computeDerivedForWrite(contracts: contracts, projectId: 1, minutes: 60, reportedMinutes: nil, workDate: "2026-03-01")
        XCTAssertEqual(r.earnedAmount, 100)
    }

    func testWorklogInsertHardcodesManualSource() {
        let billing = WorklogBilling(effectiveMinutes: 60, resolvedRate: 100, earnedAmount: 100)
        let p = buildWorklogInsert(taskId: 7, input: WorklogWriteInput(workDate: "2026-03-01", minutes: 60, reportedMinutes: nil, description: "x"),
                                   syncId: "s1", now: "2026-03-01T10:00:00Z", billing: billing)
        let j = enc(p)
        XCTAssertEqual(j["source"] as? String, "manual")
        XCTAssertTrue(j["external_id"] is NSNull)
        XCTAssertEqual(j["work_date"] as? String, "2026-03-01")
        XCTAssertEqual(j["effective_minutes"] as? Double, 60)
    }

    func testWorklogInsertNullColumnsAndValues() {
        let billing = WorklogBilling(effectiveMinutes: 60, resolvedRate: 100, earnedAmount: 100)
        let p = buildWorklogInsert(taskId: 7, input: WorklogWriteInput(workDate: "2026-03-01", minutes: 60, reportedMinutes: nil, description: "x"),
                                   syncId: "s1", now: "2026-03-01T10:00:00Z", billing: billing)
        let j = enc(p)
        XCTAssertEqual(j["sync_id"] as? String, "s1")
        XCTAssertEqual(j["task_id"] as? Int, 7)
        XCTAssertEqual(j["minutes"] as? Double, 60)
        XCTAssertTrue(j["reported_minutes"] is NSNull)
        XCTAssertEqual(j["description"] as? String, "x")
        XCTAssertEqual(j["jira_uploaded"] as? Bool, false)
        XCTAssertTrue(j["deleted_at"] is NSNull)
        XCTAssertEqual(j["updated_at"] as? String, "2026-03-01T10:00:00Z")
        XCTAssertEqual(j["resolved_rate"] as? Double, 100)
        XCTAssertEqual(j["earned_amount"] as? Double, 100)
    }

    func testWorklogUpdateColumns() {
        let billing = WorklogBilling(effectiveMinutes: 30, resolvedRate: nil, earnedAmount: nil)
        let p = buildWorklogUpdate(input: WorklogWriteInput(workDate: "2026-04-01", minutes: 30, reportedMinutes: nil, description: nil),
                                   now: "2026-04-01T00:00:00Z", billing: billing)
        let j = enc(p)
        XCTAssertEqual(j["work_date"] as? String, "2026-04-01")
        XCTAssertEqual(j["minutes"] as? Double, 30)
        XCTAssertTrue(j["reported_minutes"] is NSNull)
        XCTAssertTrue(j["description"] is NSNull)
        XCTAssertEqual(j["updated_at"] as? String, "2026-04-01T00:00:00Z")
        XCTAssertEqual(j["effective_minutes"] as? Double, 30)
        XCTAssertTrue(j["resolved_rate"] is NSNull)
        XCTAssertTrue(j["earned_amount"] is NSNull)
        // Update rows never touch source/external_id/jira_uploaded/deleted_at.
        XCTAssertNil(j["source"])
        XCTAssertNil(j["deleted_at"])
    }

    func testTaskInsertAndUpdateColumns() {
        let input = TaskWriteInput(epicId: 3, number: "42", title: "Do thing", status: "todo", estimatedMinutes: 120, description: nil)
        let insert = enc(buildTaskInsert(input: input, syncId: "t1", now: "2026-03-01T00:00:00Z"))
        XCTAssertEqual(insert["sync_id"] as? String, "t1")
        XCTAssertEqual(insert["epic_id"] as? Int, 3)
        XCTAssertEqual(insert["number"] as? String, "42")
        XCTAssertEqual(insert["title"] as? String, "Do thing")
        XCTAssertEqual(insert["status"] as? String, "todo")
        XCTAssertEqual(insert["estimated_minutes"] as? Double, 120)
        XCTAssertTrue(insert["description"] is NSNull)
        XCTAssertTrue(insert["deleted_at"] is NSNull)
        XCTAssertEqual(insert["updated_at"] as? String, "2026-03-01T00:00:00Z")

        let update = enc(buildTaskUpdate(input: input, now: "2026-03-02T00:00:00Z"))
        XCTAssertEqual(update["epic_id"] as? Int, 3)
        XCTAssertEqual(update["number"] as? String, "42")
        XCTAssertEqual(update["updated_at"] as? String, "2026-03-02T00:00:00Z")
        XCTAssertNil(update["sync_id"])
        XCTAssertNil(update["deleted_at"])
    }

    func testContractInsertUpdateEndDateColumns() {
        let input = ContractWriteInput(effectiveFrom: "2026-01-01", endDate: nil, rateType: "hourly", rateAmount: 100, hoursPerDay: 8, mdLimit: nil)
        let insert = enc(buildContractInsert(input: input, projectId: 9, syncId: "c1", now: "2026-01-01T00:00:00Z", groupId: nil))
        XCTAssertEqual(insert["sync_id"] as? String, "c1")
        XCTAssertEqual(insert["project_id"] as? Int, 9)
        XCTAssertEqual(insert["effective_from"] as? String, "2026-01-01")
        XCTAssertEqual(insert["rate_type"] as? String, "hourly")
        XCTAssertEqual(insert["rate_amount"] as? Double, 100)
        XCTAssertEqual(insert["hours_per_day"] as? Double, 8)
        XCTAssertTrue(insert["end_date"] is NSNull)
        XCTAssertTrue(insert["md_limit"] is NSNull)
        XCTAssertTrue(insert["contract_group_id"] is NSNull)
        XCTAssertTrue(insert["deleted_at"] is NSNull)
        XCTAssertEqual(insert["updated_at"] as? String, "2026-01-01T00:00:00Z")

        let update = enc(buildContractUpdate(input: input, now: "2026-02-01T00:00:00Z"))
        XCTAssertEqual(update["effective_from"] as? String, "2026-01-01")
        XCTAssertEqual(update["updated_at"] as? String, "2026-02-01T00:00:00Z")
        XCTAssertNil(update["sync_id"])

        let endDate = enc(buildContractEndDate(endDate: "2026-06-30", now: "2026-06-01T00:00:00Z"))
        XCTAssertEqual(endDate["end_date"] as? String, "2026-06-30")
        XCTAssertEqual(endDate["updated_at"] as? String, "2026-06-01T00:00:00Z")
        XCTAssertEqual(endDate.count, 2)
    }

    func testContractInsertEmitsContractGroupIdWhenProvided() {
        let input = ContractWriteInput(effectiveFrom: "2026-01-01", endDate: nil, rateType: "hourly", rateAmount: 100, hoursPerDay: 8, mdLimit: nil)
        let insert = enc(buildContractInsert(input: input, projectId: 9, syncId: "c1", now: "2026-01-01T00:00:00Z", groupId: "group-123"))
        XCTAssertEqual(insert["contract_group_id"] as? String, "group-123")
    }

    func testDayOffUpsertColumns() {
        let j = enc(buildDayOffUpsert(date: "2026-03-05", kind: "vacation", syncId: "d1", now: "2026-03-01T00:00:00Z"))
        XCTAssertEqual(j["sync_id"] as? String, "d1")
        XCTAssertEqual(j["date"] as? String, "2026-03-05")
        XCTAssertEqual(j["kind"] as? String, "vacation")
        XCTAssertTrue(j["note"] is NSNull)
        XCTAssertTrue(j["deleted_at"] is NSNull)
        XCTAssertEqual(j["updated_at"] as? String, "2026-03-01T00:00:00Z")
    }

    func testSoftDeleteStampsBothTimestamps() {
        let j = enc(softDelete(now: "2026-03-01T10:00:00Z"))
        XCTAssertEqual(j["deleted_at"] as? String, "2026-03-01T10:00:00Z")
        XCTAssertEqual(j["updated_at"] as? String, "2026-03-01T10:00:00Z")
        XCTAssertEqual(j.count, 2)
    }

    func testRebillRecomputesOnlyTargetProject() {
        let contracts = [ContractRow(syncId: "a", projectId: 1, effectiveFrom: "2026-01-01", endDate: nil, rateType: "hourly", rateAmount: 200, hoursPerDay: 8, mdLimit: nil, contractGroupId: nil)]
        let w1 = makeWorklog(projectId: 1, minutes: 60, earned: 0)
        let w2 = makeWorklog(projectId: 2, minutes: 60, earned: 42)
        let out = rebillProjectWorklogs([w1, w2], projectId: 1, contracts: contracts)
        XCTAssertEqual(out[0].earnedAmount, 200)
        XCTAssertEqual(out[1].earnedAmount, 42) // untouched
    }

    func testLiteFiltersByProjectAndDropsExtraFields() {
        let contracts = [
            ContractRow(syncId: "a", projectId: 1, effectiveFrom: "2026-01-01", endDate: nil, rateType: "hourly", rateAmount: 100, hoursPerDay: 8, mdLimit: nil, contractGroupId: nil),
            ContractRow(syncId: "b", projectId: 2, effectiveFrom: "2026-01-01", endDate: nil, rateType: "hourly", rateAmount: 999, hoursPerDay: 8, mdLimit: nil, contractGroupId: nil),
        ]
        let result = lite(contracts, projectId: 1)
        XCTAssertEqual(result.count, 1)
        XCTAssertEqual(result[0].rateAmount, 100)
    }
}
