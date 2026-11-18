import SwiftUI
import ComposableArchitecture
import WatchtowerCore

/// Records → "Grid" — ported from the ORIGINAL
/// `packages/module-timetracker/src/billing/records/TaskGridView.tsx` (NOT
/// iphone-native): the task x day spreadsheet. Read-only in structure: cells
/// are plain display, with no inline edit widgets of their own. The one
/// interaction a cell carries is a tap that opens the worklog editor sheet
/// (via `RecordsFeature.gridCellTapped`, same as the original) — gated by
/// `canEdit(billing.loadState)` below, so it is inert whenever the dataset
/// isn't in a writable state.
///
/// The table surface uses `dataPanel()` — the non-frosted, near-solid fill
/// the design-align pass reserves for dense data grids (crisp numbers, no
/// blur softening digits) — while the header bar above it uses `glassCard()`
/// like every other sticky filter bar in this module.
///
/// Layout keeps the fixed `nameW`/`sigW`/`dayW` geometry and the frozen-left-
/// column + horizontally-scrolling day-region split sharing one vertical
/// `ScrollView` so the two sides stay aligned "for free". KNOWN GAP vs the
/// web original: the header row and footer are NOT pinned to the viewport
/// during vertical scroll (CSS `position: sticky` has no direct SwiftUI
/// equivalent for a footer, and pinning the header would require reworking
/// the frozen-column/day-region split into a row-synchronized double-scroll
/// construct) — they scroll with the body like a normal table. The frozen
/// LEFT columns (task name + Σ), the part of the spec this most depends on
/// for usability at a wide iPad width, are unaffected. No reducer/derivation
/// changes: on the wider iPad screen, the horizontal day-region simply shows
/// more columns before the user needs to scroll — nothing else differs.
struct TaskGridView: View {
    let billing: StoreOf<BillingFeature>
    let records: StoreOf<RecordsFeature>

    // MARK: - Column/row geometry (ported verbatim from the iPhone reference)

    private let nameW: CGFloat = 118
    private let sigW: CGFloat = 60
    private let dayW: CGFloat = 30
    private let headerH: CGFloat = 34
    private let rowH: CGFloat = 30
    private let footerH: CGFloat = 26

    private var dataset: BillingDataset {
        billing.dataset ?? BillingDataset(worklogs: [], contracts: [], daysOff: [], projects: [], tasks: [], epics: [], fetchedAt: "")
    }

    private var isLoading: Bool {
        billing.loadState == .loading && billing.dataset == nil
    }

    private var editable: Bool {
        canEdit(billing.loadState)
    }

    /// Ported from `TaskGridView.tsx`'s `estimatesByKey` map: last task for a given
    /// `projectId:taskNumber` key wins, matching JS `Map` set-overwrite semantics.
    private var estimatesByKey: [String: Int?] {
        var map: [String: Int?] = [:]
        for t in dataset.tasks {
            map["\(t.projectId):\(t.taskNumber ?? "")"] = t.estimatedMinutes
        }
        return map
    }

    private var g: TaskGridResult {
        buildTaskGrid(dataset.worklogs, month: records.gridMonth, projectIds: records.gridProjectIds, estimatesByKey: estimatesByKey)
    }

    private var meta: [GridDayMeta] {
        gridDayMeta(month: records.gridMonth, daysOff: dataset.daysOff, today: utcTodayIso())
    }

    // `expectedEarnings` takes `projectIds` so the footer's expected-earnings
    // target scopes to the same project filter as the grid body, not all billable projects.
    private var exp: ExpectedEarnings {
        expectedEarnings(
            month: records.gridMonth, worklogs: dataset.worklogs, contracts: dataset.contracts,
            daysOff: dataset.daysOff, projectIds: records.gridProjectIds
        )
    }

