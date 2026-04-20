import Foundation
import UIKit
import Capacitor
import ActivityKit
import os

private let log = Logger(subsystem: "com.waymark.app", category: "LiveActivity")

@objc(WaymarkLiveActivityPlugin)
public class WaymarkLiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WaymarkLiveActivityPlugin"
    public let jsName = "WaymarkLiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endAll", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getCurrent", returnType: CAPPluginReturnPromise),
    ]

    private var currentActivityId: String?
    private var observersRegistered = false

    override public func load() {
        super.load()
        log.info("WaymarkLiveActivity plugin loaded")
        registerNotificationObservers()
        if #available(iOS 16.2, *) {
            adoptExistingActivities()
            observeNewActivities()
        }
    }

    @available(iOS 16.2, *)
    private func adoptExistingActivities() {
        // Morph-only invariant: at most one waymark LA across the app.
        // On cold launch (user force-closed during a session and reopened),
        // pick up any pre-existing LA so subsequent update() calls morph
        // in place rather than failing and spawning a duplicate.
        let existing = Activity<WaymarkActivityAttributes>.activities
        if let first = existing.first {
            currentActivityId = first.id
            log.info("adopted pre-existing LA id=\(first.id, privacy: .public)")
        }
        for activity in existing {
            observeActivityState(activity)
        }
    }

    @available(iOS 16.2, *)
    private func observeNewActivities() {
        // Long-lived task that watches for activities created after launch
        // so we can observe their end state too.
        Task {
            for await activity in Activity<WaymarkActivityAttributes>.activityUpdates {
                observeActivityState(activity)
            }
        }
    }

    @available(iOS 16.2, *)
    private func observeActivityState(_ activity: Activity<WaymarkActivityAttributes>) {
        Task { [weak self] in
            for await state in activity.activityStateUpdates {
                if state == .ended || state == .dismissed {
                    // Dedupe: start() + observeNewActivities both register
                    // observers on the same activity, so two tasks race here
                    // on end. finalize() ensures only the first caller fires
                    // the downstream events (activityEnded, and optionally
                    // endRequested if the end was not app-initiated).
                    let result = WaymarkInternalEndTracker.shared.finalize(activity.id)
                    guard result.isFirst else { return }
                    await MainActor.run {
                        if self?.currentActivityId == activity.id {
                            self?.currentActivityId = nil
                        }
                        self?.notifyListeners("activityEnded", data: ["activityId": activity.id])
                        // If the id wasn't marked internal before .end() fired,
                        // the user swiped the LA off the lock screen. Surface
                        // that as an end request so JS can tear down the
                        // session (navigate back to Today).
                        if !result.wasInternal {
                            log.info("LA dismissed externally id=\(activity.id, privacy: .public) — forwarding as endRequested")
                            self?.notifyListeners("endRequested", data: [:])
                        }
                    }
                    return
                }
            }
        }
    }

    private func registerNotificationObservers() {
        guard !observersRegistered else { return }
        observersRegistered = true

        NotificationCenter.default.addObserver(
            forName: .waymarkTimerPauseRequested,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.notifyListeners("pauseRequested", data: [:])
        }

        NotificationCenter.default.addObserver(
            forName: .waymarkTimerResumeRequested,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            var data: [String: Any] = [:]
            if let userInfo = notification.userInfo,
               let endsAtMs = userInfo["endsAtMs"] as? Double {
                data["endsAtMs"] = endsAtMs
            }
            self?.notifyListeners("resumeRequested", data: data)
        }

        NotificationCenter.default.addObserver(
            forName: .waymarkTimerRestartRequested,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.notifyListeners("restartRequested", data: [:])
        }

        NotificationCenter.default.addObserver(
            forName: .waymarkSessionEndRequested,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.notifyListeners("endRequested", data: [:])
        }

        NotificationCenter.default.addObserver(
            forName: .waymarkCompleteSetRequested,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.notifyListeners("completeSetRequested", data: [:])
        }

        NotificationCenter.default.addObserver(
            forName: .waymarkStartHoldRequested,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.notifyListeners("startHoldRequested", data: [:])
        }

        NotificationCenter.default.addObserver(
            forName: .waymarkAdvanceRequested,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.notifyListeners("advanceRequested", data: [:])
        }
    }

    @objc func isSupported(_ call: CAPPluginCall) {
        if #available(iOS 16.2, *) {
            let enabled = ActivityAuthorizationInfo().areActivitiesEnabled
            log.info("isSupported iOS=\(UIDevice.current.systemVersion, privacy: .public) enabled=\(enabled, privacy: .public)")
            call.resolve([
                "supported": enabled,
                "iosVersion": UIDevice.current.systemVersion,
            ])
        } else {
            log.info("isSupported iOS=\(UIDevice.current.systemVersion, privacy: .public) below 16.2")
            call.resolve([
                "supported": false,
                "iosVersion": UIDevice.current.systemVersion,
            ])
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            log.error("start rejected: iOS < 16.2")
            call.reject("Live Activities require iOS 16.2+")
            return
        }

        guard let sessionType = call.getString("sessionType"),
              let sessionLabel = call.getString("sessionLabel"),
              let stateDict = call.getObject("state"),
              let contentState = parseContentState(stateDict)
        else {
            log.error("start rejected: missing/invalid sessionType, sessionLabel, or state")
            call.reject("Missing or invalid sessionType, sessionLabel, or state")
            return
        }

        let authEnabled = ActivityAuthorizationInfo().areActivitiesEnabled
        log.info("start request sessionType=\(sessionType, privacy: .public) label=\(sessionLabel, privacy: .public) authEnabled=\(authEnabled, privacy: .public)")

        let attributes = WaymarkActivityAttributes(
            sessionType: sessionType,
            sessionLabel: sessionLabel
        )

        do {
            let content = ActivityContent(state: contentState, staleDate: nil)
            let activity = try Activity<WaymarkActivityAttributes>.request(
                attributes: attributes,
                content: content
            )
            currentActivityId = activity.id
            observeActivityState(activity)
            log.info("start succeeded id=\(activity.id, privacy: .public)")
            call.resolve(["activityId": activity.id])
        } catch {
            log.error("start failed: \(error.localizedDescription, privacy: .public)")
            call.reject("Failed to start Live Activity: \(error.localizedDescription)")
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.reject("Live Activities require iOS 16.2+")
            return
        }

        guard let stateDict = call.getObject("state"),
              let contentState = parseContentState(stateDict)
        else {
            call.reject("Missing or invalid state payload")
            return
        }

        let activityId = call.getString("activityId") ?? currentActivityId
        guard let id = activityId else {
            call.reject("No active Live Activity to update")
            return
        }

        Task {
            if let activity = Activity<WaymarkActivityAttributes>.activities.first(where: { $0.id == id }) {
                let content = ActivityContent(state: contentState, staleDate: nil)
                await activity.update(content)
                log.debug("update id=\(id, privacy: .public) phase=\(contentState.phase, privacy: .public)")
                call.resolve()
            } else {
                log.error("update failed: activity id=\(id, privacy: .public) not found")
                call.reject("Activity \(id) not found")
            }
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve()
            return
        }

        let dismissAfterMs = call.getInt("dismissAfterMs") ?? 0
        let activityId = call.getString("activityId") ?? currentActivityId

        guard let id = activityId else {
            call.resolve()
            return
        }

        let finalStateDict = call.getObject("state")

        Task {
            guard let activity = Activity<WaymarkActivityAttributes>.activities.first(where: { $0.id == id }) else {
                if currentActivityId == id { currentActivityId = nil }
                call.resolve()
                return
            }

            let dismissalPolicy: ActivityUIDismissalPolicy
            if dismissAfterMs > 0 {
                let dismissDate = Date().addingTimeInterval(TimeInterval(dismissAfterMs) / 1000.0)
                dismissalPolicy = .after(dismissDate)
            } else {
                dismissalPolicy = .immediate
            }

            // Mark before ending so observeActivityState can tell this apart
            // from a user-initiated lock-screen dismissal.
            WaymarkInternalEndTracker.shared.mark(activity.id)

            if let finalStateDict = finalStateDict,
               let finalState = parseContentState(finalStateDict) {
                let content = ActivityContent(state: finalState, staleDate: nil)
                await activity.end(content, dismissalPolicy: dismissalPolicy)
            } else {
                await activity.end(nil, dismissalPolicy: dismissalPolicy)
            }

            log.info("end id=\(id, privacy: .public) dismissAfterMs=\(dismissAfterMs, privacy: .public)")
            if currentActivityId == id { currentActivityId = nil }
            call.resolve()
        }
    }

    @objc func getCurrent(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve([:])
            return
        }
        // Prefer the cached id (set on load or on start). Fall back to the
        // first live activity — covers the case where our cache was cleared
        // but the OS still has the LA, or where the plugin loaded before
        // ActivityKit had enumerated existing activities.
        if let id = currentActivityId,
           let activity = Activity<WaymarkActivityAttributes>.activities.first(where: { $0.id == id }) {
            call.resolve([
                "activityId": id,
                "sessionType": activity.attributes.sessionType,
                "sessionLabel": activity.attributes.sessionLabel,
            ])
            return
        }
        if let activity = Activity<WaymarkActivityAttributes>.activities.first {
            currentActivityId = activity.id
            call.resolve([
                "activityId": activity.id,
                "sessionType": activity.attributes.sessionType,
                "sessionLabel": activity.attributes.sessionLabel,
            ])
            return
        }
        call.resolve([:])
    }

    @objc func endAll(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve()
            return
        }

        Task {
            for activity in Activity<WaymarkActivityAttributes>.activities {
                WaymarkInternalEndTracker.shared.mark(activity.id)
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            currentActivityId = nil
            call.resolve()
        }
    }

    @available(iOS 16.2, *)
    private func parseContentState(_ dict: [String: Any]) -> WaymarkActivityAttributes.ContentState? {
        guard let phase = dict["phase"] as? String,
              let label = dict["label"] as? String,
              let endsAtMs = dict["endsAt"] as? Double,
              let startedAtMs = dict["startedAt"] as? Double,
              let isPaused = dict["isPaused"] as? Bool
        else { return nil }

        return WaymarkActivityAttributes.ContentState(
            phase: phase,
            label: label,
            detail: dict["detail"] as? String,
            endsAt: Date(timeIntervalSince1970: endsAtMs / 1000.0),
            startedAt: Date(timeIntervalSince1970: startedAtMs / 1000.0),
            isPaused: isPaused,
            pausedRemaining: dict["pausedRemaining"] as? TimeInterval,
            completeMessage: dict["completeMessage"] as? String,
            endPending: dict["endPending"] as? Bool ?? false,
            exerciseName: dict["exerciseName"] as? String
        )
    }
}
