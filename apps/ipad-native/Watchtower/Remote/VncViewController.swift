import UIKit
import RoyalVNCKit
import WatchtowerRemote

/// Full-screen native VNC screen. Owns the RoyalVNC connection, renders the
/// framebuffer, and translates iOS touch/keyboard input into RFB input events.
/// Lifecycle is reported to the presenting view (Task 6's RemoteView) through
/// the closures below.
final class VncViewController: UIViewController, VNCConnectionDelegate {
    // Injected by the presenting view.
    var host = ""
    var username = ""
    var password = ""
    var onState: ((VncStatus) -> Void)?
    var onAuthFailed: (() -> Void)?
    var onClosed: (() -> Void)?

    private let imageView = UIImageView()
    private let statusLabel = PaddedLabel()
    private let backButton = UIButton(type: .system)
    private let keyboardCatcher = UITextField()

    private var connection: VNCConnection?
    private var fbSize: CGSize = .zero
    private var pointerDown = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        setupUI()
        connect()
    }

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }

    private func setupUI() {
        imageView.contentMode = .scaleAspectFit
        imageView.backgroundColor = .black
        imageView.isUserInteractionEnabled = true
        imageView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(imageView)

        // Hidden text field: becomes first responder to summon the iOS soft
        // keyboard and to receive hardware key presses (pressesBegan/Ended).
        keyboardCatcher.autocorrectionType = .no
        keyboardCatcher.autocapitalizationType = .none
        keyboardCatcher.spellCheckingType = .no
        keyboardCatcher.inputAssistantItem.leadingBarButtonGroups = []
        keyboardCatcher.inputAssistantItem.trailingBarButtonGroups = []
        keyboardCatcher.frame = .zero
        keyboardCatcher.delegate = self
        view.addSubview(keyboardCatcher)

        statusLabel.textColor = .white
        statusLabel.font = .systemFont(ofSize: 14, weight: .semibold)
        statusLabel.backgroundColor = UIColor(white: 0.08, alpha: 0.82)
        statusLabel.layer.cornerRadius = 14
        statusLabel.layer.masksToBounds = true
        statusLabel.textAlignment = .center
        statusLabel.text = "Connecting to Mac screen…"
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(statusLabel)

        backButton.setTitle("‹ Back", for: .normal)
        backButton.setTitleColor(.white, for: .normal)
        backButton.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
        backButton.backgroundColor = UIColor(white: 0.08, alpha: 0.82)
        backButton.layer.cornerRadius = 12
        backButton.contentEdgeInsets = UIEdgeInsets(top: 8, left: 14, bottom: 8, right: 14)
        backButton.addTarget(self, action: #selector(backTapped), for: .touchUpInside)
        backButton.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(backButton)

        let keyboardButton = UIButton(type: .system)
        keyboardButton.setTitle("⌨", for: .normal)
        keyboardButton.setTitleColor(.white, for: .normal)
        keyboardButton.titleLabel?.font = .systemFont(ofSize: 20)
        keyboardButton.backgroundColor = UIColor(white: 0.08, alpha: 0.82)
        keyboardButton.layer.cornerRadius = 12
        keyboardButton.contentEdgeInsets = UIEdgeInsets(top: 6, left: 12, bottom: 6, right: 12)
        keyboardButton.addTarget(self, action: #selector(toggleKeyboard), for: .touchUpInside)
        keyboardButton.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(keyboardButton)

        NSLayoutConstraint.activate([
            imageView.topAnchor.constraint(equalTo: view.topAnchor),
            imageView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            imageView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            imageView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            statusLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            statusLabel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            statusLabel.heightAnchor.constraint(equalToConstant: 40),
            backButton.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            backButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            keyboardButton.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            keyboardButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
        ])

        addGestures()
    }

    private func addGestures() {
        let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
        imageView.addGestureRecognizer(tap)

        let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
        pan.maximumNumberOfTouches = 1
        imageView.addGestureRecognizer(pan)

        let twoFingerPan = UIPanGestureRecognizer(target: self, action: #selector(handleScroll(_:)))
        twoFingerPan.minimumNumberOfTouches = 2
        twoFingerPan.maximumNumberOfTouches = 2
        // Opt into indirect scroll events so a Magic Keyboard trackpad / mouse
        // wheel two-finger scroll (delivered with 0 touches, not as a 2-finger
        // touch pan) also drives handleScroll. Direct 2-finger touch still works.
        if #available(iOS 13.4, *) { twoFingerPan.allowedScrollTypesMask = .all }
        imageView.addGestureRecognizer(twoFingerPan)
        // Without this the single-finger pan grabs the first finger of a
        // two-finger gesture and scroll never begins. Make the 1-finger pan
        // wait for the 2-finger pan to fail (fast when only one finger is down).
        pan.require(toFail: twoFingerPan)

        let longPress = UILongPressGestureRecognizer(target: self, action: #selector(handleLongPress(_:)))
        imageView.addGestureRecognizer(longPress)
    }

    func connect() {
        connection?.disconnect()
        let settings = VNCConnection.Settings(
            isDebugLoggingEnabled: false,
            hostname: host,
            port: 5900,
            isShared: true,
            isScalingEnabled: false,
            useDisplayLink: false,
            // NOT .none — RoyalVNCKit gates the ENTIRE input-send path
            // (mouse buttons, move, wheel, keys) behind `inputMode != .none`
            // (VNCConnection+Queue.swift). We send our own events from the
            // gestures/keyboard here, so any non-.none mode works; this is the
            // library default and needs no macOS accessibility permissions.
            inputMode: .forwardKeyboardShortcutsIfNotInUseLocally,
            isClipboardRedirectionEnabled: false,
            colorDepth: .depth24Bit,
            frameEncodings: VNCFrameEncodingType.defaultFrameEncodings
        )
        let conn = VNCConnection(settings: settings, logger: VNCPrintLogger())
        conn.delegate = self
        connection = conn
        onState?(.connecting)
        conn.connect()
    }

    /// Disconnect the VNC session, dismiss the VC, and notify the caller via
    /// onClosed. Used by both the back button and a host-initiated teardown().
    func teardown() {
        stopMomentum()
        connection?.disconnect()
        connection = nil
        dismiss(animated: true) { [weak self] in self?.onClosed?() }
    }

    @objc private func backTapped() {
        teardown()
    }

    @objc private func toggleKeyboard() {
        if keyboardCatcher.isFirstResponder { keyboardCatcher.resignFirstResponder() }
        else { keyboardCatcher.becomeFirstResponder() }
    }

    // MARK: - Coordinate mapping (aspect-fit letterbox aware)
    private func framebufferPoint(from p: CGPoint) -> (UInt16, UInt16)? {
        guard fbSize != .zero, imageView.bounds.width > 0, imageView.bounds.height > 0 else { return nil }
        let viewSize = imageView.bounds.size
        let scale = min(viewSize.width / fbSize.width, viewSize.height / fbSize.height)
        let drawW = fbSize.width * scale
        let drawH = fbSize.height * scale
        let offX = (viewSize.width - drawW) / 2
        let offY = (viewSize.height - drawH) / 2
        let fx = (p.x - offX) / scale
        let fy = (p.y - offY) / scale
        let x = UInt16(max(0, min(fbSize.width - 1, fx)))
        let y = UInt16(max(0, min(fbSize.height - 1, fy)))
        return (x, y)
    }

    @objc private func handleTap(_ gr: UITapGestureRecognizer) {
        stopMomentum() // a tap halts a coasting flick, like iOS
        guard let conn = connection, let (x, y) = framebufferPoint(from: gr.location(in: imageView)) else { return }
        conn.mouseButtonDown(.left, x: x, y: y)
        conn.mouseButtonUp(.left, x: x, y: y)
    }

    @objc private func handlePan(_ gr: UIPanGestureRecognizer) {
        guard let conn = connection, let (x, y) = framebufferPoint(from: gr.location(in: imageView)) else { return }
        switch gr.state {
        case .began:
            stopMomentum() // a new drag halts a coasting flick
            conn.mouseButtonDown(.left, x: x, y: y); pointerDown = true
        case .changed:
            // RoyalVNCKit exposes an explicit pointer-move: keep the (already
            // pressed) left button down and just move the cursor while dragging.
            if pointerDown { conn.mouseMove(x: x, y: y) }
        case .ended, .cancelled, .failed:
            conn.mouseButtonUp(.left, x: x, y: y); pointerDown = false
        default: break
        }
    }

    // Finger/scroll travel (points) per discrete wheel click. Smaller = more
    // sensitive (more clicks per drag).
    private let wheelStepPx: CGFloat = 3
    // Unconsumed scroll distance carried between callbacks (no motion lost).
    // Shared by live dragging and the momentum coast so they're continuous.
    private var scrollAccumulator: CGFloat = 0

    @objc private func handleScroll(_ gr: UIPanGestureRecognizer) {
        guard let conn = connection, let (x, y) = framebufferPoint(from: gr.location(in: imageView)) else { return }
        switch gr.state {
        case .began:
            stopMomentum() // a fresh scroll cancels any coasting flick (iOS behaviour)
            scrollAccumulator = 0
        case .changed:
            // Accumulate the incremental delta since the last callback and emit as
            // many wheel clicks as fit, keeping the sub-step remainder so fast
            // swipes scroll proportionally instead of losing motion. Natural-scroll
            // direction: drag down (dy>0) = content down = wheel up.
            scrollAccumulator += gr.translation(in: imageView).y
            gr.setTranslation(.zero, in: imageView)
            flushWheel(at: x, y, on: conn)
        case .ended:
            // Hand off to an inertial coast so a flick keeps scrolling and decays,
            // like iOS — RFB has no momentum, so we emulate it (see #160).
            startMomentum(velocity: gr.velocity(in: imageView).y, at: (x, y))
        case .cancelled, .failed:
            stopMomentum()
        default:
            break
        }
    }

    /// Convert the accumulated point-travel into discrete RFB wheel clicks at
    /// (x, y), keeping the sub-step remainder in `scrollAccumulator`. Shared by
    /// the live drag and the momentum coast (RoyalVNCKit loops `steps` clicks).
    private func flushWheel(at x: UInt16, _ y: UInt16, on conn: VNCConnection) {
        let raw = Int(scrollAccumulator / wheelStepPx)
        guard raw != 0 else { return }
        scrollAccumulator -= CGFloat(raw) * wheelStepPx
        let wheel: VNCMouseWheel = raw > 0 ? .up : .down
        let steps = min(abs(raw), 12) // cap a single burst
        conn.mouseWheel(wheel, x: x, y: y, steps: UInt32(steps))
    }

    // --- Inertial (momentum) scroll -----------------------------------------
    // RFB has no pixel/momentum scroll, so a flick is emulated: capture the pan
    // velocity at release and emit a decaying train of wheel clicks on a display
    // link until it dies out. Any new touch cancels the coast.
    private var momentumLink: CADisplayLink?
    private var momentumVelocity: CGFloat = 0          // points/sec (imageView space)
    private var momentumAnchor: (UInt16, UInt16)?      // framebuffer point to scroll at
    private let momentumMinStart: CGFloat = 120        // below this a release doesn't coast
    private let momentumMinStop: CGFloat = 16          // coast ends once velocity decays past this
    private let momentumDecayPerSec: Double = 0.05     // fraction of velocity retained after 1s

    private func startMomentum(velocity: CGFloat, at anchor: (UInt16, UInt16)) {
        stopMomentum()
        guard abs(velocity) >= momentumMinStart else { return }
        momentumVelocity = velocity
        momentumAnchor = anchor
        let link = CADisplayLink(target: self, selector: #selector(momentumTick(_:)))
        link.add(to: .main, forMode: .common)
        momentumLink = link
    }

    private func stopMomentum() {
        momentumLink?.invalidate()
        momentumLink = nil
        momentumVelocity = 0
        momentumAnchor = nil
    }

    @objc private func momentumTick(_ link: CADisplayLink) {
        guard let conn = connection, let (x, y) = momentumAnchor else { stopMomentum(); return }
        let dt = link.targetTimestamp - link.timestamp        // seconds to the next frame
        scrollAccumulator += momentumVelocity * CGFloat(dt)    // this frame's travel
        flushWheel(at: x, y, on: conn)
        momentumVelocity *= CGFloat(pow(momentumDecayPerSec, dt)) // frame-rate-independent decay
        if abs(momentumVelocity) < momentumMinStop { stopMomentum() }
    }

    @objc private func handleLongPress(_ gr: UILongPressGestureRecognizer) {
        guard gr.state == .began, let conn = connection,
              let (x, y) = framebufferPoint(from: gr.location(in: imageView)) else { return }
        conn.mouseButtonDown(.right, x: x, y: y)
        conn.mouseButtonUp(.right, x: x, y: y)
    }

    // MARK: - Rendering
    private func render(_ framebuffer: VNCFramebuffer) {
        guard let cg = framebuffer.cgImage else { return }
        let img = UIImage(cgImage: cg)
        DispatchQueue.main.async {
            self.fbSize = CGSize(width: Int(framebuffer.size.width), height: Int(framebuffer.size.height))
            self.imageView.image = img
        }
    }

    // MARK: - Keyboard → keysym
    override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        if !sendPresses(presses, down: true) { super.pressesBegan(presses, with: event) }
    }
    override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        if !sendPresses(presses, down: false) { super.pressesEnded(presses, with: event) }
    }
    private func sendPresses(_ presses: Set<UIPress>, down: Bool) -> Bool {
        // UIPress.key / UIKey is iOS 13.4+. On older systems the hidden text
        // field's UITextFieldDelegate path still delivers soft-keyboard input.
        guard #available(iOS 13.4, *) else { return false }
        guard let conn = connection else { return false }
        var handled = false
        for press in presses {
            guard let key = press.key else { continue }
            if let code = vncKeyCode(for: key) {
                if down { conn.keyDown(code) } else { conn.keyUp(code) }
                handled = true
            }
        }
        return handled
    }

    // Maps a hardware UIKey to a RoyalVNC key code: special (non-printable)
    // keys go through WatchtowerRemote's VncSpecialKey table, everything else
    // falls through to the scalar → X11-keysym mapping.
    @available(iOS 13.4, *)
    private func vncKeyCode(for key: UIKey) -> VNCKeyCode? {
        let special: VncSpecialKey?
        switch key.keyCode {
        case .keyboardReturnOrEnter: special = .returnKey
        case .keyboardDeleteOrBackspace: special = .backspace
        case .keyboardTab: special = .tab
        case .keyboardEscape: special = .escape
        case .keyboardLeftArrow: special = .left
        case .keyboardUpArrow: special = .up
        case .keyboardRightArrow: special = .right
        case .keyboardDownArrow: special = .down
        default: special = nil
        }
        if let special {
            return VNCKeyCode(VncKeyMap.keysym(for: special))
        }
        if !key.characters.isEmpty, let scalar = key.characters.unicodeScalars.first,
           let keysym = VncKeyMap.keysym(forScalar: scalar) {
            return VNCKeyCode(keysym)
        }
        return nil
    }

    // MARK: - VNCConnectionDelegate
    func connection(_ connection: VNCConnection, stateDidChange state: VNCConnection.ConnectionState) {
        DispatchQueue.main.async {
            switch state.status {
            case .connecting:
                self.onState?(.connecting); self.statusLabel.text = "Connecting to Mac screen…"; self.statusLabel.isHidden = false
            case .connected:
                self.onState?(.connected); self.statusLabel.isHidden = true
            case .disconnecting:
                self.onState?(.connecting); self.statusLabel.text = "Disconnecting…"; self.statusLabel.isHidden = false
            case .disconnected:
                // RoyalVNCKit has no dedicated auth-failed delegate hook; a
                // rejected credential surfaces as a VNCError.authentication on
                // the disconnected state's `error`.
                let isAuthError = (state.error as? VNCError)?.isAuthenticationError ?? false
                if isAuthError {
                    self.onAuthFailed?()
                    self.dismiss(animated: true) { [weak self] in self?.onClosed?() }
                } else {
                    self.onState?(.disconnected); self.statusLabel.text = "Disconnected – check Screen Sharing on the Mac"; self.statusLabel.isHidden = false
                }
            @unknown default:
                break
            }
        }
    }

    func connection(_ connection: VNCConnection, credentialFor authenticationType: VNCAuthenticationType,
                    completion: @escaping (VNCCredential?) -> Void) {
        if authenticationType.requiresUsername {
            completion(VNCUsernamePasswordCredential(username: username, password: password))
        } else {
            completion(VNCPasswordCredential(password: password))
        }
    }

    func connection(_ connection: VNCConnection, didCreateFramebuffer framebuffer: VNCFramebuffer) { render(framebuffer) }
    func connection(_ connection: VNCConnection, didResizeFramebuffer framebuffer: VNCFramebuffer) { render(framebuffer) }
    func connection(_ connection: VNCConnection, didUpdateFramebuffer framebuffer: VNCFramebuffer,
                    x: UInt16, y: UInt16, width: UInt16, height: UInt16) { render(framebuffer) }
    func connection(_ connection: VNCConnection, didUpdateCursor cursor: VNCCursor) { }
}

extension VncViewController: UITextFieldDelegate {
    // Route soft-keyboard characters into RFB when there are no hardware presses.
    func textField(_ textField: UITextField, shouldChangeCharactersIn range: NSRange, replacementString string: String) -> Bool {
        guard let conn = connection else { return false }
        if string.isEmpty {
            // Backspace
            let bs = VNCKeyCode(VncKeyMap.keysym(for: .backspace))
            conn.keyDown(bs); conn.keyUp(bs)
        } else {
            for scalar in string.unicodeScalars {
                if let keysym = VncKeyMap.keysym(forScalar: scalar) {
                    let code = VNCKeyCode(keysym)
                    conn.keyDown(code); conn.keyUp(code)
                }
            }
        }
        return false // never mutate the hidden field's text
    }
}

/// UILabel with content insets, for the status pill.
final class PaddedLabel: UILabel {
    override func drawText(in rect: CGRect) { super.drawText(in: rect.insetBy(dx: 16, dy: 0)) }
    override var intrinsicContentSize: CGSize {
        let s = super.intrinsicContentSize; return CGSize(width: s.width + 32, height: s.height)
    }
}
