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
        // Page 44 (redesign step 4). All optional so a state encoded by an
        // older build (or sent by an older JS bundle) still decodes; the
        // widget falls back to parsing `label` and to `sessionType`.
        // Painted session icon key ("bag", "strength", "zone2", ...); the
        // widget's asset catalog holds it as "session-<key>".
        public var iconKey: String?
        // Session-level count for the header flap (BAG WORK · 3/12): the
        // round for bag work / skip rope, the exercise for strength.
        public var stepIndex: Int?
        public var stepTotal: Int?
        // Strength set counter shown in the big tiles (2/3).
        public var setIndex: Int?
        public var setTotal: Int?
        // Page 55 (the bag round's lock card, approved 2026-10-19). Optional,
        // so a state from an older build or JS bundle still decodes; without
        // them the widget draws today's card.
        // The round, kept apart from the step count: this round in a round
        // and in the rest after it (the header then counts the round coming).
        public var round: Int?
        public var roundTotal: Int?
        // This round's first combo as strikes (JAB, CROSS, HOOK).
        public var combo: [String]?
        // The next round's first combo: the card shows it in rest.
        public var nextCombo: [String]?
        // The combo on the card was found in an MT class (page 49's glove).
        public var fromClass: Bool?
        // The session's one combo size on the card (pt, 14-19), fitted in the
        // app to the session's longest combo.
        public var comboSize: Double?
        // Page 74 (the run with the strap, approved 2026-10-22). Optional, so an
        // older state still decodes; without them the run's card is today's.
        // The heart rate now (nil: no strap, a drop, silent).
        public var hr: Int?
        // The zone against the run's line: "in" (teal), "gold", "over" (ember,
        // EASE OFF), "none" (a dim heart and "--"). Nil: not a strap run.
        public var hrZone: String?
        // Bumped on every heart-rate update the recorder sends, so the heart's
        // soft glow plays once per update (Live Activities can't loop a beat).
        public var hrSeq: Int?
        // GPS distance so far (outdoor runs).
        public var distanceKm: Double?
        // "easy" (one continuous run: pause / play only, never skip) or
        // "runwalk" (skip = the next piece, run <-> walk). Nil: not a run.
        public var runKind: String?

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
            exerciseName: String? = nil,
            iconKey: String? = nil,
            stepIndex: Int? = nil,
            stepTotal: Int? = nil,
            setIndex: Int? = nil,
            setTotal: Int? = nil,
            round: Int? = nil,
            roundTotal: Int? = nil,
            combo: [String]? = nil,
            nextCombo: [String]? = nil,
            fromClass: Bool? = nil,
            comboSize: Double? = nil,
            hr: Int? = nil,
            hrZone: String? = nil,
            hrSeq: Int? = nil,
            distanceKm: Double? = nil,
            runKind: String? = nil
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
            self.iconKey = iconKey
            self.stepIndex = stepIndex
            self.stepTotal = stepTotal
            self.setIndex = setIndex
            self.setTotal = setTotal
            self.round = round
            self.roundTotal = roundTotal
            self.combo = combo
            self.nextCombo = nextCombo
            self.fromClass = fromClass
            self.comboSize = comboSize
            self.hr = hr
            self.hrZone = hrZone
            self.hrSeq = hrSeq
            self.distanceKm = distanceKm
            self.runKind = runKind
        }
    }

    public var sessionType: String
    public var sessionLabel: String

    public init(sessionType: String, sessionLabel: String) {
        self.sessionType = sessionType
        self.sessionLabel = sessionLabel
    }
}

// Page 44's "time ran out" state. A running timer's content goes stale the
// moment it ends, so the system redraws the Live Activity then (with
// `context.isStale`), even when the app is suspended and sends nothing.
// Paused timers, the strength card, between holds and the finish never go
// stale on their own.
@available(iOS 16.2, *)
public extension WaymarkActivityAttributes.ContentState {
    var timerStaleDate: Date? {
        switch phase {
        case "complete", "exercise", "ready":
            return nil
        default:
            return isPaused ? nil : endsAt
        }
    }
}
