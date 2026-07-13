import SwiftUI
import ComposableArchitecture
import WatchtowerCore

/// Create/edit sheet for a single contract (rate history entry), bound to
/// `ContractDrawerFeature`. Same Save/Delete/Close wiring as `WorklogFormView`
/// / `TaskFormView`, plus the shared-project checklist the React
/// `ContractDrawer` renders as a checkbox list.
///
/// `sharedProjectIds` prefill: `ProjectDetailFeature.contractRowTapped`
/// already seeds `store.sharedProjectIds` from the group's current
/// membership before this view ever appears (see
/// `ProjectDetailFeature.groupMembership`) — this view must only ever toggle
/// membership, never reset/clear the set, or an edit-then-no-op-save would
/// silently drop every sibling member from the shared contract.
struct ContractDrawerView: View {
    @Bindable var store: StoreOf<ContractDrawerFeature>
    let billing: StoreOf<BillingFeature>

    private var isEditMode: Bool {
        if case .edit = store.mode { return true }
        return false
    }

    private var currentProjectId: Int {
        switch store.mode {
        case let .create(projectId): return projectId
        case let .edit(row): return row.projectId
        }
    }

    /// Other `work`-kind, non-current projects eligible to share this
    /// contract with — mirrors the React `sharableProjects` filter.
    private var shareableProjects: [ProjectRow] {
        (billing.dataset?.projects ?? []).filter { $0.kind == "work" && $0.id != currentProjectId }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Palette.baseBg.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 16) {
                        GlassCard {
                            VStack(alignment: .leading, spacing: 14) {
                                dateFields
                                rateTypePicker
                                rateFields
                                mdLimitField

                                if !shareableProjects.isEmpty {
                                    sharedProjectsChecklist
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
                        .accessibilityLabel("Save rate")

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
                            .accessibilityLabel("Delete rate")
                        }
                    }
                    .padding(16)
                }
            }
            .foregroundStyle(Palette.textPrimary)
            .navigationTitle(isEditMode ? "Edit rate" : "New rate")
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

    // MARK: - Fields

    private var dateFields: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                SectionHeader(title: "Effective from")
                TextField("YYYY-MM-DD", text: $store.effectiveFromText)
                    .keyboardType(.numbersAndPunctuation)
                    .padding(12)
                    .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
                    .foregroundStyle(Palette.textPrimary)
            }

            VStack(alignment: .leading, spacing: 6) {
                SectionHeader(title: "End date (optional)")
                TextField("YYYY-MM-DD", text: $store.endDateText)
                    .keyboardType(.numbersAndPunctuation)
                    .padding(12)
                    .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
                    .foregroundStyle(Palette.textPrimary)
            }
        }
    }

    private var rateTypePicker: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionHeader(title: "Rate type")
            Picker("Rate type", selection: $store.rateType) {
                Text("Hourly").tag("hourly")
                Text("Daily").tag("daily")
            }
            .pickerStyle(.segmented)
        }
    }

    private var rateFields: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                SectionHeader(title: "Rate amount")
                TextField("e.g. 1500", text: $store.rateAmountText)
                    .keyboardType(.decimalPad)
                    .padding(12)
                    .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
                    .foregroundStyle(Palette.textPrimary)
            }

            VStack(alignment: .leading, spacing: 6) {
                SectionHeader(title: "Hours per day")
                TextField("e.g. 8", text: $store.hoursPerDayText)
                    .keyboardType(.decimalPad)
                    .padding(12)
                    .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
                    .foregroundStyle(Palette.textPrimary)
            }
        }
    }

    private var mdLimitField: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionHeader(title: "MD limit (optional)")
            TextField("Optional", text: $store.mdLimitText)
                .keyboardType(.decimalPad)
                .padding(12)
                .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
                .foregroundStyle(Palette.textPrimary)
        }
    }

    // MARK: - Shared-projects checklist

    private var sharedProjectsChecklist: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionHeader(title: "Shared with projects (optional)")
            VStack(spacing: 0) {
                ForEach(Array(shareableProjects.enumerated()), id: \.element.id) { index, project in
                    Toggle(isOn: sharedBinding(for: project.id)) {
                        Text(project.name)
                            .foregroundStyle(Palette.textPrimary)
                    }
                    .toggleStyle(.switch)
                    .tint(Palette.accent)
                    .accessibilityLabel("Share rate with \(project.name)")

                    if index < shareableProjects.count - 1 {
                        Divider().overlay(Color.white.opacity(0.08))
                    }
                }
            }
            .padding(8)
            .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
        }
    }

    /// Toggling flips membership in `store.sharedProjectIds` only — never
    /// resets the whole set, so the parent's edit-mode prefill (every
    /// sibling member id) survives untouched apart from the one id the user
    /// actually tapped.
    private func sharedBinding(for id: Int) -> Binding<Bool> {
        Binding(
            get: { store.sharedProjectIds.contains(id) },
            set: { isOn in
                var next = store.sharedProjectIds
                if isOn {
                    next.insert(id)
                } else {
                    next.remove(id)
                }
                $store.sharedProjectIds.wrappedValue = next
            }
        )
    }
}
