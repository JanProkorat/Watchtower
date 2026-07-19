import SwiftUI
import ComposableArchitecture
import WatchtowerCore
import WatchtowerBridge

/// iPad port of the iPhone `EarningsView` — same shared stores
/// (`BillingFeature`'s dataset/loadState + `EarningsFeature`'s month cursor)
/// and the same pure derivations (`aggregateMonthEarnings`, `trailingMonths`),
/// but the layout is the iPad design system's **D2 master-detail** rather
/// than the iPhone's push navigation: month stepper / hero total / trend /
/// project list live in a leading pane, and whenever `earnings.projectDetail`
/// is presented, `ProjectDetailView` renders inline in a trailing pane —
/// never as a `.navigationDestination`. Tapping a project row sends
/// `.openProjectTapped(id)`; the trailing pane shows a "Select a project"
/// placeholder until a project is selected, with a close (x) affordance that
/// nils the presented state back out (the iPhone's equivalent is simply the
/// system back button, which doesn't exist for an inline pane).
struct EarningsView: View {
    let store: StoreOf<IPadAppFeature>

    var body: some View {
        EarningsSplitView(
            billing: store.scope(state: \.billing, action: \.billing),
            earnings: store.scope(state: \.earnings, action: \.earnings)
        )
    }
}

/// Split into its own type so `earnings` can be `@Bindable` — required for
/// the `$earnings.scope(state:action:)` presentation binding below, which a
/// computed (non-stored) property can't carry.
private struct EarningsSplitView: View {
    let billing: StoreOf<BillingFeature>
    @Bindable var earnings: StoreOf<EarningsFeature>

    private var selectedMonth: String { earnings.selectedMonth }

    private var dataset: BillingDataset {
        billing.dataset ?? BillingDataset(worklogs: [], contracts: [], daysOff: [], projects: [], tasks: [], epics: [], fetchedAt: "")
    }

    private var agg: (totalCzk: Double, perProject: [ProjectEarning]) {
        aggregateMonthEarnings(dataset.worklogs, selectedMonth)
    }

    private var trailing: [(month: String, earnedCzk: Double)] {
        trailingMonths(dataset.worklogs, selectedMonth, 8)
    }

    private var maxEarned: Double {
        max(agg.perProject.map(\.earnedCzk).max() ?? 1, 1)
    }

    private var isLoading: Bool {
        billing.loadState == .loading && billing.dataset == nil
    }

    /// Presented-scope binding for the trailing pane. Reading `.wrappedValue`
    /// gives the (possibly nil) child store; writing `nil` to it dismisses —
    /// exactly what `.navigationDestination(item:)` does on the iPhone when
    /// the user taps back.
    private var projectDetailBinding: Binding<StoreOf<ProjectDetailFeature>?> {
        $earnings.scope(state: \.projectDetail, action: \.projectDetail)
    }

    var body: some View {
        HStack(spacing: 0) {
            leadingPane
                .frame(width: 420)
            Divider().overlay(Palette.hairline)
            trailingPane
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Palette.baseBg)
    }

    // MARK: - Leading pane

