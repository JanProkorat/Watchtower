# Watchtower iPad shell — build & run runbook

This is the Capacitor iOS skeleton for remote-controlling Watchtower from an iPad.
The connection uses a plain `ws://` LAN WebSocket (ATS local-networking exception is in
`Info.plist`). Tailscale + TLS arrive in #72; this skeleton is for on-bench testing only.

---

## 1. Mac side — start the orchestrator with LAN binding

```bash
# Option A: auto-detect LAN IP
WATCHTOWER_WS_HOST=auto npm run dev

# Option B: explicit LAN IP (useful if you have multiple interfaces)
WATCHTOWER_WS_HOST=192.168.1.42 npm run dev
```

Look for the startup log line printed by the orchestrator:

```
[orchestrator] iPad connect → ws://192.168.1.42:7445/ws  token: abc123xyz
```

Copy the host, port, and token — you will need them on the iPad.

> The Mac and iPad **must be on the same Wi-Fi** network.
> The WS listener is **off by default** — it only starts when `WATCHTOWER_WS_HOST` is set.

---

## 2. Build the web app and sync it into the native project

From the **repo root**:

```bash
npm run build --workspace @watchtower/ipad
cd apps/ipad && LANG=en_US.UTF-8 npx cap sync ios
```

Or equivalently from `apps/ipad/`:

```bash
cd apps/ipad
npm run build
LANG=en_US.UTF-8 npx cap sync ios
```

> `LANG=en_US.UTF-8` is required for CocoaPods on macOS to avoid a Ruby UTF-8
> encoding error. You can add `export LANG=en_US.UTF-8` to your `~/.zprofile`
> to avoid passing it every time.

---

## 3. Sign & run in Xcode

```bash
cd apps/ipad
LANG=en_US.UTF-8 npx cap open ios
```

Inside Xcode:

1. Select the **App** project in the navigator.
2. Go to **Signing & Capabilities** → **Team** → choose your **personal Apple ID** team
   (free account is fine; no paid developer programme needed for on-device testing).
3. Verify **Bundle Identifier** is `cz.greencode.watchtower.ipad`.
4. Plug in your iPad and select it in the device picker at the top.
5. Click **Run** (▶).

Xcode will compile, sign, and install the app on your iPad.

---

## 4. On the iPad

1. Open the **Watchtower** app.
2. In the connection screen, enter:
   - **Host**: the IP from the orchestrator log (e.g. `192.168.1.42`)
   - **Port**: the port from the log (default `7445`)
   - **Token**: the token from the log
3. Tap **Connect**.
4. You should see `status: connected` and the live instance list from the Mac.
5. When instance state changes on the Mac (spawn / kill a session), the push
   counter on the screen should increment.

---

## 5. Caveats and known limitations

| Caveat | Detail |
|---|---|
| **7-day cert expiry** | Free personal-team certificates expire after 7 days. Re-open in Xcode and click Run again to renew. |
| **Same Wi-Fi required** | The `ws://` connection is direct LAN — the Mac and iPad must be on the same network. |
| **ATS local-networking only** | `NSAllowsLocalNetworking: true` is set in `Info.plist`. This allows `ws://` to LAN addresses. It does NOT open all insecure connections. |
| **Skeleton only** | This `ws://` + ATS path is the walking skeleton. Tailscale + TLS encryption arrive in issue #72 and will replace this. |
| **No Settings UI for token** | The token/host/port are entered manually in the connection screen. A Watchtower Settings panel is deferred beyond the skeleton. |

---

## Acceptance criteria (manual)

- [ ] App builds, signs with the personal team, and installs on the iPad.
- [ ] Entering the logged host/port/token and tapping Connect shows `status: connected`
      and the live instance list from the Mac.
- [ ] The pushes counter increments when instance state changes on the Mac
      (e.g. spawn/kill a session).

Record the outcome (screenshot or notes) in the PR for #73.
