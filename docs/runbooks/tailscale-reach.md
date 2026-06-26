# Tailscale reach for the Watchtower iPad (#71 / #72 reachability)

Make the messaging hub (and the rest of the iPad live plane) work away from
the home Wi-Fi by reaching the Mac over Tailscale.

1. Install **Tailscale** on the Mac and the iPad; sign both into the **same
   tailnet**.
2. On the Mac, find its Tailscale IP: `tailscale ip -4` (a `100.x.x.x` address).
3. In the dev env (`.env` / shell), set `WATCHTOWER_WS_HOST=auto` — the
   orchestrator now **prefers the Tailscale (`100.64.0.0/10`) address** when
   binding, so it's reachable both away (over Tailscale) and at home (Tailscale
   routes locally). (Or set `WATCHTOWER_WS_HOST` to the `100.x` IP explicitly.)
4. On the iPad, enter that **`100.x` Tailscale IP** as the host (port 7445,
   same bearer token). The terminal mirror now works off-LAN (the terminal is
   where you answer; APNs taps open the instance that needs attention).

**Still required:** APNs (to wake a locked/closed iPad — unchanged). **Not
covered here:** Wake-on-LAN to wake a *sleeping* Mac (the hardware part of #72,
still parked) — this reaches an **awake** Mac.

**Security:** Tailscale restricts reachability to your tailnet; the bearer
token remains the access control. The server never binds `0.0.0.0`.
