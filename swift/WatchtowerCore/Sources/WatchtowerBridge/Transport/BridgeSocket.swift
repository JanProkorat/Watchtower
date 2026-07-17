import Foundation

public enum BridgeSocketEvent: Equatable, Sendable {
    case opened
    case text(String)
    case closed
}

/// Minimal socket seam so BridgeConnection is testable with a scripted fake.
/// Contract: `events` yields `.opened` at most once when the socket connects,
/// `.text` per received message, and `.closed` EXACTLY once when the socket
/// dies — a failed connect and a live-connection drop both end in one
/// `.closed` (mirrors the signalClose dedupe in webSocketTransport.ts).
public protocol BridgeSocket: Sendable {
    var events: AsyncStream<BridgeSocketEvent> { get }
    func send(_ text: String) async throws
    func close()
}

public typealias BridgeSocketFactory = @Sendable (URL) -> any BridgeSocket

/// Live implementation over URLSessionWebSocketTask.
public final class URLSessionSocket: NSObject, BridgeSocket, @unchecked Sendable {
    public let events: AsyncStream<BridgeSocketEvent>
    private let continuation: AsyncStream<BridgeSocketEvent>.Continuation
    private var session: URLSession!
    private var task: URLSessionWebSocketTask!
    private let lock = NSLock()
    private var closedOnce = false

    public init(url: URL) {
        (events, continuation) = AsyncStream<BridgeSocketEvent>.makeStream()
        super.init()
        session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        task = session.webSocketTask(with: url)
        task.resume()
        receiveLoop()
    }

    private func receiveLoop() {
        task.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case let .success(message):
                if case let .string(text) = message {
                    self.continuation.yield(.text(text))
                }
                self.receiveLoop()
            case .failure:
                self.signalClosed()
            }
        }
    }

    /// Emit `.closed` exactly once no matter how many paths report death
    /// (receive failure, delegate didClose, didCompleteWithError, local close).
    private func signalClosed() {
        lock.lock()
        let already = closedOnce
        closedOnce = true
        lock.unlock()
        guard !already else { return }
        continuation.yield(.closed)
        continuation.finish()
        session.finishTasksAndInvalidate()
    }

    public func send(_ text: String) async throws {
        try await task.send(.string(text))
    }

    public func close() {
        task.cancel(with: .normalClosure, reason: nil)
        signalClosed()
    }
}

extension URLSessionSocket: URLSessionWebSocketDelegate {
    public func urlSession(
        _ session: URLSession, webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        continuation.yield(.opened)
    }

    public func urlSession(
        _ session: URLSession, webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?
    ) {
        signalClosed()
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        // Fires for failed connects (which never get didOpen/didClose) —
        // the equivalent of the TS pre-open `error` → close mapping.
        signalClosed()
    }
}
