import SwiftUI
import WatchtowerCore

// MARK: - Section header

/// Shared uppercase section label used across Dashboard/Earnings views.
struct SectionHeader: View {
    let title: String

    var body: some View {
        Text(title.uppercased())
            .font(.caption.weight(.bold))
            .foregroundStyle(Palette.textMuted)
            .tracking(0.8)
    }
}

// MARK: - Glass card container

/// Shared translucent card container used across Dashboard/Earnings views.
struct GlassCard<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        content
            .padding(14)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }
}
