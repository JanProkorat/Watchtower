import Foundation

/// Wire protocol for the orchestrator WebSocket bridge — a Swift port of
/// packages/shared/src/wsProtocol.ts. Frames are JSON text messages; payloads
/// stay raw `Data` here so the typed layer (BridgeRequest) decodes them.
public enum WsFrameError: Error, Equatable {
    case invalidFrame
}

public enum IncomingFrame: Equatable {
    case response(id: String, payload: Data?, error: String?)
    case push(kind: String, payload: Data?)
}

/// Splice an already-encoded JSON payload into a request frame.
public func composeRequestFrame(id: String, kind: String, payload: Data) throws -> String {
    let payloadObj = try JSONSerialization.jsonObject(with: payload, options: [.fragmentsAllowed])
    let frame: [String: Any] = ["id": id, "kind": kind, "payload": payloadObj]
    let data = try JSONSerialization.data(withJSONObject: frame)
    return String(decoding: data, as: UTF8.self)
}

public func decodeIncomingFrame(_ raw: String) throws -> IncomingFrame {
    guard let obj = (try? JSONSerialization.jsonObject(with: Data(raw.utf8))) as? [String: Any],
          let kind = obj["kind"] as? String
    else { throw WsFrameError.invalidFrame }
    let payload: Data? = obj["payload"].flatMap {
        try? JSONSerialization.data(withJSONObject: $0, options: [.fragmentsAllowed])
    }
    if obj["push"] as? Bool == true {
        return .push(kind: kind, payload: payload)
    }
    guard let id = obj["id"] as? String, !id.isEmpty else { throw WsFrameError.invalidFrame }
    return .response(id: id, payload: payload, error: obj["error"] as? String)
}
