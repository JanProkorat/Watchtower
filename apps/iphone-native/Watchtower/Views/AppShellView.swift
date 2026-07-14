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
            NavigationStack {
                TabView(selection: $store.selectedTab.sending(\.tabSelected)) {
                    ForEach(AppFeature.Tab.allCases, id: \.self) { tab in
                        tabContent(tab)
                            .tabItem { Label(tab.title, systemImage: icon(tab)) }
                            .tag(tab)
                    }
                }
                .tint(Palette.accent)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        attentionBell
                    }
                }
            }
            .sheet(isPresented: $showAttention) {
                AttentionView(store: store.scope(state: \.attention, action: \.attention))
            }
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

    @ViewBuilder
    private func tabContent(_ tab: AppFeature.Tab) -> some View {
        switch tab {
        case .dashboard:
            DashboardView(
                billing: store.scope(state: \.billing, action: \.billing),
                dashboard: store.scope(state: \.dashboard, action: \.dashboard)
            )

        case .earnings:
            EarningsView(
                billing: store.scope(state: \.billing, action: \.billing),
                earnings: store.scope(state: \.earnings, action: \.earnings)
            )

        case .reports:
            ReportsView(
                billing: store.scope(state: \.billing, action: \.billing),
                reports: store.scope(state: \.reports, action: \.reports)
            )

        case .records:
            RecordsView(
                billing: store.scope(state: \.billing, action: \.billing),
                records: store.scope(state: \.records, action: \.records)
            )
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
