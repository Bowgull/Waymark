import ActivityKit
import Foundation

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

        public init(
            phase: String,
            label: String,
            detail: String? = nil,
            endsAt: Date,
            startedAt: Date,
            isPaused: Bool = false,
            pausedRemaining: TimeInterval? = nil,
            completeMessage: String? = nil
        ) {
            self.phase = phase
            self.label = label
            self.detail = detail
            self.endsAt = endsAt
            self.startedAt = startedAt
            self.isPaused = isPaused
            self.pausedRemaining = pausedRemaining
            self.completeMessage = completeMessage
        }
    }

    public var sessionType: String
    public var sessionLabel: String

    public init(sessionType: String, sessionLabel: String) {
        self.sessionType = sessionType
        self.sessionLabel = sessionLabel
    }
}
