import SwiftUI
import ComposableArchitecture
import WatchtowerCore
import WatchtowerBridge

/// Floating glass sidebar — native port of `apps/ipad/src/components/Rail.tsx`
/// (design-align T2), replacing the old compact 88pt icon-only rail. Faithful
/// to the original's structure: logo + wordmark header, five top-level nav
/// rows (Dashboard/Instances/Remote Mac/Billing/Settings), an expandable flat
/// Billing sub-group (was a segmented Earnings|Reports|Records switcher
/// inside `BillingView` — now lives here, one level, matching the web rail),
/// a footer notification row, and a collapse toggle. Two independent
/// persisted booleans (`@AppStorage`, same key names as the web
/// `localStorage` keys) drive width (232 expanded / 52 collapsed) and
/// whether the Billing sub-group is shown.
struct RailView: View {
    let store: StoreOf<IPadAppFeature>

    @AppStorage("watchtower.ipad.rail.expanded") private var expanded: Bool = true
    @AppStorage("watchtower.ipad.rail.billingExpanded") private var billingExpanded: Bool = true

    private let expandedWidth: CGFloat = 232
    private let collapsedWidth: CGFloat = 52

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            RailHeader(expanded: expanded)

            ForEach(IPadAppFeature.Module.allCases, id: \.self) { module in
                VStack(spacing: 2) {
                    RailNavRow(
                        title: module.title,
                        systemImage: module.systemImage,
                        isActive: store.selectedModule == module,
                        expanded: expanded,
                        hasChevron: module == .billing,
                        chevronExpanded: billingExpanded,
                        onTap: { handleParentTap(module) },
                        onChevronTap: { billingExpanded.toggle() }
                    )

                    if module == .billing, expanded, billingExpanded {
                        ForEach(IPadAppFeature.BillingSection.allCases, id: \.self) { section in
                            RailBillingSubRow(
                                title: section.title,
                                systemImage: section.systemImage,
                                isActive: store.selectedModule == .billing && store.billingSection == section,
                                onTap: { store.send(.billingSectionSelected(section)) }
                            )
                        }
                    }
                }
            }

            Spacer(minLength: 0)

            RailFooter(expanded: expanded, onCollapseToggle: { expanded.toggle() })
        }
        .padding(.horizontal, expanded ? 8 : 0)
        .padding(.bottom, 8)
        .frame(width: expanded ? expandedWidth : collapsedWidth, alignment: .leading)
        .floatingGlass(cornerRadius: 20)
        .padding(.leading, 13)
        .padding(.vertical, 13)
        .animation(.easeInOut(duration: 0.16), value: expanded)
        .animation(.easeInOut(duration: 0.16), value: billingExpanded)
    }

    /// Plain modules switch directly. Billing toggles its sub-list when
    /// already active, otherwise activates billing and force-expands the
    /// list so the active child stays visible — same UX as `Rail.tsx`'s
    /// `handleParentClick`.
    private func handleParentTap(_ module: IPadAppFeature.Module) {
        if module != .billing {
            store.send(.moduleSelected(module))
            return
        }
        if store.selectedModule == .billing {
            billingExpanded.toggle()
        } else {
            store.send(.moduleSelected(.billing))
            billingExpanded = true
        }
    }
}

// MARK: - Header

private struct RailHeader: View {
    let expanded: Bool

    var body: some View {
        HStack(spacing: 10) {
            WatchtowerLogoMark(size: 28)
            if expanded {
                Text("Watchtower")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Palette.textPrimary)
                    .lineLimit(1)
            }
        }
        .padding(.leading, expanded ? 8 : 0)
        .frame(maxWidth: .infinity, alignment: expanded ? .leading : .center)
        .frame(height: 56)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Palette.hairline).frame(height: 1)
        }
        .padding(.bottom, 4)
    }
}

/// Approximates the web mark's three overlapping colored hex facets
/// (`polygon` triples at `#4dd0e1`/`#1abc9c`/`#2980b9`) with three tinted
/// `hexagon.fill` glyphs arranged in the same top / bottom-left /
/// bottom-right triangle — SwiftUI has no equivalent to inline SVG
/// polygons, so this is the closest system-symbol approximation.
struct WatchtowerLogoMark: View {
    var size: CGFloat = 28

    private var facetSize: CGFloat { size * 0.62 }

    var body: some View {
        ZStack {
            facet(color: Color(hex: "#4dd0e1"))
                .offset(y: -size * 0.22)
            facet(color: Color(hex: "#1abc9c"))
                .offset(x: -size * 0.26, y: size * 0.16)
            facet(color: Color(hex: "#2980b9"))
                .offset(x: size * 0.26, y: size * 0.16)
        }
        .frame(width: size, height: size)
    }

