import SwiftUI
import ComposableArchitecture
import WatchtowerCore
import WatchtowerBridge

struct AppShellView: View {
    @Bindable var store: StoreOf<IPadAppFeature>

    var body: some View {
        HStack(spacing: 0) {
            RailView(store: store)
            Divider().overlay(Color.white.opacity(0.08))
            detail
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Palette.baseBg.ignoresSafeArea())
    }

    @ViewBuilder private var detail: some View {
        switch store.selectedModule {
        case .dashboard:
            PlaceholderView(
                title: "Dashboard",
                subtitle: store.instancesOnline.map { "\($0) instance(s) online" }
                    ?? "Waiting for the Mac…"
            )
        case .instances:
            InstancesView(
                store: store.scope(state: \.instances, action: \.instances),
                onOpenRemote: { store.send(.openRemoteForAuth) }
            )
        case .remote:
            PlaceholderView(title: "Remote Mac", subtitle: "VNC + Wake arrive in Phase 4")
        case .billing:
            PlaceholderView(title: "Billing", subtitle: "Billing arrives in Phase 5")
        case .settings:
            SettingsView(store: store)
        }
    }
}

struct PlaceholderView: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(spacing: 8) {
            Text(title).font(.largeTitle.bold()).foregroundStyle(Palette.textPrimary)
            Text(subtitle).font(.body).foregroundStyle(Palette.textMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
