import SwiftUI
import ComposableArchitecture
import WatchtowerCore

/// Records → "Tasks" — ported from the ORIGINAL
/// `packages/module-timetracker/src/billing/records/TaskListView.tsx` (NOT
/// iphone-native): same search filter + sort (localized project name then
/// title), same sticky glass search bar + "+ Add task" CTA, and the same
/// flat list of individually-`glassCard(10)`'d rows (project dot, mono task
/// number, title, status chip).
///
/// Adds explicit `canEdit` gating the web original doesn't have at the view
/// layer: the "+ Add task" affordance is hidden, and every row becomes
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
                        // Individual `glassCard(10)` per row with a 6pt gap —
                        // matches `TaskListView.tsx`'s per-row `glassCard(10)`
                        // buttons in a `gap: 6` column, NOT a single grouped
                        // card with dividers.
                        VStack(spacing: 6) {
                            ForEach(rows, id: \.syncId) { task in
                                Button {
                                    records.send(.taskRowTapped(task))
                                } label: {
                                    TaskRowView(task: task)
                                }
                                .buttonStyle(.plain)
                                .disabled(!editable)
                            }
                        }
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
        .glassCard(cornerRadius: 16)
        .padding(.horizontal, 16)
        .padding(.top, 12)
    }

    /// Solid CTA pill — mirrors the web original's `ctaGradient`-filled
    /// "+ Přidat úkol" button.
    private var addButton: some View {
        Button {
            guard let epicId = defaultEpicId else { return }
            records.send(.addTaskTapped(epicId: epicId))
        } label: {
            Text("+ Add task")
                .font(.system(size: 12.5, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .frame(height: 34)
        }
        .buttonStyle(.plain)
        .background(Palette.ctaGradient, in: RoundedRectangle(cornerRadius: 11))
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

/// Status chip fill/border opacity — mirrors `TaskListView.tsx`'s
/// `statusChipStyle`: open/done are a muted flat pill; in_progress and
/// to_accept share the accent text color but to_accept renders a visibly
/// stronger fill/border (0.28/0.55 vs 0.18/0.40), signalling it's the more
/// urgent of the two "in flight" states.
private func taskStatusChipStyle(_ status: String) -> (text: Color, fill: Color, border: Color) {
    switch status {
    case "in_progress":
        return (Palette.accent, Palette.accent.opacity(0.18), Palette.accent.opacity(0.40))
    case "to_accept":
        return (Palette.accent, Palette.accent.opacity(0.28), Palette.accent.opacity(0.55))
    default:
        return (Palette.textMuted, Color.white.opacity(0.05), Color.white.opacity(0.10))
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
            statusChip
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 12)
        .glassCard(cornerRadius: 10)
    }

    private var statusChip: some View {
        let style = taskStatusChipStyle(task.status)
        return Text(taskStatusLabel(task.status))
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(style.text)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(style.fill, in: Capsule())
            .overlay(
                Capsule().stroke(style.border, lineWidth: 1)
            )
            .fixedSize()
    }
}
