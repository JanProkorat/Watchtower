// WatchtowerBridge — the Mac control plane for the native iPad app.
// Everything that talks to the orchestrator's WebSocket bridge lives in this
// target so the iPhone app (which links only WatchtowerCore) never pulls it in.

let watchtowerBridgeModuleMarker = "WatchtowerBridge"
