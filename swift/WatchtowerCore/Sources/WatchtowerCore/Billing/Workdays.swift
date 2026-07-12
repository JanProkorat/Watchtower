import Foundation

private func pad2(_ n: Int) -> String { String(format: "%02d", n) }
private func ymd(_ y: Int, _ m: Int, _ d: Int) -> String { "\(y)-\(pad2(m))-\(pad2(d))" }

/// Anonymous Gregorian — returns (month, day) of Easter Sunday.
private func easterSunday(_ year: Int) -> (month: Int, day: Int) {
    let a = year % 19
    let b = year / 100
    let c = year % 100
    let d = b / 4
    let e = b % 4
    let f = (b + 8) / 25
    let g = (b - f + 1) / 3
    let h = (19 * a + b - d - g + 15) % 30
    let i = c / 4
    let k = c % 4
    let l = (32 + 2 * e + 2 * i - h - k) % 7
    let m = (a + 11 * h + 22 * l) / 451
    let month = (h + l - 7 * m + 114) / 31
    let day = ((h + l - 7 * m + 114) % 31) + 1
    return (month, day)
}

// UTC calendar for all date-string arithmetic (never local zone).
private let utcCal: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "UTC")!
    return c
}()

private func date(_ y: Int, _ m: Int, _ d: Int) -> Date {
    utcCal.date(from: DateComponents(year: y, month: m, day: d))!
}

private func addDaysYmd(_ y: Int, _ m: Int, _ d: Int, _ delta: Int) -> (Int, Int, Int) {
    let dt = utcCal.date(byAdding: .day, value: delta, to: date(y, m, d))!
    let c = utcCal.dateComponents([.year, .month, .day], from: dt)
    return (c.year!, c.month!, c.day!)
}

public func czechHolidays(_ year: Int) -> Set<String> {
    var set = Set<String>()
    let fixed: [(Int, Int)] = [
        (1, 1), (5, 1), (5, 8), (7, 5), (7, 6),
        (9, 28), (10, 28), (11, 17), (12, 24), (12, 25), (12, 26),
    ]
    for (m, d) in fixed { set.insert(ymd(year, m, d)) }
    let e = easterSunday(year)
    let gf = addDaysYmd(year, e.month, e.day, -2)
    let em = addDaysYmd(year, e.month, e.day, +1)
    set.insert(ymd(gf.0, gf.1, gf.2))
    set.insert(ymd(em.0, em.1, em.2))
    return set
}

/// Mon–Fri in [from, to] (inclusive) minus Czech holidays minus `extraNonWorking`.
public func countWorkdays(_ from: String, _ to: String, _ extraNonWorking: Set<String>) -> Int {
    if from > to { return 0 }
    let fp = from.split(separator: "-").compactMap { Int($0) }
    let tp = to.split(separator: "-").compactMap { Int($0) }
    guard fp.count == 3, tp.count == 3 else { return 0 }
    var cur = date(fp[0], fp[1], fp[2])
    let end = date(tp[0], tp[1], tp[2])
    var holidaysByYear: [Int: Set<String>] = [:]
    var count = 0
    while cur <= end {
        let c = utcCal.dateComponents([.year, .month, .day, .weekday], from: cur)
        // Gregorian weekday: 1=Sun ... 7=Sat. Skip weekend.
        if c.weekday != 1 && c.weekday != 7 {
            let y = c.year!
            let hol = holidaysByYear[y] ?? {
                let h = czechHolidays(y); holidaysByYear[y] = h; return h
            }()
            let key = ymd(y, c.month!, c.day!)
            if !hol.contains(key) && !extraNonWorking.contains(key) { count += 1 }
        }
        cur = utcCal.date(byAdding: .day, value: 1, to: cur)!
    }
    return count
}
