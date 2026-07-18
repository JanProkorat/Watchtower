import SwiftUI
import ComposableArchitecture
import WatchtowerCore

/// iPad port of the iPhone `TaskFormView` — same create/edit sheet bound to
/// `TaskFormFeature` (number/title/status/estimate/description fields), same
/// mode-derived Delete visibility, but the card uses the iPad design
/// system's `contentCard()` instead of `GlassCard`, and Save/Delete are
/// additionally `.disabled` when `!canEdit(store.loadState)` — matching
/// `WorklogFormView`/`ContractDrawerView`'s pattern.
struct TaskFormView: View {
    @Bindable var store: StoreOf<TaskFormFeature>

    private static let statusOptions: [(value: String, label: String)] = [
        ("open", "Open"), ("in_progress", "In progress"), ("to_accept", "To accept"), ("done", "Done"),
    ]

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
                                SectionHeader(title: "Number")
                                TextField("Task number", text: $store.numberText)
                                    .padding(12)
                                    .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
                                    .foregroundStyle(Palette.textPrimary)
                                    .disabled(!editable)
                            }

                            VStack(alignment: .leading, spacing: 6) {
                                SectionHeader(title: "Title")
                                TextField("Task title", text: $store.titleText)
                                    .padding(12)
                                    .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
                                    .foregroundStyle(Palette.textPrimary)
                                    .disabled(!editable)
                            }

                            VStack(alignment: .leading, spacing: 6) {
                                SectionHeader(title: "Status")
                                Picker("Status", selection: $store.status) {
                                    ForEach(Self.statusOptions, id: \.value) { option in
                                        Text(option.label).tag(option.value)
                                    }
                                }
                                .pickerStyle(.segmented)
                                .disabled(!editable)
                            }

                            VStack(alignment: .leading, spacing: 6) {
                                SectionHeader(title: "Estimate")
                                TextField("e.g. 4:00 or 4h", text: $store.estimateText)
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
                        .accessibilityLabel("Save task")

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
                            .accessibilityLabel("Delete task")
                        }
                    }
                    .padding(16)
                }
            }
            .foregroundStyle(Palette.textPrimary)
            .navigationTitle(isEditMode ? "Edit task" : "New task")
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
