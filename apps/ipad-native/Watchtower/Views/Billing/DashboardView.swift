import SwiftUI
import ComposableArchitecture
import WatchtowerCore
import WatchtowerBridge

/// iPad port of `packages/module-timetracker/src/billing/DashboardView.tsx`
/// (the ORIGINAL Capacitor design, not iphone-native). Read-only — reads the
/// shared `BillingFeature` dataset and reuses the exact same pure-function
/// projections the web view calls (`dashboardKpis`, `contractBurn`,
/// `topProjects`, `activityHeatmap`), including the `contractGroupId`
/// dedupe for pooled contracts.
///
/// Design-align (Task 3): layout is now a single vertical column of
/// full-width sections (Worked / Active contracts / Top projects / Activity),
/// matching the web original — NOT the earlier adaptive `LazyVGrid` of tiles.
/// Cards use the frosted `glassCard()` helper (Task 1) and the shared
/// `SectionHeaderLabel`, not the solid `contentCard()` / local `TileHeader`.
struct DashboardView: View {
    let store: StoreOf<IPadAppFeature>

    private var billing: StoreOf<BillingFeature> {
        store.scope(state: \.billing, action: \.billing)
    }

    private var dashboard: StoreOf<DashboardFeature> {
        store.scope(state: \.dashboard, action: \.dashboard)
    }

    // UTC calendar for the "today" date string — matches WatchtowerCore's
    // date-arithmetic convention (never the local time zone).
    private static let utcCalendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    private var today: String {
        let c = Self.utcCalendar.dateComponents([.year, .month, .day], from: Date())
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    private var dataset: BillingDataset {
        billing.dataset ?? BillingDataset(worklogs: [], contracts: [], daysOff: [], projects: [], tasks: [], epics: [], fetchedAt: "")
    }

    private var month: String { String(today.prefix(7)) }

    private var kpis: DashboardKpis { dashboardKpis(dataset.worklogs, today: today) }

    private var burns: [ContractBurn] {
        let raw = contractBurn(dataset.contracts, dataset.worklogs, dataset.daysOff, dataset.projects, today: today)
        var seenGroups: Set<String> = []
        var result: [ContractBurn] = []
        for b in raw {
            if let group = b.contractGroupId {
                if seenGroups.contains(group) { continue }
                seenGroups.insert(group)
            }
            result.append(b)
        }
        return result
    }

    private var top: [ProjectEarning] { topProjects(dataset.worklogs, month, 8) }

    private var topMaxMinutes: Double { max(top.map(\.minutes).max() ?? 1, 1) }

    private var heatmap: HeatmapResult { activityHeatmap(dataset.worklogs, today: today) }

    private var monthHasData: Bool {
        dataset.worklogs.contains { $0.workDate.prefix(7) == month }
    }

    private var isLoading: Bool {
        billing.loadState == .loading && billing.dataset == nil
    }

    private var monthLabel: String { month.replacingOccurrences(of: "-", with: "/") }

    var body: some View {
        ZStack {
            if isLoading {
                VStack(spacing: 12) {
                    ProgressView().tint(Palette.accentIcon)
                    Text("Loading…").foregroundStyle(Palette.textMuted)
                }
            } else {
                ScrollView {
                    // Single vertical column, 24pt gaps between sections —
                    // mirrors the web original's `flexDirection: 'column', gap: 24`.
                    VStack(alignment: .leading, spacing: 24) {
                        // A true ViewBuilder omission (zero children) when
                        // fresh/loading — not an `EmptyView()` occupying a
                        // slot, which would still absorb the outer VStack's
                        // 24pt inter-child spacing and leave a phantom gap
                        // above "Worked" on the common (fresh) load path.
                        if billing.loadState == .offline || billing.loadState == .cached {
                            statusBanner
                        }
                        workedSection
                        if !burns.isEmpty {
                            contractsSection
                        }
                        topProjectsSection
                        activitySection
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.top, 16)
                    .padding(.bottom, 32)
                }
                .refreshable {
                    await billing.send(.refreshRequested).finish()
                    dashboard.send(.refreshFinished)
                }
            }

            if dashboard.showToast {
                VStack {
                    Spacer()
                    toastPill
                        .padding(.bottom, 24)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Stale / offline chrome
    //
    // Only called from the `.offline`/`.cached` branch at the call site, so
    // this can assume one of those two states.

    @ViewBuilder
    private var statusBanner: some View {
        if billing.loadState == .offline {
            bannerRow(
                icon: "wifi.slash",
                text: "Offline — dashboard data unavailable",
                tint: Palette.chartAmber,
                showRetry: true
            )
        } else {
            bannerRow(
                icon: "clock.arrow.circlepath",
                text: "Showing cached data — pull to refresh",
                tint: Palette.textMuted,
                showRetry: false
            )
        }
    }

    private func bannerRow(icon: String, text: String, tint: Color, showRetry: Bool) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon).foregroundStyle(tint)
            Text(text)
                .font(.footnote.weight(.medium))
                .foregroundStyle(Palette.textPrimary)
            Spacer()
            if showRetry {
                Button("Retry") { billing.send(.refreshRequested) }
                    .buttonStyle(.glass)
                    .tint(Palette.accent)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .glassCard(cornerRadius: 12)
    }

    // MARK: - Worked ("Odpracováno" in the web original)

    private var workedSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHeaderLabel("Worked")
            // Three equal-width KPI tiles in one non-wrapping row — the web
            // original wraps on phone width, but iPad is always wide enough
            // for a single row (no isNarrow branch needed here).
            HStack(spacing: 10) {
                KpiTile(label: "Today", minutes: kpis.today.minutes, earnedCzk: kpis.today.earnedCzk)
                KpiTile(label: "Sprint", minutes: kpis.sprint.minutes, earnedCzk: kpis.sprint.earnedCzk)
                KpiTile(label: "This month", minutes: kpis.month.minutes, earnedCzk: kpis.month.earnedCzk)
            }
        }
    }

    // MARK: - Active contracts ("Aktivní kontrakty")

    private var contractsSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHeaderLabel("Active contracts")
            VStack(spacing: 8) {
                ForEach(burns, id: \.projectId) { burn in
                    ContractCard(burn: burn)
                }
            }
        }
    }

