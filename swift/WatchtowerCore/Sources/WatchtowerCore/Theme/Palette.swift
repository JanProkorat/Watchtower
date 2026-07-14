import SwiftUI

/// Parse a `#RRGGBB` (or `RRGGBB`) hex string into sRGB components in 0...1.
/// Returns nil on malformed input. Host-agnostic (no UIKit/AppKit) so it is
/// unit-testable under `swift test` on macOS.
func hexRGB(_ hex: String) -> (red: Double, green: Double, blue: Double)? {
    let s = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
    guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
    return (
        red: Double((v >> 16) & 0xff) / 255,
        green: Double((v >> 8) & 0xff) / 255,
        blue: Double(v & 0xff) / 255
    )
}

public extension Color {
    /// Parse a `#RRGGBB` hex string. Falls back to clear on bad input.
    init(hex: String) {
        if let c = hexRGB(hex) {
            self.init(.sRGB, red: c.red, green: c.green, blue: c.blue, opacity: 1)
        } else {
            self = .clear
        }
    }
}

// Ocean-blue palette — mirrors the shared desktop/iPad tokens in
// packages/ui-core/src/glass.ts and packages/module-timetracker reports/tokens.ts.
// Keep these hexes in sync with that source of truth.
public enum Palette {
    public static let baseBg = Color(hex: "#0a0d13")
    public static let textPrimary = Color(hex: "#e5e7eb")
    public static let textMuted = Color(hex: "#9aa1ab")
    public static let textDim = Color(hex: "#5a6072")
    public static let accent = Color(hex: "#38bdf8")
    public static let accentIcon = Color(hex: "#bae6fd")

    public static let ctaGradient = LinearGradient(
        colors: [Color(hex: "#38bdf8"), Color(hex: "#0284c7")],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    // Primary chart series. Named `violet` to match the shared TS token, which
    // kept the name after the ocean remap even though the value is now sky-blue.
    public static let chartViolet = Color(hex: "#38bdf8")
    public static let chartCyan = Color(hex: "#22d3ee")
    public static let chartAmber = Color(hex: "#fbbf24")
}
