import SwiftUI
import ComposableArchitecture
import WatchtowerCore

/// Native port of `packages/module-timetracker/src/billing/reports/ReportsView.tsx`.
/// Composes the filter bar + four report panels (trend / earnings / project
/// breakdown / activity heatmap) from the shared `BillingFeature` dataset and
/// the `ReportsFeature` filter selection.
struct ReportsView: View {
    let billing: StoreOf<BillingFeature>
    @Bindable var reports: StoreOf<ReportsFeature>
    /// The parent `AppFeature` store + the shell's sheet-presentation flag,
    /// threaded through so the shared attention bell/badge toolbar (Task 12
    /// fix) can attach to THIS view's own inner `NavigationStack` rather than
    /// nesting a second stack around it — see `AttentionToolbarModifier`.
    let appStore: StoreOf<AppFeature>
    @Binding var showAttention: Bool

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
        NavigationStack {
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

                            section(title: "Trend") {
                                TrendChartPanel(series: trend, markers: markers, from: range.from, to: range.to, granularity: granularity)
                            }

                            section(title: "Earnings") {
                                EarningsSummaryPanel(summary: earnings, onOpenProject: { reports.send(.openProjectTapped($0)) })
                            }

                            section(title: "By projects") {
                                ProjectDonutPanel(slices: breakdown, onOpenProject: { reports.send(.openProjectTapped($0)) })
                            }

                            section(title: "Activity") {
                                ActivityHeatmapPanel(heatmap: heat)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.bottom, 32)
                        .padding(.top, 16)
                    }
                }
            }
            .navigationDestination(item: $reports.scope(state: \.projectDetail, action: \.projectDetail)) { detailStore in
                ProjectDetailView(store: detailStore, billing: billing)
            }
            .attentionToolbar(store: appStore, showAttention: $showAttention)
        }
    }

    @ViewBuilder
    private func section<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: title)
            content()
        }
    }
}