    var body: some View {
        ZStack {
            Palette.baseBg.ignoresSafeArea()

            VStack(spacing: 0) {
                headerControls
                legend

                if isLoading {
                    Spacer()
                    VStack(spacing: 12) {
                        ProgressView().tint(Palette.accentIcon)
                        Text("Loading…").foregroundStyle(Palette.textMuted)
                    }
                    Spacer()
                } else if g.tasks.isEmpty {
                    Spacer()
                    Text("no records for this month")
                        .font(.subheadline)
                        .foregroundStyle(Palette.textMuted)
                    Spacer()
                } else {
                    matrix
                        .padding(.horizontal, 16)
                        .padding(.top, 12)
                        .padding(.bottom, 16)
                }
            }
        }
    }

    // MARK: - Header controls (month stepper + multi-select project menu)

    private var headerControls: some View {
        VStack(spacing: 10) {
            HStack(spacing: 8) {
                stepButton("‹") { records.send(.gridMonthStepped(-1)) }
                Text(CzFormat.czechMonthLabel(records.gridMonth))
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Palette.textPrimary)
                    .frame(minWidth: 128)
                    .multilineTextAlignment(.center)
                stepButton("›") { records.send(.gridMonthStepped(1)) }
                Spacer()
                todayButton
            }
            projectMenu
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .glassCard(cornerRadius: 16)
        .padding(.horizontal, 16)
        .padding(.top, 12)
    }

