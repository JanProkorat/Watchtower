import SwiftUI
import WatchtowerCore

/// Full-bleed ambient background: base color plus three soft radial washes.
/// Presentation-only — no state, safe to drop behind any screen.
struct AmbientBackground: View {
    var body: some View {
        ZStack {
            Palette.baseBg
            RadialGradient(colors: [Palette.ambientSky, .clear], center: .topLeading, startRadius: 0, endRadius: 620)
            RadialGradient(colors: [Palette.ambientCyan, .clear], center: .topTrailing, startRadius: 0, endRadius: 680)
            RadialGradient(colors: [Palette.ambientOcean, .clear], center: .bottomTrailing, startRadius: 0, endRadius: 760)
        }
        .ignoresSafeArea()
    }
}
