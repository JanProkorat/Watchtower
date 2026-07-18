import SwiftUI
import WatchtowerCore

/// iPad port of the iPhone `EarningsSummaryPanel` (in turn ported from
/// `packages/module-timetracker/src/billing/reports/EarningsSummaryPanel.tsx`).
/// Value-only, no store — same 2×2 stat tiles + per-project earnings
/// breakdown as the iPhone panel. The enclosing `ReportsView` supplies the
/// outer `contentCard()` for the whole panel, so the per-project list here
/// is a plain `VStack` (not a nested `GlassCard`/`contentCard`) and the stat
/// tiles use the iPad design system's flat fill (matching `DashboardView`'s
/// `KpiMini`) instead of the iPhone's `.ultraThinMaterial`.
struct EarningsSummaryPanel: View {
    let summary: EarningsSummaryResult
    let onOpenProject: (Int) -> Void

    private var maxEarned: Double {
        max(summary.perProject.map(\.earnedCzk).max() ?? 1, 1)
    }

    private var avgRateText: String {
        guard let rate = summary.avgEffectiveHourlyRateCzk else { return "–" }
        return "\(CzFormat.czk(rate))/h"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                StatTile(label: "Total earned", value: CzFormat.czk(summary.totalCzk), accent: true)
                StatTile(label: "Billable", value: CzFormat.hours(summary.billableMinutes))
                StatTile(label: "Unbillable", value: CzFormat.hours(summary.unbillableMinutes))
                StatTile(label: "Avg rate", value: avgRateText)
            }

            if !summary.perProject.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(summary.perProject.enumerated()), id: \.element.projectId) { index, project in
                        Button {
                            onOpenProject(project.projectId)
                        } label: {
                            ProjectEarningRow(project: project, maxEarned: maxEarned)
                        }
                        .buttonStyle(.plain)
                        if index < summary.perProject.count - 1 {
                            Divider().overlay(Palette.hairline)
                                .padding(.vertical, 8)
                        }
                    }
                }
            }
        }
    }
}

// MARK: - Stat tile

private struct StatTile: View {
    let label: String
    let value: String
    var accent: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.caption2.weight(.semibold))
                .foregroundStyle(Palette.textMuted)
                .tracking(0.5)
            Text(value)
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(accent ? Palette.accent : Palette.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(EdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12))
        .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
    }
}

// MARK: - Per-project row

private func projectDotColor(_ project: ProjectEarning) -> Color {
    project.color.map { Color(hex: $0) } ?? Palette.chartViolet
}

private struct ProjectEarningRow: View {
    let project: ProjectEarning
    let maxEarned: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Circle()
                    .fill(projectDotColor(project))
                    .frame(width: 8, height: 8)
                Text(project.name.isEmpty ? "(no name)" : project.name)
                    .font(.subheadline)
                    .foregroundStyle(Palette.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer()
                Text(CzFormat.czk(project.earnedCzk))
                    .font(.caption)
                    .foregroundStyle(Palette.accent)
            }
            GeometryReader { geo in
                let fraction = min(1, max(0, project.earnedCzk / maxEarned))
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.10))
                    Capsule()
                        .fill(projectDotColor(project))
                        .frame(width: geo.size.width * fraction)
                }
            }
            .frame(height: 4)
        }
    }
}
