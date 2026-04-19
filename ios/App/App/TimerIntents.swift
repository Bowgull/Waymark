import ActivityKit
import AppIntents
import Foundation

// Pause / Resume intents for Waymark Live Activity buttons.
//
// LiveActivityIntent (iOS 17+) runs in the main app's process, so the
// intent can update the running Activity and also post a local notification
// that the app observes — which then bridges to the JS timer hooks.

public extension Notification.Name {
    static let waymarkTimerPauseRequested = Notification.Name("WaymarkTimerPauseRequested")
    static let waymarkTimerResumeRequested = Notification.Name("WaymarkTimerResumeRequested")
}

@available(iOS 17.0, *)
public struct PauseTimerIntent: LiveActivityIntent {
    public static var title: LocalizedStringResource = "Pause"
    public static var description: IntentDescription = IntentDescription("Pause the Waymark timer.")

    public init() {}

    public func perform() async throws -> some IntentResult {
        for activity in Activity<WaymarkActivityAttributes>.activities {
            let state = activity.content.state
            guard !state.isPaused, state.phase != "complete" else { continue }

            let remaining = max(0, state.endsAt.timeIntervalSince(Date()))
            let newState = WaymarkActivityAttributes.ContentState(
                phase: state.phase,
                label: state.label,
                detail: state.detail,
                endsAt: state.endsAt,
                startedAt: state.startedAt,
                isPaused: true,
                pausedRemaining: remaining,
                completeMessage: state.completeMessage
            )
            let content = ActivityContent(state: newState, staleDate: nil)
            await activity.update(content)
        }

        await MainActor.run {
            NotificationCenter.default.post(name: .waymarkTimerPauseRequested, object: nil)
        }
        return .result()
    }
}

@available(iOS 17.0, *)
public struct ResumeTimerIntent: LiveActivityIntent {
    public static var title: LocalizedStringResource = "Resume"
    public static var description: IntentDescription = IntentDescription("Resume the Waymark timer.")

    public init() {}

    public func perform() async throws -> some IntentResult {
        var resumedEndsAt: Date?

        for activity in Activity<WaymarkActivityAttributes>.activities {
            let state = activity.content.state
            guard state.isPaused, let remaining = state.pausedRemaining else { continue }

            let now = Date()
            let newEndsAt = now.addingTimeInterval(remaining)
            resumedEndsAt = newEndsAt
            let newState = WaymarkActivityAttributes.ContentState(
                phase: state.phase,
                label: state.label,
                detail: state.detail,
                endsAt: newEndsAt,
                startedAt: now,
                isPaused: false,
                pausedRemaining: nil,
                completeMessage: state.completeMessage
            )
            let content = ActivityContent(state: newState, staleDate: nil)
            await activity.update(content)
        }

        if let newEndsAt = resumedEndsAt {
            await MainActor.run {
                NotificationCenter.default.post(
                    name: .waymarkTimerResumeRequested,
                    object: nil,
                    userInfo: ["endsAtMs": newEndsAt.timeIntervalSince1970 * 1000.0]
                )
            }
        }
        return .result()
    }
}
