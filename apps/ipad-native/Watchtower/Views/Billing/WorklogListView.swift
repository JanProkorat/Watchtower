import SwiftUI
import ComposableArchitecture
import WatchtowerCore

private let worklogSourceLabels: [String: String] = [
    "manual": "manual",
    "watchtower-auto": "watchtower",
    "jira-sync": "jira",
]

/// iPad port of the iPhone `WorklogListView` — same derivation
/// (`groupWorklogsByDay`), same month/project filter bar, and the same
/// "+"-add / row-tap-to-edit affordances (→ `addWorklogTapped` /
/// `worklogRowTapped`), but cards use the iPad design system's
/// `contentCard()` instead of `GlassCard`/`.ultraThinMaterial`.
///
/// Adds explicit `canEdit` gating the iPhone reference doesn't have at the
/// view layer (it only relies on the reducer's internal guard): the "+ add"
/// affordance is hidden, and every row becomes untappable, whenever
/// `!canEdit(billing.loadState)` — mirrors the pattern already established
/// by `ProjectDetailView`/`ContractDrawerView` in this module.
struct WorklogListView: View {
    let billing: StoreOf<BillingFeature>
    let records: StoreOf<RecordsFeature>

    private var dataset: BillingDataset {
        billing.dataset ?? BillingDataset(worklogs: [], contracts: [], daysOff: [], projects: [], tasks: [], epics: [], fetchedAt: "")
    }

    private var days: [WorklogDay] {
        groupWorklogsByDay(dataset.worklogs, month: records.worklogMonth, projectId: records.worklogProjectId)
    }

    private var isLoading: Bool {
        billing.loadState == .loading && billing.dataset == nil
    }

    private var editable: Bool {
        canEdit(billing.loadState)
    }

    // MARK: - "+ Add worklog" default task/date

    /// The task the "+" button seeds the new-worklog sheet with: the first task
    /// under the currently-selected project filter, or the first known task if
    /// no filter is active. `nil` (button disabled) if there is no matching task
    /// — when a project filter IS active, this never falls back to another
    /// project's task, since that would misattribute the new worklog's billing.
    private var defaultWorklogTask: TaskRow? {
        if let projectId = records.worklogProjectId {
            return dataset.tasks.first { $0.projectId == projectId }
        }
        return dataset.tasks.first
    }

    /// Today if the visible month is the current month, else the 1st of the
    /// visible month — keeps the new entry's date inside what's on screen.
    private var defaultWorklogDate: String {
        let today = Self.utcTodayIso()
        return String(today.prefix(7)) == records.worklogMonth ? today : "\(records.worklogMonth)-01"
    }

    private static let utcCalendarForToday: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    private static func utcTodayIso() -> String {
        let c = utcCalendarForToday.dateComponents([.year, .month, .day], from: Date())
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    var body: some View {
        ZStack {
            Palette.baseBg.ignoresSafeArea()

            VStack(spacing: 0) {
                monthBar

                if isLoading {
                    Spacer()
                    VStack(spacing: 12) {
                        ProgressView().tint(Palette.accentIcon)
                        Text("Loading…").foregroundStyle(Palette.textMuted)
                    }
                    Spacer()
                } else if days.isEmpty {
                    Spacer()
                    Text("no records")
                        .font(.subheadline)
                        .foregroundStyle(Palette.textMuted)
                    Spacer()
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            ForEach(days, id: \.date) { day in
                                daySection(day)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.bottom, 32)
                        .padding(.top, 12)
                    }
                }
            }
        }
    }

    // MARK: - Month bar

