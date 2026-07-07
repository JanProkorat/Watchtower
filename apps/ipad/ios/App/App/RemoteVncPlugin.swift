import Foundation
import Capacitor

@objc(RemoteVncPlugin)
public class RemoteVncPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RemoteVncPlugin"
    public let jsName = "RemoteVnc"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "present", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnect", returnType: CAPPluginReturnPromise),
    ]

    private var vc: VncViewController?

    @objc func present(_ call: CAPPluginCall) {
        guard let host = call.getString("host"), !host.isEmpty else {
            call.reject("host is required"); return
        }
        let username = call.getString("username") ?? ""
        let password = call.getString("password") ?? ""
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let vc = VncViewController()
            vc.host = host; vc.username = username; vc.password = password
            vc.modalPresentationStyle = .fullScreen
            vc.onState = { [weak self] status in self?.notifyListeners("state", data: ["status": status]) }
            vc.onAuthFailed = { [weak self] in self?.notifyListeners("authFailed", data: [:]) }
            vc.onClosed = { [weak self] in
                self?.notifyListeners("closed", data: [:]); self?.vc = nil
            }
            self.vc = vc
            self.bridge?.viewController?.present(vc, animated: true) { call.resolve() }
        }
    }

    @objc func disconnect(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.vc?.teardownAndDismiss()
            self?.vc = nil
            call.resolve()
        }
    }
}
