import SwiftUI
import ComposableArchitecture
import WatchtowerCore
import WatchtowerBridge

/// iPad port of the iPhone `RecordsView` — same segmented switcher over
/// `RecordsFeature.Section` (List / Grid / Tasks / Time off / Board) and the
/// same two presented-form sheets (`worklogForm` / `taskForm`), but the
/// section content uses the iPad design system (`contentCard()`, not
/// `GlassCard`/`.ultraThinMaterial`).
///
/// This pass (Phase 5 Task 6) wires List/Grid/Tasks fully; Time off and
/// Board render a temporary placeholder until Task 7 replaces them with the
/// real views — no reducer change needed, `records.section` already covers
/// all five cases.
struct RecordsView: View {
    let store: StoreOf<IPadAppFeature>

    var body: some View {
        RecordsSwitcherView(
            billing: store.scope(state: \.billing, action: \.billing),
            records: store.scope(state: \.records, action: \.records)
        )
    }
}

/// Split into its own type so `records` can be `@Bindable` — required for the
/// `$records.scope(state:action:)` sheet-presentation bindings below, which a
/// computed (non-stored) property can't carry.
private struct RecordsSwitcherView: View {
    let billing: StoreOf<BillingFeature>
    @Bindable var records: StoreOf<RecordsFeature>

    private static let sections: [(RecordsFeature.Section, String)] = [
        (.list, "List"), (.grid, "Grid"), (.tasks, "Tasks"), (.timeOff, "Time off"), (.board, "Board"),
    ]

    var body: some View {
        ZStack {
            Palette.baseBg.ignoresSafeArea()

            VStack(spacing: 0) {
                segmentedControl
                    .padding(.horizontal, 16)
                    .padding(.top, 16)
                    .padding(.bottom, 8)

                content
            }
        }
        .sheet(item: $records.scope(state: \.worklogForm, action: \.worklogForm)) { formStore in
            WorklogFormView(store: formStore)
        }
        .sheet(item: $records.scope(state: \.taskForm, action: \.taskForm)) { formStore in
            TaskFormView(store: formStore)
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
            placeholder("Time off — Task 7")
        case .board:
            placeholder("Board — Task 7")
        }
    }

    private func placeholder(_ text: String) -> some View {
        VStack {
            Spacer()
            Text(text)
                .font(.subheadline)
                .foregroundStyle(Palette.textMuted)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
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
                        .font(.system(size: 13, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
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
        .contentCard(cornerRadius: 11)
    }
}
