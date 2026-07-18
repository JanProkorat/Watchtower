import SwiftUI
import ComposableArchitecture
import WatchtowerCore
import WatchtowerBridge

/// iPad port of the iPhone `ProjectDetailView` — identical derivations
/// (`activeContract`, `rollupEarningsByContract`) and identical section
/// order (header / rate-history / monthly ledger), but rendered as the
/// **trailing pane** of `EarningsView`'s master-detail split instead of a
/// pushed `NavigationStack` destination. Two adaptations follow from that:
///   - No `.navigationTitle`/`.navigationBarTitleDisplayMode` — there's no
///     enclosing `NavigationStack` on this pane (the project name is already
///     shown prominently in `headerCard`), so a nav-bar title would be inert.
///   - Cards use the iPad design system's `contentCard()` (solid) instead of
///     the iPhone's `GlassCard`/`.ultraThinMaterial`.
/// The contract-drawer `.sheet` presentation and `canEdit` gating (hide
/// "+ Add rate", disable/hide the rate-history row tap) are unchanged.
struct ProjectDetailView: View {
    @Bindable var store: StoreOf<ProjectDetailFeature>
    let billing: StoreOf<BillingFeature>

    // UTC calendar for the "today" date string — matches WatchtowerCore's
    // date-arithmetic convention (never the local time zone). Same pattern
    // as `DashboardView`.
    private static let utcCalendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    private static var today: String {
        let c = utcCalendar.dateComponents([.year, .month, .day], from: Date())
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    private var dataset: BillingDataset {
        billing.dataset ?? BillingDataset(worklogs: [], contracts: [], daysOff: [], projects: [], tasks: [], epics: [], fetchedAt: "")
    }

    private var projectWorklogs: [WorklogRow] {
        dataset.worklogs.filter { $0.projectId == store.projectId }
    }

    private var projectContracts: [ContractRow] {
        dataset.contracts.filter { $0.projectId == store.projectId }
    }

    private var projectName: String {
        dataset.projects.first { $0.id == store.projectId }?.name
            ?? projectWorklogs.first?.projectName
            ?? "Project #\(store.projectId)"
    }

    private var monthWorklogs: [WorklogRow] {
        projectWorklogs.filter { $0.workDate.prefix(7) == store.month }
    }

    private var totalMinutes: Double {
        monthWorklogs.reduce(0) { $0 + $1.minutes }
    }

    private var totalEarned: Double {
        monthWorklogs.reduce(0) { $0 + ($1.earnedAmount ?? 0) }
    }

    private var activeContractRow: ContractRow? {
        activeContract(projectContracts, today: Self.today)
    }

    private var contractPeriods: [ContractEarning] {
        rollupEarningsByContract(worklogs: projectWorklogs, contracts: projectContracts)
    }

    private var ledgerRows: [WorklogRow] {
        monthWorklogs.sorted { $0.workDate > $1.workDate }
    }

    private var editable: Bool {
        canEdit(store.loadState)
    }

    var body: some View {
        ZStack {
            Palette.baseBg.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    headerCard
                    rateHistorySection
                    ledgerSection
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 32)
            }
        }
        .sheet(item: $store.scope(state: \.contractDrawer, action: \.contractDrawer)) { drawerStore in
            ContractDrawerView(store: drawerStore, billing: billing)
        }
    }

    // MARK: - 1. Header card

    private var headerCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(projectName)
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(Palette.textPrimary)
                .lineLimit(2)

            HStack(alignment: .top, spacing: 20) {
                VStack(alignment: .leading, spacing: 4) {
                    SectionHeader(title: "Month")
                    HStack(spacing: 8) {
                        Button {
                            store.send(.monthStepped(-1))
                        } label: {
                            Text("‹")
                                .font(.system(size: 18))
                                .frame(width: 30, height: 30)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(Palette.accentIcon)
                        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
                        .accessibilityLabel("Previous month")

                        Text(CzFormat.czechMonthLabel(store.month))
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Palette.textPrimary)
                            .frame(minWidth: 108)
                            .multilineTextAlignment(.center)

                        Button {
                            store.send(.monthStepped(1))
                        } label: {
                            Text("›")
                                .font(.system(size: 18))
                                .frame(width: 30, height: 30)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(Palette.accentIcon)
                        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
                        .accessibilityLabel("Next month")
                    }
                }

                VStack(alignment: .leading, spacing: 4) {
                    SectionHeader(title: "Hours")
                    Text(CzFormat.hours(totalMinutes))
                        .font(.system(size: 16, weight: .bold, design: .monospaced))
                        .foregroundStyle(Palette.chartCyan)
                }

                if let active = activeContractRow {
                    VStack(alignment: .leading, spacing: 4) {
                        SectionHeader(title: "Rate")
                        Text(rateLabel(active))
                            .font(.system(size: 16, weight: .bold, design: .monospaced))
                            .foregroundStyle(Palette.chartViolet)
                    }
                }
            }
        }
        .padding(16)
        .contentCard()
    }

    // MARK: - 2. Rate history

    private var rateHistorySection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                SectionHeader(title: "Rate history")
                Spacer()
                if editable {
                    Button {
                        store.send(.addContractTapped)
                    } label: {
                        Text("+ Add rate")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Palette.accentIcon)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Add rate")
                }
            }

            if contractPeriods.isEmpty {
                Text("No rates yet")
                    .font(.subheadline)
                    .foregroundStyle(Palette.textMuted)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 12)
                    .contentCard()
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(contractPeriods.enumerated()), id: \.element.contract.syncId) { index, earning in
                        ContractHistoryRow(
                            earning: earning,
                            isActive: earning.contract.syncId == activeContractRow?.syncId,
                            groupCount: earning.contract.contractGroupId.map { sharedMemberCount(dataset.contracts, groupId: $0) },
                            editable: editable,
                            onTap: { store.send(.contractRowTapped(earning.contract)) }
                        )
                        if index < contractPeriods.count - 1 {
                            Divider().overlay(Palette.hairline)
                        }
                    }
                }
                .padding(.horizontal, 4)
                .contentCard()
            }
        }
    }

    // MARK: - 3. Worklog ledger

    private var ledgerSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Worklogs — \(CzFormat.czechMonthLabel(store.month))")

            VStack(spacing: 0) {
                ledgerColumns

                if ledgerRows.isEmpty {
                    Text("No worklogs this month")
                        .font(.subheadline)
                        .foregroundStyle(Palette.textMuted)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.vertical, 16)
                } else {
                    ForEach(Array(ledgerRows.enumerated()), id: \.element.syncId) { index, row in
                        ledgerRowView(row)
                        if index < ledgerRows.count - 1 {
                            Divider().overlay(Color.white.opacity(0.08))
                        }
                    }
                    ledgerFooter
                }
            }
            .contentCard(cornerRadius: 12)
        }
    }

    private var ledgerColumns: some View {
        HStack(spacing: 8) {
            Text("Date").frame(width: 72, alignment: .leading)
            Text("Task").frame(width: 56, alignment: .leading)
            Text("Hours").frame(maxWidth: .infinity, alignment: .trailing)
            Text("Earned").frame(maxWidth: .infinity, alignment: .trailing)
        }
        .font(.system(size: 10, weight: .bold))
        .foregroundStyle(Palette.textMuted)
        .textCase(.uppercase)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) {
            Divider().overlay(Palette.hairline)
        }
    }

    private func ledgerRowView(_ row: WorklogRow) -> some View {
        let earned = row.earnedAmount ?? 0
        return HStack(spacing: 8) {
            Text(CzFormat.dateCz(row.workDate))
                .font(.caption2)
                .foregroundStyle(Palette.textMuted)
                .frame(width: 72, alignment: .leading)

            Text(row.taskNumber ?? "—")
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(row.taskNumber != nil ? Palette.chartCyan : Palette.textMuted)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(width: 56, alignment: .leading)

            Text(CzFormat.hours(row.minutes))
                .font(.system(size: 13, design: .monospaced))
                .foregroundStyle(Palette.textPrimary)
                .frame(maxWidth: .infinity, alignment: .trailing)

            Text(CzFormat.czk(earned))
                .font(.system(size: 13, weight: earned > 0 ? .semibold : .regular, design: .monospaced))
                .foregroundStyle(earned > 0 ? Palette.chartViolet : Palette.textMuted)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private var ledgerFooter: some View {
        HStack(spacing: 8) {
            Text("Total".uppercased())
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(Palette.textMuted)
                .frame(width: 72, alignment: .leading)
            Text("").frame(width: 56, alignment: .leading)
            Text(CzFormat.hours(totalMinutes))
                .font(.system(size: 13, weight: .bold, design: .monospaced))
                .foregroundStyle(Palette.chartCyan)
                .frame(maxWidth: .infinity, alignment: .trailing)
            Text(CzFormat.czk(totalEarned))
                .font(.system(size: 13, weight: .bold, design: .monospaced))
                .foregroundStyle(Palette.chartViolet)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Palette.chartViolet.opacity(0.08))
        .overlay(alignment: .top) {
            Divider().overlay(Color.white.opacity(0.15))
        }
    }
}

// MARK: - Rate-history row

private struct ContractHistoryRow: View {
    let earning: ContractEarning
    let isActive: Bool
    let groupCount: Int?
    let editable: Bool
    let onTap: () -> Void

    private var periodLabel: String {
        let end = earning.contract.endDate.map(CzFormat.dateCz) ?? "now"
        return "\(CzFormat.dateCz(earning.contract.effectiveFrom)) – \(end)"
    }

    var body: some View {
        Button(action: onTap) {
            HStack(alignment: .top, spacing: 10) {
                Circle()
                    .fill(isActive ? Palette.chartViolet : Color.white.opacity(0.20))
                    .frame(width: 6, height: 6)
                    .padding(.top, 5)

                VStack(alignment: .leading, spacing: 2) {
                    if let groupCount {
                        Text("Shared · \(groupCount) projects".uppercased())
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(Palette.chartViolet.opacity(0.8))
                            .tracking(0.3)
                    }
                    Text(periodLabel)
                        .font(.caption)
                        .fontWeight(isActive ? .semibold : .regular)
                        .foregroundStyle(isActive ? Palette.textPrimary : Palette.textMuted)
                    Text(rateLabel(earning.contract))
                        .font(.system(size: 13, weight: .semibold, design: .monospaced))
                        .foregroundStyle(isActive ? Palette.chartViolet : Palette.textMuted)
                }

                Spacer()

                Text(CzFormat.czk(earning.earnedCzk))
                    .font(.system(size: 13, weight: .semibold, design: .monospaced))
                    .foregroundStyle(isActive ? Palette.chartViolet : Palette.textMuted)

                if editable {
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundStyle(Palette.textMuted)
                }
            }
            .padding(.vertical, 12)
            .padding(.horizontal, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!editable)
    }
}
