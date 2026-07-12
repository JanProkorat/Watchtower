import Foundation

/// Ported from packages/shared/src/billing/parseMinutes.ts — returns nil where TS returns NaN.
public func parseMinutes(_ input: String) -> Int? {
    // Trim, lowercase, replace FIRST comma with dot (String.replace w/o /g).
    var trimmed = input.trimmingCharacters(in: .whitespaces).lowercased()
    if let comma = trimmed.firstIndex(of: ",") { trimmed.replaceSubrange(comma...comma, with: ".") }
    if trimmed.isEmpty { return nil }

    // 1) pure decimal hours: ^\d+(\.\d+)?$
    if matches(trimmed, #"^\d+(\.\d+)?$"#), let hours = Double(trimmed) {
        return Int((hours * 60).rounded())
    }
    // 2) H:MM colon form: ^(\d+):(\d{1,2})$  (minutes NOT clamped)
    if let g = capture(trimmed, #"^(\d+):(\d{1,2})$"#), let h = Int(g[0]), let m = Int(g[1]) {
        return h * 60 + m
    }
    // 3) [Nh][Mm] form: ^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$ — at least one group present
    if let g = optionalCapture(trimmed, #"^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$"#) {
        let hStr = g[0], mStr = g[1]
        if !hStr.isEmpty || !mStr.isEmpty {
            let hoursPart = Int(((Double(hStr) ?? 0) * 60).rounded())
            let minsPart = Int(mStr) ?? 0
            return hoursPart + minsPart
        }
    }
    return nil
}

private func matches(_ s: String, _ pattern: String) -> Bool {
    s.range(of: pattern, options: .regularExpression) != nil
}
// Returns the capture groups (empty string for a group that didn't match), or nil if no overall match.
private func capture(_ s: String, _ pattern: String) -> [String]? { runRegex(s, pattern, groups: 2, requireAll: true) }
private func optionalCapture(_ s: String, _ pattern: String) -> [String]? { runRegex(s, pattern, groups: 2, requireAll: false) }

private func runRegex(_ s: String, _ pattern: String, groups: Int, requireAll: Bool) -> [String]? {
    guard let re = try? NSRegularExpression(pattern: pattern) else { return nil }
    let range = NSRange(s.startIndex..., in: s)
    guard let m = re.firstMatch(in: s, range: range) else { return nil }
    var out: [String] = []
    for i in 1...groups {
        let r = m.range(at: i)
        if r.location == NSNotFound {
            if requireAll { return nil }
            out.append("")
        } else if let sr = Range(r, in: s) {
            out.append(String(s[sr]))
        } else { out.append("") }
    }
    return out
}
