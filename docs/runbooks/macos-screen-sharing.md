# macOS Screen Sharing setup for Watchtower Remote Mac

1. **System Settings → General → Sharing → Screen Sharing → ON**.

2. **Screen Sharing → (i) → Computer Settings** → enable **"VNC viewers may
   control screen with password"** and set a password.
   **The password must be ≤ 8 characters** — macOS truncates longer VNC
   passwords (RFB DES key limit), so a longer one will silently fail auth.

3. **Privacy & Security → grant Screen Recording permission** if prompted.

4. Confirm TCP **5900** is reachable on the LAN (firewall allow).

5. In the iPad app's connection form, enter this password in
   **"heslo pro sdílení obrazovky"**. The orchestrator relay reaches the Mac at
   `127.0.0.1:5900`; the iPad only needs the existing host/port/token + this
   password.
