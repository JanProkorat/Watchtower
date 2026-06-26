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
                break
            }
        }
        conn.start(queue: .global(qos: .userInitiated))
    }
}
