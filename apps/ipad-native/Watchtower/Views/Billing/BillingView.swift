import SwiftUI
import ComposableArchitecture
import WatchtowerCore
import WatchtowerBridge

/// Container for the Billing module: a secondary segmented tab-strip
/// (Earnings | Reports | Records) above the Task-4/5/6 sub-screens, plus a
/// no-gate `BillingAuthBar` shown above the switcher whenever the iPad has
/// no live Supabase session. Unlike the iPhone's `AppFeature`, billing is
/// NOT auth-gated here — the sub-screens always render (cached/empty data),
/// the bar is purely additive chrome offering a way to sign in for sync.
///
/// Which section is active is iPad-only navigation state (not shared with
/// the iPhone reducer), so it lives as local `@State` rather than in
/// `IPadAppFeature.State`.
struct BillingView: View {
    let store: StoreOf<IPadAppFeature>

    @State private var section: BillingSection = .earnings

    var body: some View {
        VStack(spacing: 0) {
            if !store.authPresent {
                BillingAuthBar(store: store.scope(state: \.auth, action: \.auth))
            }
            tabStrip
            Divider().overlay(Color.white.opacity(0.08))
            detail
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @ViewBuilder private var detail: some View {
        switch section {
        case .earnings:
            EarningsView(store: store)
        case .reports:
            ReportsView(store: store)
        case .records:
            RecordsView(store: store)
        }
    }

    private var tabStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            GlassEffectContainer(spacing: 8) {
                HStack(spacing: 8) {
                    ForEach(BillingSection.allCases) { tab in
                        sectionTab(tab)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
    }

    private func sectionTab(_ tab: BillingSection) -> some View {
        let selected = tab == section
        return Button {
            section = tab
        } label: {
            Text(tab.title)
                .font(.system(size: 14, weight: .medium))
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .foregroundStyle(selected ? Palette.accent : Palette.textMuted)
                .floatingGlass(cornerRadius: 12, tint: selected ? Palette.accentWash : nil)
        }
        .buttonStyle(.plain)
    }
}

/// Local-only nav state for `BillingView`'s segmented switcher — the iPhone
/// has no equivalent (it uses a tab bar at the app-shell level instead), so
/// this doesn't belong on the shared `IPadAppFeature.State`.
enum BillingSection: String, CaseIterable, Identifiable {
    case earnings, reports, records

    var id: String { rawValue }

    var title: String {
        switch self {
        case .earnings: return "Earnings"
        case .reports: return "Reports"
        case .records: return "Records"
        }
    }
}
