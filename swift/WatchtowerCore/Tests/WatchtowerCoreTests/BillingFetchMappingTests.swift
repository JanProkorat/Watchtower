import XCTest
@testable import WatchtowerCore

final class BillingFetchMappingTests: XCTestCase {
    func testWorklogWithTaskChain() throws {
        let json = """
        {"sync_id":"w1","work_date":"2026-06-07","minutes":90,"effective_minutes":90,
         "earned_amount":1500,"reported_minutes":null,"description":null,"source":"manual",
         "tasks":{"number":"T-1","title":"Task","epics":{"projects":{"id":7,"name":"Proj","color":"#abc","kind":"work","is_billable":true}}}}
        """
        let dto = try JSONDecoder().decode(WorklogDTO.self, from: Data(json.utf8))
        let row = BillingMapper.worklog(dto)
        XCTAssertEqual(row.projectId, 7)
        XCTAssertEqual(row.projectName, "Proj")
        XCTAssertEqual(row.isBillable, true)
        XCTAssertEqual(row.taskNumber, "T-1")
        XCTAssertEqual(row.effectiveMinutes, 90)
    }
    func testWorklogWithoutTask() throws {
        let json = """
        {"sync_id":"w2","work_date":"2026-06-07","minutes":30,"effective_minutes":30,
         "earned_amount":null,"reported_minutes":null,"description":null,"source":null,"tasks":null}
        """
        let dto = try JSONDecoder().decode(WorklogDTO.self, from: Data(json.utf8))
        let row = BillingMapper.worklog(dto)
        XCTAssertEqual(row.projectId, 0)
        XCTAssertEqual(row.projectName, "")
        XCTAssertNil(row.earnedAmount)
    }
    func testTaskEstimateFallback() throws {
        let json = """
        {"id":1,"sync_id":"t1","epic_id":2,"number":"T-1","title":"T","status":"open",
         "estimated_minutes":null,"jira_estimate_secs":5400,"jira_status":null,"description":null,
         "epics":{"projects":{"id":7,"name":"P","color":null,"kind":"work","is_billable":true}}}
        """
        let dto = try JSONDecoder().decode(TaskDTO.self, from: Data(json.utf8))
        XCTAssertEqual(BillingMapper.task(dto).estimatedMinutes, 90)
    }
}
