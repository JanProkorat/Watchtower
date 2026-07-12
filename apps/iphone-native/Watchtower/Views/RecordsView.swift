import SwiftUI
import ComposableArchitecture
import WatchtowerCore

/// Top-level shell for the Records tab: a segmented control over
/// `RecordsFeature.Section` (List / Grid / Tasks / Time off) switching
/// between the four read-only sub-views. Each sub-view owns its own
/// loading gate and reads the shared `BillingFeature` dataset plus its
/// slice of `RecordsFeature` filter state.
struct RecordsView: View {
    let billing: StoreOf<BillingFeature>
    let records: StoreOf<RecordsFeature>

    private static let sections: [(RecordsFeature.Section, String)] = [
        (.list, "List"), (.grid, "Grid"), (.tasks, "Tasks"), (.timeOff, "Time off"),
    ]

    var body: some View {
        ZStack {
            Palette.baseBg.ignoresSafeArea()

            VStack(spacing: 0) {
                segmentedControl
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                    .padding(.bottom, 8)

                content
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch records.section {
        case .list:
            WorklogListView(billing: billing, records: records)
        case .grid:
            TaskGridView(billing: billing, records: records)
        case .tasks:
            TaskListView(billing: billing, records: records)
        case .timeOff:
            TimeOffView(billing: billing, records: records)
        }
    }

    // MARK: - Segmented control

    private var segmentedControl: some View {
        HStack(spacing: 3) {
            ForEach(Array(Self.sections.enumerated()), id: \.offset) { _, option in
                let (value, label) = option
                let active = value == records.section

                Button {
                    records.send(.sectionChanged(value))
                } label: {
                    Text(label)
                        .font(.system(size: 12.5, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 7)
                        .padding(.horizontal, 4)
                }
                .buttonStyle(.plain)
                .foregroundStyle(active ? Palette.accent : Palette.textMuted)
                .background(
                    active ? Palette.accent.opacity(0.16) : Color.clear,
                    in: RoundedRectangle(cornerRadius: 8)
                )
            }
        }
        .padding(3)
        .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 11))
        .overlay(
            RoundedRectangle(cornerRadius: 11)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        )
    }
}
