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
    static let waymarkTimerRestartRequested = Notification.Name("WaymarkTimerRestartRequested")
    static let waymarkSessionEndRequested = Notification.Name("WaymarkSessionEndRequested")
    static let waymarkCompleteSetRequested = Notification.Name("WaymarkCompleteSetRequested")
    static let waymarkStartHoldRequested = Notification.Name("WaymarkStartHoldRequested")
    static let waymarkAdvanceRequested = Notification.Name("WaymarkAdvanceRequested")
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
                completeMessage: state.completeMessage,
                endPending: false
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
                completeMessage: state.completeMessage,
                endPending: false
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

// Restart the current phase from full duration. The widget optimistically
// can't know the original duration after pause/resume, so we simply post a
// notification — the JS side owns timer durations and will drive the update.
@available(iOS 17.0, *)
public struct RestartPhaseIntent: LiveActivityIntent {
    public static var title: LocalizedStringResource = "Restart"
    public static var description: IntentDescription = IntentDescription("Restart the current Waymark phase from full duration.")

    public init() {}

    public func perform() async throws -> some IntentResult {
        // Clear any pending end confirmation as a side-effect.
        for activity in Activity<WaymarkActivityAttributes>.activities {
            let state = activity.content.state
            guard state.endPending else { continue }
            let newState = WaymarkActivityAttributes.ContentState(
                phase: state.phase,
                label: state.label,
                detail: state.detail,
                endsAt: state.endsAt,
                startedAt: state.startedAt,
                isPaused: state.isPaused,
                pausedRemaining: state.pausedRemaining,
                completeMessage: state.completeMessage,
                endPending: false
            )
            await activity.update(ActivityContent(state: newState, staleDate: nil))
        }

        await MainActor.run {
            NotificationCenter.default.post(name: .waymarkTimerRestartRequested, object: nil)
        }
        return .result()
    }
}

// First tap of the End glyph. Flips endPending=true so the widget shows
// the "End?" confirmation button. Schedules an auto-revert after 3s so
// the confirmation doesn't linger if the user walks away.
@available(iOS 17.0, *)
public struct RequestEndIntent: LiveActivityIntent {
    public static var title: LocalizedStringResource = "End"
    public static var description: IntentDescription = IntentDescription("Ask to end the Waymark session.")

    public init() {}

    public func perform() async throws -> some IntentResult {
        for activity in Activity<WaymarkActivityAttributes>.activities {
            let state = activity.content.state
            guard !state.endPending, state.phase != "complete" else { continue }
            let newState = WaymarkActivityAttributes.ContentState(
                phase: state.phase,
                label: state.label,
                detail: state.detail,
                endsAt: state.endsAt,
                startedAt: state.startedAt,
                isPaused: state.isPaused,
                pausedRemaining: state.pausedRemaining,
                completeMessage: state.completeMessage,
                endPending: true
            )
            await activity.update(ActivityContent(state: newState, staleDate: nil))
        }

        // Auto-revert after 3s if the user doesn't confirm.
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            for activity in Activity<WaymarkActivityAttributes>.activities {
                let state = activity.content.state
                guard state.endPending else { continue }
                let newState = WaymarkActivityAttributes.ContentState(
                    phase: state.phase,
                    label: state.label,
                    detail: state.detail,
                    endsAt: state.endsAt,
                    startedAt: state.startedAt,
                    isPaused: state.isPaused,
                    pausedRemaining: state.pausedRemaining,
                    completeMessage: state.completeMessage,
                    endPending: false
                )
                await activity.update(ActivityContent(state: newState, staleDate: nil))
            }
        }

        return .result()
    }
}

// Fired from the exercise-phase "Complete Set" button. Posts a notification
// the plugin forwards to JS — the web side reads current weight/reps from
// its input row and calls the normal handleSetComplete flow.
@available(iOS 17.0, *)
public struct CompleteSetIntent: LiveActivityIntent {
    public static var title: LocalizedStringResource = "Complete Set"
    public static var description: IntentDescription = IntentDescription("Log the current set and start rest.")

    public init() {}

    public func perform() async throws -> some IntentResult {
        await MainActor.run {
            NotificationCenter.default.post(name: .waymarkCompleteSetRequested, object: nil)
        }
        return .result()
    }
}

// Fired from the mobility "next hold ready" phase. Tells JS to start the
// next hold timer so the user can move seamlessly between holds without
// unlocking.
@available(iOS 17.0, *)
public struct StartHoldIntent: LiveActivityIntent {
    public static var title: LocalizedStringResource = "Start Hold"
    public static var description: IntentDescription = IntentDescription("Begin the next mobility hold.")

    public init() {}

    public func perform() async throws -> some IntentResult {
        await MainActor.run {
            NotificationCenter.default.post(name: .waymarkStartHoldRequested, object: nil)
        }
        return .result()
    }
}

// Universal "advance to next phase" — the single primary action on every
// timer phase of every session (hold, rest, round, interval, run). The
// widget shows a phase-specific label ("Done →", "Skip →", "Next →") but
// they all route through this one intent. JS-side each session view
// decides what "next" means for its current phase.
@available(iOS 17.0, *)
public struct AdvancePhaseIntent: LiveActivityIntent {
    public static var title: LocalizedStringResource = "Next"
    public static var description: IntentDescription = IntentDescription("Advance the current Waymark phase.")

    public init() {}

    public func perform() async throws -> some IntentResult {
        await MainActor.run {
            NotificationCenter.default.post(name: .waymarkAdvanceRequested, object: nil)
        }
        return .result()
    }
}

// Second tap while endPending=true. Ends all waymark Live Activities
// intrinsically and posts a notification so JS — if running — can tear
// down the session model. Ending here guarantees the LA disappears even
// if the app isn't resident (force-closed) when the user taps End.
@available(iOS 17.0, *)
public struct ConfirmEndIntent: LiveActivityIntent {
    public static var title: LocalizedStringResource = "End Session"
    public static var description: IntentDescription = IntentDescription("Confirm ending the Waymark session.")

    public init() {}

    public func perform() async throws -> some IntentResult {
        for activity in Activity<WaymarkActivityAttributes>.activities {
            // Mark before ending so the plugin's state observer knows this
            // was an in-app confirmation (not a user swipe-to-clear).
            WaymarkInternalEndTracker.shared.mark(activity.id)
            await activity.end(nil, dismissalPolicy: .immediate)
        }
        await MainActor.run {
            NotificationCenter.default.post(name: .waymarkSessionEndRequested, object: nil)
        }
        return .result()
    }
}
