import SwiftUI
import WatchtowerCore

extension View {
    /// Floating/functional-layer glass (rail, tab strip, pills). Regular variant, optional tint.
    func floatingGlass(cornerRadius: CGFloat = 14, tint: Color? = nil) -> some View {
        glassEffect(tint.map { .regular.tint($0) } ?? .regular, in: .rect(cornerRadius: cornerRadius))
    }

    /// Content-layer surface — solid, NOT glass (HIG).
    func contentCard(cornerRadius: CGFloat = 16) -> some View {
        self
            .background(RoundedRectangle(cornerRadius: cornerRadius).fill(Palette.contentFill))
            .overlay(RoundedRectangle(cornerRadius: cornerRadius).stroke(Palette.hairline, lineWidth: 1))
    }

    /// The frosted content card from apps/ipad's `glass.ts` `glassCard()` — KPI
    /// tiles, contract cards, top-projects rows, heatmap frame, etc. These
    /// REPEAT across a screen (KPI rows, project lists), so — mirroring the
    /// desktop glass-helper split (glassFill for repeating elements, real blur
    /// only for chrome singletons) — this is a translucent FILL over the
    /// ambient background rather than a live `.glassEffect`/backdrop-blur per
    /// instance. Border, shadow, and inset top highlight match glass.ts's
    /// `glassCard()` values exactly. This is the new default for content
    /// surfaces (`contentCard` above stays for call sites not yet migrated).
    func glassCard(cornerRadius: CGFloat = 16) -> some View {
        self
            .background(RoundedRectangle(cornerRadius: cornerRadius).fill(Palette.glassCardFill))
            .overlay(RoundedRectangle(cornerRadius: cornerRadius).stroke(Palette.hairline, lineWidth: 1))
            .overlay(
                // Approximates CSS `inset 0 1px 0 rgba(255,255,255,0.20)` — a
                // hairline highlight along the top inner edge. SwiftUI has no
                // inset-shadow primitive, so mask a full-perimeter stroke with
                // a top-to-center fade (brightest at top, gone by mid-height).
                RoundedRectangle(cornerRadius: cornerRadius)
                    .stroke(Color.white.opacity(0.20), lineWidth: 1)
                    .mask(LinearGradient(colors: [.white, .clear], startPoint: .top, endPoint: .center))
            )
            .shadow(color: Color.black.opacity(0.38), radius: 20, x: 0, y: 10)
    }

    /// Near-solid, NON-frosted surface for dense data (worklog ledger, task
    /// grid, board columns). Matches glass.ts `dataPanelFill`. Apply to the
    /// table/grid wrapper itself, not the card frame around it.
    func dataPanel(cornerRadius: CGFloat = 16) -> some View {
        self
            .background(RoundedRectangle(cornerRadius: cornerRadius).fill(Palette.dataPanelFill))
            .overlay(RoundedRectangle(cornerRadius: cornerRadius).stroke(Palette.hairline, lineWidth: 1))
    }
}

/// Uppercase section header used across every screen (KPI groups, contract
/// lists, dashboard sections) — canonical cross-module equivalent of
/// `glass.ts`-driven web `SectionHeader` styling (11px bold, 0.8 kerning,
/// uppercase, muted text, 8pt bottom padding). A `SectionHeader` view already
/// exists in `Views/Billing` (Phase 5, per-file style); this is added
/// alongside it without breaking existing call sites — consolidation is a
/// later design-align task.
struct SectionHeaderLabel: View {
    private let title: String

    init(_ title: String) {
        self.title = title
    }

    var body: some View {
        Text(title)
            .font(.system(size: 11, weight: .bold))
            .kerning(0.8)
            .textCase(.uppercase)
            .foregroundStyle(Palette.textMuted)
            .padding(.bottom, 8)
    }
}
