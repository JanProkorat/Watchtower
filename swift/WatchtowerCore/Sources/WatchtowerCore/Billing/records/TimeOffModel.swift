import Foundation

/// Kind of a time-off / holiday day rendered on the TimeOff calendar. Ported
/// from `TimeOffKind` in `timeOffModel.ts:5`.
public enum TimeOffKind: String, Equatable, Sendable {
    case vacation
    case sick
    case other
    case holiday
}

/// One calendar cell: `nil` fields for leading/trailing pad cells outside the
/// month. Ported from `CalDay` in `timeOffModel.ts:6`.
public struct CalDay: Equatable, Sendable {
    public let date: String?
    public let kind: TimeOffKind?
    public let isWeekend: Bool

    public init(date: String?, kind: TimeOffKind?, isWeekend: Bool) {
        self.date = date
        self.kind = kind
        self.isWeekend = isWeekend
    }
}

/// One rendered month: label + Monday-first weeks padded to full rows.
/// Ported from `MonthCal` in `timeOffModel.ts:7`.
public struct MonthCal: Equatable, Sendable {
    public let month: String
    public let label: String
    public let weeks: [[CalDay]]

    public init(month: String, label: String, weeks: [[CalDay]]) {
        self.month = month
        self.label = label
        self.weeks = weeks
    }
}

/// One entry in the "upcoming" list (future holiday or user day-off). Ported
/// from `UpcomingItem` in `timeOffModel.ts:8`.
public struct UpcomingItem: Equatable, Sendable {
    public let date: String
    public let kind: TimeOffKind
    public let note: String?

    public init(date: String, kind: TimeOffKind, note: String?) {
        self.date = date
        self.kind = kind
        self.note = note
    }
}

/// Three-month calendar strip (prev/focus/next) plus the merged upcoming
/// list. Ported from `TimeOffModel` in `timeOffModel.ts:9`.
public struct TimeOffModel: Equatable, Sendable {
    public let months: [MonthCal]
    public let upcoming: [UpcomingItem]

    public init(months: [MonthCal], upcoming: [UpcomingItem]) {
        self.months = months
        self.upcoming = upcoming
    }
}

private func pad2(_ n: Int) -> String { String(format: "%02d", n) }

/// Raw `days_off.kind` not in {vacation, sick, other} normalizes to `.other`.
/// Ported from `normalizeKind` in `timeOffModel.ts:13-15`.
private func normalizeKind(_ raw: String) -> TimeOffKind {
    TimeOffKind(rawValue: raw).flatMap { $0 == .holiday ? nil : $0 } ?? .other
}

private let utcCal: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "UTC")!
    return c
}()

/// Builds one Monday-first month grid, sliced into 7-wide weeks with
/// leading/trailing `nil` pad cells. Ported from `buildMonth` in
/// `timeOffModel.ts:17-39`.
private func buildMonth(_ month: String, daysOff: [String: TimeOffKind], holidays: [String: String]) -> MonthCal {
    let parts = month.split(separator: "-").compactMap { Int($0) }
    let y = parts.count > 0 ? parts[0] : 0
    let m = parts.count > 1 ? parts[1] : 1

    guard let firstOfMonth = utcCal.date(from: DateComponents(year: y, month: m, day: 1)),
          let range = utcCal.range(of: .day, in: .month, for: firstOfMonth) else {
        return MonthCal(month: month, label: CzFormat.czechMonthLabel(month), weeks: [])
    }
    let daysInMonth = range.count
    // Monday-first leading pad: Calendar weekday Sun=1..Sat=7 → Mon=0..Sun=6.
    let firstWeekday = utcCal.component(.weekday, from: firstOfMonth)
    let firstDow = (firstWeekday + 5) % 7

    var cells: [CalDay] = []
    for _ in 0..<firstDow { cells.append(CalDay(date: nil, kind: nil, isWeekend: false)) }
    for d in 1...daysInMonth {
        let date = "\(y)-\(pad2(m))-\(pad2(d))"
        let dow = utcCal.component(.weekday, from: utcCal.date(from: DateComponents(year: y, month: m, day: d))!)
        // Calendar weekday: 1=Sun ... 7=Sat.
        let isWeekend = dow == 1 || dow == 7
        let kind: TimeOffKind? = daysOff[date] ?? (holidays[date] != nil ? .holiday : nil)
        cells.append(CalDay(date: date, kind: kind, isWeekend: isWeekend))
    }
    while cells.count % 7 != 0 { cells.append(CalDay(date: nil, kind: nil, isWeekend: false)) }

    var weeks: [[CalDay]] = []
    var i = 0
    while i < cells.count {
        weeks.append(Array(cells[i..<min(i + 7, cells.count)]))
        i += 7
    }
    return MonthCal(month: month, label: CzFormat.czechMonthLabel(month), weeks: weeks)
}

/// Builds the 3-month TimeOff calendar strip (`focusMonth` -1/0/+1) plus the
/// merged upcoming list (future Czech holidays ∪ future user days-off, user
/// wins ties, ascending, capped at 30). Ported from `buildTimeOffModel` in
/// `timeOffModel.ts:41-69`.
public func buildTimeOffModel(focusMonth: String, daysOff: [DayOffRow], today: String) -> TimeOffModel {
    var userByDate: [String: TimeOffKind] = [:]
    for d in daysOff { userByDate[d.date] = normalizeKind(d.kind) }

    let focusYearParts = focusMonth.split(separator: "-")
    let focusYear = focusYearParts.first.flatMap { Int($0) } ?? 0

    var holidays: [String: String] = [:]
    for yr in [focusYear - 1, focusYear, focusYear + 1] {
        for (date, name) in czechHolidayNames(yr) { holidays[date] = name }
    }

    let months = [CzFormat.addMonths(focusMonth, -1), focusMonth, CzFormat.addMonths(focusMonth, 1)]
        .map { buildMonth($0, daysOff: userByDate, holidays: holidays) }

    // Upcoming: future user days_off ∪ holidays (prior year + focus year +
    // next), user wins, ascending, cap 30. focusYear-1 is included because
    // the -1 calendar pane can show still-future prior-year holidays (e.g.
    // Dec when focus=Jan).
    var upcomingByDate: [String: UpcomingItem] = [:]
    for yr in [focusYear - 1, focusYear, focusYear + 1] {
        for (date, name) in czechHolidayNames(yr) where date >= today {
            upcomingByDate[date] = UpcomingItem(date: date, kind: .holiday, note: name)
        }
    }
    for (date, kind) in userByDate where date >= today {
        upcomingByDate[date] = UpcomingItem(date: date, kind: kind, note: nil) // user wins
    }
    let upcoming = upcomingByDate.values.sorted { $0.date < $1.date }.prefix(30)

    return TimeOffModel(months: months, upcoming: Array(upcoming))
}
