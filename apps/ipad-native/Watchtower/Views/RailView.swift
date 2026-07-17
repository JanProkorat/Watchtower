import SwiftUI
import ComposableArchitecture
import WatchtowerCore
import WatchtowerBridge

struct RailView: View {
    let store: StoreOf<IPadAppFeature>

    var body: some View {
        VStack(spacing: 6) {
            ForEach(IPadAppFeature.Module.allCases, id: \.self) { module in
                railButton(module)
            }
            Spacer()
            StatusPill(status: store.connStatus)
                .padding(.bottom, 16)
        }
        .padding(.top, 24)
        .frame(width: 88)
        .background(Color.white.opacity(0.03))
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
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(selected ? Color.white.opacity(0.08) : .clear)
            )
        }
        .buttonStyle(.plain)
    }
}

struct StatusPill: View {
    let status: ConnStatus

    private var color: Color {
        switch status {
        case .connected: return .green
        case .connecting: return .yellow
        case .disconnected: return .red
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
        VStack(spacing: 4) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(label).font(.system(size: 9)).foregroundStyle(Palette.textDim)
        }
    }
}