    // MARK: - Top projects ("Top projekty")

    @ViewBuilder
    private var topProjectsSection: some View {
        // Mirrors the web original exactly: the header only renders when the
        // month has data at all; with no data for the month at all, a single
        // standalone centered card replaces header+list entirely.
        if monthHasData {
            VStack(alignment: .leading, spacing: 0) {
                SectionHeaderLabel("Top projects — \(monthLabel)")
                if top.isEmpty {
                    Text("no data")
                        .font(.subheadline)
                        .foregroundStyle(Palette.textMuted)
                        .padding(.vertical, 8)
                } else {
                    VStack(spacing: 12) {
                        ForEach(Array(top.enumerated()), id: \.element.projectId) { index, project in
                            TopRow(rank: index + 1, project: project, maxMinutes: topMaxMinutes)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                    .glassCard(cornerRadius: 12)
                }
            }
        } else {
            Text("no data for this month")
                .font(.system(size: 14))
                .foregroundStyle(Palette.textMuted)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.vertical, 28)
                .padding(.horizontal, 16)
                .glassCard(cornerRadius: 12)
        }
    }

    // MARK: - Activity ("Aktivita")

    private var activitySection: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHeaderLabel("Activity (30 days)")
            VStack(alignment: .leading, spacing: 12) {
                let maxMinutes = max(heatmap.days.map(\.minutes).max() ?? 1, 1)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 3), count: 7), spacing: 3) {
                    ForEach(heatmap.days, id: \.date) { day in
                        HeatCell(day: day, maxMinutes: maxMinutes)
                    }
                }
                // Cap the width so cells stay small squares on a wide iPad
                // instead of stretching to ~width/7 — matches the web
                // original's `maxWidth: 280`.
                .frame(maxWidth: 280)

                statStrip
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .glassCard(cornerRadius: 12)
        }
    }

    private var statStrip: some View {
        let stats = heatmap.stats
        return HStack(alignment: .top, spacing: 16) {
            statItem(Text("\(stats.currentStreak)").foregroundStyle(Palette.accent), "day streak")
            statItem(Text("\(stats.longestStreak)").foregroundStyle(Palette.textPrimary), "longest streak")
            statItem(Text("\(stats.activeDays)").foregroundStyle(Palette.textPrimary), "active days")
            statItem(Text(CzFormat.hours(Double(stats.weeklyAvgMinutes))).foregroundStyle(Palette.textPrimary), "avg/week")
            if let busiest = stats.busiestDay {
                statItem(Text(CzFormat.dateCz(busiest)).foregroundStyle(Palette.textPrimary), "busiest")
            }
        }
        .font(.caption)
    }

    /// A bold colored value followed by a muted label — mirrors the web
    /// `StatStrip`'s `<strong>` + plain-text pattern.
    private func statItem(_ value: Text, _ label: String) -> some View {
        value.fontWeight(.semibold) + Text(" \(label)").foregroundStyle(Palette.textMuted)
    }

    private var toastPill: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(Color.green)
                .frame(width: 7, height: 7)
            Text("Dashboard updated")
                .font(.footnote.weight(.medium))
                .foregroundStyle(Palette.textPrimary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 9)
        .background(.ultraThinMaterial, in: Capsule())
    }
}

// MARK: - KPI tile

private struct KpiTile: View {
    let label: String
    let minutes: Double
    let earnedCzk: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.system(size: 11, weight: .semibold))
                .kerning(0.6)
                .foregroundStyle(Palette.textMuted)
            Text(CzFormat.hours(minutes))
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(Palette.textPrimary)
            Text(CzFormat.czk(earnedCzk))
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Palette.accent)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .glassCard(cornerRadius: 12)
    }
}

// MARK: - Contract burn card

private struct ContractCard: View {
    let burn: ContractBurn

