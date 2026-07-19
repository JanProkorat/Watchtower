import SwiftUI
import ComposableArchitecture
import WatchtowerCore
import WatchtowerBridge

// Port of apps/ipad's SettingsModule.tsx: a centered column (max-width ~480,
// within the original's 420-560 range) of two glassCard(16) surfaces —
// Account first, then Mac connection — matching the original's stacking
// order. Design-align Task 8.
struct SettingsView: View {
    @Bindable var store: StoreOf<IPadAppFeature>

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Settings").font(.largeTitle.bold()).foregroundStyle(Palette.textPrimary)
                AccountSectionView(store: store)
                ConnectionSectionView(
                    store: store.scope(state: \.connection, action: \.connection)
                )
            }
            .frame(maxWidth: 480)
            .padding(32)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct ConnectionSectionView: View {
    @Bindable var store: StoreOf<ConnectionFeature>

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeaderLabel("Mac connection")

            field("Host", text: $store.form.host, placeholder: "mac.tailnet.ts.net")
            HStack(spacing: 12) {
                field("Port", text: $store.form.port, placeholder: "7445")
                    .frame(width: 140)
                field("Token", text: $store.form.token, placeholder: "orchestrator token")
            }

            // Port of ConnectionFields.tsx's hairline-divided "Wake-on-LAN"
            // sub-section (MAC / LAN IP / DDNS host / DDNS port).
            VStack(alignment: .leading, spacing: 12) {
                Divider().overlay(Palette.hairline)
                Text("Wake-on-LAN").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.textMuted)
                field("MAC address", text: $store.form.mac, placeholder: "AA:BB:CC:DD:EE:FF")
                field("LAN IP", text: $store.form.lanIp, placeholder: "192.168.1.10")
                HStack(spacing: 12) {
                    field("WAN host (DDNS)", text: $store.form.wanHost, placeholder: "home.example.com")
                    field("WAN port (DDNS)", text: $store.form.wanPort, placeholder: "9")
                        .frame(width: 140)
                }
            }
            .padding(.top, 4)

            if let error = store.errorMessage {
                Text(error).font(.callout).foregroundStyle(.red)
            }
            HStack(spacing: 12) {
                Button("Save & connect") { store.send(.saveTapped) }
                    .buttonStyle(.glassProminent)
                    .tint(Palette.accent)
                if store.didSave {
                    Text("Saved").font(.callout).foregroundStyle(.green)
                }
                Spacer()
                StatusPill(status: store.status)
            }
        }
        .padding(18)
        .glassCard(cornerRadius: 16)
        .onAppear { store.send(.onAppear) }
    }

    private func field(_ label: String, text: Binding<String>, placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption).foregroundStyle(Palette.textDim)
            TextField(placeholder, text: text)
                .glassField()
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
        }
    }
}

struct AccountSectionView: View {
    @Bindable var store: StoreOf<IPadAppFeature>

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeaderLabel("Account")
            if store.authPresent {
                HStack {
                    Text("Signed in").foregroundStyle(Palette.textMuted)
                    Spacer()
                    Button("Sign out") { store.send(.signOutTapped) }
                        .buttonStyle(.glass)
                }
            } else {
                AuthFormView(store: store.scope(state: \.auth, action: \.auth))
            }
        }
        .padding(18)
        .glassCard(cornerRadius: 16)
    }
}

struct AuthFormView: View {
    @Bindable var store: StoreOf<AuthFeature>

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextField("E-mail", text: $store.email)
                .glassField()
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            SecureField("Password", text: $store.password)
                .glassField()
            if let error = store.errorMessage {
                Text(error).font(.callout).foregroundStyle(.red)
            }
            Button {
                store.send(.signInTapped)
            } label: {
                if store.isSubmitting {
                    ProgressView()
                } else {
                    Text("Sign in")
                }
            }
            .buttonStyle(.glassProminent)
            .tint(Palette.accent)
            .disabled(store.isSubmitting)
        }
    }
}
