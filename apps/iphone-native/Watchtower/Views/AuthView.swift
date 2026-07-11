import SwiftUI
import ComposableArchitecture
import WatchtowerCore

struct AuthView: View {
    @Bindable var store: StoreOf<AuthFeature>

    var body: some View {
        ZStack {
            Palette.baseBg.ignoresSafeArea()
            VStack(spacing: 18) {
                Text("Watchtower")
                    .font(.largeTitle.bold())
                    .foregroundStyle(Palette.accentIcon)
                TextField("E-mail", text: $store.email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(12)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
                SecureField("Password", text: $store.password)
                    .textContentType(.password)
                    .padding(12)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
                if let error = store.errorMessage {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
                Button {
                    store.send(.signInTapped)
                } label: {
                    Text(store.isSubmitting ? "Signing in…" : "Sign in")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(Palette.ctaGradient, in: RoundedRectangle(cornerRadius: 12))
                        .foregroundStyle(.white)
                }
                .disabled(store.isSubmitting)
            }
            .padding(24)
            .foregroundStyle(Palette.textPrimary)
        }
    }
}
