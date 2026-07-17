import SwiftUI
import ComposableArchitecture
import WatchtowerBridge

@main
struct WatchtowerApp: App {
    @MainActor
    static let store = Store(initialState: IPadAppFeature.State()) {
        IPadAppFeature()
    }

    var body: some Scene {
        WindowGroup {
            AppShellView(store: Self.store)
                .onAppear { Self.store.send(.onAppear) }
                .preferredColorScheme(.dark)
        }
    }
}
