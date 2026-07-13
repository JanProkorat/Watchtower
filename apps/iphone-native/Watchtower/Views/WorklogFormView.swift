import SwiftUI
import ComposableArchitecture
import WatchtowerCore

/// Create/edit sheet for a single worklog entry, bound to `WorklogFormFeature`.
/// Mode (create vs edit) is read straight from `store.mode` — the Delete button
/// only appears in `.edit` mode, matching the reducer's own guard (`deleteTapped`
/// is a no-op in `.create` mode).
struct WorklogFormView: View {
    @Bindable var store: StoreOf<WorklogFormFeature>

    private var isEditMode: Bool {
        if case .edit = store.mode { return true }
        return false
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Palette.baseBg.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 16) {
                        GlassCard {
                            VStack(alignment: .leading, spacing: 14) {
                                VStack(alignment: .leading, spacing: 6) {
                                    SectionHeader(title: "Duration")
                                    TextField("e.g. 1:30 or 1.5h", text: $store.hoursText)
                                        .keyboardType(.numbersAndPunctuation)
                                        .padding(12)
                                        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
                                        .foregroundStyle(Palette.textPrimary)
                                }

                                VStack(alignment: .leading, spacing: 6) {
                                    SectionHeader(title: "Description")
                                    TextField("Optional note", text: $store.descriptionText)
                                        .padding(12)
                                        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
                                        .foregroundStyle(Palette.textPrimary)
                                }

                                if let error = store.errorMessage {
                                    Text(error)
                                        .font(.footnote)
                                        .foregroundStyle(.red)
                                }
                            }
                        }

                        Button {
                            store.send(.saveTapped)
                        } label: {
                            Text(store.isSaving ? "Saving…" : "Save")
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                                .background(Palette.ctaGradient, in: RoundedRectangle(cornerRadius: 12))
                                .foregroundStyle(.white)
                        }
                        .disabled(store.isSaving)
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
                            .disabled(store.isSaving)
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
