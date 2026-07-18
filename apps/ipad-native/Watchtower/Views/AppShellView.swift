import SwiftUI
import ComposableArchitecture
import WatchtowerCore
import WatchtowerBridge
import WatchtowerRemote

struct AppShellView: View {
    @Bindable var store: StoreOf<IPadAppFeature>
    // Standalone store — RemoteFeature is deliberately NOT composed into
    // IPadAppFeature (see RemoteFeature's doc comment); the shell owns and
    // drives it directly.
    @State private var remoteStore = Store(initialState: RemoteFeature.State()) { RemoteFeature() }

    var body: some View {
        ZStack {
            AmbientBackground()
            HStack(spacing: 0) {
                RailView(store: store)
                Divider().overlay(Color.white.opacity(0.08))
                detail
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
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
            RemoteView(store: remoteStore)
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
