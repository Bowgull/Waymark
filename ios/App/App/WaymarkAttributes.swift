import ActivityKit
import Foundation

// Process-local tracker to distinguish "the app ended this LA intentionally"
// from "the user swiped it off the lock screen." Both plugin.end()/endAll()
// and ConfirmEndIntent call mark(id) before awaiting activity.end(); the
// plugin's activityStateUpdates observer calls consume(id) when the state
// flips to .ended/.dismissed. A miss there means the user dismissed the LA
// externally — we translate that into endRequested so JS tears down the
// session (swipe-to-clear exits the workout).
//
// Lives in WaymarkAttributes.swift because it's the one Swift file already
// shared between the main-app target and the WaymarkActivity widget target.
public final class WaymarkInternalEndTracker {
    public static let shared = WaymarkInternalEndTracker()
    private var internalIds = Set<String>()
    private var finalizedIds = Set<String>()
    private let queue = DispatchQueue(label: "com.waymark.la.internal-end")

    private init() {}

    public func mark(_ id: String) {
        queue.sync { _ = internalIds.insert(id) }
    }

    /// Result of calling finalize for an activity that transitioned to
    /// ended/dismissed. `isFirst` is true only on the very first finalize
    /// call for a given id — subsequent callers (e.g. a second redundant
    /// observer on the same activity) get isFirst=false and MUST skip any
    /// side effects. `wasInternal` reflects whether mark(id) had been
    /// called before activity.end() fired (i.e. the end was app-initiated).
    public struct FinalizeResult {
        public let isFirst: Bool
        public let wasInternal: Bool
    }

    /// Should be called exactly once per activity end per observer. The
    /// tracker guarantees only the first caller sees isFirst=true, so two
    /// observers racing on the same activity produce exactly one set of
    /// downstream events.
    public func finalize(_ id: String) -> FinalizeResult {
        queue.sync {
            let isFirst = finalizedIds.insert(id).inserted
            let wasInternal = internalIds.remove(id) != nil
            return FinalizeResult(isFirst: isFirst, wasInternal: wasInternal)
        }
    }
}

// Shape of a Waymark Live Activity.
// The same struct is used by the main app (to start/update/end activities)
// and by the widget extension (to render them).
@available(iOS 16.2, *)
public struct WaymarkActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var phase: String
        public var label: String
        public var detail: String?
        public var endsAt: Date
        public var startedAt: Date
        public var isPaused: Bool
        public var pausedRemaining: TimeInterval?
        public var completeMessage: String?
        // True when the user has tapped End once and the widget is asking
        // for confirmation. Reverts after a short window or on next update.
        public var endPending: Bool
        // Exercise-phase fields (phase == "exercise"). Timer fields are
        // ignored in this phase; the widget renders a static "what's next"
        // card with a Complete Set action.
        public var exerciseName: String?

        public init(
            phase: String,
            label: String,
            detail: String? = nil,
            endsAt: Date,
            startedAt: Date,
            isPaused: Bool = false,
            pausedRemaining: TimeInterval? = nil,
            completeMessage: String? = nil,
            endPending: Bool = false,
            exerciseName: String? = nil
        ) {
            self.phase = phase
            self.label = label
            self.detail = detail
            self.endsAt = endsAt
            self.startedAt = startedAt
            self.isPaused = isPaused
            self.pausedRemaining = pausedRemaining
            self.completeMessage = completeMessage
            self.endPending = endPending
            self.exerciseName = exerciseName
        }
    }

    public var sessionType: String
    public var sessionLabel: String

    public init(sessionType: String, sessionLabel: String) {
        self.sessionType = sessionType
        self.sessionLabel = sessionLabel
    }
}
