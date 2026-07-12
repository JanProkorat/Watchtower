import SwiftUI
import Charts
import WatchtowerCore

/// Native port of `packages/module-timetracker/src/billing/reports/TrendChart.tsx`.
/// Zero-filled bar chart of minutes-per-bucket with tappable detail and
/// dashed rate-change markers.
struct TrendChartPanel: View {
    let series: [TrendBucket]
    let markers: [RateMarker]
    let from: String
    let to: String
    let granularity: Granularity

    @State private var selectedBucket: String?

    private var filled: [TrendBucket] {
        let byBucket = Dictionary(series.map { ($0.bucket, $0) }, uniquingKeysWith: { first, _ in first })
        return enumerateBuckets(from, to, granularity).map { key in
            byBucket[key] ?? TrendBucket(bucket: key, minutes: 0, earnedCzk: 0)
        }
    }

    private var markerBuckets: Set<String> {
        Set(markers.map { bucketKey($0.effectiveFrom, granularity) })
    }

    private var shown: TrendBucket? {
        guard let selectedBucket else { return nil }
        return filled.first { $0.bucket == selectedBucket }
    }

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 8) {
                detailLine

                if filled.isEmpty {
                    Text("no data")
                        .font(.system(size: 13))
                        .foregroundStyle(Palette.textMuted)
                        .padding(.vertical, 8)
                } else {
                    chart
                        .frame(height: 140)

                    HStack {
                        Text(bucketLabel(filled.first?.bucket ?? "", granularity))
                        Spacer()
                        Text(bucketLabel(filled.last?.bucket ?? "", granularity))
                    }
                    .font(.system(size: 10))
                    .foregroundStyle(Palette.textMuted)
                }
            }
        }
    }

    // MARK: - Detail line

    private var detailLine: some View {
        Group {
            if let shown {
                Text("\(bucketLabel(shown.bucket, granularity)): \(CzFormat.hours(shown.minutes)) \u{00B7} \(CzFormat.czk(shown.earnedCzk))")
            } else {
                Text("Tap a bar for detail")
            }
        }
        .font(.system(size: 12))
        .foregroundStyle(Palette.textMuted)
        .frame(height: 18)
    }

    // MARK: - Chart

    private var chart: some View {
        Chart {
            ForEach(filled, id: \.bucket) { bucket in
                BarMark(
                    x: .value("bucket", bucket.bucket),
                    y: .value("minutes", bucket.minutes)
                )
                .foregroundStyle(
                    bucket.bucket == selectedBucket
                        ? Palette.accent
                        : Palette.accent.opacity(0.55)
                )
                .cornerRadius(3)
            }

            ForEach(Array(markerBuckets), id: \.self) { key in
                RuleMark(x: .value("bucket", key))
                    .foregroundStyle(Palette.chartCyan)
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))
            }
        }
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
        .chartOverlay { proxy in
            GeometryReader { geo in
                Rectangle()
                    .fill(Color.clear)
                    .contentShape(Rectangle())
                    .simultaneousGesture(
                        DragGesture(minimumDistance: 0)
                            .onChanged { value in selectBucket(at: value.location, proxy: proxy, geo: geo) }
                    )
            }
        }
    }

    private func selectBucket(at location: CGPoint, proxy: ChartProxy, geo: GeometryProxy) {
        let origin = geo[proxy.plotAreaFrame].origin
        let x = location.x - origin.x
        guard let bucket: String = proxy.value(atX: x) else { return }
        if filled.contains(where: { $0.bucket == bucket }) {
            selectedBucket = bucket
        }
    }
}

/// `2026-06` → `2026/06`, `2026-W23` → `23`, `2026-06-07` → `07`.
private func bucketLabel(_ bucket: String, _ granularity: Granularity) -> String {
    switch granularity {
    case .month:
        return bucket.replacingOccurrences(of: "-", with: "/")
    case .week:
        guard let range = bucket.range(of: "-W") else { return bucket }
        return String(bucket[range.upperBound...])
    case .day:
        return String(bucket.suffix(2))
    }
}
