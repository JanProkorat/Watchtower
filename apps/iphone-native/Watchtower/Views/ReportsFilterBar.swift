import SwiftUI
import ComposableArchitecture
import WatchtowerCore

/// Native port of `packages/module-timetracker/src/billing/reports/ReportsFilterBar.tsx`.
/// Three stacked labeled fields (iPhone-narrow layout): Period, Granularity, Project.
struct ReportsFilterBar: View {
    let store: StoreOf<ReportsFeature>
    let projects: [ProjectRow]

    private static let presets: [(Preset, String)] = [
        (.d7, "7d"), (.d30, "30d"), (.month, "Month"), (.year, "Year"), (.all, "All"),
    ]
    private static let grans: [(Granularity, String)] = [
        (.day, "Day"), (.week, "Week"), (.month, "Month"),
    ]

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 14) {
                field(label: "Period") {
                    segmentedControl(
                        options: Self.presets,
                        isActive: { $0 == store.preset },
                        isDisabled: { _ in false },
                        onTap: { store.send(.presetChanged($0)) }
                    )
                }

                field(label: "Granularity") {
                    segmentedControl(
                        options: Self.grans,
                        isActive: { $0 == store.granularity },
                        isDisabled: { clampGranularity($0, from: store.range.from, to: store.range.to) != $0 },
                        onTap: { store.send(.granularityChanged($0)) }
                    )
                }

                field(label: "Project") {
                    projectMenu
                }
            }
        }
    }

    // MARK: - Labeled field

    @ViewBuilder
    private func field<Content: View>(label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(label.uppercased())
                .font(.system(size: 10.5, weight: .bold))
                .tracking(0.6)
                .foregroundStyle(Palette.textMuted)
            content()
        }
    }

    // MARK: - Segmented control (shared by Period + Granularity)

    private func segmentedControl<T: Equatable>(
        options: [(T, String)],
        isActive: @escaping (T) -> Bool,
        isDisabled: @escaping (T) -> Bool,
        onTap: @escaping (T) -> Void
    ) -> some View {
        HStack(spacing: 3) {
            ForEach(Array(options.enumerated()), id: \.offset) { _, option in
                let (value, label) = option
                let active = isActive(value)
                let disabled = isDisabled(value)

                Button {
                    onTap(value)
                } label: {
                    Text(label)
                        .font(.system(size: 12.5, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 7)
                        .padding(.horizontal, 4)
                }
                .buttonStyle(.plain)
                .disabled(disabled)
                .foregroundStyle(active ? Palette.accent : Palette.textMuted)
                .background(
                    active ? Palette.accent.opacity(0.16) : Color.clear,
                    in: RoundedRectangle(cornerRadius: 8)
                )
                .opacity(disabled ? 0.32 : 1)
            }
        }
        .padding(3)
        .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 11))
        .overlay(
            RoundedRectangle(cornerRadius: 11)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        )
    }

    // MARK: - Project menu

    private var projectMenu: some View {
        Menu {
            Button("All projects") { store.send(.projectChanged(nil)) }
            ForEach(projects, id: \.id) { project in
                Button(project.name.isEmpty ? "(no name)" : project.name) {
                    store.send(.projectChanged(project.id))
                }
            }
        } label: {
            HStack {
                Text(selectedProjectLabel)
                    .font(.system(size: 14))
                    .foregroundStyle(Palette.textPrimary)
                    .lineLimit(1)
                Spacer()
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption2)
                    .foregroundStyle(Palette.textMuted)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 9))
            .overlay(
                RoundedRectangle(cornerRadius: 9)
                    .stroke(Color.white.opacity(0.12), lineWidth: 1)
            )
        }
        .menuOrder(.fixed)
    }

    private var selectedProjectLabel: String {
        guard let id = store.projectId, let project = projects.first(where: { $0.id == id }) else {
            return "All projects"
        }
        return project.name.isEmpty ? "(no name)" : project.name
    }
}
