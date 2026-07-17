# Watchtower iPad (native)

Native SwiftUI + TCA iPad app. Views only — all logic lives in the
`WatchtowerCore` / `WatchtowerBridge` SPM targets at `swift/WatchtowerCore`.
Spec: `docs/superpowers/specs/2026-07-15-native-ipad-swiftui-rewrite-design.md`.

## Build

    cp Watchtower/Secrets.sample.xcconfig Watchtower/Secrets.xcconfig  # fill in Supabase values
    xcodegen generate
    xcodebuild -project Watchtower.xcodeproj -scheme Watchtower \
      -destination 'generic/platform=iOS Simulator' -skipMacroValidation \
      CODE_SIGNING_ALLOWED=NO build

Bundle id `cz.greencode.watchtower.ipados` ("Watchtower N") — installs
side-by-side with the Capacitor iPad app until parity (spec Phase 8).

## Run on the iPad

See the devicectl flow in the Phase 1 plan (Task 11):
build for `generic/platform=iOS`, then `devicectl device install app` +
`devicectl device process launch`. Package tests: `cd ../../swift/WatchtowerCore && swift test`.
