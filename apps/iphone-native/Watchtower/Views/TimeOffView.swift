import SwiftUI
import ComposableArchitecture
import WatchtowerCore

private let timeOffDowAbbrevs = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]

/// Solid fill for vacation/sick/other; the accent color for holiday (rendered
/// as a dashed outline, never a solid fill — see `TimeOffView.tsx`'s
/// `KIND_COLOR` map, kept 1:1 except `holiday` (`#6d5fbb` → `Palette.accent`,
/// close enough and already in the shared palette).
private func kindColor(_ kind: TimeOffKind) -> Color {
    switch kind {
    case .vacation: return Palette.chartCyan
    case .sick: return Color(hex: "#f87171")
    case .other: return Palette.chartAmber
    case .holiday: return Palette.accent
    }
}

private func kindLabel(_ kind: TimeOffKind) -> String {
    switch kind {
    case .vacation: return "Vacation"
    case .sick: return "Sick"
    case .other: return "Other"
    case .holiday: return "Holiday"
    }
}

/// Native port of `packages/module-timetracker/src/billing/records/TimeOffView.tsx`.
/// Read-only this phase: day cells are plain (non-tappable) and there is no
/// bottom-sheet kind picker (mutations land in a later phase). The web view
/// renders a 3-month strip on iPad and a single focused month on phone-narrow
/// layouts (`isNarrow` branch) — iPhone always takes the narrow path, so this
/// view only ever renders `model.months[1]` (the focused month).
struct TimeOffView: View {
    let billing: StoreOf<BillingFeature>
    let records: StoreOf<RecordsFeature>

