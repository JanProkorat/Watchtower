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

            if !store.host.isEmpty && !store.credentialFormOpen {
                VncControllerRepresentable(store: store)
                    .id(store.credentials) // resubmitted creds rebuild + reconnect
                    .ignoresSafeArea()
            } else {
                emptyOrForm
            }
        }
        .onAppear { store.send(.onAppear) }
    }

    @ViewBuilder private var emptyOrForm: some View {
        if store.host.isEmpty {
            emptyState
        } else {
            credentialForm
        }
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

                HStack {
                    Button("Submit") { store.send(.submitCredentials) }
                        .buttonStyle(.glassProminent)
                        .tint(Palette.accent)
                    Spacer()
                    statusLabel
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
            wakeButton
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

/// UIKit bridge for the full-screen VNC session. Mirrors
/// `RemoteTerminalView`/`TerminalController`: `makeUIViewController` wires the
/// VC's lifecycle callbacks into `store.send`, and
/// `dismantleUIViewController` tears the connection down when SwiftUI removes
/// the view (host/creds change re-key this via `.id(store.credentials)`).
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
