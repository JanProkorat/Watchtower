import SwiftUI
import ComposableArchitecture
import WatchtowerCore
import WatchtowerBridge

/// iPad port of `packages/module-timetracker/src/billing/EarningsMonthView.tsx`
/// (the ORIGINAL Capacitor design, not iphone-native). Same shared stores
/// (`BillingFeature`'s dataset/loadState + `EarningsFeature`'s month cursor)
/// and the same pure derivations (`aggregateMonthEarnings`, `trailingMonths`)
/// as before.
///
/// Design-align (Task 4): layout is now a single vertical scroll — month
/// picker, hero total, trend chart, project list, in that order — matching
/// the web original, replacing the earlier D2 master-detail split (a leading
/// list pane + a trailing "Select a project" pane). Tapping a project row
/// PUSHES `ProjectDetailView` via `.navigationDestination(item:)` — the same
/// pattern already proven by iphone-native's `EarningsView` — instead of
/// presenting it inline in a trailing pane.
struct EarningsView: View {
    let store: StoreOf<IPadAppFeature>

    var body: some View {
        EarningsRootView(
            billing: store.scope(state: \.billing, action: \.billing),
            earnings: store.scope(state: \.earnings, action: \.earnings)
        )
    }
}

/// Split into its own type so `earnings` can be `@Bindable` — required for
/// the `$earnings.scope(state:action:)` presentation binding below, which a
/// computed (non-stored) property can't carry.
private struct EarningsRootView: View {
    let billing: StoreOf<BillingFeature>
    @Bindable var earnings: StoreOf<EarningsFeature>

    private var selectedMonth: String { earnings.selectedMonth }

    private var dataset: BillingDataset {
        billing.dataset ?? BillingDataset(worklogs: [], contracts: [], daysOff: [], projects: [], tasks: [], epics: [], fetchedAt: "")
    }

    private var agg: (totalCzk: Double, perProject: [ProjectEarning]) {
        aggregateMonthEarnings(dataset.worklogs, selectedMonth)
    }

    private var trailing: [(month: String, earnedCzk: Double)] {
        trailingMonths(dataset.worklogs, selectedMonth, 8)
    }

    private var maxEarned: Double {
        max(agg.perProject.map(\.earnedCzk).max() ?? 1, 1)
    }

    private var isLoading: Bool {
        billing.loadState == .loading && billing.dataset == nil
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Palette.baseBg.ignoresSafeArea()

                VStack(spacing: 0) {
                    monthPicker

                    if isLoading {
                        Spacer()
                        VStack(spacing: 12) {
                            ProgressView().tint(Palette.accentIcon)
                            Text("Loading…").foregroundStyle(Palette.textMuted)
                        }
                        Spacer()
                    } else {
                        ScrollView {
                            VStack(alignment: .leading, spacing: 24) {
                                heroTotal
                                trendSection
                                projectsSection
                            }
                            .padding(.horizontal, 16)
                            .padding(.top, 16)
                            .padding(.bottom, 32)
                        }
                    }
                }
            }
            // The single vertical scroll of a `NavigationStack`'s root view;
            // tapping a project row pushes `ProjectDetailView` full-screen —
            // matching the web's in-place full-view swap / the iPhone's push
            // navigation — instead of presenting it in a trailing pane.
            .navigationDestination(item: $earnings.scope(state: \.projectDetail, action: \.projectDetail)) { detailStore in
                ProjectDetailView(store: detailStore, billing: billing)
            }
            // Root view has no title/back button of its own, so hide the
            // system nav bar entirely — otherwise an empty ~90pt bar renders
            // above the month picker. `ProjectDetailView` (the pushed
            // destination) sets its own `.toolbar(.hidden, for: .navigationBar)`
            // and draws a custom back bar instead, so this only affects the
            // root screen, matching the web original's chromeless top.
            .toolbar(.hidden, for: .navigationBar)
        }
    }

    // MARK: - Month picker

    private var monthPicker: some View {
        HStack(spacing: 12) {
            Button {
                earnings.send(.monthStepped(-1))
            } label: {
                Text("‹")
                    .font(.system(size: 20))
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Palette.textPrimary)
            .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
            .accessibilityLabel("Previous month")

            Text(CzFormat.czechMonthLabel(selectedMonth))
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Palette.textPrimary)
                .frame(minWidth: 160)
                .multilineTextAlignment(.center)

            Button {
                earnings.send(.monthStepped(1))
            } label: {
                Text("›")
                    .font(.system(size: 20))
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Palette.textPrimary)
            .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
            .accessibilityLabel("Next month")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity)
        .glassCard(cornerRadius: 16)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    // MARK: - Hero total

    private var heroTotal: some View {
        VStack(spacing: 4) {
            Text("Total earnings".uppercased())
                .font(.caption.weight(.bold))
                .foregroundStyle(Palette.textMuted)
                .tracking(0.8)
            Text(CzFormat.czk(agg.totalCzk))
                .font(.system(size: 40, weight: .bold, design: .monospaced))
                .foregroundStyle(Palette.chartViolet)
        }
        .frame(maxWidth: .infinity)
        .padding(16)
        .glassCard()
    }

    // MARK: - Trend

    private var trendSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeaderLabel("Trend (8 months)")
            TrailingBars(months: trailing, selectedMonth: selectedMonth)
                .padding(16)
                .glassCard(cornerRadius: 12)
        }
    }

    // MARK: - Projects

    private var projectsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeaderLabel("Projects")
            if agg.perProject.isEmpty {
                Text("No earnings this month")
                    .font(.subheadline)
                    .foregroundStyle(Palette.textMuted)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 12)
                    .glassCard(cornerRadius: 12)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(agg.perProject.enumerated()), id: \.element.projectId) { index, project in
                        EarningsProjectRow(
                            project: project,
                            barFraction: project.earnedCzk / maxEarned,
                            onTap: { earnings.send(.openProjectTapped(project.projectId)) }
                        )
                        if index < agg.perProject.count - 1 {
                            Divider().overlay(Palette.hairline)
                        }
                    }
                }
                .padding(.horizontal, 4)
                .glassCard(cornerRadius: 12)
            }
        }
    }
}

