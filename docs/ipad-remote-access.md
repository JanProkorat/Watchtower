# iPad remote access (off-network) via Tailscale

The iPad reaches the Mac's instance control (WS bridge) and the "Vzdálený Mac"
VNC screen through a single `host` value. Set it to the Mac's Tailscale MagicDNS
name and it works both on the home Wi-Fi and from anywhere.

## One-time setup
1. Install Tailscale on the Mac and the iPad; sign both into the same tailnet.
2. Enable **MagicDNS** in the Tailscale admin console.
3. Note the Mac's MagicDNS name (e.g. `jans-mac.<tailnet>.ts.net`) or its
   `100.x` address (`tailscale ip -4`).
4. Run Watchtower on the Mac as usual — `WATCHTOWER_WS_HOST=auto` binds the
   tailnet interface automatically (the `iPad connect →` log line is annotated
   "(Tailscale — reachable off-network)").
5. On the iPad: **Nastavení → Připojení k Macu**, set **Host** = the MagicDNS
   name, **port** = the bridge port (default 7445), **token** = the value from
   the desktop log, then **Uložit a připojit**.

## Notes / limitations
- The Mac must stay **awake and online** — Tailscale keeps the path but can't
  wake a sleeping Mac; Wake-on-LAN is not available on this hardware (finding #105).
- Traffic is WireGuard-encrypted and the bridge is reachable only from your
  tailnet — never the public internet — which is why the plaintext-`ws://`
  token transport is acceptable off-network.
- No LAN/WAN switching: one MagicDNS host works everywhere (Tailscale uses a
  direct path on the same LAN).