    private var monthBar: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Button {
                    records.send(.worklogMonthStepped(-1))
                } label: {
                    Text("‹")
                        .font(.system(size: 18))
                        .frame(width: 34, height: 34)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Palette.accentIcon)
                .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 9))

                Text(CzFormat.czechMonthLabel(records.worklogMonth))
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Palette.textPrimary)
                    .frame(minWidth: 128)
                    .multilineTextAlignment(.center)

                Button {
                    records.send(.worklogMonthStepped(1))
                } label: {
                    Text("›")
                        .font(.system(size: 18))
                        .frame(width: 34, height: 34)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Palette.accentIcon)
                .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 9))

                Spacer()

                if editable {
                    addButton
                }
            }

            projectMenu
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .contentCard(cornerRadius: 16)
        .padding(.horizontal, 16)
        .padding(.top, 12)
    }

    private var projectMenu: some View {
        Menu {
            Button("All projects") { records.send(.worklogProjectChanged(nil)) }
            ForEach(dataset.projects, id: \.id) { project in
                Button(project.name.isEmpty ? "(no name)" : project.name) {
                    records.send(.worklogProjectChanged(project.id))
                }
            }
        } label: {
            HStack {
                Text(selectedProjectLabel)
                    .font(.system(size: 13))
                    .foregroundStyle(Palette.textPrimary)
                    .lineLimit(1)
                Spacer()
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption2)
                    .foregroundStyle(Palette.textMuted)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 9))
            .overlay(
                RoundedRectangle(cornerRadius: 9)
                    .stroke(Color.white.opacity(0.12), lineWidth: 1)
            )
        }
        .menuOrder(.fixed)
    }

    private var selectedProjectLabel: String {
        guard let id = records.worklogProjectId,
              let project = dataset.projects.first(where: { $0.id == id }) else {
            return "All projects"
        }
        return project.name.isEmpty ? "(no name)" : project.name
    }

    private var addButton: some View {
        Button {
            records.send(.addWorklogTapped(date: defaultWorklogDate, task: defaultWorklogTask))
        } label: {
            Image(systemName: "plus.circle.fill")
                .font(.system(size: 22))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Palette.accentIcon)
        .disabled(defaultWorklogTask == nil)
        .accessibilityLabel("Add worklog")
    }

    // MARK: - Day section

    @ViewBuilder
    private func daySection(_ day: WorklogDay) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(CzFormat.dateCz(day.date))
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Palette.textPrimary)
                Spacer()
                Text(CzFormat.hours(day.totalMinutes))
                    .font(.caption)
                    .foregroundStyle(Palette.textMuted)
            }

            VStack(spacing: 0) {
                ForEach(Array(day.entries.enumerated()), id: \.element.syncId) { index, entry in
                    Button {
                        records.send(.worklogRowTapped(entry))
                    } label: {
                        WorklogRowView(entry: entry)
                    }
                    .buttonStyle(.plain)
                    .disabled(!editable)
                    if index < day.entries.count - 1 {
                        Divider().overlay(Palette.hairline)
                    }
                }
            }
            .contentCard()
        }
    }
}

// MARK: - Worklog row (read-only)

private struct WorklogRowView: View {
    let entry: WorklogRow

    var body: some View {
        HStack(spacing: 10) {
            if let color = entry.projectColor {
                Circle()
                    .fill(Color(hex: color))
                    .frame(width: 9, height: 9)
            }
            if let taskNumber = entry.taskNumber {
                Text(taskNumber)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(Palette.textMuted)
                    .fixedSize()
            }
            Text(entry.taskTitle ?? entry.projectName)
                .font(.system(size: 12.5))
                .foregroundStyle(Palette.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 4)
            if let source = entry.source {
                Text(worklogSourceLabels[source] ?? source)
                    .font(.system(size: 9.5, weight: .semibold))
                    .foregroundStyle(Palette.textMuted)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 5))
                    .overlay(
                        RoundedRectangle(cornerRadius: 5)
                            .stroke(Color.white.opacity(0.10), lineWidth: 1)
                    )
                    .textCase(.uppercase)
            }
            HStack(spacing: 0) {
                Text(CzFormat.hours(entry.minutes))
                    .font(.system(size: 12.5))
                    .foregroundStyle(Palette.textPrimary)
                if entry.effectiveMinutes != entry.minutes {
                    Text(" → \(CzFormat.hours(entry.effectiveMinutes))")
                        .font(.system(size: 12.5))
                        .foregroundStyle(Palette.textMuted)
                }
            }
            .fixedSize()
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 4)
    }
}
