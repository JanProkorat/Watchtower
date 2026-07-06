# Wake-on-LAN setup for the iPad "Probudit Mac" button (#72)

Wakes a sleeping, wired Mac from the iPad. Unicast magic packet — no Apple
multicast entitlement needed.

## Build prerequisite (now committed — no manual Xcode step)
The native `WakePlugin.swift` lives at `apps/ipad/ios/App/App/WakePlugin.swift`.
`cap sync` does **not** add it to the App target, so historically the "Probudit
Mac" button appeared to work but sent nothing (the plugin wasn't compiled in).
As of #105 the file is **wired into `App.xcodeproj/project.pbxproj`** (build
file + file reference + App group + Sources phase), so it compiles into the App
target on a plain checkout — no manual drag needed. No entitlement, Podfile, or
AppDelegate change is needed; registration is automatic via `CAPBridgedPlugin`.

> If `cap sync` ever regenerates the project and drops the reference, re-add it:
> in Xcode drag `WakePlugin.swift` into the **App** group (target **App**
> checked), or restore the four `WakePlugin` entries in `project.pbxproj`.

## macOS (the Mac to wake)
1. Connect the Mac to the router by **wired Ethernet** (USB-C dock). Wi-Fi WoL
   is unreliable on Apple Silicon and unsupported by the router for WoL.
2. System Settings → Battery → Options → **"Wake for network access"** = on
   (Always, or "Only on power adapter" if docked).
3. Leave the Mac in normal (deep) sleep at home; keep it on the charger. An 80%
   charge cap + Optimized Battery Charging is fine.
4. Find the values you'll enter in the app:
   - **Ethernet MAC:** System Settings → Network → (your Ethernet/dock service)
     → Details → Hardware → MAC Address, or `ifconfig en<N> | grep ether`.
   - **LAN IP:** same Network panel (e.g. `192.168.1.50`). Reserve it as a
     static DHCP lease on the router so it doesn't change.

## Router — TP-Link Archer AX55 Pro (for the away case)
1. Set up **DDNS** (TP-Link DDNS or no-ip) → you get a hostname like
   `myhome.tplinkdns.com`.
2. Add a **UDP port-forward / virtual server** for the WoL port (e.g. external
   UDP `9` → the Mac's LAN IP `:9`), or use the router's built-in
   "Wake-on-LAN" tool if present. This is the only internet-exposed surface and
   it can do nothing but wake the machine.

## App (iPad connection form → "Probuzení")
- **MAC adresa:** the Ethernet MAC from above.
- **LAN IP Macu (doma):** the Mac's LAN IP — used when you're on home Wi-Fi.
- **DDNS host (mimo síť):** your DDNS hostname — used when you're away.
- **DDNS port:** the external UDP port you forwarded (default 9).
- Tap **Probudit Mac**. The first home wake triggers the iOS Local Network
  permission prompt — allow it. The button confirms "Paket odeslán"; it cannot
  confirm the Mac woke, so just wait for the connection to re-establish.

## Gotchas
- **No delivery confirmation:** WoL is fire-and-forget UDP; "Paket odeslán"
  means the packet left the iPad, nothing more.
- **Home unicast relies on the ARP entry:** the router must still map the
  sleeping Mac's MAC↔IP. On wired Ethernet with "Wake for network access" this
  is normally retained; if a long-sleep home wake fails, use the DDNS path
  (the router broadcasts internally) or reserve the static lease.
- **Sandbox vs reachability:** waking only brings the Mac up; the WS/Tailscale
  reconnect is handled separately (see `tailscale-reach.md`).
