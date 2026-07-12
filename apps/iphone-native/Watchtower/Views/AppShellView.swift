import SwiftUI
import ComposableArchitecture
import WatchtowerCore

struct AppShellView: View {
    @Bindable var store: StoreOf<AppFeature>

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
                reports: store.scope(state: \.reports, action: \.reports),
                onOpenProject: { _ in }  // TODO(later phase): route to ProjectDetail
            )

        case .records:
            placeholder(tab)
        }
    }

    private func placeholder(_ tab: AppFeature.Tab) -> some View {
        ZStack {
            Palette.baseBg.ignoresSafeArea()
            VStack(spacing: 12) {
                Text(tab.title).font(.title.bold()).foregroundStyle(Palette.textPrimary)
                Text("Coming in a later phase").foregroundStyle(Palette.textMuted)
                Button("Sign out") { store.send(.signOutTapped) }
                    .foregroundStyle(Palette.accentIcon)
            }
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
