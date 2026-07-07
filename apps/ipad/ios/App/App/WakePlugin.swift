import Foundation
import Capacitor
import Network

// Custom Capacitor plugin: fire one UDP datagram (the WoL magic packet) to
// host:port. Unicast only — no broadcast, so no multicast entitlement.
// jsName "Wake" matches registerPlugin<WakePlugin>('Wake') on the JS side.
@objc(WakePlugin)
public class WakePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WakePlugin"
    public let jsName = "Wake"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "wake", returnType: CAPPluginReturnPromise)
    ]

    @objc func wake(_ call: CAPPluginCall) {
        guard let b64 = call.getString("payloadBase64"),
              let hostStr = call.getString("host"),
              let portInt = call.getInt("port"),
              portInt > 0, portInt <= 65535,
              let data = Data(base64Encoded: b64),
              let port = NWEndpoint.Port(rawValue: UInt16(portInt)) else {
            call.reject("Invalid wake arguments")
            return
        }

        // Serial queue for both the connection callbacks and the timeout, so
        // every path that touches `finished` runs on one thread — no lock needed.
        let queue = DispatchQueue(label: "cz.watchtower.wake")
        let conn = NWConnection(host: NWEndpoint.Host(hostStr), port: port, using: .udp)
        var finished = false
        let finish: (Error?) -> Void = { err in
            if finished { return }
            finished = true
            if let err = err { call.reject("wake send failed: \(err)") } else { call.resolve() }
            conn.cancel()
        }

        conn.stateUpdateHandler = { state in
            switch state {
            case .ready:
                conn.send(content: data, completion: .contentProcessed { err in finish(err) })
            case .failed(let err):
                finish(err)
            case .cancelled:
                break
            default:
                // .waiting/.preparing/.setup: nothing to do here — the timeout
                // below is the backstop. A UDP connection with no route to the
                // target (e.g. an off-network DDNS host) can sit in .waiting
                // indefinitely; without the timeout the JS promise never settled.
                break
            }
        }
        conn.start(queue: queue)

        // Backstop: guarantee the promise settles even if the connection never
        // reaches .ready or .failed (stuck .waiting, stalled DNS). Fire-and-forget
        // WoL has nothing to retry, so failing fast is the right outcome.
        queue.asyncAfter(deadline: .now() + wakeTimeoutSeconds) {
            finish(NSError(domain: "WakePlugin", code: -1,
                           userInfo: [NSLocalizedDescriptionKey: "wake timed out after \(Int(wakeTimeoutSeconds))s"]))
        }
    }
}

// Enough for DNS resolution of a DDNS host on the away path, short enough that
// the "Probudit Mac" button never hangs on "sending".
private let wakeTimeoutSeconds: TimeInterval = 5
