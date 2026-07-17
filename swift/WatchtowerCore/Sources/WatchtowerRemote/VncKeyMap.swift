import Foundation

/// Special (non-printable) keys the VNC screen maps to X11 keysyms.
public enum VncSpecialKey: Equatable, Sendable {
    case returnKey, backspace, tab, escape, left, up, right, down
}

/// X11 keysym mapping for RFB key events. Returns raw UInt32 keysyms; the app-target
/// VncViewController wraps them in RoyalVNCKit's VNCKeyCode. Port of VncKeyMap in
/// apps/ipad/ios/App/App/VncViewController.swift.
public enum VncKeyMap {
    public static func keysym(for special: VncSpecialKey) -> UInt32 {
        switch special {
        case .returnKey: return 0xFF0D
        case .backspace: return 0xFF08
        case .tab: return 0xFF09
        case .escape: return 0xFF1B
        case .left: return 0xFF51
        case .up: return 0xFF52
        case .right: return 0xFF53
        case .down: return 0xFF54
        }
    }

    /// Printable Latin-1 range maps 1:1 to its keysym (code point). Anything else → nil.
    public static func keysym(forScalar scalar: Unicode.Scalar) -> UInt32? {
        let v = scalar.value
        guard v >= 0x20 && v <= 0xFF else { return nil }
        return v
    }
}
