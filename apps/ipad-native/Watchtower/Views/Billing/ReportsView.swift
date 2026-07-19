import SwiftUI
import ComposableArchitecture
import WatchtowerCore
import WatchtowerBridge

/// iPad port of the iPhone `ReportsView` (in turn ported from
/// `packages/module-timetracker/src/billing/ReportsView.tsx` — the ORIGINAL
/// Capacitor design, not iphone-native). Same shared stores (`BillingFeature`'s
/// dataset/loadState + `ReportsFeature`'s filter selection) and the same pure
/// derivations (`trendSeries`, `rateChangeMarkers`, `earningsSummary`,
/// `projectBreakdown`, `activityHeatmapRange`) as before.
///
/// Design-align (Task 5): layout is now a single vertical stack of
/// `glassCard`-wrapped panels — filter bar, then Trend / Earnings / By
/// projects / Activity, in that order, each under a `SectionHeaderLabel` —
/// matching the web original, replacing the earlier 2×2 `LazyVGrid` of
/// `contentCard()` tiles.
///
/// Project-tap behavior: the iPhone view pushes `ProjectDetailView` onto its
/// own `NavigationStack` via `.navigationDestination(item:)`. Reports has no
/// master-detail split of its own (unlike `EarningsView`), so the iPad port
/// presents Task 4's `ProjectDetailView` as a `.sheet` bound to
/// `reports.projectDetail` — simpler than introducing a second split view
/// just for this one drill-down path.
struct ReportsView: View {
    let store: StoreOf<IPadAppFeature>

    var body: some View {
        ReportsStackView(
            billing: store.scope(state: \.billing, action: \.billing),
            reports: store.scope(state: \.reports, action: \.reports)
        )
    }
}

/// Split into its own type so `reports` can be `@Bindable` — required for
/// the `$reports.scope(state:action:)` sheet-presentation binding below,
/// which a computed (non-stored) property can't carry.
private struct ReportsStackView: View {
    let billing: StoreOf<BillingFeature>
    @Bindable var reports: StoreOf<ReportsFeature>

    private var dataset: BillingDataset {
        billing.dataset ?? BillingDataset(worklogs: [], contracts: [], daysOff: [], projects: [], tasks: [], epics: [], fetchedAt: "")
    }

    private var isLoading: Bool {
        billing.loadState == .loading && billing.dataset == nil
    }

    private var range: (from: String, to: String) { reports.range }
    private var granularity: Granularity { reports.granularity }
    private var projectId: Int? { reports.projectId }

    private var trend: [TrendBucket] {
        trendSeries(dataset.worklogs, from: range.from, to: range.to, granularity: granularity, projectId: projectId)
    }

    private var markers: [RateMarker] {
        rateChangeMarkers(dataset.contracts, from: range.from, to: range.to, projectId: projectId)
    }

    private var earnings: EarningsSummaryResult {
        earningsSummary(dataset.worklogs, from: range.from, to: range.to, projectId: projectId)
    }

    private var breakdown: [ProjectBreakdownSlice] {
        projectBreakdown(dataset.worklogs, from: range.from, to: range.to)
    }

    private var heat: HeatmapResult {
        activityHeatmapRange(dataset.worklogs, from: range.from, to: range.to)
    }

    var body: some View {
        ZStack {
            Palette.baseBg.ignoresSafeArea()

            if isLoading {
                VStack(spacing: 12) {
                    ProgressView().tint(Palette.accentIcon)
                    Text("Loading…").foregroundStyle(Palette.textMuted)
                }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        ReportsFilterBar(store: reports, projects: dataset.projects)

                        section("Trend") {
                            TrendChartPanel(series: trend, markers: markers, from: range.from, to: range.to, granularity: granularity)
                        }

                        section("Earnings") {
                            EarningsSummaryPanel(summary: earnings, onOpenProject: { reports.send(.openProjectTapped($0)) })
                        }

                        section("By projects") {
                            ProjectDonutPanel(slices: breakdown, onOpenProject: { reports.send(.openProjectTapped($0)) })
                        }

                        section("Activity") {
                            ActivityHeatmapPanel(heatmap: heat)
                        }
                    }
                    .padding(24)
                }
            }
        }
        .sheet(item: $reports.scope(state: \.projectDetail, action: \.projectDetail)) { detailStore in
            NavigationStack {
                ProjectDetailView(store: detailStore, billing: billing)
                    .navigationTitle("Project")
                    .navigationBarTitleDisplayMode(.inline)
            }
        }
    }

    /// One vertically-stacked report panel: an uppercase `SectionHeaderLabel`
    /// above a `glassCard`-framed content panel — mirroring the web
    /// original's `Section` wrapper and `EarningsView`'s section pattern.
    @ViewBuilder
    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeaderLabel(title)
            content()
                .padding(16)
                .glassCard()
        }
    }
}