    /// Render an MD limit the way React prints the raw `limit` number: whole
    /// numbers show without decimals ("20"), fractional values drop trailing
    /// zeros ("20.5"). Only the limit denominator uses this — mdsUsed/projected
    /// stay at 2dp to match the React `.toFixed(2)`.
    private func rawMd(_ value: Double) -> String {
        if value == value.rounded() {
            return String(Int(value))
        }
        var s = String(format: "%.2f", value)
        while s.hasSuffix("0") { s.removeLast() }
        if s.hasSuffix(".") { s.removeLast() }
        return s
    }

    private var isOverrun: Bool {
        guard let limit = burn.mdLimit, let projected = burn.projectedMds else { return false }
        return projected > limit
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                if let color = burn.projectColor {
                    Circle().fill(Color(hex: color)).frame(width: 10, height: 10)
                }
                Text(burn.projectName.isEmpty ? "(no name)" : burn.projectName)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Palette.textPrimary)
                    .lineLimit(1)
                Spacer()
                if let remaining = burn.workdaysRemaining {
                    Text("\(remaining) days left")
                        .font(.caption)
                        .foregroundStyle(Palette.textMuted)
                }
            }
            burnBar
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .glassCard(cornerRadius: 12)
    }

    @ViewBuilder
    private var burnBar: some View {
        if let limit = burn.mdLimit {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text("\(burn.mdsUsed, specifier: "%.2f") / \(rawMd(limit)) MD")
                        .font(.caption)
                        .foregroundStyle(Palette.textMuted)
                    Spacer()
                    if let projected = burn.projectedMds {
                        Text("est: \(projected, specifier: "%.2f") MD")
                            .font(.caption)
                            .foregroundStyle(isOverrun ? Palette.chartAmber : Palette.textMuted)
                    }
                }
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.white.opacity(0.08))
                        let usedFraction = min(1, burn.mdsUsed / limit)
                        Capsule()
                            .fill(Palette.chartViolet)
                            .frame(width: geo.size.width * usedFraction)
                        if let projected = burn.projectedMds {
                            let projFraction = min(1, projected / limit)
                            if isOverrun {
                                Capsule()
                                    .fill(Palette.chartAmber.opacity(0.7))
                                    .frame(width: geo.size.width * max(0, projFraction - usedFraction))
                                    .offset(x: geo.size.width * usedFraction)
                            } else {
                                Rectangle()
                                    .fill(Palette.chartCyan)
                                    .frame(width: 2)
                                    .offset(x: geo.size.width * projFraction - 1)
                            }
                        }
                    }
                }
                .frame(height: 8)
            }
        } else {
            Text("\(burn.mdsUsed, specifier: "%.2f") MD (no limit)")
                .font(.caption)
                .foregroundStyle(Palette.textMuted)
        }
    }
}

// MARK: - Top project row

private struct TopRow: View {
    let rank: Int
    let project: ProjectEarning
    let maxMinutes: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text("\(rank).")
                    .font(.caption2)
                    .foregroundStyle(Palette.textMuted)
                    .frame(width: 18, alignment: .trailing)
                if let color = project.color {
                    Circle().fill(Color(hex: color)).frame(width: 8, height: 8)
                }
                Text(project.name.isEmpty ? "(no name)" : project.name)
                    .font(.subheadline)
                    .foregroundStyle(Palette.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer()
                Text(CzFormat.hours(project.minutes))
                    .font(.caption)
                    .foregroundStyle(Palette.textMuted)
                if project.earnedCzk > 0 {
                    Text(CzFormat.czk(project.earnedCzk))
                        .font(.caption)
                        .foregroundStyle(Palette.accent)
                }
            }
            GeometryReader { geo in
                let fraction = project.minutes / maxMinutes
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.10))
                    Capsule()
                        .fill(project.color.map { Color(hex: $0) } ?? Palette.chartViolet)
                        .frame(width: geo.size.width * min(1, fraction))
                }
            }
            .frame(height: 4)
            .padding(.leading, 26)
        }
    }
}

// MARK: - Heatmap cell

private struct HeatCell: View {
    let day: HeatmapDay
    let maxMinutes: Double

    private var color: Color {
        guard day.minutes > 0, maxMinutes > 0 else { return Color.white.opacity(0.08) }
        let ratio = day.minutes / maxMinutes
        if ratio < 0.25 { return Palette.chartViolet.opacity(0.33) }
        if ratio < 0.5 { return Palette.chartViolet.opacity(0.55) }
        if ratio < 0.75 { return Palette.chartViolet.opacity(0.8) }
        return Palette.chartViolet
    }

    private var accessibilityText: String {
        let hours = day.minutes > 0 ? CzFormat.hours(day.minutes) : "–"
        return "\(CzFormat.dateCz(day.date)): \(hours)"
    }

    var body: some View {
        RoundedRectangle(cornerRadius: 3)
            .fill(color)
            .aspectRatio(1, contentMode: .fit)
            .accessibilityLabel(accessibilityText)
    }
}
