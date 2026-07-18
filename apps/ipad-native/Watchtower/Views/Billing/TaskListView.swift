import SwiftUI
import ComposableArchitecture
import WatchtowerCore

/// iPad port of the iPhone `TaskListView` — same search filter + sort
/// (localized project name then title) and the same "+"-add / row-tap-to-
/// edit affordances (→ `addTaskTapped` / `taskRowTapped`), but cards use the
/// iPad design system's `contentCard()` instead of `GlassCard`/
/// `.ultraThinMaterial`.
///
/// Adds explicit `canEdit` gating the iPhone reference doesn't have at the
/// view layer: the "+ add" affordance is hidden, and every row becomes
/// untappable, whenever `!canEdit(billing.loadState)`.
struct TaskListView: View {
    let billing: StoreOf<BillingFeature>
    let records: StoreOf<RecordsFeature>

    private var dataset: BillingDataset {
        billing.dataset ?? BillingDataset(worklogs: [], contracts: [], daysOff: [], projects: [], tasks: [], epics: [], fetchedAt: "")
    }

    private var rows: [TaskRow] {
        let q = records.taskQuery.lowercased().trimmingCharacters(in: .whitespaces)
        let base = q.isEmpty
            ? dataset.tasks
            : dataset.tasks.filter { "\($0.taskNumber ?? "") \($0.taskTitle) \($0.projectName)".lowercased().contains(q) }
        return base.sorted { a, b in
            if a.projectName.localizedCompare(b.projectName) == .orderedSame {
                return a.taskTitle.localizedCompare(b.taskTitle) == .orderedAscending
            }
            return a.projectName.localizedCompare(b.projectName) == .orderedAscending
        }
    }

    private var isLoading: Bool {
        billing.loadState == .loading && billing.dataset == nil
    }

    private var editable: Bool {
        canEdit(billing.loadState)
    }

    private var searchBinding: Binding<String> {
        Binding(get: { records.taskQuery }, set: { records.send(.taskQueryChanged($0)) })
    }

    /// The epic the "+" button seeds the new-task sheet with, or `nil`
    /// (button disabled) if there is no epic at all.
    private var defaultEpicId: Int? {
        rows.first?.epicId ?? dataset.epics.first?.epicId
    }

    var body: some View {
        ZStack {
            Palette.baseBg.ignoresSafeArea()

            VStack(spacing: 0) {
                searchBar

                if isLoading {
                    Spacer()
                    VStack(spacing: 12) {
                        ProgressView().tint(Palette.accentIcon)
                        Text("Loading…").foregroundStyle(Palette.textMuted)
                    }
                    Spacer()
                } else if rows.isEmpty {
                    Spacer()
                    Text("no tasks")
                        .font(.subheadline)
                        .foregroundStyle(Palette.textMuted)
                    Spacer()
                } else {
                    ScrollView {
                        VStack(spacing: 0) {
                            ForEach(Array(rows.enumerated()), id: \.element.syncId) { index, task in
                                Button {
                                    records.send(.taskRowTapped(task))
                                } label: {
                                    TaskRowView(task: task)
                                }
                                .buttonStyle(.plain)
                                .disabled(!editable)
                                if index < rows.count - 1 {
                                    Divider().overlay(Palette.hairline)
                                }
                            }
                        }
                        .contentCard()
                        .padding(.horizontal, 16)
                        .padding(.top, 12)
                        .padding(.bottom, 32)
                    }
                }
            }
        }
    }

    // MARK: - Search bar

    private var searchBar: some View {
        HStack(spacing: 8) {
            TextField("Search task…", text: searchBinding)
                .textFieldStyle(.plain)
                .font(.system(size: 13))
                .foregroundStyle(Palette.textPrimary)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 9))
                .overlay(
                    RoundedRectangle(cornerRadius: 9)
                        .stroke(Color.white.opacity(0.12), lineWidth: 1)
                )

            if editable {
                addButton
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .contentCard(cornerRadius: 16)
        .padding(.horizontal, 16)
        .padding(.top, 12)
    }

    private var addButton: some View {
        Button {
            guard let epicId = defaultEpicId else { return }
            records.send(.addTaskTapped(epicId: epicId))
        } label: {
            Image(systemName: "plus.circle.fill")
                .font(.system(size: 22))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Palette.accentIcon)
        .disabled(defaultEpicId == nil)
        .accessibilityLabel("Add task")
    }
}

// MARK: - Status label / color

private func taskStatusLabel(_ status: String) -> String {
    switch status {
    case "open": return "Open"
    case "in_progress": return "In progress"
    case "to_accept": return "To accept"
    case "done": return "Done"
    default: return status
    }
}

private func taskStatusColor(_ status: String) -> Color {
    switch status {
    case "in_progress", "to_accept": return Palette.accent
    default: return Palette.textMuted
    }
}

// MARK: - Task row (read-only)

private struct TaskRowView: View {
    let task: TaskRow

    var body: some View {
        HStack(spacing: 10) {
            if let color = task.projectColor {
                Circle()
                    .fill(Color(hex: color))
                    .frame(width: 9, height: 9)
            }
            if let number = task.taskNumber {
                Text(number)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(Palette.textMuted)
                    .fixedSize()
            }
            Text(task.taskTitle.isEmpty ? "(no name)" : task.taskTitle)
                .font(.system(size: 12.5))
                .foregroundStyle(Palette.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 4)
            Text(taskStatusLabel(task.status))
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(taskStatusColor(task.status))
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
                .background(taskStatusColor(task.status).opacity(0.15), in: Capsule())
                .overlay(
                    Capsule().stroke(taskStatusColor(task.status).opacity(0.4), lineWidth: 1)
                )
                .fixedSize()
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 4)
    }
}
