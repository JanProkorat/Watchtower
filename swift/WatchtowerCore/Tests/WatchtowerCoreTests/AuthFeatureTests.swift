import XCTest
import ComposableArchitecture
@testable import WatchtowerCore

@MainActor
final class AuthFeatureTests: XCTestCase {
    func testSuccessfulSignIn() async {
        let store = TestStore(initialState: AuthFeature.State(email: "a@b.cz", password: "pw")) {
            AuthFeature()
        } withDependencies: {
            $0.supabase.signIn = { _, _ in }
        }
        await store.send(.signInTapped) { $0.isSubmitting = true; $0.errorMessage = nil }
        // NOTE: `\.signInResponse.success` (case path drilling into Result<Void, _>.success)
        // triggers a Swift compiler IRGen crash (signal 11 in appendConcreteProtocolConformance)
        // — a known compiler bug, not a library issue: see
        // https://github.com/pointfreeco/swift-composable-architecture/discussions/3381 and
        // https://github.com/swiftlang/swift/issues/76120. Matching the outer case instead
        // (`\.signInResponse`) avoids composing a case path through Result's Void success payload.
        await store.receive(\.signInResponse) { $0.isSubmitting = false }
    }

    func testFailedSignInShowsEnglishError() async {
        struct Boom: Error {}
        let store = TestStore(initialState: AuthFeature.State(email: "a@b.cz", password: "bad")) {
            AuthFeature()
        } withDependencies: {
            $0.supabase.signIn = { _, _ in throw Boom() }
        }
        await store.send(.signInTapped) { $0.isSubmitting = true; $0.errorMessage = nil }
        await store.receive(\.signInResponse) {
            $0.isSubmitting = false
            $0.errorMessage = "Sign-in failed. Please try again."
        }
    }

    func testFailedSignInWithInvalidCredentialsShowsSpecificError() async {
        struct StubError: Error, CustomStringConvertible {
            var description = "Invalid login credentials"
        }
        let store = TestStore(initialState: AuthFeature.State(email: "a@b.cz", password: "bad")) {
            AuthFeature()
        } withDependencies: {
            $0.supabase.signIn = { _, _ in throw StubError() }
        }
        await store.send(.signInTapped) { $0.isSubmitting = true; $0.errorMessage = nil }
        await store.receive(\.signInResponse) {
            $0.isSubmitting = false
            $0.errorMessage = "Incorrect e-mail or password."
        }
    }

    func testErrorMappingForInvalidCredentials() {
        let mapped = AuthFeature.message(for: .invalidCredentials)
        XCTAssertEqual(mapped, "Incorrect e-mail or password.")
    }
}