    private func stepButton(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 18))
                .frame(width: 34, height: 34)
        }
        .buttonStyle(.plain)
        .foregroundStyle(Palette.accentIcon)
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 9))
    }

    /// Jumps `gridMonth` to the current month by dispatching the existing
    /// `gridMonthStepped(delta)` action with a computed delta — there's no
    /// dedicated "jump to today" reducer action, matching the same trick
    /// `WorklogListView`'s Today button uses.
    private var todayButton: some View {
        Button("Today") {
            let delta = Self.monthIndex(String(utcTodayIso().prefix(7))) - Self.monthIndex(records.gridMonth)
            records.send(.gridMonthStepped(delta))
        }
        .buttonStyle(.plain)
        .font(.system(size: 12.5, weight: .semibold))
        .foregroundStyle(Palette.textSecondary)
        .padding(.horizontal, 14)
        .frame(height: 34)
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 9))
        .overlay(
            RoundedRectangle(cornerRadius: 9)
                .stroke(Color.white.opacity(0.12), lineWidth: 1)
        )
    }

    private static func monthIndex(_ month: String) -> Int {
        let p = month.split(separator: "-")
        guard p.count == 2, let y = Int(p[0]), let m = Int(p[1]) else { return 0 }
        return y * 12 + (m - 1)
    }

    private var projectMenu: some View {
        Menu {
            Button {
                // No dedicated "clear" action on RecordsFeature — toggling off every
                // currently-selected id (in order) reduces gridProjectIds back to [].
                for id in records.gridProjectIds { records.send(.gridProjectToggled(id)) }
            } label: {
                if records.gridProjectIds.isEmpty {
                    Label("All projects", systemImage: "checkmark")
                } else {
                    Text("All projects")
                }
            }
            ForEach(dataset.projects, id: \.id) { project in
                let name = project.name.isEmpty ? "(no name)" : project.name
                Button {
                    records.send(.gridProjectToggled(project.id))
                } label: {
                    if records.gridProjectIds.contains(project.id) {
                        Label(name, systemImage: "checkmark")
                    } else {
                        Text(name)
                    }
                }
            }
        } label: {
            HStack {
                Text(projectMenuLabel)
                    .font(.system(size: 13))
                    .foregroundStyle(Palette.textPrimary)
                    .lineLimit(1)
                Spacer()
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption2)
                    .foregroundStyle(Palette.textMuted)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 9))
            .overlay(
                RoundedRectangle(cornerRadius: 9)
                    .stroke(Color.white.opacity(0.12), lineWidth: 1)
            )
        }
        .menuOrder(.fixed)
    }

    private var projectMenuLabel: String {
        if records.gridProjectIds.isEmpty { return "All projects" }
        let names = dataset.projects
            .filter { records.gridProjectIds.contains($0.id) }
            .map { $0.name.isEmpty ? "(no name)" : $0.name }
        return names.joined(separator: ", ")
    }

    // MARK: - Legend (static)

    private var legend: some View {
        HStack(spacing: 14) {
            legendSwatch(color: Color.white.opacity(0.18), label: "weekend")
            legendSwatch(color: Palette.accent.opacity(0.35), label: "holiday")
            legendSwatch(color: Palette.chartCyan.opacity(0.5), label: "vacation")
            legendSwatch(color: Color(hex: "#f87171").opacity(0.5), label: "sick")
            legendRing(label: "today")
            Spacer()
        }
        .font(.system(size: 11))
        .foregroundStyle(Palette.textMuted)
        .padding(.horizontal, 16)
        .padding(.top, 10)
    }

    private func legendSwatch(color: Color, label: String) -> some View {
        HStack(spacing: 5) {
            RoundedRectangle(cornerRadius: 2).fill(color).frame(width: 10, height: 10)
            Text(label)
        }
    }

    private func legendRing(label: String) -> some View {
        HStack(spacing: 5) {
            RoundedRectangle(cornerRadius: 2)
                .stroke(Palette.accent, lineWidth: 1.5)
                .frame(width: 10, height: 10)
            Text(label)
        }
    }

    // MARK: - Matrix

    private var matrix: some View {
        ScrollView(.vertical, showsIndicators: true) {
            HStack(alignment: .top, spacing: 0) {
                frozenColumn
                dayRegion
            }
        }
        // Non-frosted, near-solid surface for dense data — matches the web
        // original's `dataPanelFill` wrapper around the ledger table.
        .dataPanel(cornerRadius: 12)
    }

    // MARK: - Frozen left column (task name + Σ)

    private var frozenColumn: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                Text("Task")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Palette.textMuted)
                    .padding(.leading, 8)
                    .frame(width: nameW, alignment: .leading)
                Text("Σ")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Palette.textMuted)
                    .padding(.trailing, 8)
                    .frame(width: sigW, alignment: .trailing)
            }
            .frame(height: headerH)
            .background(Color.white.opacity(0.05))

            ForEach(g.tasks, id: \.key) { t in
                HStack(spacing: 0) {
                    taskNameCell(t)
                        .padding(.leading, 8)
                        .frame(width: nameW, alignment: .leading)
                    sigText(t)
                        .padding(.trailing, 8)
                        .frame(width: sigW, alignment: .trailing)
                }
                .frame(height: rowH)
            }

            HStack(spacing: 0) {
                Text("Total (h)")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Palette.textMuted)
                    .padding(.leading, 8)
                    .frame(width: nameW, alignment: .leading)
                footer1Sig
                    .padding(.trailing, 8)
                    .frame(width: sigW, alignment: .trailing)
            }
            .frame(height: footerH)
            .background(Color.white.opacity(0.05))

            HStack(spacing: 0) {
                Text("Earnings")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Palette.textMuted)
                    .padding(.leading, 8)
                    .frame(width: nameW, alignment: .leading)
                footer2Sig
                    .padding(.trailing, 8)
                    .frame(width: sigW, alignment: .trailing)
            }
            .frame(height: footerH)
            .background(Color.white.opacity(0.05))
        }
        .frame(width: nameW + sigW)
    }

    private func taskNameCell(_ t: TaskGridRow) -> some View {
        HStack(spacing: 6) {
            if let color = t.projectColor {
                Circle().fill(Color(hex: color)).frame(width: 7, height: 7)
            }
            Text(t.taskNumber ?? "(no task)")
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(Palette.textMuted)
                .lineLimit(1)
                .fixedSize()
            Text(t.taskTitle ?? "")
                .font(.system(size: 11.5))
                .foregroundStyle(Palette.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
        }
    }

    private func sigText(_ t: TaskGridRow) -> Text {
        let rowTotal = t.perDay.reduce(0, +)
        var text = Text(CzFormat.hours(rowTotal)).fontWeight(.bold).foregroundColor(Palette.accent)
        if let est = t.estimatedMinutes {
            text = text + Text(" / " + CzFormat.hours(Double(est))).foregroundColor(Palette.textMuted)
        }
        return text.font(.system(size: 11))
    }

    private var footer1Sig: Text {
        (Text(hoursNum(g.monthTotalMinutes)).fontWeight(.bold).foregroundColor(Palette.accent)
            + Text(" / " + hoursNum(Double(exp.capacityMinutes))).foregroundColor(Palette.textMuted))
            .font(.system(size: 11))
    }

    private var footer2Sig: Text {
        (Text(CzFormat.czk(g.monthTotalCzk)).fontWeight(.bold).foregroundColor(Palette.accent)
            + Text(" / " + czkNum(exp.expectedCzk)).foregroundColor(Palette.textMuted))
            .font(.system(size: 10.5))
    }

    // MARK: - Horizontally-scrolling day-column region

    private var dayRegion: some View {
        ScrollView(.horizontal, showsIndicators: true) {
            VStack(spacing: 0) {
                HStack(spacing: 0) {
                    ForEach(Array(meta.enumerated()), id: \.offset) { _, m in
                        dayHeaderCell(m).frame(width: dayW, height: headerH)
                    }
                }

                ForEach(g.tasks, id: \.key) { t in
                    HStack(spacing: 0) {
                        ForEach(Array(t.perDay.enumerated()), id: \.offset) { i, v in
                            dayBodyCell(v, meta[i], task: t).frame(width: dayW, height: rowH)
                        }
                    }
                }

                HStack(spacing: 0) {
                    ForEach(Array(g.dailyTotals.enumerated()), id: \.offset) { i, v in
                        footerCell(hrsBare(v), meta[i], color: Palette.accent).frame(width: dayW, height: footerH)
                    }
                }
                .background(Color.white.opacity(0.05))

                HStack(spacing: 0) {
                    ForEach(Array(g.dailyEarnings.enumerated()), id: \.offset) { i, v in
                        footerCell(czkBare(v), meta[i], color: Palette.textPrimary).frame(width: dayW, height: footerH)
                    }
                }
                .background(Color.white.opacity(0.05))
            }
        }
    }

    private func dayHeaderCell(_ m: GridDayMeta) -> some View {
        VStack(spacing: 1) {
            Text("\(m.day)")
                .font(.system(size: 10, weight: .semibold))
            Text(dowAbbrev(m.date))
                .font(.system(size: 7, weight: .semibold))
                .textCase(.uppercase)
        }
        .foregroundStyle(m.isWeekend ? Palette.accentIcon : Palette.textMuted)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(dayTint(m))
        .overlay(
            RoundedRectangle(cornerRadius: 3)
                .stroke(Palette.accent, lineWidth: m.isToday ? 1.5 : 0)
        )
    }

    /// Tappable cell → `gridCellTapped`, gated on `canEdit(billing.loadState)`
    /// (the iPhone reference relies solely on the reducer's own guard; this
    /// pass additionally disables the affordance in the view, matching
    /// `ProjectDetailView`/`ContractDrawerView`'s pattern). The task/worklog to
    /// seed the sheet with are resolved from the shared dataset by
    /// `(projectId, taskNumber)` — the same key `TaskGridRow` itself is keyed
    /// by (see the `estimatesByKey` comment above on the accepted collision
    /// risk of that key). A cell with no resolvable task (e.g. the "(no
    /// task)" row) is disabled — there's nothing to attach a new worklog to.
    private func dayBodyCell(_ minutes: Double, _ m: GridDayMeta, task: TaskGridRow) -> some View {
        let matchedTask = dataset.tasks.first {
            $0.projectId == task.projectId && ($0.taskNumber ?? "") == (task.taskNumber ?? "")
        }
        let existingWorklog = dataset.worklogs.first {
            $0.projectId == task.projectId && ($0.taskNumber ?? "") == (task.taskNumber ?? "") && $0.workDate == m.date
        }

        return Button {
            guard let matchedTask else { return }
            records.send(.gridCellTapped(taskId: matchedTask.taskId, date: m.date, existing: existingWorklog))
        } label: {
            Text(hrsBare(minutes))
                .font(.system(size: 10))
                .foregroundStyle(minutes != 0 ? Palette.textPrimary : Palette.textDim)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(dayTint(m))
                .overlay(
                    RoundedRectangle(cornerRadius: 3)
                        .stroke(Palette.accent, lineWidth: m.isToday ? 1.2 : 0)
                )
        }
        .buttonStyle(.plain)
        .disabled(matchedTask == nil || !editable)
    }

    private func footerCell(_ text: String, _ m: GridDayMeta, color: Color) -> some View {
        Text(text)
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(color)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(dayTint(m))
    }
}

