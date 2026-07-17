import Foundation
import SwiftTerm
import ComposableArchitecture
import WatchtowerBridge

/// Bridges a SwiftTerm TerminalView to a WatchtowerBridge TerminalSession.
/// feed ← ptyData (snapshot replay + live); send → ptyWrite; sizeChanged → ptyResize.
@MainActor
final class TerminalController: NSObject, TerminalSink, TerminalViewDelegate {
    let terminalView: TerminalView
    private let instanceId: String
    private let bridge: BridgeClient
    private var session: TerminalSession?

    init(instanceId: String, bridge: BridgeClient) {
        self.terminalView = TerminalView(frame: .zero)
        self.instanceId = instanceId
        self.bridge = bridge
        super.init()
        terminalView.terminalDelegate = self
    }

    func startIfNeeded() {
        guard session == nil else { return }
        let session = TerminalSession(bridge: bridge, instanceId: instanceId)
        self.session = session
        Task { await session.start(sink: self) }
    }

    func stop() { let s = session; session = nil; Task { await s?.stop() } }

    // MARK: TerminalSink (feed is thread-safe; SwiftTerm hops its own redraw to main)
    nonisolated func write(_ text: String) { terminalView.feed(text: text) }
    nonisolated func clear() { terminalView.feed(text: "\u{1b}c") } // RIS full reset before replay

    // MARK: TerminalViewDelegate
    nonisolated func send(source: TerminalView, data: ArraySlice<UInt8>) {
        let s = String(decoding: data, as: UTF8.self)
        Task { _ = try? await bridge.invoke(PtyWriteRequest(instanceId: instanceId, data: s)) }
    }
    nonisolated func sizeChanged(source: TerminalView, newCols: Int, newRows: Int) {
        Task { _ = try? await bridge.invoke(PtyResizeRequest(instanceId: instanceId, cols: newCols, rows: newRows)) }
    }
    func focus() { Task { _ = try? await bridge.invoke(TerminalFocusRequest(instanceId: instanceId)) } }

    // Unused delegate methods (11-method protocol in SwiftTerm 1.14.0)
    nonisolated func setTerminalTitle(source: TerminalView, title: String) {}
    nonisolated func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
    nonisolated func scrolled(source: TerminalView, position: Double) {}
    nonisolated func requestOpenLink(source: TerminalView, link: String, params: [String: String]) {}
    nonisolated func bell(source: TerminalView) {}
    nonisolated func clipboardCopy(source: TerminalView, content: Data) {}
    nonisolated func clipboardRead(source: TerminalView) -> Data? { nil }
    nonisolated func iTermContent(source: TerminalView, content: ArraySlice<UInt8>) {}
    nonisolated func rangeChanged(source: TerminalView, startY: Int, endY: Int) {}
}
