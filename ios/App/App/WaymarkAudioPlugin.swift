import Foundation
import AVFoundation
import Capacitor

// Plays in-session timer sounds (round start/end, finish/rest warnings) through
// an AVAudioSession configured with `.duckOthers` so music from other apps
// (Spotify, etc.) ducks briefly for the cue and restores on its own.
//
// Lifecycle:
//   - activate()   when a session view mounts
//   - play(name)   for each cue — name is the bundle resource, e.g. "round_start"
//   - deactivate() on unmount; posts .notifyOthersOnDeactivation so the
//                  other app's music returns to full volume immediately.
@objc(WaymarkAudioPlugin)
public class WaymarkAudioPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WaymarkAudioPlugin"
    public let jsName = "WaymarkAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "activate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deactivate", returnType: CAPPluginReturnPromise),
    ]

    private var players: [String: AVAudioPlayer] = [:]
    private var sessionActive = false

    @objc func activate(_ call: CAPPluginCall) {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                .playback,
                mode: .default,
                options: [.mixWithOthers, .duckOthers]
            )
            try session.setActive(true, options: [])
            sessionActive = true
            call.resolve()
        } catch {
            call.reject("Failed to activate audio session: \(error.localizedDescription)")
        }
    }

    @objc func play(_ call: CAPPluginCall) {
        guard let name = call.getString("name") else {
            call.reject("Missing sound name")
            return
        }

        // Lazy-activate in case play() is called before activate(). This keeps
        // behaviour sane if a cue slips in before the mount effect runs.
        if !sessionActive {
            let session = AVAudioSession.sharedInstance()
            try? session.setCategory(.playback, mode: .default, options: [.mixWithOthers, .duckOthers])
            try? session.setActive(true, options: [])
            sessionActive = true
        }

        do {
            let player = try cachedPlayer(for: name)
            player.currentTime = 0
            player.play()
            call.resolve()
        } catch {
            call.reject("Failed to play \(name): \(error.localizedDescription)")
        }
    }

    @objc func deactivate(_ call: CAPPluginCall) {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setActive(false, options: [.notifyOthersOnDeactivation])
            sessionActive = false
            call.resolve()
        } catch {
            // Best effort — the view is tearing down anyway.
            sessionActive = false
            call.resolve()
        }
    }

    // Locate the .caf in the main bundle. Sound files live in ios/App/App/Sounds/
    // and are added to the App target as bundle resources (see add_audio_plugin.rb).
    private func cachedPlayer(for name: String) throws -> AVAudioPlayer {
        if let existing = players[name] { return existing }
        guard let url = Bundle.main.url(forResource: name, withExtension: "caf")
            ?? Bundle.main.url(forResource: name, withExtension: "caf", subdirectory: "Sounds")
        else {
            throw NSError(domain: "WaymarkAudio", code: 404, userInfo: [
                NSLocalizedDescriptionKey: "Sound file \(name).caf not found in bundle",
            ])
        }
        let player = try AVAudioPlayer(contentsOf: url)
        player.prepareToPlay()
        players[name] = player
        return player
    }
}
