import SwiftUI
import ComposableArchitecture
import WatchtowerCore

/// Records form sheet — ported from the ORIGINAL
/// `packages/module-timetracker/src/billing/records/WorklogDrawer.tsx` (NOT
/// iphone-native): same create/edit sheet bound to `WorklogFormFeature`, same
/// mode-derived Delete visibility, but the card uses the design-align
/// `glassCard()` helper (not `contentCard()`), the shared `SectionHeaderLabel`
/// for field captions, and a read-only task/date summary line (derived from
/// `store.mode`) matching the web original's fixed-task chip + date field —
/// `WorklogFormFeature.State` has no task-picker or editable-date binding
/// (both are locked at creation time by the caller), so this stays read-only
/// rather than adding new reducer state. Save/Delete are additionally
/// `.disabled` when `!canEdit(store.loadState)` — matching
/// `ContractDrawerView`'s pattern (the web original only gates via the
/// reducer's internal `canEdit` guard, which no-ops with an error message).
struct WorklogFormView: View {
    @Bindable var store: StoreOf<WorklogFormFeature>

    private var isEditMode: Bool {
        if case .edit = store.mode { return true }
        return false
    }

    private var editable: Bool {
        canEdit(store.loadState)
    }

    /// The fixed task label ("NUMBER · title") and work date this entry is
    /// attached to — read-only display, mirroring the web drawer's
    /// `fixedTask`/date summary since neither is editable post-creation here.
    private var fixedSummary: (task: String, date: String) {
        switch store.mode {
        case let .create(task, date):
            let label = task.taskNumber.map { "\($0) · \(task.taskTitle)" } ?? task.taskTitle
            return (label, date)
        case let .edit(row):
            let label = row.taskNumber.map { "\($0) · \(row.taskTitle ?? row.projectName)" } ?? (row.taskTitle ?? row.projectName)
            return (label, row.workDate)
        }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Palette.baseBg.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 16) {
                        VStack(alignment: .leading, spacing: 14) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(fixedSummary.task)
                                    .font(.system(size: 13))
                                    .foregroundStyle(Palette.textMuted)
                                Text(CzFormat.dateCz(fixedSummary.date))
                                    .font(.system(size: 13))
                                    .foregroundStyle(Palette.textMuted)
                            }

                            VStack(alignment: .leading, spacing: 6) {
                                SectionHeaderLabel("Duration")
                                TextField("e.g. 1:30 or 1.5h", text: $store.hoursText)
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
                        .accessibilityLabel("Save worklog")

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
