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

    func testAuthEventTrueWhileSignedInIsNoOp() async {
        let store = TestStore(initialState: AppFeature.State(phase: .signedIn)) { AppFeature() }
        // No trailing assert closure: phase must stay .signedIn (guard no-op).
        await store.send(.authEvent(true))
    }

    func testAuthEventFalseWhileSignedOutPreservesAuthState() async {
        let typed = AuthFeature.State(email: "typed@x.cz", password: "pw")
        let store = TestStore(initialState: AppFeature.State(phase: .signedOut(typed))) { AppFeature() }
        // No trailing assert closure: the guard must NOT clobber the in-progress
        // AuthFeature.State by resetting to a fresh .signedOut(AuthFeature.State()).
        await store.send(.authEvent(false))
    }

    func testAuthActionRoutedToEmbeddedAuthFeature() async {
        let store = TestStore(initialState: AppFeature.State(phase: .signedOut(AuthFeature.State()))) {
            AppFeature()
        }
        await store.send(.auth(.binding(.set(\.email, "typed@x.cz")))) {
            $0.phase = .signedOut(AuthFeature.State(email: "typed@x.cz"))
        }
    }

    func testOnAppearForwardsStreamEvents() async {
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
        events.continuation.yield(true)
        await store.receive(\.authEvent) {
            $0.phase = .signedIn
        }
        events.continuation.finish()
    }
}
