# macOS Screen Sharing setup for Watchtower Remote Mac

The iPad authenticates with **Apple authentication** (RFB security type 30)
using your **macOS account** username + password. macOS Screen Sharing
advertises Apple auth ahead of the legacy standalone "VNC password" (type 2) —
so the macOS account is what's used. (The legacy ≤8-char VNC password is *not*
needed.)

1. **System Settings → General → Sharing → Screen Sharing → ON**.

2. **Screen Sharing → (i)** → under **"Allow access for"**, make sure your
   macOS user account is permitted (e.g. "Only these users" includes you, or
   "All users"). That account's login is what you'll enter on the iPad.

3. **Privacy & Security → grant Screen Recording permission** if prompted.

4. Confirm TCP **5900** is reachable from the iPad — over the LAN, or over
   Tailscale (the Mac's `100.x` address). Quick check from a terminal on the
   Mac: `nc -z 127.0.0.1 5900 && echo OPEN`.

5. On the iPad, open **Vzdálený Mac**. The first time, it prompts for your
   **macOS account username + password** (stored on the device, in Capacitor
   Preferences). The native RoyalVNC client connects directly to
   `<connection host>:5900`; there is no separate VNC token.

> **Security note:** because Apple auth uses the macOS *account* password, that
> credential lives on the iPad. Treat the device accordingly. Access is gated
> by tailnet membership + the macOS password; there is no separate VNC token.

---

## Native RoyalVNC client (#86)

The iPad app now renders Screen Sharing with a native RoyalVNC client that
connects **directly over TCP to the Mac at `<connection host>:5900`** (no
orchestrator relay). Requirements:

1. System Settings → General → Sharing → **Screen Sharing → ON**.
2. Screen Sharing → (i) → allow access for your macOS user; the iPad logs in
   with your **macOS account short name + login password** (Apple RFB type-30).
   The legacy "VNC viewers may control screen with password" (≤8-char) path is
   NOT used.
3. Port **5900** must be reachable from the iPad — over the LAN, or over
   Tailscale (the Mac's `100.x` address). Access is gated by tailnet membership
   + the macOS password; there is no separate VNC token.
4. In the app: Rail → "Vzdálený Mac" (or the auth-block "Otevřít obrazovku
   Macu" handoff) → enter the macOS short name + password once (stored on
   device). The native full-screen VNC view opens; "‹ Zpět" returns to the app.