    // UTC calendar for the "today" date string — matches WatchtowerCore's
    // date-arithmetic convention (never the local time zone).
    private static let utcCalendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    private var today: String {
        let c = Self.utcCalendar.dateComponents([.year, .month, .day], from: Date())
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    private var dataset: BillingDataset {
        billing.dataset ?? BillingDataset(worklogs: [], contracts: [], daysOff: [], projects: [], tasks: [], epics: [], fetchedAt: "")
    }

    private var model: TimeOffModel {
        buildTimeOffModel(focusMonth: records.timeOffFocus, daysOff: dataset.daysOff, today: today)
    }

    /// The focused month is always `months[1]` (prev/focus/next), but guard
    /// the index anyway — `buildTimeOffModel` always returns 3 entries, but a
    /// stray empty state should render nothing rather than crash.
    private var focusedMonth: MonthCal? {
        model.months.count > 1 ? model.months[1] : model.months.first
    }

    private var isLoading: Bool {
        billing.loadState == .loading && billing.dataset == nil
    }

    var body: some View {
        ZStack {
            Palette.baseBg.ignoresSafeArea()

            VStack(spacing: 0) {
                header

                if isLoading {
                    Spacer()
                    VStack(spacing: 12) {
                        ProgressView().tint(Palette.accentIcon)
                        Text("Loading…").foregroundStyle(Palette.textMuted)
                    }
                    Spacer()
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 20) {
                            if let month = focusedMonth {
                                calendarCard(month)
                            }
                            upcomingSection
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 16)
                        .padding(.bottom, 32)
                    }
                }
            }
        }
    }

    // MARK: - Header (month stepper + kind legend)

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Button {
                    records.send(.timeOffFocusStepped(-1))
                } label: {
                    Text("‹")
                        .font(.system(size: 18))
                        .frame(width: 34, height: 34)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Palette.accentIcon)
                .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 9))

                Text(CzFormat.czechMonthLabel(records.timeOffFocus))
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Palette.textPrimary)
                    .frame(minWidth: 128)
                    .multilineTextAlignment(.center)

                Button {
                    records.send(.timeOffFocusStepped(1))
                } label: {
                    Text("›")
                        .font(.system(size: 18))
                        .frame(width: 34, height: 34)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Palette.accentIcon)
                .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 9))

                Spacer()
            }

            legend
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 12)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
        .padding(.horizontal, 16)
        .padding(.top, 12)
    }

    private var legend: some View {
        HStack(spacing: 12) {
            ForEach([TimeOffKind.vacation, .sick, .other, .holiday], id: \.self) { kind in
                HStack(spacing: 5) {
                    kindSwatch(kind, size: 10)
                    Text(kindLabel(kind))
                        .font(.system(size: 11))
                        .foregroundStyle(Palette.textMuted)
                }
            }
        }
    }

    @ViewBuilder
    private func kindSwatch(_ kind: TimeOffKind, size: CGFloat) -> some View {
        if kind == .holiday {
            RoundedRectangle(cornerRadius: 2)
                .strokeBorder(kindColor(kind).opacity(0.7), style: StrokeStyle(lineWidth: 1, dash: [2, 2]))
                .frame(width: size, height: size)
        } else {
            RoundedRectangle(cornerRadius: 2)
                .fill(kindColor(kind))
                .frame(width: size, height: size)
        }
    }

    // MARK: - Calendar card

    @ViewBuilder
    private func calendarCard(_ month: MonthCal) -> some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 8) {
                Text(month.label)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Palette.textPrimary)

                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 3), count: 7), spacing: 3) {
                    ForEach(timeOffDowAbbrevs, id: \.self) { dow in
                        Text(dow)
                            .font(.system(size: 10))
                            .foregroundStyle(Palette.textMuted)
                            .frame(maxWidth: .infinity)
                    }
                    ForEach(Array(month.weeks.flatMap { $0 }.enumerated()), id: \.offset) { _, day in
                        dayCell(day)
                    }
                }
            }
        }
    }

    /// Tap-to-cycle a day cell through the user-settable kinds: none → vacation
    /// → sick → other → none (`clearDayOff`). `.holiday` is a computed Czech
    /// public holiday, not a `days_off` row — it isn't user-editable, so a
    /// holiday cell (and pad cells outside the month) don't respond to taps.
    @ViewBuilder
    private func dayCell(_ day: CalDay) -> some View {
        let dayNumber = day.date.flatMap { Int($0.suffix(2)) }
        let isEditable = day.date != nil && day.kind != .holiday

        Button {
            guard let date = day.date else { return }
            switch day.kind {
            case nil:
                records.send(.setDayOff(date: date, kind: "vacation"))
            case .vacation:
                records.send(.setDayOff(date: date, kind: "sick"))
            case .sick:
                records.send(.setDayOff(date: date, kind: "other"))
            case .other:
                records.send(.clearDayOff(date: date))
            case .holiday:
                break
            }
        } label: {
            Text(dayNumber.map(String.init) ?? "")
                .font(.system(size: 11, weight: day.kind != nil ? .bold : .regular))
                .foregroundStyle(dayNumberColor(day))
                .frame(maxWidth: .infinity)
                .aspectRatio(1, contentMode: .fit)
                .background(dayCellBackground(day))
                .overlay(dayCellBorder(day))
        }
        .buttonStyle(.plain)
        .disabled(!isEditable)
    }

    private func dayNumberColor(_ day: CalDay) -> Color {
        guard day.date != nil else { return .clear }
        if day.kind == .holiday { return Palette.accentIcon }
        if day.kind != nil { return Color(hex: "#0F0F17") }
        if day.isWeekend { return Palette.textMuted }
        return Palette.textPrimary
    }

    @ViewBuilder
    private func dayCellBackground(_ day: CalDay) -> some View {
        if let kind = day.kind, kind != .holiday {
            RoundedRectangle(cornerRadius: 6).fill(kindColor(kind))
        } else if day.date != nil {
            RoundedRectangle(cornerRadius: 6).fill(Color.white.opacity(0.04))
        } else {
            Color.clear
        }
    }

    @ViewBuilder
    private func dayCellBorder(_ day: CalDay) -> some View {
        if day.kind == .holiday {
            RoundedRectangle(cornerRadius: 6)
                .strokeBorder(kindColor(.holiday).opacity(0.6), style: StrokeStyle(lineWidth: 1, dash: [3, 2]))
        }
    }

    // MARK: - Upcoming

    private var upcomingSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Upcoming")

            if model.upcoming.isEmpty {
                Text("nothing upcoming")
                    .font(.system(size: 13))
                    .foregroundStyle(Palette.textMuted)
            } else {
                GlassCard {
                    VStack(spacing: 0) {
                        ForEach(Array(model.upcoming.enumerated()), id: \.element.date) { index, item in
                            upcomingRow(item)
                            if index < model.upcoming.count - 1 {
                                Divider().overlay(Color.white.opacity(0.10))
                            }
                        }
                    }
                }
            }
        }
    }

    private func upcomingRow(_ item: UpcomingItem) -> some View {
        HStack(spacing: 10) {
            kindSwatch(item.kind, size: 10)
            Text(CzFormat.dateCz(item.date))
                .font(.system(size: 12.5))
                .foregroundStyle(Palette.textPrimary)
                .frame(minWidth: 90, alignment: .leading)
            Text(item.note ?? kindLabel(item.kind))
                .font(.system(size: 12))
                .foregroundStyle(Palette.textMuted)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 4)
    }
}
