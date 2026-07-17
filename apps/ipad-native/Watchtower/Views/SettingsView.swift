import SwiftUI
import ComposableArchitecture
import WatchtowerCore
import WatchtowerBridge

struct SettingsView: View {
    @Bindable var store: StoreOf<IPadAppFeature>

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("Settings").font(.largeTitle.bold()).foregroundStyle(Palette.textPrimary)
                ConnectionSectionView(
                    store: store.scope(state: \.connection, action: \.connection)
                )
                AccountSectionView(store: store)
            }
            .frame(maxWidth: 560, alignment: .leading)
            .padding(32)
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }
}

struct ConnectionSectionView: View {
    @Bindable var store: StoreOf<ConnectionFeature>

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Mac connection").font(.headline).foregroundStyle(Palette.textPrimary)

            field("Host", text: $store.form.host, placeholder: "mac.tailnet.ts.net")
            HStack(spacing: 12) {
                field("Port", text: $store.form.port, placeholder: "7445")
                    .frame(width: 140)
                field("Token", text: $store.form.token, placeholder: "orchestrator token")
            }
            DisclosureGroup("Wake-on-LAN (optional)") {
                VStack(alignment: .leading, spacing: 12) {
                    field("MAC address", text: $store.form.mac, placeholder: "AA:BB:CC:DD:EE:FF")
                    field("LAN IP", text: $store.form.lanIp, placeholder: "192.168.1.10")
                    HStack(spacing: 12) {
                        field("WAN host", text: $store.form.wanHost, placeholder: "home.example.com")
                        field("WAN port", text: $store.form.wanPort, placeholder: "9")
                            .frame(width: 140)
                    }
                }
                .padding(.top, 8)
            }
            .foregroundStyle(Palette.textMuted)

            if let error = store.errorMessage {
                Text(error).font(.callout).foregroundStyle(.red)
            }
            HStack(spacing: 12) {
                Button("Save & connect") { store.send(.saveTapped) }
                    .buttonStyle(.borderedProminent)
                if store.didSave {
                    Text("Saved").font(.callout).foregroundStyle(.green)
                }
                Spacer()
                StatusPill(status: store.status)
            }
        }
        .onAppear { store.send(.onAppear) }
    }

    private func field(_ label: String, text: Binding<String>, placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption).foregroundStyle(Palette.textDim)
            TextField(placeholder, text: text)
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
        }
    }
}

struct AccountSectionView: View {
    @Bindable var store: StoreOf<IPadAppFeature>

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Supabase account").font(.headline).foregroundStyle(Palette.textPrimary)
            if store.authPresent {
                HStack {
                    Text("Signed in").foregroundStyle(Palette.textMuted)
                    Spacer()
                    Button("Sign out") { store.send(.signOutTapped) }
                        .buttonStyle(.bordered)
                }
            } else {
                AuthFormView(store: store.scope(state: \.auth, action: \.auth))
            }
        }
    }
}

struct AuthFormView: View {
    @Bindable var store: StoreOf<AuthFeature>

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextField("E-mail", text: $store.email)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            SecureField("Password", text: $store.password)
                .textFieldStyle(.roundedBorder)
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
            .buttonStyle(.borderedProminent)
            .disabled(store.isSubmitting)
        }
    }
}
