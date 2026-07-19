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
            detail
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @ViewBuilder private var detail: some View {
        let billing = store.scope(state: \.billing, action: \.billing)
        let records = store.scope(state: \.records, action: \.records)

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
