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
}
