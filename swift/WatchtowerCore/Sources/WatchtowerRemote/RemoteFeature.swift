import Foundation
import ComposableArchitecture
import WatchtowerBridge

/// VNC connection lifecycle status, driven by the app-target `VncViewController`.
public enum VncStatus: String, Equatable, Sendable {
    case idle, connecting, connected, disconnected
}

/// Remote Mac screen — Wake-on-LAN + VNC creds + connection state.
/// Port of apps/ipad/src/components/RemoteMacView.tsx UX. Standalone reducer
/// (not composed into IPadAppFeature) — the app target's RemoteView owns its
/// own store and drives VncViewController from `state.host` / `state.credentials`.
@Reducer
public struct RemoteFeature {
    @ObservableState
    public struct State: Equatable {
        public var host: String = ""
        public var credentials = VncCredentials(username: "", password: "")
        public var status: VncStatus = .idle
        public var credentialFormOpen = false
        public var authFailed = false
        public var waking = false

        public init(
            host: String = "",
            credentials: VncCredentials = VncCredentials(username: "", password: ""),
            status: VncStatus = .idle,
            credentialFormOpen: Bool = false,
            authFailed: Bool = false,
            waking: Bool = false
        ) {
            self.host = host
            self.credentials = credentials
            self.status = status
            self.credentialFormOpen = credentialFormOpen
            self.authFailed = authFailed
            self.waking = waking
        }
    }

    public enum Action: Equatable {
        case onAppear
        case wakeTapped
        case wakeFinished
        case vncStateChanged(VncStatus)
        case vncAuthFailed
        case vncClosed
        case credentialsUsernameChanged(String)
        case credentialsPasswordChanged(String)
        case submitCredentials
    }

    @Dependency(\.connectionStore) var connectionStore
    @Dependency(\.vncCredentialsStore) var vncCredentialsStore
    @Dependency(\.wakeOnLanClient) var wakeOnLanClient

    public init() {}

    public var body: some ReducerOf<Self> {
        Reduce { state, action in
            switch action {
            case .onAppear:
                if let c = connectionStore.load() { state.host = c.host }
                if let creds = vncCredentialsStore.load() { state.credentials = creds }
                state.status = .connecting
                return .none

            case .wakeTapped:
                guard let c = connectionStore.load(), let mac = c.mac.flatMap(parseMac) else { return .none }
                state.waking = true
                let packet = buildMagicPacket(mac)
                let targets = wakeTargets(c)
                return .run { send in
                    for t in targets {
                        // Per-target failure is expected (e.g. off-network) and swallowed.
                        try? await wakeOnLanClient.send(packet, t.host, t.port)
                    }
                    await send(.wakeFinished)
                }

            case .wakeFinished:
                state.waking = false
                return .none

            case let .vncStateChanged(status):
                state.status = status
                if status == .connected {
                    state.credentialFormOpen = false
                    state.authFailed = false
                }
                return .none

            case .vncAuthFailed:
                state.status = .disconnected
                state.credentials.password = ""
                state.credentialFormOpen = true
                state.authFailed = true
                return .none

            case .vncClosed:
                state.status = .disconnected
                return .none

            case let .credentialsUsernameChanged(username):
                state.credentials.username = username
                return .none

            case let .credentialsPasswordChanged(password):
                state.credentials.password = password
                return .none

            case .submitCredentials:
                vncCredentialsStore.save(state.credentials)
                state.credentialFormOpen = false
                state.authFailed = false
                state.status = .connecting
                return .none
            }
        }
    }
}
