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
        /// Bumped by `.retryTapped` to force `RemoteView`'s VC-identity to
        /// change (alongside `credentials`) even when creds didn't change,
        /// so a plain retry rebuilds the VC and reconnects.
        public var reconnectToken: Int = 0
        /// Whether the saved connection has a configured MAC address — gates
        /// the Wake Mac button (`RemoteMacView.tsx:165`,
        /// `{connection.mac && <WakeButton/>}`). Set from `onAppear`.
        public var hasMac: Bool = false

        public init(
            host: String = "",
            credentials: VncCredentials = VncCredentials(username: "", password: ""),
            status: VncStatus = .idle,
            credentialFormOpen: Bool = false,
            authFailed: Bool = false,
            waking: Bool = false,
            reconnectToken: Int = 0,
            hasMac: Bool = false
        ) {
            self.host = host
            self.credentials = credentials
            self.status = status
            self.credentialFormOpen = credentialFormOpen
            self.authFailed = authFailed
            self.waking = waking
            self.reconnectToken = reconnectToken
            self.hasMac = hasMac
        }
    }

    public enum Action: Equatable {
        case onAppear
        case wakeTapped
        case wakeFinished
        case retryTapped
        case changeLoginTapped
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
                let connection = connectionStore.load()
                if let connection { state.host = connection.host }
                state.hasMac = !(connection?.mac?.isEmpty ?? true)
                let creds = vncCredentialsStore.load()
                if let creds {
                    state.credentials = creds
                }
                // Port of RemoteMacView.tsx:98 (`if (!creds || loginOpen)`):
                // no stored creds (or an empty username/password) means a
                // VNC connect attempt is doomed, so open the form instead of
                // flipping to .connecting.
                let hasUsableCreds = !(creds?.username.isEmpty ?? true) && !(creds?.password.isEmpty ?? true)
                if hasUsableCreds {
                    state.status = .connecting
                } else {
                    state.credentialFormOpen = true
                }
                return .none

            case .retryTapped:
                state.status = .connecting
                state.reconnectToken += 1
                return .none

            case .changeLoginTapped:
                state.credentialFormOpen = true
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
                // Port of the TS `submitCreds` early-return: an empty username or
                // password is never persisted to the Keychain — leave the form open.
                let trimmedUsername = state.credentials.username.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmedUsername.isEmpty, !state.credentials.password.isEmpty else { return .none }
                vncCredentialsStore.save(state.credentials)
                state.credentialFormOpen = false
                state.authFailed = false
                state.status = .connecting
                return .none
            }
        }
    }
}
