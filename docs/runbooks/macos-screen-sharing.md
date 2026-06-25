# macOS Screen Sharing setup for Watchtower Remote Mac

The iPad's noVNC client authenticates with **Apple authentication** (RFB
security type 30) using your **macOS account** username + password. macOS
Screen Sharing advertises Apple auth ahead of the legacy standalone "VNC
password" (type 2), and noVNC selects the first type it supports — so the
macOS account is what's used. (The legacy ≤8-char VNC password is *not* needed.)

1. **System Settings → General → Sharing → Screen Sharing → ON**.

2. **Screen Sharing → (i)** → under **"Allow access for"**, make sure your
   macOS user account is permitted (e.g. "Only these users" includes you, or
   "All users"). That account's login is what you'll enter on the iPad.

3. **Privacy & Security → grant Screen Recording permission** if prompted.

4. Confirm TCP **5900** is reachable on the LAN (firewall allow). Quick check
   from a terminal: `nc -z 127.0.0.1 5900 && echo OPEN`.

5. On the iPad, open **Vzdálený Mac**. The first time, it prompts for your
   **macOS account username + password** (stored on the device, in Capacitor
   Preferences). The orchestrator relay reaches the Mac at `127.0.0.1:5900`;
   the iPad only needs the existing host/port/token plus these macOS
   credentials.

> **Security note:** because Apple auth uses the macOS *account* password, that
> credential lives on the iPad. Treat the device accordingly. (A future
> hardening option is an auth-injecting relay that keeps the credential on the
> Mac — see the design doc, §5.)
