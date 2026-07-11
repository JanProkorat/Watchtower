import SwiftUI
import ComposableArchitecture
import WatchtowerCore

@main
struct WatchtowerApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    @MainActor
    static let store = Store(initialState: AppFeature.State()) {
        AppFeature()
    }

    var body: some Scene {
        WindowGroup {
            AppShellView(store: Self.store)
                .onAppear { Self.store.send(.onAppear) }
                .preferredColorScheme(.dark)
        }
    }
}
