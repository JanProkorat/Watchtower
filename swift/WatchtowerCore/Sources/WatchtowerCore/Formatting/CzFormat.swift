import Foundation

public enum CzFormat {
    private static let czMonths = [
        "Leden", "Únor", "Březen", "Duben", "Květen", "Červen",
        "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec",
    ]

    private static func makeFormatter(fractionDigits: Int, grouping: Bool) -> NumberFormatter {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "cs_CZ")
        f.maximumFractionDigits = fractionDigits
        f.minimumFractionDigits = 0
        f.usesGroupingSeparator = grouping
        f.groupingSeparator = "\u{00A0}" // NBSP — match Intl cs-CZ, independent of OS locale data
        f.decimalSeparator = ","
        return f
    }

    /// `142 500 Kč` — NBSP grouping, 0 fraction digits, NBSP before Kč.
    public static func czk(_ amount: Double) -> String {
        let n = makeFormatter(fractionDigits: 0, grouping: true)
            .string(from: amount as NSNumber) ?? "0"
        return "\(n)\u{00A0}Kč"
    }

    /// `1,5 h` — minutes→hours, comma decimal, ≤2 fraction digits, no grouping.
    public static func hours(_ minutes: Double) -> String {
        let n = makeFormatter(fractionDigits: 2, grouping: false)
            .string(from: (minutes / 60) as NSNumber) ?? "0"
        return "\(n)\u{00A0}h"
    }

    /// `7. 6. 2026` — string-sliced, no Date, no leading zeros.
    public static func dateCz(_ iso: String) -> String {
        let p = iso.split(separator: "-")
        guard p.count == 3, let y = Int(p[0]), let m = Int(p[1]), let d = Int(p[2]) else { return iso }
        return "\(d). \(m). \(y)"
    }

    /// `Červen 2026` from `2026-06`.
    public static func czechMonthLabel(_ month: String) -> String {
        let p = month.split(separator: "-")
        guard p.count == 2, let y = Int(p[0]), let m = Int(p[1]), m >= 1, m <= 12 else { return month }
        return "\(czMonths[m - 1]) \(y)"
    }

    /// `2026-01` + delta months → `YYYY-MM` (pure integer math; no Date/TZ).
    public static func addMonths(_ month: String, _ delta: Int) -> String {
        let p = month.split(separator: "-")
        guard p.count == 2, let y = Int(p[0]), let m = Int(p[1]) else { return month }
        let total = y * 12 + (m - 1) + delta
        let ny = total / 12
        let nm = total % 12 + 1
        return String(format: "%04d-%02d", ny, nm)
    }
}
