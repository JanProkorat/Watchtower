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
        public var reports = ReportsFeature.State()
        public var records = RecordsFeature.State()
        public var attention = AttentionFeature.State()
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
        case reports(ReportsFeature.Action)
        case records(RecordsFeature.Action)
        case attention(AttentionFeature.Action)
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
                    // `earliest` isn't known yet (it derives from the billing
                    // dataset, which hasn't loaded) — seed with nil here; the
                    // `.billing` case below re-seeds it once a dataset first
                    // arrives (cache-load or network fetch).
                    return present
                        ? .merge(
                            .send(.billing(.onAppear)),
                            .send(.earnings(.onAppear)),
                            .send(.reports(.onAppear(earliest: nil))),
                            .send(.records(.onAppear)),
                            .send(.attention(.onAppear))
                        )
                        : .none
                }

            case let .tabSelected(tab):
                state.selectedTab = tab
                return .none

            case .signOutTapped:
                return .run { _ in await supabase.signOut() }

            case .auth:
                return .none

            case let .billing(billingAction):
                // Re-seed the Reports "all"-preset lower bound the first time
                // a billing dataset lands (cache-load or network fetch) — at
                // sign-in the dataset isn't loaded yet, so `earliest` was
                // sent as nil. This runs BEFORE the `Scope(\.billing)` below,
                // so `state.billing.dataset` here still reflects the
                // pre-mutation value: nil ⇒ this is the first arrival.
                guard state.billing.dataset == nil else { return .none }
                let newDataset: BillingDataset?
                switch billingAction {
                case let .cacheLoaded(dataset):
                    newDataset = dataset
                case let .fetchResponse(.success(dataset)):
                    newDataset = dataset
                case let .refreshResponse(.success(dataset)):
                    newDataset = dataset
                default:
                    newDataset = nil
                }
                guard let newDataset else { return .none }
                let earliest = newDataset.worklogs.map(\.workDate).min()
                return .send(.reports(.onAppear(earliest: earliest)))

            case .dashboard:
                return .none

            case .earnings:
                return .none

            case .reports:
                return .none

            case .records:
                return .none

            case .attention:
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
        Scope(state: \.reports, action: \.reports) {
            ReportsFeature()
        }
        Scope(state: \.records, action: \.records) {
            RecordsFeature()
        }
        Scope(state: \.attention, action: \.attention) {
            AttentionFeature()
        }
    }
}

private extension AppFeature.State {
    var signedOutAuth: AuthFeature.State? {
        get { if case let .signedOut(s) = phase { return s } else { return nil } }
        set { if let newValue { phase = .signedOut(newValue) } }
    }
}
