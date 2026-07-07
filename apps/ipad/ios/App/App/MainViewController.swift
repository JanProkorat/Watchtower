import UIKit
import Capacitor

// Capacitor 6 no longer auto-registers plugin classes. App-local plugins (not
// distributed via npm) must be registered explicitly in a custom bridge view
// controller — see the Capacitor 5→6 iOS migration guide. Without this, the
// native `Wake` plugin compiles but the bridge reports it as
// "not implemented on ios" (#105).
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(WakePlugin())
    }
}
