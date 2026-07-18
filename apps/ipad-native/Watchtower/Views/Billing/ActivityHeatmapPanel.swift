import SwiftUI
import WatchtowerCore

/// iPad port of the iPhone `ActivityHeatmapPanel` (in turn ported from
/// `packages/module-timetracker/src/billing/reports/ActivityHeatmapPanel.tsx`).
/// Value-only, no store — tapping a cell reveals its date/hours in a label
/// above the grid, same as the iPhone panel (no native tooltip). The
/// enclosing `ReportsView` supplies the outer `contentCard()`, so this view
/// renders its content only (no `GlassCard` wrapper).
struct ActivityHeatmapPanel: View {
    let heatmap: HeatmapResult

    @State private var selectedDay: HeatmapDay?

    private var maxMinutes: Double {
        max(heatmap.days.map(\.minutes).max() ?? 1, 1)
    }

    private var selectedLabel: String {
        guard let day = selectedDay else { return " " }
        let hours = day.minutes > 0 ? CzFormat.hours(day.minutes) : "–"
        return "\(CzFormat.dateCz(day.date)): \(hours)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(selectedLabel)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Palette.textPrimary)
                .opacity(selectedDay == nil ? 0 : 1)
                .frame(minHeight: 14, alignment: .leading)

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 13, maximum: 13), spacing: 3)], alignment: .leading, spacing: 3) {
                ForEach(heatmap.days, id: \.date) { day in
                    HeatCellButton(
                        day: day,
                        maxMinutes: maxMinutes,
                        isSelected: selectedDay?.date == day.date
                    ) {
                        selectedDay = (selectedDay?.date == day.date) ? nil : day
                    }
                }
            }

            statStrip
        }
    }

    private var statStrip: some View {
        let stats = heatmap.stats
        return VStack(alignment: .leading, spacing: 4) {
            Text("\(stats.currentStreak) day streak")
            Text("longest: \(stats.longestStreak)")
            Text("active days: \(stats.activeDays)")
            Text("weekly avg: \(CzFormat.hours(Double(stats.weeklyAvgMinutes)))")
        }
        .font(.caption)
        .foregroundStyle(Palette.textMuted)
    }
}

// MARK: - Heatmap cell (tappable)

private struct HeatCellButton: View {
    let day: HeatmapDay
    let maxMinutes: Double
    let isSelected: Bool
    let onTap: () -> Void

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
        Button(action: onTap) {
            RoundedRectangle(cornerRadius: 3)
                .fill(color)
                .frame(width: 13, height: 13)
                .overlay(
                    RoundedRectangle(cornerRadius: 3)
                        .stroke(Palette.textPrimary.opacity(isSelected ? 0.9 : 0), lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityText)
    }
}
