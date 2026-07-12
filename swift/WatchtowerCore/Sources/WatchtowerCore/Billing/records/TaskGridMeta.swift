import Foundation

/// Kind of a non-working / status day rendered on the task grid. Ported from
/// the `DayMeta['kind']` union in `TaskGridView.tsx:16`.
public enum GridDayKind: String, Equatable, Sendable {
    case holiday
    case vacation
    case sick
    case other
}

/// Per-day tint metadata for one column of the task grid: weekend / holiday /
/// vacation / sick / today. Ported from `TaskGridView.tsx:84-93`.
public struct GridDayMeta: Equatable, Sendable {
    public let day: Int
    public let date: String
    public let isWeekend: Bool
    public let isToday: Bool
    public let kind: GridDayKind?

    public init(day: Int, date: String, isWeekend: Bool, isToday: Bool, kind: GridDayKind?) {
        self.day = day
        self.date = date
        self.isWeekend = isWeekend
        self.isToday = isToday
        self.kind = kind
    }
}

private let utcCal: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "UTC")!
    return c
}()

private func pad2(_ n: Int) -> String { String(format: "%02d", n) }

/// One `GridDayMeta` per day 1...daysInMonth of `month` ("YYYY-MM"). Ported
/// from the inline day-meta loop in `TaskGridView.tsx:77-93`. Holiday wins
/// over a matching `daysOff` entry for the same date; any daysOff kind
/// outside {vacation, sick, other} normalizes to `.other`.
public func gridDayMeta(month: String, daysOff: [DayOffRow], today: String) -> [GridDayMeta] {
    let parts = month.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 2 else { return [] }
    let year = parts[0]
    let mon = parts[1]
    guard let firstOfMonth = utcCal.date(from: DateComponents(year: year, month: mon, day: 1)) else { return [] }
    guard let range = utcCal.range(of: .day, in: .month, for: firstOfMonth) else { return [] }
    let daysInMonth = range.count
    let holidayDates = Set(czechHolidayNames(year).keys)
    let daysOffByDate = Dictionary(uniqueKeysWithValues: daysOff.map { ($0.date, $0.kind) }.reversed())

    var out: [GridDayMeta] = []
    out.reserveCapacity(daysInMonth)
    for d in 1...daysInMonth {
        let date = "\(month)-\(pad2(d))"
        let dow = utcCal.component(.weekday, from: utcCal.date(from: DateComponents(year: year, month: mon, day: d))!)
        // Calendar weekday: 1=Sun ... 7=Sat.
        let isWeekend = dow == 1 || dow == 7
        let isToday = date == today
        let kind: GridDayKind?
        if holidayDates.contains(date) {
            kind = .holiday
        } else if let rawKind = daysOffByDate[date] {
            kind = GridDayKind(rawValue: rawKind) ?? .other
        } else {
            kind = nil
        }
        out.append(GridDayMeta(day: d, date: date, isWeekend: isWeekend, isToday: isToday, kind: kind))
    }
    return out
}

/// Footer capacity/expected-earnings totals for one month. Ported from
/// `TaskGridView.tsx:95-118`.
public struct ExpectedEarnings: Equatable, Sendable {
    public let capacityMinutes: Int
    public let expectedCzk: Double

    public init(capacityMinutes: Int, expectedCzk: Double) {
        self.capacityMinutes = capacityMinutes
        self.expectedCzk = expectedCzk
    }
}

/// Computes capacity (workdays * 8h) and expected earnings (sum over each
/// workday x each billable project of the contract rate active that day) for
/// `month` ("YYYY-MM"). Ported from `TaskGridView.tsx:100-116`.
public func expectedEarnings(month: String, worklogs: [WorklogRow], contracts: [ContractRow], daysOff: [DayOffRow], projectIds: [Int]) -> ExpectedEarnings {
    let parts = month.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 2 else { return ExpectedEarnings(capacityMinutes: 0, expectedCzk: 0) }
    let year = parts[0]
    let mon = parts[1]
    guard let firstOfMonth = utcCal.date(from: DateComponents(year: year, month: mon, day: 1)),
          let range = utcCal.range(of: .day, in: .month, for: firstOfMonth) else {
        return ExpectedEarnings(capacityMinutes: 0, expectedCzk: 0)
    }
    let daysInMonth = range.count
    let monthStart = "\(month)-01"
    let monthEnd = "\(month)-\(pad2(daysInMonth))"

    let daysOffSet = Set(daysOff.filter { $0.date >= monthStart && $0.date <= monthEnd }.map { $0.date })
    let workdays = workdayDates(monthStart, monthEnd, daysOffSet)
    let capacityMinutes = workdays.count * 8 * 60

    // billableProjectIds: distinct projectId of ALL worklogs (no month filter,
    // matching TaskGridView.tsx:110-111 / desktop grid) that pass the project
    // filter (empty = all) and are billable with a real projectId.
    var seenProjectIds: [Int] = []
    var seenSet = Set<Int>()
    for w in worklogs where (projectIds.isEmpty || projectIds.contains(w.projectId)) && w.isBillable && w.projectId != 0 {
        if !seenSet.contains(w.projectId) {
            seenSet.insert(w.projectId)
            seenProjectIds.append(w.projectId)
        }
    }

    var expectedCzk = 0.0
    for date in workdays {
        for pid in seenProjectIds {
            if let c = contracts.first(where: { $0.projectId == pid && $0.effectiveFrom <= date && ($0.endDate == nil || date <= $0.endDate!) }) {
                expectedCzk += c.rateType == "daily" ? c.rateAmount : c.rateAmount * c.hoursPerDay
            }
        }
    }
    expectedCzk = expectedCzk.rounded()

    return ExpectedEarnings(capacityMinutes: capacityMinutes, expectedCzk: expectedCzk)
}
