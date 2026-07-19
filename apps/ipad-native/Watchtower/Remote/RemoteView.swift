import SwiftUI
import ComposableArchitecture
import WatchtowerCore
import WatchtowerRemote

/// Remote Mac screen: full-screen native VNC (via `VncControllerRepresentable`)
/// once a host + credentials are known, a credential-entry overlay otherwise,
/// plus a Wake Mac button and status chrome. Port of
/// apps/ipad/src/components/RemoteMacView.tsx. Owns a standalone
/// `RemoteFeature` store passed in by `AppShellView` (not composed into
/// `IPadAppFeature` — see RemoteFeature's doc comment).
struct RemoteView: View {
    let store: StoreOf<RemoteFeature>

    var body: some View {
        ZStack {
            Palette.baseBg.ignoresSafeArea()

            if store.host.isEmpty {
                emptyState
            } else if store.credentialFormOpen {
                credentialForm
            } else if store.status == .disconnected {
                disconnectedOverlay
            } else {
                VncControllerRepresentable(store: store)
                    .id(ReconnectID(credentials: store.credentials, token: store.reconnectToken))
                    .ignoresSafeArea()
            }
        }
        .onAppear { store.send(.onAppear) }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Text("Remote Mac").font(.largeTitle.bold()).foregroundStyle(Palette.textPrimary)
            Text("Configure the Mac connection in Settings.")
                .font(.body)
                .foregroundStyle(Palette.textMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var credentialForm: some View {
        VStack(spacing: 20) {
            Spacer()
            VStack(alignment: .leading, spacing: 16) {
                Text("Screen Sharing sign-in").font(.headline).foregroundStyle(Palette.textPrimary)

                if store.authFailed {
                    Text("Sign-in failed — check your macOS account short name and password.")
                        .font(.callout)
                        .foregroundStyle(.red)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("Username").font(.caption).foregroundStyle(Palette.textDim)
                    TextField(
                        "macOS account short name",
                        text: Binding(
                            get: { store.credentials.username },
                            set: { store.send(.credentialsUsernameChanged($0)) }
                        )
                    )
                    .textFieldStyle(.roundedBorder)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("Password").font(.caption).foregroundStyle(Palette.textDim)
                    SecureField(
                        "Password",
                        text: Binding(
                            get: { store.credentials.password },
                            set: { store.send(.credentialsPasswordChanged($0)) }
                        )
                    )
                    .textFieldStyle(.roundedBorder)
                }

                Button("Submit") { store.send(.submitCredentials) }
                    .buttonStyle(.glassProminent)
                    .tint(Palette.accent)
            }
            .padding(20)
            .contentCard()
            .frame(maxWidth: 420)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(32)
        .safeAreaInset(edge: .top) { wakeBar }
    }

    /// Shown when the Mac is unreachable (asleep, off-network, or Screen
    /// Sharing off) — a non-auth disconnect. This is the scenario the
    /// Wake-on-LAN feature exists for, so Wake/Retry/Change-login must all
    /// stay reachable here rather than being hidden behind the full-bleed VNC
    /// representable (which would otherwise keep rendering with no way out).
    /// Port of RemoteMacView.tsx:157-165.
    private var disconnectedOverlay: some View {
        VStack(spacing: 20) {
            Spacer()
            VStack(spacing: 16) {
                Text("Mac disconnected").font(.headline).foregroundStyle(Palette.textPrimary)
                Text("Check that the Mac is awake and Screen Sharing is on.")
                    .font(.callout)
                    .foregroundStyle(Palette.textMuted)
                HStack(spacing: 12) {
                    Button("Retry") { store.send(.retryTapped) }
                        .buttonStyle(.glass)
                    Button("Change login") { store.send(.changeLoginTapped) }
                        .buttonStyle(.glass)
                }
            }
            .padding(20)
            .contentCard()
            .frame(maxWidth: 420)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(32)
        .safeAreaInset(edge: .top) { wakeBar }
    }

    private var wakeBar: some View {
        HStack {
            Text("Remote Mac").font(.title2.bold()).foregroundStyle(Palette.textPrimary)
            Spacer()
            statusLabel
            // Port of RemoteMacView.tsx:165 (`{connection.mac && <WakeButton/>}`):
            // no configured MAC means a wake attempt is a guaranteed no-op
            // (wakeTapped silently guards on it), so hide the button entirely.
            if store.hasMac {
                wakeButton
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
    }

    private var wakeButton: some View {
        Button {
            store.send(.wakeTapped)
        } label: {
            if store.waking {
                ProgressView()
            } else {
                Label("Wake Mac", systemImage: "power")
            }
        }
        .buttonStyle(.glass)
        .disabled(store.waking)
    }

    private var statusLabel: some View {
        let colors = Palette.status(connState(for: store.status))
        return Text(statusText)
            .font(.caption.weight(.medium))
            .foregroundStyle(colors.accent)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .floatingGlass(cornerRadius: 999, tint: colors.fill)
    }

    private var statusText: String {
        switch store.status {
        case .idle: return "Idle"
        case .connecting: return "Connecting…"
        case .connected: return "Connected"
        case .disconnected: return "Disconnected"
        }
    }

    private func connState(for status: VncStatus) -> Palette.ConnState {
        switch status {
        case .idle, .connecting: return .connecting
        case .connected: return .connected
        case .disconnected: return .disconnected
        }
    }
}

/// Identity for `VncControllerRepresentable`'s `.id(...)` re-key: changes on
/// a creds resubmit (`credentials` differs) OR a plain retry
/// (`.retryTapped` bumps `token` with `credentials` unchanged) — either one
/// must force SwiftUI to tear down the old VC and build a fresh one.
private struct ReconnectID: Hashable {
    let credentials: VncCredentials
    let token: Int
}

/// UIKit bridge for the full-screen VNC session. Mirrors
/// `RemoteTerminalView`/`TerminalController`: `makeUIViewController` wires the
/// VC's lifecycle callbacks into `store.send`, and
/// `dismantleUIViewController` tears the connection down when SwiftUI removes
/// the view (host/creds/retry changes re-key this via `.id(ReconnectID(...))`).
private struct VncControllerRepresentable: UIViewControllerRepresentable {
    let store: StoreOf<RemoteFeature>

    func makeUIViewController(context: Context) -> VncViewController {
        let vc = VncViewController()
        vc.host = store.host
        vc.username = store.credentials.username
        vc.password = store.credentials.password
        vc.onState = { status in store.send(.vncStateChanged(status)) }
        vc.onAuthFailed = { store.send(.vncAuthFailed) }
        vc.onClosed = { store.send(.vncClosed) }
        // Do NOT call vc.connect() here: VncViewController.viewDidLoad already
        // calls it once the view loads (which SwiftUI triggers right after
        // this returns, with host/username/password already set above). An
        // extra explicit call here would create a second VNCConnection that
        // gets torn down immediately, but its async stateDidChange(.disconnected)
        // delegate callback can still land after the real connection starts,
        // flipping store.status to .disconnected mid-connect.
        return vc
    }

    func updateUIViewController(_ uiViewController: VncViewController, context: Context) {}

    static func dismantleUIViewController(_ uiViewController: VncViewController, coordinator: Coordinator) {
        uiViewController.teardown()
    }
}
