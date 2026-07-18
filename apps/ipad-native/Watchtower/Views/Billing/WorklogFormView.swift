import SwiftUI
import ComposableArchitecture
import WatchtowerCore

/// iPad port of the iPhone `WorklogFormView` — same create/edit sheet bound
/// to `WorklogFormFeature`, same mode-derived Delete visibility, but the
/// card uses the iPad design system's `contentCard()` instead of `GlassCard`,
/// and Save/Delete are additionally `.disabled` when
/// `!canEdit(store.loadState)` — matching `ContractDrawerView`'s pattern
/// (the iPhone reference only gates via the reducer's internal `canEdit`
/// guard, which no-ops with an error message).
struct WorklogFormView: View {
    @Bindable var store: StoreOf<WorklogFormFeature>

    private var isEditMode: Bool {
        if case .edit = store.mode { return true }
        return false
    }

    private var editable: Bool {
        canEdit(store.loadState)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Palette.baseBg.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 16) {
                        VStack(alignment: .leading, spacing: 14) {
                            VStack(alignment: .leading, spacing: 6) {
                                SectionHeader(title: "Duration")
                                TextField("e.g. 1:30 or 1.5h", text: $store.hoursText)
                                    .keyboardType(.numbersAndPunctuation)
                                    .padding(12)
                                    .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
                                    .foregroundStyle(Palette.textPrimary)
                                    .disabled(!editable)
                            }

                            VStack(alignment: .leading, spacing: 6) {
                                SectionHeader(title: "Description")
                                TextField("Optional note", text: $store.descriptionText)
                                    .padding(12)
                                    .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
                                    .foregroundStyle(Palette.textPrimary)
                                    .disabled(!editable)
                            }

                            if let error = store.errorMessage {
                                Text(error)
                                    .font(.footnote)
                                    .foregroundStyle(.red)
                            }
                        }
                        .padding(16)
                        .contentCard()

                        Button {
                            store.send(.saveTapped)
                        } label: {
                            Text(store.isSaving ? "Saving…" : "Save")
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                                .background(Palette.ctaGradient, in: RoundedRectangle(cornerRadius: 12))
                                .foregroundStyle(.white)
                        }
                        .disabled(store.isSaving || !editable)
                        .accessibilityLabel("Save worklog")

                        if isEditMode {
                            Button(role: .destructive) {
                                store.send(.deleteTapped)
                            } label: {
                                Text("Delete")
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 12)
                                    .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
                                    .foregroundStyle(.red)
                            }
                            .disabled(store.isSaving || !editable)
                            .accessibilityLabel("Delete worklog")
                        }
                    }
                    .padding(16)
                }
            }
            .foregroundStyle(Palette.textPrimary)
            .navigationTitle(isEditMode ? "Edit worklog" : "New worklog")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        store.send(.delegate(.dismissed))
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .accessibilityLabel("Close")
                }
            }
        }
    }
}
