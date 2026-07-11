import Foundation
import ComposableArchitecture

@Reducer
public struct AuthFeature {
    @ObservableState
    public struct State: Equatable {
        public var email: String = ""
        public var password: String = ""
        public var isSubmitting: Bool = false
        public var errorMessage: String?
        public init(email: String = "", password: String = "") {
            self.email = email
            self.password = password
        }
    }

    public enum AuthError: Error, Equatable {
        case invalidCredentials
        case other

        static func from(_ error: Error) -> AuthError {
            let msg = String(describing: error).lowercased()
            if msg.contains("invalid") && msg.contains("credential") { return .invalidCredentials }
            return .other
        }
    }

    public enum Action: BindableAction {
        case binding(BindingAction<State>)
        case signInTapped
        case signInResponse(Result<Void, AuthError>)
    }

    @Dependency(\.supabase) var supabase

    public init() {}

    public static func message(for error: AuthError) -> String {
        switch error {
        case .invalidCredentials: return "Incorrect e-mail or password."
        case .other: return "Sign-in failed. Please try again."
        }
    }

    public var body: some ReducerOf<Self> {
        BindingReducer()
        Reduce { state, action in
            switch action {
            case .binding:
                return .none

            case .signInTapped:
                state.isSubmitting = true
                state.errorMessage = nil
                let email = state.email, password = state.password
                return .run { send in
                    do {
                        try await supabase.signIn(email, password)
                        await send(.signInResponse(.success(())))
                    } catch {
                        await send(.signInResponse(.failure(AuthError.from(error))))
                    }
                }

            case .signInResponse(.success):
                state.isSubmitting = false
                // Session presence propagates to AppFeature via supabase.authEvents.
                return .none

            case let .signInResponse(.failure(err)):
                state.isSubmitting = false
                state.errorMessage = Self.message(for: err)
                return .none
            }
        }
    }
}