// MARK: - Per-day tint (presentation only, mirrors TaskGridView.tsx's `dayTint`)

private func dayTint(_ m: GridDayMeta) -> Color {
    if let kind = m.kind {
        switch kind {
        case .vacation: return Palette.chartCyan.opacity(0.18)
        case .sick: return Color(hex: "#f87171").opacity(0.18)
        case .holiday: return Palette.accent.opacity(0.20)
        case .other: return m.isWeekend ? Color.white.opacity(0.08) : Color.clear
        }
    }
    return m.isWeekend ? Color.white.opacity(0.08) : Color.clear
}

// MARK: - Bare (unit-less) number formatting

private let bareHoursFormatter: NumberFormatter = {
    let f = NumberFormatter()
    f.numberStyle = .decimal
    f.locale = Locale(identifier: "cs_CZ")
    f.maximumFractionDigits = 2
    f.minimumFractionDigits = 0
    f.usesGroupingSeparator = true
    f.groupingSeparator = "\u{00A0}"
    f.decimalSeparator = ","
    return f
}()

private let bareCzkFormatter: NumberFormatter = {
    let f = NumberFormatter()
    f.numberStyle = .decimal
    f.locale = Locale(identifier: "cs_CZ")
    f.maximumFractionDigits = 0
    f.minimumFractionDigits = 0
    f.usesGroupingSeparator = true
    f.groupingSeparator = "\u{00A0}"
    f.decimalSeparator = ","
    return f
}()

