import SwiftUI
import ComposableArchitecture
import WatchtowerCore
import WatchtowerBridge

struct RailView: View {
    let store: StoreOf<IPadAppFeature>

    var body: some View {
        GlassEffectContainer(spacing: 10) {
            VStack(spacing: 6) {
                ForEach(IPadAppFeature.Module.allCases, id: \.self) { module in
                    railButton(module)
                }
                Spacer()
                StatusPill(status: store.connStatus)
                    .padding(.bottom, 16)
            }
            .padding(.top, 24)
        }
        .frame(width: 88)
        .padding(.leading, 12)
        .padding(.vertical, 16)
    }

    private func railButton(_ module: IPadAppFeature.Module) -> some View {
        let selected = store.selectedModule == module
        return Button {
            store.send(.moduleSelected(module))
        } label: {
            VStack(spacing: 4) {
                Image(systemName: module.systemImage)
                    .font(.system(size: 20, weight: .medium))
                Text(module.title)
                    .font(.system(size: 10, weight: .medium))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .foregroundStyle(selected ? Palette.accent : Palette.textMuted)
            .frame(width: 72, height: 56)
            .floatingGlass(cornerRadius: 14, tint: selected ? Palette.accentWash : nil)
        }
        .buttonStyle(.plain)
    }
}

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
