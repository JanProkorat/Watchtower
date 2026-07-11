import XCTest
import ComposableArchitecture
@testable import WatchtowerCore

@MainActor
final class AppFeatureTests: XCTestCase {
    func testOnAppearWithNoSessionGoesSignedOut() async {
        let events = AsyncStream<Bool>.makeStream()
        let store = TestStore(initialState: AppFeature.State()) { AppFeature() } withDependencies: {
            $0.supabase.currentSessionExists = { false }
            $0.supabase.authEvents = { events.stream }
        }
        store.exhaustivity = .off(showSkippedAssertions: false)
        await store.send(.onAppear)
        await store.receive(\.authEvent) {
            $0.phase = .signedOut(AuthFeature.State())
        }
        await store.send(.tabSelected(.reports)) // keep the long-living stream effect tidy
        events.continuation.finish()
    }

    func testAuthEventTrueFlipsToSignedIn() async {
        let store = TestStore(initialState: AppFeature.State(phase: .signedOut(AuthFeature.State()))) {
            AppFeature()
        }
        await store.send(.authEvent(true)) { $0.phase = .signedIn }
    }

    func testAuthEventFalseFlipsToSignedOut() async {
        let store = TestStore(initialState: AppFeature.State(phase: .signedIn)) { AppFeature() }
        await store.send(.authEvent(false)) { $0.phase = .signedOut(AuthFeature.State()) }
    }

    func testTabSelection() async {
        let store = TestStore(initialState: AppFeature.State(phase: .signedIn)) { AppFeature() }
        await store.send(.tabSelected(.earnings)) { $0.selectedTab = .earnings }
    }

    func testSignOutCallsDependency() async {
        let signedOut = LockIsolated(false)
        let store = TestStore(initialState: AppFeature.State(phase: .signedIn)) { AppFeature() } withDependencies: {
            $0.supabase.signOut = { signedOut.setValue(true) }
        }
        await store.send(.signOutTapped)
        XCTAssertTrue(signedOut.value)
    }
}
