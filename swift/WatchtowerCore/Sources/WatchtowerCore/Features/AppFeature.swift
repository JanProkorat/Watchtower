import Foundation
import ComposableArchitecture

@Reducer
public struct AppFeature {
    public enum Tab: String, CaseIterable, Equatable {
        case dashboard, earnings, reports, records
        public var title: String {
            switch self {
            case .dashboard: return "Dashboard"
            case .earnings: return "Earnings"
            case .reports: return "Reports"
            case .records: return "Records"
            }
        }
    }

    @CasePathable
    @dynamicMemberLookup
    public enum Phase: Equatable {
        case loading
        case signedOut(AuthFeature.State)
        case signedIn
    }

    @ObservableState
    public struct State: Equatable {
        public var phase: Phase
        public var selectedTab: Tab
        public var billing = BillingFeature.State()
        public var dashboard = DashboardFeature.State()
        public var earnings = EarningsFeature.State()
        public init(phase: Phase = .loading, selectedTab: Tab = .dashboard) {
            self.phase = phase
            self.selectedTab = selectedTab
        }
    }

    public enum Action {
        case onAppear
        case authEvent(Bool)
        case tabSelected(Tab)
        case signOutTapped
        case auth(AuthFeature.Action)
        case billing(BillingFeature.Action)
        case dashboard(DashboardFeature.Action)
        case earnings(EarningsFeature.Action)
    }

    @Dependency(\.supabase) var supabase

    public init() {}

    public var body: some ReducerOf<Self> {
        Reduce { state, action in
            switch action {
            case .onAppear:
                return .run { send in
                    await send(.authEvent(supabase.currentSessionExists()))
                    for await present in supabase.authEvents() {
                        await send(.authEvent(present))
                    }
                }

            case let .authEvent(present):
                switch state.phase {
                case .signedIn where present, .signedOut where !present:
                    return .none
                default:
                    state.phase = present ? .signedIn : .signedOut(AuthFeature.State())
                    // Load billing/earnings only on the transition INTO signedIn
                    // (fresh sign-in or cold-launch session restore) — never on
                    // bare onAppear (auth isn't known yet) and never on the
                    // already-signedIn no-op branch above (token-refresh
                    // re-emissions of `present == true` must not refetch).
                    return present
                        ? .merge(.send(.billing(.onAppear)), .send(.earnings(.onAppear)))
                        : .none
                }

            case let .tabSelected(tab):
                state.selectedTab = tab
                return .none

            case .signOutTapped:
                return .run { _ in await supabase.signOut() }

            case .auth:
                return .none

            case .billing:
                return .none

            case .dashboard:
                return .none

            case .earnings:
                return .none
            }
        }
        .ifLet(\.signedOutAuth, action: \.auth) {
            AuthFeature()
        }
        Scope(state: \.billing, action: \.billing) {
            BillingFeature()
        }
        Scope(state: \.dashboard, action: \.dashboard) {
            DashboardFeature()
        }
        Scope(state: \.earnings, action: \.earnings) {
            EarningsFeature()
        }
    }
}

private extension AppFeature.State {
    var signedOutAuth: AuthFeature.State? {
        get { if case let .signedOut(s) = phase { return s } else { return nil } }
        set { if let newValue { phase = .signedOut(newValue) } }
    }
}
