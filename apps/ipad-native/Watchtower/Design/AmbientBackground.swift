import SwiftUI
import WatchtowerCore

/// Full-bleed ambient background: base color plus three soft radial washes.
/// Presentation-only — no state, safe to drop behind any screen.
///
/// Mirrors glass.ts `ambientBackground` (3 CSS radial-gradients over #0a0d13):
///   - sky:   60%×55% at   4%,  0%  rgba(56,189,248,0.30) → transparent 60%
///   - cyan:  70%×65% at 100%,  8%  rgba(34,211,238,0.20) → transparent 55%
///   - ocean: 85%×85% at  88%,100%  rgba(2,132,199,0.24)  → transparent 55%
///
/// `RadialGradient` centers below use precise `UnitPoint`s matching those
/// percentages exactly. Colors match exactly (Palette.ambient* == the same
/// hex/alpha). The one unavoidable delta: CSS radial-gradients here are
/// elliptical (independent width/height) while SwiftUI's `RadialGradient` is
/// circular (single radius in points) — endRadius below is tuned so the
/// relative sizing (sky smallest → cyan → ocean largest) still matches the
/// CSS ellipse-size ordering; this is as close as SwiftUI's primitive allows.
struct AmbientBackground: View {
    var body: some View {
        ZStack {
            Palette.baseBg
            RadialGradient(colors: [Palette.ambientSky, .clear], center: UnitPoint(x: 0.04, y: 0.0), startRadius: 0, endRadius: 620)
            RadialGradient(colors: [Palette.ambientCyan, .clear], center: UnitPoint(x: 1.0, y: 0.08), startRadius: 0, endRadius: 680)
            RadialGradient(colors: [Palette.ambientOcean, .clear], center: UnitPoint(x: 0.88, y: 1.0), startRadius: 0, endRadius: 760)
        }
        .ignoresSafeArea()
    }
}
