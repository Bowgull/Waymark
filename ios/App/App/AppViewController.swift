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
        // Phase 1 run-recorder spike (throwaway; /dev/recorder).
        bridge?.registerPluginInstance(WaymarkRecorderSpikePlugin())
        // Page 61 item 6: the app-switcher cover while the Waybook is open.
        bridge?.registerPluginInstance(WaymarkPrivacyPlugin())
    }
}

// The app-switcher picture (page 61, optional item 6, approved): while the
// Waybook is open, the snapshot iOS takes on the way out shows a plain dark
// cover instead of the pages. JS turns it on and off (setCover); AppDelegate
// draws it on resign-active and takes it away on become-active.
@objc(WaymarkPrivacyPlugin)
public class WaymarkPrivacyPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WaymarkPrivacyPlugin"
    public let jsName = "WaymarkPrivacy"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setCover", returnType: CAPPluginReturnPromise),
    ]

    static var coverOn = false

    @objc func setCover(_ call: CAPPluginCall) {
        WaymarkPrivacyPlugin.coverOn = call.getBool("on") ?? false
        call.resolve()
    }
}
