import XCTest
@testable import WatchtowerCore

final class BreakdownTests: XCTestCase {
    private func wl(_ pid: Int, _ name: String, _ eff: Double, _ earned: Double?) -> WorklogRow {
        WorklogRow(syncId: "\(pid)-\(eff)", workDate: "2026-06-10", minutes: eff, reportedMinutes: nil, effectiveMinutes: eff,
            earnedAmount: earned, description: nil, projectId: pid, projectName: name, projectColor: nil,
            projectKind: "work", isBillable: true, taskNumber: nil, taskTitle: nil, source: nil)
    }
    func testBreakdownShares() {
        let rows = [wl(1,"Alpha",60,1000), wl(2,"Beta",180,3000), wl(3,"Gamma",0,nil)]
        let s = projectBreakdown(rows, from: "2026-06-01", to: "2026-06-30")
        XCTAssertEqual(s.map(\.projectId), [2, 1])          // 180 desc, then 60; zero-minute Gamma filtered
        XCTAssertEqual(s.first?.share ?? 0, 0.75, accuracy: 0.0001) // 180/240
    }
}
