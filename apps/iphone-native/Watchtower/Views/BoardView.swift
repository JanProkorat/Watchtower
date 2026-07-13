import SwiftUI
import ComposableArchitecture
import WatchtowerCore

/// Native read-only port of `packages/module-timetracker/src/billing/BoardView.tsx`'s
/// Jira-status Kanban board. iPhone has no Mac bridge, so the iPad-only actions
/// (re-sync from Jira, upload worklogs — `BoardActions` in the React version) are
/// dropped entirely: this is a pure read of `buildBoard(tasks:worklogs:projectId:)`
/// over the shared billing dataset, with a project filter bound to
/// `RecordsFeature.boardProjectId`. No drag, no card taps, no sync/upload buttons.
struct BoardView: View {
    let records: StoreOf<RecordsFeature>
    let billing: StoreOf<BillingFeature>

    /// Column display names. Kept English per the app-wide locale switch even
    /// though the React reference still shows the Czech "Rozpracované" / "K akceptaci".
    private static let columnTitles: [BoardColumn: String] = [
        .todo: "To Do",
        .doing: "In Progress",
        .to_accept: "To Accept",
    ]

    private var dataset: BillingDataset {
        billing.dataset ?? BillingDataset(worklogs: [], contracts: [], daysOff: [], projects: [], tasks: [], epics: [], fetchedAt: "")
    }

    private var isLoading: Bool {
        billing.loadState == .loading && billing.dataset == nil
    }

    private var board: BoardData {
        buildBoard(tasks: dataset.tasks, worklogs: dataset.worklogs, projectId: records.boardProjectId)
    }

    var body: some View {
        ZStack {
            Palette.baseBg.ignoresSafeArea()

            VStack(spacing: 0) {
                filterBar

                if isLoading {
                    Spacer()
                    VStack(spacing: 12) {
                        ProgressView().tint(Palette.accentIcon)
                        Text("Loading…").foregroundStyle(Palette.textMuted)
                    }
                    Spacer()
                } else if board.totalCards == 0 {
                    Spacer()
                    Text("No tasks from the Jira board.")
                        .font(.subheadline)
                        .foregroundStyle(Palette.textMuted)
                    Spacer()
                } else {
                    boardRow
                }
            }
        }
    }

    // MARK: - Filter bar (project picker)

    private var filterBar: some View {
        VStack(alignment: .leading, spacing: 10) {
            projectMenu
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
        .padding(.horizontal, 16)
        .padding(.top, 12)
    }

    private var projectMenu: some View {
        Menu {
            Button("All projects") { records.send(.boardProjectChanged(nil)) }
            ForEach(dataset.projects, id: \.id) { project in
                Button(project.name.isEmpty ? "(no name)" : project.name) {
                    records.send(.boardProjectChanged(project.id))
                }
            }
        } label: {
            HStack {
                Text(selectedProjectLabel)
                    .font(.system(size: 13))
                    .foregroundStyle(Palette.textPrimary)
                    .lineLimit(1)
                Spacer()
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption2)
                    .foregroundStyle(Palette.textMuted)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 9))
            .overlay(
                RoundedRectangle(cornerRadius: 9)
                    .stroke(Color.white.opacity(0.12), lineWidth: 1)
            )
        }
        .menuOrder(.fixed)
    }

    private var selectedProjectLabel: String {
        guard let id = records.boardProjectId,
              let project = dataset.projects.first(where: { $0.id == id }) else {
            return "All projects"
        }
        return project.name.isEmpty ? "(no name)" : project.name
    }

    // MARK: - Horizontally-scrolling columns

    private var boardRow: some View {
        ScrollView(.horizontal, showsIndicators: true) {
            HStack(alignment: .top, spacing: 12) {
                ForEach(visibleBoardColumns, id: \.self) { column in
                    columnView(column)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .frame(maxHeight: .infinity)
    }

    private func columnView(_ column: BoardColumn) -> some View {
        let cards = board.columns[column] ?? []
        return VStack(alignment: .leading, spacing: 0) {
            columnHeader(column, count: cards.count)
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 8) {
                    ForEach(cards) { card in
                        BoardCardTile(card: card)
                    }
                }
                .padding(8)
            }
        }
        .frame(width: 210)
        .frame(maxHeight: .infinity)
        .background(Color.white.opacity(0.03), in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        )
    }

    private func columnHeader(_ column: BoardColumn, count: Int) -> some View {
        HStack {
            Text(Self.columnTitles[column] ?? column.rawValue)
                .font(.system(size: 12.5, weight: .bold))
                .foregroundStyle(Palette.textPrimary)
            Spacer()
            Text("\(count)")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(Palette.textMuted)
                .frame(minWidth: 20, minHeight: 20)
                .background(Color.white.opacity(0.08), in: Capsule())
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .overlay(
            Rectangle()
                .fill(Color.white.opacity(0.08))
                .frame(height: 1),
            alignment: .bottom
        )
    }
}

// MARK: - Card tile

private struct BoardCardTile: View {
    let card: BoardCard

    /// `"<logged> h"` or `"<logged> / <estimate> h"`. Mirrors `BoardView.tsx`'s
    /// `timeLine()`; the combined form composes two bare (unit-less) hour
    /// figures with a single trailing " h" so it doesn't repeat the unit.
    private var timeLine: String {
        if let estimate = card.estimateMinutes, estimate > 0 {
            return "\(hoursBare(card.loggedMinutes)) / \(hoursBare(estimate)) h"
        }
        return CzFormat.hours(card.loggedMinutes)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                if let color = card.projectColor {
                    Circle().fill(Color(hex: color)).frame(width: 7, height: 7)
                }
                Text(card.taskNumber ?? "(no task)")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(Palette.textMuted)
                    .lineLimit(1)
            }

            Text(card.taskTitle)
                .font(.system(size: 12.5))
                .foregroundStyle(Palette.textPrimary)
                .lineLimit(2)
                .truncationMode(.tail)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 6) {
                Text(card.jiraStatus.uppercased())
                    .font(.system(size: 9.5, weight: .bold))
                    .tracking(0.3)
                    .foregroundStyle(Palette.chartViolet.opacity(0.8))
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 6)
                Text(timeLine)
                    .font(.system(size: 11))
                    .foregroundStyle(Palette.textMuted)
                    .lineLimit(1)
                    .fixedSize()
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 9))
        .overlay(
            RoundedRectangle(cornerRadius: 9)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        )
    }
}

// MARK: - Bare (unit-less) hours formatting

private let boardHoursFormatter: NumberFormatter = {
    let f = NumberFormatter()
    f.numberStyle = .decimal
    f.locale = Locale(identifier: "cs_CZ")
    f.maximumFractionDigits = 2
    f.minimumFractionDigits = 0
    f.usesGroupingSeparator = false
    f.decimalSeparator = ","
    return f
}()

/// cs-CZ formatted hours with no " h" suffix — used for the logged/estimate
/// pair in `timeLine` so the combined string carries a single trailing unit.
private func hoursBare(_ minutes: Double) -> String {
    boardHoursFormatter.string(from: (minutes / 60) as NSNumber) ?? "0"
}
