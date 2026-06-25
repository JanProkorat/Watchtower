# APNs setup for the Watchtower messaging hub (#71)

1. Apple Developer → Certificates, IDs & Profiles → Keys → **+** → enable
   **Apple Push Notifications service (APNs)** → download the **`.p8`** (once).
   Note the **Key ID**; note your **Team ID** (top-right of the portal).
2. Xcode (apps/ipad) → Signing & Capabilities → **+ Capability → Push
   Notifications**. This adds the `aps-environment` entitlement
   (`development` for Xcode installs, `production` for TestFlight/App Store).
3. Watchtower → Settings → **Messaging hub**: paste the `.p8` contents, Key ID,
   Team ID; set **Environment** to match the installed build
   (**sandbox** for an Xcode/dev install, **production** for TestFlight).
   Enable the hub.
4. On the iPad, accept the notification permission prompt on first launch.

**Gotcha:** a sandbox/production mismatch makes APNs silently not deliver
(no error) — the env must match how the build was signed/installed.
