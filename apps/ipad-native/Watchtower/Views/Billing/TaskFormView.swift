import SwiftUI
import ComposableArchitecture
import WatchtowerCore

/// Records form sheet — ported from the ORIGINAL
/// `packages/module-timetracker/src/billing/records/TaskListView.tsx`'s
/// `TaskDrawer` (NOT iphone-native): same create/edit sheet bound to
/// `TaskFormFeature` (number/title/status/estimate/description fields), same
/// mode-derived Delete visibility, but the card uses the design-align
/// `glassCard()` helper (not `contentCard()`), the shared
/// `SectionHeaderLabel` for field captions, and a read-only project summary
/// line (looked up from `store.dataset`) matching the web original's epic/
/// project picker — `TaskFormFeature.State` locks the epic at creation time
/// (`Mode.create(epicId:)`) with no in-form picker, so this stays read-only
/// rather than adding new reducer state. Save/Delete are additionally
/// `.disabled` when `!canEdit(store.loadState)` — matching
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

    /// The project this task belongs to (color + name), read-only —
    /// resolved from `store.dataset` for create mode (via the locked
    /// `epicId`) or straight off the row for edit mode.
    private var projectSummary: (name: String, color: String?)? {
        switch store.mode {
        case let .edit(row):
            return (row.projectName, row.projectColor)
        case let .create(epicId):
            guard let epic = store.dataset?.epics.first(where: { $0.epicId == epicId }),
                  let project = store.dataset?.projects.first(where: { $0.id == epic.projectId }) else {
                return nil
            }
            return (project.name, project.color)
        }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Palette.baseBg.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 16) {
                        VStack(alignment: .leading, spacing: 14) {
                            if let project = projectSummary {
                                HStack(spacing: 6) {
                                    if let color = project.color {
                                        Circle().fill(Color(hex: color)).frame(width: 8, height: 8)
                                    }
                                    Text(project.name.isEmpty ? "(no name)" : project.name)
                                        .font(.system(size: 13))
                                        .foregroundStyle(Palette.textMuted)
                                }
                            }

                            VStack(alignment: .leading, spacing: 6) {
                                SectionHeaderLabel("Number")
                                TextField("Task number", text: $store.numberText)
                                    .padding(12)
                                    .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 11))
                                    .foregroundStyle(Palette.textPrimary)
                                    .disabled(!editable)
                            }

                            VStack(alignment: .leading, spacing: 6) {
                                SectionHeaderLabel("Title")
                                TextField("Task title", text: $store.titleText)
                                    .padding(12)
                                    .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 11))
                                    .foregroundStyle(Palette.textPrimary)
                                    .disabled(!editable)
                            }

                            VStack(alignment: .leading, spacing: 6) {
                                SectionHeaderLabel("Status")
                                Picker("Status", selection: $store.status) {
                                    ForEach(Self.statusOptions, id: \.value) { option in
                                        Text(option.label).tag(option.value)
                                    }
                                }
                                .pickerStyle(.segmented)
                                .disabled(!editable)
                            }

                            VStack(alignment: .leading, spacing: 6) {
                                SectionHeaderLabel("Estimate")
                                TextField("e.g. 4:00 or 4h", text: $store.estimateText)
                                    .keyboardType(.numbersAndPunctuation)
                                    .padding(12)
                                    .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 11))
                                    .foregroundStyle(Palette.textPrimary)
                                    .disabled(!editable)
                            }

                            VStack(alignment: .leading, spacing: 6) {
                                SectionHeaderLabel("Description")
                                TextField("Optional note", text: $store.descriptionText)
                                    .padding(12)
                                    .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 11))
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
                        .glassCard()

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
                                    .background(Color(hex: "#6e1818").opacity(0.32), in: RoundedRectangle(cornerRadius: 12))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 12)
                                            .stroke(Color(hex: "#f87171").opacity(0.40), lineWidth: 1)
                                    )
                                    .foregroundStyle(Color(hex: "#fca5a5"))
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
