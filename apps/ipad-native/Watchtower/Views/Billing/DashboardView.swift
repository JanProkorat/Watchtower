import SwiftUI
import ComposableArchitecture
import WatchtowerCore
import WatchtowerBridge

/// iPad port of the iPhone `DashboardView` (in turn ported from
/// `packages/module-timetracker/src/billing/DashboardView.tsx`). Read-only —
/// reads the shared `BillingFeature` dataset and reuses the exact same
/// pure-function projections the iPhone view calls (`dashboardKpis`,
/// `contractBurn`, `topProjects`, `activityHeatmap`), including the
/// `contractGroupId` dedupe for pooled contracts.
///
/// The only thing that changes for iPad is the LAYOUT: instead of the
/// iPhone's single stacked column, the four sections (Worked, Active
/// contracts, Top projects, Activity) sit as peer tiles in a responsive
/// `LazyVGrid`, each wrapped in the iPad design system's `contentCard()`
/// (solid content-layer surface) rather than the iPhone's
/// `.ultraThinMaterial` `GlassCard`.
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

    private let tileColumns = [GridItem(.adaptive(minimum: 360, maximum: 560), spacing: 16)]

    var body: some View {
        ZStack {
            if isLoading {
                VStack(spacing: 12) {
                    ProgressView().tint(Palette.accentIcon)
                    Text("Loading…").foregroundStyle(Palette.textMuted)
                }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        statusBanner
                        LazyVGrid(columns: tileColumns, alignment: .leading, spacing: 16) {
                            workedTile
                            if !burns.isEmpty {
                                contractsTile
                            }
                            topProjectsTile
                            activityTile
                        }
                    }
                    .padding(24)
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

    @ViewBuilder
    private var statusBanner: some View {
        switch billing.loadState {
        case .offline:
            bannerRow(
                icon: "wifi.slash",
                text: "Offline — dashboard data unavailable",
                tint: Palette.chartAmber,
                showRetry: true
            )
        case .cached:
            bannerRow(
                icon: "clock.arrow.circlepath",
                text: "Showing cached data — pull to refresh",
                tint: Palette.textMuted,
                showRetry: false
            )
        case .loading, .fresh:
            EmptyView()
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
        .contentCard(cornerRadius: 12)
    }

    // MARK: - Worked

    private var workedTile: some View {
        VStack(alignment: .leading, spacing: 12) {
            TileHeader(title: "Worked")
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 100), spacing: 10)], spacing: 10) {
                KpiMini(label: "Today", minutes: kpis.today.minutes, earnedCzk: kpis.today.earnedCzk)
                KpiMini(label: "Sprint", minutes: kpis.sprint.minutes, earnedCzk: kpis.sprint.earnedCzk)
                KpiMini(label: "This month", minutes: kpis.month.minutes, earnedCzk: kpis.month.earnedCzk)
            }
        }
        .padding(16)
        .contentCard()
    }

    // MARK: - Active contracts

    private var contractsTile: some View {
        VStack(alignment: .leading, spacing: 12) {
            TileHeader(title: "Active contracts")
            VStack(spacing: 10) {
                ForEach(burns, id: \.projectId) { burn in
                    BurnRow(burn: burn)
                }
            }
        }
        .padding(16)
        .contentCard()
    }

    // MARK: - Top projects

    private var topProjectsTile: some View {
        VStack(alignment: .leading, spacing: 12) {
            TileHeader(title: "Top projects — \(month.replacingOccurrences(of: "-", with: "/"))")
            if !monthHasData {
                Text("no data for this month")
                    .font(.subheadline)
                    .foregroundStyle(Palette.textMuted)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 12)
            } else if top.isEmpty {
                Text("no data")
                    .font(.subheadline)
                    .foregroundStyle(Palette.textMuted)
            } else {
                VStack(spacing: 12) {
                    ForEach(Array(top.enumerated()), id: \.element.projectId) { index, project in
                        TopRow(rank: index + 1, project: project, maxMinutes: topMaxMinutes)
                    }
                }
            }
        }
        .padding(16)
        .contentCard()
    }

    // MARK: - Activity

    private var activityTile: some View {
        VStack(alignment: .leading, spacing: 12) {
            TileHeader(title: "Activity (30 days)")
            let maxMinutes = max(heatmap.days.map(\.minutes).max() ?? 1, 1)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 3), count: 7), spacing: 3) {
                ForEach(heatmap.days, id: \.date) { day in
                    HeatCell(day: day, maxMinutes: maxMinutes)
                }
            }
            .frame(maxWidth: 280)

            statStrip
        }
        .padding(16)
        .contentCard()
    }

    private var statStrip: some View {
        // `.accessibilityLabel` lives on each HeatCell; the strip below
        // mirrors the React `StatStrip` text summary.
        let stats = heatmap.stats
        return VStack(alignment: .leading, spacing: 4) {
            Text("\(stats.currentStreak) day streak")
            Text("longest: \(stats.longestStreak)")
            Text("active days: \(stats.activeDays)")
            Text("weekly avg: \(CzFormat.hours(Double(stats.weeklyAvgMinutes)))")
            if let busiest = stats.busiestDay {
                Text("busiest: \(CzFormat.dateCz(busiest))")
            }
        }
        .font(.caption)
        .foregroundStyle(Palette.textMuted)
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

// MARK: - Tile header

private struct TileHeader: View {
    let title: String

    var body: some View {
        Text(title.uppercased())
            .font(.caption.weight(.bold))
            .foregroundStyle(Palette.textMuted)
            .tracking(0.8)
    }
}

// MARK: - KPI mini card

private struct KpiMini: View {
    let label: String
    let minutes: Double
    let earnedCzk: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.caption2.weight(.semibold))
                .foregroundStyle(Palette.textMuted)
                .tracking(0.6)
            Text(CzFormat.hours(minutes))
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(Palette.textPrimary)
            Text(CzFormat.czk(earnedCzk))
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Palette.accent)
        }
        .frame(minWidth: 100, maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
    }
}

// MARK: - Contract burn row

private struct BurnRow: View {
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
                    Text("\(remaining) wd left")
                        .font(.caption)
                        .foregroundStyle(Palette.textMuted)
                }
            }
            burnBar
        }
        .padding(12)
        .background(Color.white.opacity(0.03), in: RoundedRectangle(cornerRadius: 10))
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
                Circle()
                    .fill(Color(hex: project.color ?? "#38bdf8"))
                    .frame(width: 8, height: 8)
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
                        .fill(Color(hex: project.color ?? "#38bdf8"))
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
