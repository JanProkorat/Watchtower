import XCTest
@testable import WatchtowerCore

final class BillingModelsTests: XCTestCase {
    func testDatasetCodableRoundTrip() throws {
        let ds = BillingDataset(
            worklogs: [WorklogRow(syncId: "w1", workDate: "2026-06-07", minutes: 90, reportedMinutes: nil,
                effectiveMinutes: 90, earnedAmount: 1500, description: nil, projectId: 1, projectName: "P",
                projectColor: "#111111", projectKind: "work", isBillable: true, taskNumber: "T-1",
                taskTitle: "Task", source: "manual")],
            contracts: [], daysOff: [], projects: [ProjectRow(id: 1, name: "P", color: "#111111", kind: "work", isBillable: true)],
            tasks: [], epics: [], fetchedAt: "2026-06-07T10:00:00Z")
        let data = try JSONEncoder().encode(ds)
        let back = try JSONDecoder().decode(BillingDataset.self, from: data)
        XCTAssertEqual(back, ds)
        XCTAssertEqual(back.worklogs.first?.earnedAmount, 1500)
        XCTAssertNil(back.worklogs.first?.reportedMinutes)
    }
}
