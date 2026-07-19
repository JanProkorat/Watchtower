import SwiftUI
import ComposableArchitecture
import WatchtowerCore

private let timeOffDowAbbrevs = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]

/// Solid fill for vacation/sick/other; the accent color for holiday (rendered
/// as a dashed outline, never a solid fill — see the iPhone `TimeOffView`'s
/// `kindColor`, itself 1:1 with `TimeOffView.tsx`'s `KIND_COLOR` map, kept
/// except `holiday` (`#6d5fbb` → `Palette.accent`, close enough and already
/// in the shared palette).
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

/// Records → "Time off" — ported from the ORIGINAL
/// `packages/module-timetracker/src/billing/records/TimeOffView.tsx` (NOT
/// iphone-native): same derivation (`buildTimeOffModel`), same sticky glass
/// toolbar (stepper + Today + kind legend), same 3-months-side-by-side
/// `glassCard(12)` calendar strip, and the same "Upcoming" list of
/// individually-`glassCard(10)`'d rows.
///
/// `buildTimeOffModel` always returns `months: [prev, focus, next]`. The web
/// original stacks all 3 on iPad width (it only narrows to a single month
/// below its own `isNarrow` breakpoint) — this view always has iPad's width,
/// so all 3 render side by side as a horizontal strip (`monthStrip`); the
/// header stepper still moves the focus month (which shifts the whole strip).
///
/// Day tap opens a kind-picker (`.confirmationDialog`, the native-idiomatic
/// stand-in for the web's `BottomSheet`) offering Vacation / Sick / Other /
/// Delete record — 1:1 with the web original's picker, not the iPhone
/// reference's tap-to-cycle. Gated by `editable` (`canEdit(billing.loadState)`)
/// — the web original relies solely on the reducer's internal guard; this
/// view is explicit, mirroring `WorklogListView`/`TaskListView`.
struct TimeOffView: View {
    let billing: StoreOf<BillingFeature>
    let records: StoreOf<RecordsFeature>

    /// The date of the day cell whose kind-picker is open, or `nil` when
    /// closed. Local view state only — mirrors the web original's
    /// `useState<{date, anchor}>`; the reducer has no "picker open" concept.
    @State private var pickerDate: String?

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

    private var isLoading: Bool {
        billing.loadState == .loading && billing.dataset == nil
    }

    private var editable: Bool {
        canEdit(billing.loadState)
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
                            monthStrip
                            upcomingSection
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 16)
                        .padding(.bottom, 32)
                    }
                }
            }
        }
        .confirmationDialog(
            pickerDate.map { CzFormat.dateCz($0) } ?? "",
            isPresented: Binding(
                get: { pickerDate != nil },
                set: { if !$0 { pickerDate = nil } }
            ),
            titleVisibility: .visible
        ) {
            if let date = pickerDate {
                Button("Vacation") { records.send(.setDayOff(date: date, kind: "vacation")) }
                Button("Sick") { records.send(.setDayOff(date: date, kind: "sick")) }
                Button("Other") { records.send(.setDayOff(date: date, kind: "other")) }
                Button("Delete record", role: .destructive) { records.send(.clearDayOff(date: date)) }
            }
            Button("Cancel", role: .cancel) {}
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

                todayButton

                Spacer()
            }

            legend
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .glassCard(cornerRadius: 16)
        .padding(.horizontal, 16)
        .padding(.top, 12)
    }

    private var todayButton: some View {
        Button("Today") {
            records.send(.timeOffFocusStepped(Self.monthIndex(today.prefix(7).description) - Self.monthIndex(records.timeOffFocus)))
        }
        .buttonStyle(.plain)
        .font(.system(size: 12.5, weight: .semibold))
        .foregroundStyle(Palette.textSecondary)
        .padding(.horizontal, 14)
        .frame(height: 34)
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 9))
        .overlay(
            RoundedRectangle(cornerRadius: 9)
                .stroke(Color.white.opacity(0.12), lineWidth: 1)
        )
    }

    /// `"YYYY-MM"` → an absolute month index (`year*12 + month-1`), so two
    /// month strings can be diffed into a single `timeOffFocusStepped` delta.
    /// There's no dedicated "jump to current month" reducer action, same as
    /// `WorklogListView`'s `monthIndex`.
    private static func monthIndex(_ month: String) -> Int {
        let p = month.split(separator: "-")
        guard p.count == 2, let y = Int(p[0]), let m = Int(p[1]) else { return 0 }
        return y * 12 + (m - 1)
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
            if !editable {
                Text("read-only offline")
                    .font(.system(size: 11))
                    .foregroundStyle(Palette.textMuted)
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

    // MARK: - Month strip (iPad: all 3 months side by side)

    private var monthStrip: some View {
        HStack(alignment: .top, spacing: 16) {
            ForEach(model.months, id: \.month) { month in
                calendarCard(month)
            }
        }
    }

    @ViewBuilder
    private func calendarCard(_ month: MonthCal) -> some View {
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
        .padding(12)
        .glassCard(cornerRadius: 12)
        .frame(maxWidth: .infinity)
    }

    /// Tapping a day (any kind, including holiday — matching the web
    /// original's `onClick` which only guards on `editable && c.date`) opens
    /// the kind-picker `.confirmationDialog`. Pad cells outside the month
    /// (`day.date == nil`) don't respond. Also gated by `editable`
    /// (`canEdit(billing.loadState)`) — the web original relies solely on
    /// the reducer's internal guard.
    @ViewBuilder
    private func dayCell(_ day: CalDay) -> some View {
        let dayNumber = day.date.flatMap { Int($0.suffix(2)) }
        let isEditable = day.date != nil && editable

        Button {
            guard let date = day.date else { return }
            pickerDate = date
        } label: {
            Text(dayNumber.map(String.init) ?? "")
                .font(.system(size: 11, weight: day.kind != nil ? .bold : .regular))
                .foregroundStyle(dayNumberColor(day))
                .frame(maxWidth: .infinity)
                .aspectRatio(1, contentMode: .fit)
                .background(dayCellBackground(day))
                .overlay(dayCellBorder(day))
                .overlay(daySelectionRing(day))
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

    /// Highlight ring on the cell whose picker is currently open — mirrors
    /// the web original's `boxShadow: 'inset 0 0 0 2px #7dd3fc'`.
    @ViewBuilder
    private func daySelectionRing(_ day: CalDay) -> some View {
        if day.date != nil, day.date == pickerDate {
            RoundedRectangle(cornerRadius: 6)
                .stroke(Color(hex: "#7dd3fc"), lineWidth: 2)
        }
    }

    // MARK: - Upcoming

    private var upcomingSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeaderLabel("Upcoming")

            if model.upcoming.isEmpty {
                Text("nothing upcoming")
                    .font(.system(size: 13))
                    .foregroundStyle(Palette.textMuted)
            } else {
                // Individual `glassCard(10)` per row with a 6pt gap — matches
                // `TimeOffView.tsx`'s per-row `glassCard(10)` rows in a
                // `gap: 6` column, NOT a single grouped card with dividers.
                VStack(spacing: 6) {
                    ForEach(model.upcoming, id: \.date) { item in
                        upcomingRow(item)
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
        .padding(.vertical, 9)
        .padding(.horizontal, 12)
        .glassCard(cornerRadius: 10)
    }
}
