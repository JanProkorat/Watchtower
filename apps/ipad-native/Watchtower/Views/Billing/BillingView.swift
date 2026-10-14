import SwiftUI
import ComposableArchitecture
import WatchtowerCore
import WatchtowerBridge

/// Container for the Billing module. Design-align T2 drops the old in-view
/// segmented switcher (Earnings | Reports | Records, with a further
/// sub-switcher inside Records) in favor of the sidebar's flat Billing
/// sub-group (`RailView`'s expandable group, `IPadAppFeature.BillingSection`)
/// — this view is now a pure router over `store.billingSection`, reusing the
/// existing Phase-5 sub-views as-is (their internal layouts get realigned in
/// design-align Tasks 3-7; this task only rewires navigation).
///
/// Unlike the iPhone's `AppFeature`, billing is NOT auth-gated here — the
/// sub-screens always render (cached/empty data); `BillingAuthBar` is purely
/// additive chrome offering a way to sign in for sync.
struct BillingView: View {
    let store: StoreOf<IPadAppFeature>

    var body: some View {
        VStack(spacing: 0) {
            if !store.authPresent {
                BillingAuthBar(store: store.scope(state: \.auth, action: \.auth))
            }
            BillingRouterView(
                store: store,
                billing: store.scope(state: \.billing, action: \.billing),
                records: store.scope(state: \.records, action: \.records)
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

/// Split into its own type so `records` can be `@Bindable` — required for
/// the `$records.scope(state:action:)` sheet-presentation bindings for the
/// worklog/task editor forms, which a computed (non-stored) property can't
/// carry. Mirrors the split the old (now-deleted) `RecordsView.swift`'s
/// `RecordsSwitcherView` used for the same reason.
///
/// Hosting the two sheets here — once, at the router level, covering every
/// case — matters: the first cut of this router dropped `RecordsView` (and
/// its `.sheet(item:)` pair) entirely, orphaning
/// `records.worklogForm`/`records.taskForm`. `WorklogListView`
/// (addWorklogTapped/worklogRowTapped), `TaskGridView` (gridCellTapped), and
/// `TaskListView` (addTaskTapped/taskRowTapped) still set that presentation
/// state — with no sheet bound to it, tapping "+" or a row/cell silently did
/// nothing. Builds green regardless, because the state itself is
/// well-typed; it just had no presenter.
private struct BillingRouterView: View {
    let store: StoreOf<IPadAppFeature>
    let billing: StoreOf<BillingFeature>
    @Bindable var records: StoreOf<RecordsFeature>

    var body: some View {
        detail
            .sheet(item: $records.scope(state: \.worklogForm, action: \.worklogForm)) { formStore in
                WorklogFormView(store: formStore)
            }
            .sheet(item: $records.scope(state: \.taskForm, action: \.taskForm)) { formStore in
                TaskFormView(store: formStore)
            }
    }

    @ViewBuilder private var detail: some View {
        switch store.billingSection {
        case .earnings:
            EarningsView(store: store)
        case .reports:
            ReportsView(store: store)
        case .recordsList:
            WorklogListView(billing: billing, records: records)
        case .recordsGrid:
            TaskGridView(billing: billing, records: records)
        case .recordsTasks:
            TaskListView(billing: billing, records: records)
        case .recordsTimeOff:
            TimeOffView(billing: billing, records: records)
        case .board:
            BoardView(records: records, billing: billing)
        }
    }
}
