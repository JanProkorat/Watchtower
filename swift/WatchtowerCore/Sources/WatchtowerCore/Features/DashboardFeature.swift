import Foundation
import ComposableArchitecture

/// Tiny toast lifecycle for the Dashboard's pull-to-refresh affordance.
/// The Dashboard *view* owns the pull-to-refresh gesture and drives
/// `BillingFeature`'s own refresh; once that finishes it sends
/// `.refreshFinished` here to show a transient "Updated" toast.
@Reducer
public struct DashboardFeature {
    @ObservableState
    public struct State: Equatable {
        public var showToast: Bool = false
        public init() {}
    }

    public enum Action: Equatable {
        case refreshFinished
        case toastExpired
    }

    @Dependency(\.continuousClock) var clock

    public init() {}

    private enum CancelID { case toast }

    public var body: some ReducerOf<Self> {
        Reduce { state, action in
            switch action {
            case .refreshFinished:
                state.showToast = true
                return .run { send in
                    try await clock.sleep(for: .seconds(2.2))
                    await send(.toastExpired)
                }
                .cancellable(id: CancelID.toast, cancelInFlight: true)

            case .toastExpired:
                state.showToast = false
                return .none
            }
        }
    }
}
