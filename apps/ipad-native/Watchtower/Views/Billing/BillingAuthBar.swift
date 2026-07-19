import SwiftUI
import ComposableArchitecture
import WatchtowerCore

/// No-gate auth affordance for the Billing module (D5): shown above the
/// Earnings/Reports/Records switcher whenever there's no live Supabase
/// session. Purely additive chrome — it never blocks the sub-screens, which
/// keep rendering their cached/empty data regardless. Tapping "Sign in"
/// presents a login sheet bound to the same `AuthFeature` store the iPhone
/// app gates its whole shell with; here it's just a convenience to restore
/// sync, adapted from `apps/iphone-native/Watchtower/Views/AuthView.swift`
/// for the iPad design system (`contentCard`/`floatingGlass`, not
/// `GlassCard`/`.ultraThinMaterial`).
struct BillingAuthBar: View {
    @Bindable var store: StoreOf<AuthFeature>

    @State private var showingSignIn = false

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "person.crop.circle.badge.exclamationmark")
                .foregroundStyle(Palette.textMuted)
            Text("Not signed in — sign in to sync billing")
                .font(.callout.weight(.medium))
                .foregroundStyle(Palette.textPrimary)
            Spacer()
            Button("Sign in") { showingSignIn = true }
                .buttonStyle(.glass)
                .tint(Palette.accent)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .floatingGlass(cornerRadius: 14)
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .sheet(isPresented: $showingSignIn) {
            BillingSignInSheet(store: store, isPresented: $showingSignIn)
        }
    }
}

/// Login form content — email/password bound directly to `AuthFeature`
/// (`@Bindable` + `BindingAction`), "Sign in" → `.signInTapped`, inline
/// `errorMessage`, `isSubmitting` spinner state on the button label.
private struct BillingSignInSheet: View {
    @Bindable var store: StoreOf<AuthFeature>
    @Binding var isPresented: Bool

    var body: some View {
        NavigationStack {
            ZStack {
                Palette.baseBg.ignoresSafeArea()
                VStack(spacing: 18) {
                    Text("Sign in to Watchtower")
                        .font(.title2.bold())
                        .foregroundStyle(Palette.textPrimary)

                    TextField("E-mail", text: $store.email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding(12)
                        .contentCard(cornerRadius: 12)

                    SecureField("Password", text: $store.password)
                        .textContentType(.password)
                        .padding(12)
                        .contentCard(cornerRadius: 12)

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
            }
            .navigationTitle("Sign in")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { isPresented = false }
                }
            }
        }
        // The bar (and this sheet) is only mounted while `authPresent` is
        // false; once sign-in succeeds, `IPadAppFeature`'s supabase auth
        // event flips `authPresent` and `BillingView` un-mounts the bar,
        // which dismisses this sheet with it. Also close eagerly on success
        // in case the bar itself hasn't re-rendered yet this frame.
        .onChange(of: store.isSubmitting) { wasSubmitting, isSubmitting in
            if wasSubmitting, !isSubmitting, store.errorMessage == nil {
                isPresented = false
            }
        }
    }
}
