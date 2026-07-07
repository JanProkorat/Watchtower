import UIKit
import RoyalVNCKit

// THROWAWAY SPIKE (#86) — proves RoyalVNC connects to the Mac's Screen Sharing
// over TCP with Apple (type-30) auth and renders a live framebuffer in a native
// iOS view. Not merged. Bypasses React/Capacitor entirely: this is the app's
// launch view controller on the spike branch.
final class SpikeVNCViewController: UIViewController, VNCConnectionDelegate {
    private let hostField = UITextField()
    private let userField = UITextField()
    private let passField = UITextField()
    private let connectButton = UIButton(type: .system)
    private let statusLabel = UILabel()
    private let imageView = UIImageView()

    private var connection: VNCConnection?
    private var fbSize: CGSize = .zero
    private var firstFrameLogged = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        setupUI()
    }

    private func setupUI() {
        imageView.contentMode = .scaleAspectFit
        imageView.backgroundColor = .darkGray
        imageView.isUserInteractionEnabled = true
        imageView.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(handleTap(_:))))

        for f in [hostField, userField, passField] {
            f.borderStyle = .roundedRect
            f.autocapitalizationType = .none
            f.autocorrectionType = .no
            f.backgroundColor = .white
        }
        hostField.text = "192.168.0.52"
        hostField.placeholder = "Mac IP"
        userField.placeholder = "macOS short name"
        passField.placeholder = "macOS password"
        passField.isSecureTextEntry = true

        connectButton.setTitle("Connect", for: .normal)
        connectButton.titleLabel?.font = .boldSystemFont(ofSize: 17)
        connectButton.addTarget(self, action: #selector(connectTapped), for: .touchUpInside)

        statusLabel.textColor = .white
        statusLabel.font = .systemFont(ofSize: 13)
        statusLabel.text = "idle"
        statusLabel.numberOfLines = 2

        let controls = UIStackView(arrangedSubviews: [hostField, userField, passField, connectButton, statusLabel])
        controls.axis = .vertical
        controls.spacing = 8
        controls.translatesAutoresizingMaskIntoConstraints = false
        imageView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(imageView)
        view.addSubview(controls)

        NSLayoutConstraint.activate([
            controls.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            controls.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            controls.widthAnchor.constraint(equalToConstant: 260),
            imageView.topAnchor.constraint(equalTo: controls.bottomAnchor, constant: 12),
            imageView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            imageView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            imageView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
    }

    @objc private func connectTapped() {
        connection?.disconnect()
        let host = (hostField.text ?? "").trimmingCharacters(in: .whitespaces)
        let settings = VNCConnection.Settings(
            isDebugLoggingEnabled: true,
            hostname: host,
            port: 5900,
            isShared: true,
            isScalingEnabled: false,
            useDisplayLink: false,
            inputMode: .none,
            isClipboardRedirectionEnabled: false,
            colorDepth: .depth24Bit,
            frameEncodings: VNCFrameEncodingType.defaultFrameEncodings
        )
        let conn = VNCConnection(settings: settings, logger: VNCPrintLogger())
        conn.delegate = self
        connection = conn
        firstFrameLogged = false
        statusLabel.text = "connecting → \(host):5900"
        conn.connect()
    }

    @objc private func handleTap(_ gr: UITapGestureRecognizer) {
        guard let conn = connection, fbSize != .zero else { return }
        let p = gr.location(in: imageView)
        // Approximate map (scaleToFill assumption) — precise aspect-fit mapping
        // is a full-build concern; this only gauges click round-trip latency.
        let x = UInt16(max(0, min(fbSize.width - 1, p.x / imageView.bounds.width * fbSize.width)))
        let y = UInt16(max(0, min(fbSize.height - 1, p.y / imageView.bounds.height * fbSize.height)))
        conn.mouseButtonDown(.left, x: x, y: y)
        conn.mouseButtonUp(.left, x: x, y: y)
    }

    private func render(_ framebuffer: VNCFramebuffer) {
        guard let cg = framebuffer.cgImage else { return }
        let img = UIImage(cgImage: cg)
        DispatchQueue.main.async {
            self.fbSize = CGSize(width: Int(framebuffer.size.width), height: Int(framebuffer.size.height))
            self.imageView.image = img
            if !self.firstFrameLogged {
                self.firstFrameLogged = true
                self.statusLabel.text = "rendering \(framebuffer.size.width)×\(framebuffer.size.height)"
            }
        }
    }

    // MARK: - VNCConnectionDelegate
    func connection(_ connection: VNCConnection, stateDidChange state: VNCConnection.ConnectionState) {
        DispatchQueue.main.async {
            switch state.status {
            case .connecting: self.statusLabel.text = "connecting…"
            case .connected: self.statusLabel.text = "connected"
            case .disconnecting: self.statusLabel.text = "disconnecting…"
            case .disconnected: self.statusLabel.text = "disconnected: \(state.error.map { String(describing: $0) } ?? "clean")"
            }
        }
    }

    func connection(_ connection: VNCConnection, credentialFor authenticationType: VNCAuthenticationType,
                    completion: @escaping ((any VNCCredential)?) -> Void) {
        let user = userField.text ?? ""
        let pass = passField.text ?? ""
        if authenticationType.requiresUsername {
            completion(VNCUsernamePasswordCredential(username: user, password: pass))
        } else {
            completion(VNCPasswordCredential(password: pass))
        }
    }

    func connection(_ connection: VNCConnection, didCreateFramebuffer framebuffer: VNCFramebuffer) { render(framebuffer) }
    func connection(_ connection: VNCConnection, didResizeFramebuffer framebuffer: VNCFramebuffer) { render(framebuffer) }
    func connection(_ connection: VNCConnection, didUpdateFramebuffer framebuffer: VNCFramebuffer,
                    x: UInt16, y: UInt16, width: UInt16, height: UInt16) { render(framebuffer) }
    func connection(_ connection: VNCConnection, didUpdateCursor cursor: VNCCursor) { }
}