/// cs-CZ formatted hours, no " h" suffix — footer "Total (h)" targets.
private func hoursNum(_ minutes: Double) -> String {
    bareHoursFormatter.string(from: (minutes / 60) as NSNumber) ?? "0"
}

/// cs-CZ formatted CZK, no " Kč" suffix — footer "Earnings" target.
private func czkNum(_ amount: Double) -> String {
    bareCzkFormatter.string(from: amount as NSNumber) ?? "0"
}

/// Body-cell hours: 1 decimal, comma separator, blank at 0. Mirrors `TaskGridView.tsx`'s `hrs`.
private func hrsBare(_ minutes: Double) -> String {
    guard minutes != 0 else { return "" }
    return String(format: "%.1f", minutes / 60).replacingOccurrences(of: ".", with: ",")
}

/// Footer per-day earnings: rounded integer, blank at 0. Mirrors the TSX footer's
/// `{czk ? Math.round(czk) : ''}`.
private func czkBare(_ amount: Double) -> String {
    guard amount != 0 else { return "" }
    return String(Int(amount.rounded()))
}

// MARK: - Date helpers (UTC, no locale/timezone drift)

private let utcCalendarForGrid: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "UTC")!
    return c
}()

private let utcDayFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    f.timeZone = TimeZone(identifier: "UTC")!
    f.locale = Locale(identifier: "en_US_POSIX")
    return f
}()

private func utcTodayIso() -> String {
    utcDayFormatter.string(from: Date())
}

private let dowAbbrevs = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]

/// Mon-first day-of-week abbreviation for a "YYYY-MM-DD" date string.
private func dowAbbrev(_ dateStr: String) -> String {
    let parts = dateStr.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3,
          let date = utcCalendarForGrid.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    else { return "" }
    let weekday = utcCalendarForGrid.component(.weekday, from: date) // 1=Sun ... 7=Sat
    let idx = (weekday + 5) % 7
    return dowAbbrevs[idx]
}