    private func facet(color: Color) -> some View {
        Image(systemName: "hexagon.fill")
            .resizable()
            .scaledToFit()
            .frame(width: facetSize, height: facetSize)
            .foregroundStyle(color)
    }
}

// MARK: - Nav row (40pt, top-level modules)

private struct RailNavRow: View {
    let title: String
    let systemImage: String
    let isActive: Bool
    let expanded: Bool
    let hasChevron: Bool
    let chevronExpanded: Bool
    let onTap: () -> Void
    let onChevronTap: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            Button(action: onTap) {
                HStack(spacing: expanded ? 12 : 0) {
                    Image(systemName: systemImage)
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(isActive ? Palette.accentIcon : Palette.textMuted)
                        .frame(width: 24)
                    if expanded {
                        Text(title)
                            .font(.system(size: 13, weight: isActive ? .semibold : .medium))
                            .foregroundStyle(isActive ? Palette.textPrimary : Palette.textMuted)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                    }
                }
                .padding(.leading, expanded ? 10 : 0)
                .padding(.trailing, expanded ? 10 : 0)
                .frame(height: 40)
                .frame(maxWidth: expanded ? .infinity : 40)
                .background(
                    RoundedRectangle(cornerRadius: 11)
                        .fill(isActive ? Palette.accentWash : Color.clear)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 11)
                        .strokeBorder(isActive ? Palette.accent.opacity(0.30) : Color.clear, lineWidth: 1)
                )
            }
            .buttonStyle(.plain)

            if hasChevron, expanded {
                Button(action: onChevronTap) {
                    Image(systemName: chevronExpanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Palette.textMuted)
                        .frame(width: 28, height: 28)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

// MARK: - Billing sub-row (32pt, indented, flat — replaces the old segmented switcher)

private struct RailBillingSubRow: View {
    let title: String
    let systemImage: String
    let isActive: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 10) {
                Image(systemName: systemImage)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(isActive ? Palette.accentIcon : Palette.textMuted)
                    .frame(width: 18)
                Text(title)
                    .font(.system(size: 12.5, weight: isActive ? .semibold : .regular))
                    .foregroundStyle(isActive ? Palette.textPrimary : Palette.textMuted)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.leading, 22)
            .padding(.trailing, 10)
            .frame(height: 32)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(isActive ? Palette.accentWash : Color.clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .strokeBorder(isActive ? Palette.accent.opacity(0.30) : Color.clear, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Footer (notifications + collapse toggle)

private struct RailFooter: View {
    let expanded: Bool
    let onCollapseToggle: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Rectangle().fill(Palette.hairline).frame(height: 1)
            Group {
                if expanded {
                    HStack(spacing: 6) { bellButton; collapseButton }
                } else {
                    VStack(spacing: 6) { bellButton; collapseButton }
                }
            }
            .padding(.top, 8)
        }
        .padding(.top, 6)
    }

    // Notifications is a stub row for now (Phase 7 wires the real feed/badge
    // count) — tapping it is a deliberate no-op, matching the task scope.
    private var bellButton: some View {
        Button(action: {}) {
            HStack(spacing: expanded ? 11 : 0) {
                Image(systemName: "bell.fill")
                    .font(.system(size: 15))
                if expanded {
                    Text("Notifications")
                        .font(.system(size: 12.5, weight: .medium))
                        .lineLimit(1)
                    Spacer(minLength: 0)
                }
            }
            .foregroundStyle(Palette.textMuted)
            .padding(.leading, expanded ? 11 : 0)
            .frame(height: 38)
            .frame(maxWidth: expanded ? .infinity : 40)
        }
        .buttonStyle(.plain)
    }

    private var collapseButton: some View {
        Button(action: onCollapseToggle) {
            Image(systemName: expanded ? "chevron.left" : "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Palette.textMuted)
                .frame(width: 30, height: 30)
                .background(Circle().fill(Color.white.opacity(0.06)))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Status pill (still used standalone by SettingsView)

struct StatusPill: View {
    let status: ConnStatus

    private var connState: Palette.ConnState {
        switch status {
        case .connected: return .connected
        case .connecting: return .connecting
        case .disconnected: return .disconnected
        }
    }

    private var label: String {
        switch status {
        case .connected: return "Connected"
        case .connecting: return "Connecting"
        case .disconnected: return "Offline"
        }
    }

    var body: some View {
        let colors = Palette.status(connState)
        VStack(spacing: 4) {
            Circle()
                .fill(colors.accent)
                .frame(width: 8, height: 8)
                .shadow(color: colors.accent, radius: 6)
            Text(label).font(.system(size: 9)).foregroundStyle(Palette.textDim)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .floatingGlass(cornerRadius: 999, tint: colors.fill)
    }
}
