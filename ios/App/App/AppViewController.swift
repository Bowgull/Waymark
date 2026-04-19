import Capacitor

// Capacitor 6+ only auto-registers plugins listed in `packageClassList`
// in capacitor.config.json (which `cap sync` generates from npm-installed
// plugins). In-app custom plugins are NOT auto-discovered — they must be
// registered manually here via `capacitorDidLoad()`.
//
// Main.storyboard's initial view controller uses this class (customClass =
// "AppViewController", customModule = "App") so this hook fires once per
// bridge init.
class AppViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(WaymarkAudioPlugin())
        bridge?.registerPluginInstance(WaymarkLiveActivityPlugin())
    }
}
