# Wake-on-LAN setup for the iPad "Probudit Mac" button (#72)

Wakes a sleeping, wired Mac from the iPad. Unicast magic packet — no Apple
multicast entitlement needed.

## How the native plugin is wired (fixed in #105)
The "Probudit Mac" button was a **silent no-op from #72 until #105** for two
stacked reasons, both now fixed in the committed project:

1. **`WakePlugin.swift` wasn't in the App target.** `cap sync` does not add it,
   and the manual Xcode drag was never committed → it didn't compile in. Fixed
   by wiring the four entries (build file + file ref + App group + Sources
   phase) into `App.xcodeproj/project.pbxproj`.
2. **Capacitor 6 dropped automatic plugin registration.** Even once compiled,
   the bridge reported `"Wake" plugin is not implemented on ios`. Per the
   Capacitor 5→6 iOS migration guide, **app-local plugins (not npm packages)
   must be registered manually.** Fixed by `MainViewController.swift` — a
   `CAPBridgeViewController` subclass overriding `capacitorDidLoad()` to call
   `bridge?.registerPluginInstance(WakePlugin())` — and pointing `Main.storyboard`
   at it (`customClass=MainViewController`, module `App`).

> If `cap sync` regenerates the project and drops any of this: restore the
> `WakePlugin`/`MainViewController` entries in `project.pbxproj`, and re-set the
> storyboard's view-controller `customClass` to `MainViewController`. If the
> storyboard reverts to `CAPBridgeViewController`, the plugin silently stops
> registering again.

## Device-test result (#105) — send path proven, actual wake NOT viable here
Validated on device 2026-07-07 (iPad Pro M4 → MacBook Pro M1 Pro):
- ✅ **Send path works.** Tapping Probudit emits a correct 102-byte magic packet
  (`ff*6` + MAC*16) to the LAN IP on UDP/9 — confirmed with `tcpdump -i <eth> -X
  'udp port 9 and dst host <ip>'` while the Mac was awake.
- ❌ **The Mac does not wake.** With the Mac asleep, the send itself fails
  (`Chyba odesílání`). Root cause: this is an **Apple Silicon laptop on a USB
  Ethernet dongle (AX88179A)**; Apple Silicon powers USB peripherals down on
  sleep, so the dongle's link drops → the iPad can't ARP-resolve the target →
  the unicast is undeliverable (and a powered-off NIC couldn't wake anyway).

**Conclusion:** do **not** rely on WoL to wake this Mac. Options:
1. **Keep the Mac awake** (`sudo pmset -c sleep 0`, display-only sleep) — matches
   the epic's "live plane needs the Mac awake". Recommended for a laptop target.
2. Use a **Mac with built-in Ethernet** (mini/Studio/iMac) — built-in NICs stay
   powered for "Wake for network access", so unicast WoL works.
3. **Bonjour Sleep Proxy** (always-on Apple TV/HomePod) — Apple's real
   Apple-Silicon wake path, but wakes on Bonjour service access, not a raw
   magic packet → a wake-trigger redesign, not a config change.

## macOS (the Mac to wake)
1. Connect the Mac to the router by **wired Ethernet**. Wi-Fi WoL is unreliable
   on Apple Silicon and unsupported by the router for WoL. ⚠️ A **USB Ethernet
   dongle powers off on sleep** on Apple Silicon — use a Mac with **built-in**
   Ethernet, or WoL won't work (see the #105 device-test result above).
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
