import SwiftUI
import Charts
import WatchtowerCore

/// Native port of `packages/module-timetracker/src/billing/reports/ProjectDonut.tsx`.
/// Donut breakdown of minutes-per-project (Swift Charts `SectorMark`) with a
/// legend that doubles as a tappable, proportional-bar breakdown.
struct ProjectDonutPanel: View {
    let slices: [ProjectBreakdownSlice]
    let onOpenProject: (Int) -> Void

    private static let fallback: [Color] = [
        Palette.chartViolet, Palette.chartCyan, Palette.chartAmber,
        Color(hex: "#f87171"), Color(hex: "#34d399"), Color(hex: "#f472b6"),
        Color(hex: "#60a5fa"), Color(hex: "#a3e635"),
    ]

    private var totalMinutes: Double {
        slices.reduce(0) { $0 + $1.minutes }
    }

    private func color(for slice: ProjectBreakdownSlice, at index: Int) -> Color {
        slice.color.flatMap { Color(hex: $0) } ?? Self.fallback[index % Self.fallback.count]
    }

    var body: some View {
        GlassCard {
            if slices.isEmpty {
                Text("no data")
                    .font(.system(size: 13))
                    .foregroundStyle(Palette.textMuted)
                    .padding(.vertical, 8)
            } else {
                VStack(alignment: .leading, spacing: 20) {
                    donut
                        .frame(width: 150, height: 150)
                        .frame(maxWidth: .infinity)

                    legend
                }
            }
        }
    }

    // MARK: - Donut

    private var donut: some View {
        Chart(Array(slices.enumerated()), id: \.element.projectId) { i, slice in
            SectorMark(
                angle: .value("minutes", slice.minutes),
                innerRadius: .ratio(0.62),
                angularInset: 1
            )
            .foregroundStyle(color(for: slice, at: i))
            .cornerRadius(2)
        }
        .chartLegend(.hidden)
        .chartBackground { _ in
            VStack(spacing: 2) {
                Text(CzFormat.hours(totalMinutes))
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Palette.textPrimary)
                Text("total")
                    .font(.system(size: 10))
                    .foregroundStyle(Palette.textMuted)
                    .textCase(.uppercase)
                    .tracking(0.5)
            }
        }
    }

    // MARK: - Legend

    private var legend: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(Array(slices.enumerated()), id: \.element.projectId) { i, slice in
                legendRow(slice, color: color(for: slice, at: i))
            }
        }
    }

    private func legendRow(_ slice: ProjectBreakdownSlice, color: Color) -> some View {
        Button {
            onOpenProject(slice.projectId)
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(color)
                        .frame(width: 10, height: 10)

                    Text(slice.name.isEmpty ? "(no name)" : slice.name)
                        .font(.system(size: 13))
                        .foregroundStyle(Palette.textPrimary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    Text(CzFormat.hours(slice.minutes))
                        .font(.system(size: 12.5))
                        .foregroundStyle(Palette.textMuted)
                        .monospacedDigit()

                    Text("\(Int((slice.share * 100).rounded())) %")
                        .font(.system(size: 12.5, weight: .semibold))
                        .foregroundStyle(Palette.textPrimary)
                        .monospacedDigit()
                        .frame(width: 46, alignment: .trailing)
                }

                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 999)
                            .fill(Color.white.opacity(0.06))

                        RoundedRectangle(cornerRadius: 999)
                            .fill(color)
                            .frame(width: geo.size.width * max(0.02, slice.share))
                    }
                }
                .frame(height: 6)
            }
        }
        .buttonStyle(.plain)
    }
}
