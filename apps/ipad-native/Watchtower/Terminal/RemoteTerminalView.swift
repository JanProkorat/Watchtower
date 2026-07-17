import SwiftUI
import SwiftTerm
import ComposableArchitecture
import WatchtowerBridge

/// SwiftUI wrapper around a SwiftTerm TerminalView, bridged to a remote
/// Watchtower instance's pty via TerminalController.
struct RemoteTerminalView: UIViewRepresentable {
    let instanceId: String
    @Dependency(\.bridge) var bridge

    func makeCoordinator() -> TerminalController {
        TerminalController(instanceId: instanceId, bridge: bridge)
    }

    func makeUIView(context: Context) -> TerminalView {
        let controller = context.coordinator
        controller.startIfNeeded()
        DispatchQueue.main.async {
            _ = controller.terminalView.becomeFirstResponder() // bring up keyboard + receive keys
            controller.focus()
        }
        return controller.terminalView
    }

    func updateUIView(_ uiView: TerminalView, context: Context) {}

    static func dismantleUIView(_ uiView: TerminalView, coordinator: TerminalController) {
        coordinator.stop()
    }
}
