import SwiftUI
import ComposableArchitecture
import WatchtowerCore

struct AppShellView: View {
    @Bindable var store: StoreOf<AppFeature>
    @State private var showAttention = false

    var body: some View {
        switch store.phase {
        case .loading:
            ZStack { Palette.baseBg.ignoresSafeArea(); ProgressView().tint(Palette.accentIcon) }

        case .signedOut:
            if let authStore = store.scope(state: \.phase.signedOut, action: \.auth) {
                AuthView(store: authStore)
            }

        case .signedIn:
            TabView(selection: $store.selectedTab.sending(\.tabSelected)) {
                ForEach(AppFeature.Tab.allCases, id: \.self) { tab in
                    tabContent(tab)
                        .tabItem { Label(tab.title, systemImage: icon(tab)) }
                        .tag(tab)
                }
            }
            .tint(Palette.accent)
        }
    }

    @ViewBuilder
    private func tabContent(_ tab: AppFeature.Tab) -> some View {
        switch tab {
        case .dashboard:
            NavigationStack {
                DashboardView(
                    billing: store.scope(state: \.billing, action: \.billing),
                    dashboard: store.scope(state: \.dashboard, action: \.dashboard)
                )
            }
            .attentionToolbar(store: store, showAttention: $showAttention)

        case .earnings:
            EarningsView(
                billing: store.scope(state: \.billing, action: \.billing),
                earnings: store.scope(state: \.earnings, action: \.earnings),
                appStore: store,
                showAttention: $showAttention
            )

        case .reports:
            ReportsView(
                billing: store.scope(state: \.billing, action: \.billing),
                reports: store.scope(state: \.reports, action: \.reports),
                appStore: store,
                showAttention: $showAttention
            )

        case .records:
            NavigationStack {
                RecordsView(
                    billing: store.scope(state: \.billing, action: \.billing),
                    records: store.scope(state: \.records, action: \.records)
                )
            }
            .attentionToolbar(store: store, showAttention: $showAttention)
        }
    }

    private func icon(_ tab: AppFeature.Tab) -> String {
        switch tab {
        case .dashboard: return "square.grid.2x2"
        case .earnings: return "creditcard"
        case .reports: return "chart.bar"
        case .records: return "clock"
        }
    }
}

// MARK: - Shared attention bell toolbar

/// Attaches the bell/badge toolbar item + its sheet presentation to a single
/// `NavigationStack` root. Applied once per tab (Task 12 fix) so each of the
/// four tabs owns exactly one `NavigationStack` with the bell attached to it
/// — Dashboard/Records get a `NavigationStack` wrapper for this purpose;
/// Earnings/Reports already have their own inner stack (needed for the
/// Phase 5 `ProjectDetail` drill-down) and attach this modifier to that same
/// stack rather than nesting a second one.
struct AttentionToolbarModifier: ViewModifier {
    let store: StoreOf<AppFeature>
    @Binding var showAttention: Bool

    func body(content: Content) -> some View {
        content
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    attentionBell
                }
            }
            .sheet(isPresented: $showAttention) {
                AttentionView(store: store.scope(state: \.attention, action: \.attention))
            }
    }

    private var attentionBell: some View {
        let unanswered = store.attention.unansweredCount
        return Button {
            showAttention = true
        } label: {
            Image(systemName: "bell")
                .overlay(alignment: .topTrailing) {
                    if unanswered > 0 {
                        Text("\(unanswered)")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(4)
                            .background(Circle().fill(.red))
                            .offset(x: 10, y: -10)
                    }
                }
        }
        .accessibilityLabel(unanswered > 0 ? "Attention, \(unanswered) unanswered" : "Attention")
    }
}

extension View {
    /// Shared bell/badge toolbar + sheet, applied to exactly one
    /// `NavigationStack` per tab. See `AttentionToolbarModifier`.
    func attentionToolbar(store: StoreOf<AppFeature>, showAttention: Binding<Bool>) -> some View {
        modifier(AttentionToolbarModifier(store: store, showAttention: showAttention))
    }
}
