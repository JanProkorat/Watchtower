import Foundation
import ComposableArchitecture
import WatchtowerCore

/// Root shell for the native iPad app: module rail + bridge lifecycle.
/// Unlike the iPhone's AppFeature, Supabase auth does NOT gate the shell —
/// terminals need only the Mac bridge; billing gates itself (Phase 5).
@Reducer
public struct IPadAppFeature {
    public enum Module: String, CaseIterable, Equatable, Sendable {
        case dashboard, instances, remote, billing, settings

        public var title: String {
            switch self {
            case .dashboard: return "Dashboard"
            case .instances: return "Instances"
            case .remote: return "Remote Mac"
            case .billing: return "Billing"
            case .settings: return "Settings"
            }
        }

        public var systemImage: String {
            switch self {
            case .dashboard: return "square.grid.2x2"
            case .instances: return "terminal"
            case .remote: return "display"
            case .billing: return "banknote"
            case .settings: return "gearshape"
            }
        }
    }

    @ObservableState
    public struct State: Equatable {
        public var selectedModule: Module = .dashboard
        public var connStatus: ConnStatus = .disconnected
        /// Result of the connectivity probe; nil until the first successful probe.
        public var instancesOnline: Int?
        public var authPresent = false
        public var connection = ConnectionFeature.State()
        public var auth = AuthFeature.State()

        public init() {}
    }

    public enum Action {
        case onAppear
        case moduleSelected(Module)
        case statusChanged(ConnStatus)
        case probeResponse(Int?)
        case authEvent(Bool)
        case signOutTapped
        case connection(ConnectionFeature.Action)
        case auth(AuthFeature.Action)
    }

    private enum CancelID { case status, auth, probe }

    @Dependency(\.connectionStore) var connectionStore
    @Dependency(\.bridge) var bridge
    @Dependency(\.supabase) var supabase

    public init() {}

    public var body: some ReducerOf<Self> {
        Scope(state: \.connection, action: \.connection) {
            ConnectionFeature()
        }
        Scope(state: \.auth, action: \.auth) {
            AuthFeature()
        }
        Reduce { state, action in
            switch action {
            case .onAppear:
                let saved = connectionStore.load()
                if saved == nil {
                    // First run: land on Settings so the connection can be entered.
                    state.selectedModule = .settings
                }
                return .merge(
                    .run { _ in
                        if let saved { await bridge.configure(saved) }
                    },
                    .run { send in
                        for await s in await bridge.statusStream() {
                            await send(.statusChanged(s))
                        }
                    }
                    .cancellable(id: CancelID.status, cancelInFlight: true),
                    .run { send in
                        await send(.authEvent(supabase.currentSessionExists()))
                        for await present in supabase.authEvents() {
                            await send(.authEvent(present))
                        }
                    }
                    .cancellable(id: CancelID.auth, cancelInFlight: true)
                )

            case let .moduleSelected(module):
                state.selectedModule = module
                return .none

            case let .statusChanged(status):
                let wasConnected = state.connStatus == .connected
                state.connStatus = status
                guard status == .connected, !wasConnected else { return .none }
                // Connectivity probe on each transition into connected —
                // port of apps/ipad/src/probe.ts.
                return .run { send in
                    let res = try? await bridge.invoke(ListInstancesRequest())
                    await send(.probeResponse(res.map(\.instances.count)))
                }
                .cancellable(id: CancelID.probe, cancelInFlight: true)

            case let .probeResponse(count):
                state.instancesOnline = count
                return .none

            case let .authEvent(present):
                state.authPresent = present
                return .none

            case .signOutTapped:
                return .run { _ in await supabase.signOut() }

            case .connection, .auth:
                return .none
            }
        }
    }
}