// MARK: - Trailing months bar chart

private struct TrailingBars: View {
    let months: [(month: String, earnedCzk: Double)]
    let selectedMonth: String

    private var maxCzk: Double {
        max(months.map(\.earnedCzk).max() ?? 1, 1)
    }

    private static let monthShortNames = [
        "led", "úno", "bře", "dub", "kvě", "čer", "čvc", "srp", "zář", "říj", "lis", "pro",
    ]

    private func caption(for month: String) -> String {
        let parts = month.split(separator: "-")
        guard parts.count == 2, let m = Int(parts[1]), m >= 1, m <= 12 else { return "" }
        return Self.monthShortNames[m - 1]
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: 6) {
            ForEach(months, id: \.month) { entry in
                let isSelected = entry.month == selectedMonth
                let pct = max(entry.earnedCzk / maxCzk, 0.03) * 100

                VStack(spacing: 4) {
                    GeometryReader { geo in
                        VStack {
                            Spacer(minLength: 0)
                            RoundedRectangle(cornerRadius: 3)
                                .fill(isSelected ? Palette.chartViolet : Palette.chartViolet.opacity(0.53))
                                .frame(height: geo.size.height * CGFloat(pct) / 100)
                        }
                    }
                    Text(caption(for: entry.month))
                        .font(.system(size: 9, weight: isSelected ? .bold : .regular))
                        .foregroundStyle(isSelected ? Palette.chartViolet : Palette.textMuted)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(CzFormat.czechMonthLabel(entry.month)): \(CzFormat.czk(entry.earnedCzk))")
            }
        }
        .frame(height: 100)
    }
}

// MARK: - Per-project row

private struct EarningsProjectRow: View {
    let project: ProjectEarning
    let barFraction: Double
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Circle()
                        .fill(Color(hex: project.color ?? "#38bdf8"))
                        .frame(width: 10, height: 10)
                    Text(project.name.isEmpty ? "(no name)" : project.name)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Palette.textPrimary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Spacer()
                    Text(CzFormat.hours(project.minutes))
                        .font(.caption)
                        .foregroundStyle(Palette.textMuted)
                    Text(CzFormat.czk(project.earnedCzk))
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Palette.chartViolet)
                        .frame(minWidth: 80, alignment: .trailing)
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundStyle(Palette.textMuted)
                }
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.white.opacity(0.10))
                        Capsule()
                            .fill(Color(hex: project.color ?? "#38bdf8"))
                            .frame(width: geo.size.width * min(1, max(0, CGFloat(barFraction))))
                    }
                }
                .frame(height: 3)
                .padding(.leading, 18)
            }
            .padding(.vertical, 12)
            .padding(.horizontal, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