    private var leadingPane: some View {
        VStack(spacing: 0) {
            monthPicker

            if isLoading {
                Spacer()
                VStack(spacing: 12) {
                    ProgressView().tint(Palette.accentIcon)
                    Text("Loading…").foregroundStyle(Palette.textMuted)
                }
                Spacer()
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        heroTotal
                        trendSection
                        projectsSection
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 16)
                    .padding(.bottom, 32)
                }
            }
        }
        .background(Palette.baseBg)
    }

    private var monthPicker: some View {
        HStack(spacing: 12) {
            Button {
                earnings.send(.monthStepped(-1))
            } label: {
                Text("‹")
                    .font(.system(size: 20))
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Palette.textPrimary)
            .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
            .accessibilityLabel("Previous month")

            Text(CzFormat.czechMonthLabel(selectedMonth))
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Palette.textPrimary)
                .frame(minWidth: 160)
                .multilineTextAlignment(.center)

            Button {
                earnings.send(.monthStepped(1))
            } label: {
                Text("›")
                    .font(.system(size: 20))
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Palette.textPrimary)
            .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
            .accessibilityLabel("Next month")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity)
        .contentCard(cornerRadius: 16)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    // MARK: - Hero total

    private var heroTotal: some View {
        VStack(spacing: 4) {
            Text("Total earnings".uppercased())
                .font(.caption.weight(.bold))
                .foregroundStyle(Palette.textMuted)
                .tracking(0.8)
            Text(CzFormat.czk(agg.totalCzk))
                .font(.system(size: 40, weight: .bold, design: .monospaced))
                .foregroundStyle(Palette.chartViolet)
        }
        .frame(maxWidth: .infinity)
        .padding(16)
        .contentCard()
    }

    // MARK: - Trend

    private var trendSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Trend (8 months)")
            TrailingBars(months: trailing, selectedMonth: selectedMonth)
                .padding(16)
                .contentCard()
        }
    }

    // MARK: - Projects

    private var projectsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Projects")
            if agg.perProject.isEmpty {
                Text("No earnings this month")
                    .font(.subheadline)
                    .foregroundStyle(Palette.textMuted)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 12)
                    .contentCard()
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(agg.perProject.enumerated()), id: \.element.projectId) { index, project in
                        EarningsProjectRow(
                            project: project,
                            barFraction: project.earnedCzk / maxEarned,
                            isSelected: projectDetailBinding.wrappedValue?.projectId == project.projectId,
                            onTap: { earnings.send(.openProjectTapped(project.projectId)) }
                        )
                        if index < agg.perProject.count - 1 {
                            Divider().overlay(Palette.hairline)
                        }
                    }
                }
                .padding(.horizontal, 4)
                .contentCard()
            }
        }
    }

    // MARK: - Trailing pane

    @ViewBuilder
    private var trailingPane: some View {
        if let detailStore = projectDetailBinding.wrappedValue {
            VStack(spacing: 0) {
                trailingCloseBar
                ProjectDetailView(store: detailStore, billing: billing)
            }
        } else {
            VStack(spacing: 8) {
                Image(systemName: "folder")
                    .font(.system(size: 32))
                    .foregroundStyle(Palette.textMuted)
                Text("Select a project")
                    .font(.title3)
                    .foregroundStyle(Palette.textMuted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var trailingCloseBar: some View {
        HStack {
            Spacer()
            Button {
                projectDetailBinding.wrappedValue = nil
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(Palette.textMuted)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close project detail")
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
    }
}

// MARK: - Shared section label (also used by ProjectDetailView / ContractDrawerView)

/// Small uppercase caption header, mirroring `DashboardView`'s private
/// `TileHeader` — kept internal (not `private`) so the sibling Billing views
/// in this module can reuse it instead of redefining the same style thrice.
struct SectionHeader: View {
    let title: String

    var body: some View {
        Text(title.uppercased())
            .font(.caption.weight(.bold))
            .foregroundStyle(Palette.textMuted)
            .tracking(0.8)
    }
}

// MARK: - Trailing months bar chart

private struct TrailingBars: View {
    let months: [(month: String, earnedCzk: Double)]
    let selectedMonth: String

    private var maxCzk: Double {
        max(months.map(\.earnedCzk).max() ?? 1, 1)
    }

    private static let monthShortNames = [
        "led", "úno", "bře", "dub", "kvě", "čer", "čvc", "srp", "zář", "říj", "lis", "pro",
    ]

    private func caption(for month: String) -> String {
        let parts = month.split(separator: "-")
        guard parts.count == 2, let m = Int(parts[1]), m >= 1, m <= 12 else { return "" }
        return Self.monthShortNames[m - 1]
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: 6) {
            ForEach(months, id: \.month) { entry in
                let isSelected = entry.month == selectedMonth
                let pct = max(entry.earnedCzk / maxCzk, 0.03) * 100

                VStack(spacing: 4) {
                    GeometryReader { geo in
                        VStack {
                            Spacer(minLength: 0)
                            RoundedRectangle(cornerRadius: 3)
                                .fill(isSelected ? Palette.chartViolet : Palette.chartViolet.opacity(0.53))
                                .frame(height: geo.size.height * CGFloat(pct) / 100)
                        }
                    }
                    Text(caption(for: entry.month))
                        .font(.system(size: 9, weight: isSelected ? .bold : .regular))
                        .foregroundStyle(isSelected ? Palette.chartViolet : Palette.textMuted)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(CzFormat.czechMonthLabel(entry.month)): \(CzFormat.czk(entry.earnedCzk))")
            }
        }
        .frame(height: 100)
    }
}

// MARK: - Per-project row

private struct EarningsProjectRow: View {
    let project: ProjectEarning
    let barFraction: Double
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Circle()
                        .fill(Color(hex: project.color ?? "#38bdf8"))
                        .frame(width: 10, height: 10)
                    Text(project.name.isEmpty ? "(no name)" : project.name)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Palette.textPrimary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Spacer()
                    Text(CzFormat.hours(project.minutes))
                        .font(.caption)
                        .foregroundStyle(Palette.textMuted)
                    Text(CzFormat.czk(project.earnedCzk))
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Palette.chartViolet)
                        .frame(minWidth: 80, alignment: .trailing)
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundStyle(Palette.textMuted)
                }
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.white.opacity(0.10))
                        Capsule()
                            .fill(Color(hex: project.color ?? "#38bdf8"))
                            .frame(width: geo.size.width * min(1, max(0, CGFloat(barFraction))))
                    }
                }
                .frame(height: 3)
                .padding(.leading, 18)
            }
            .padding(.vertical, 12)
            .padding(.horizontal, 8)
            .background(isSelected ? Color.white.opacity(0.05) : Color.clear, in: RoundedRectangle(cornerRadius: 8))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
