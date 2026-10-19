import ActivityKit
import AppIntents
import SwiftUI
import UIKit
import WidgetKit

// The Live Activity and Dynamic Island, as approved on mockup page 44
// (design-decisions.md, "Live Activity", redrawn to iOS's 160 pt limit,
// 2026-10-18). 1 px on the mockup = 1 pt here.
//   - Lock screen card: exactly 160 pt tall, padding 10 / 12.
//       header 22: crest, the session and count on an xs flap, the icon
//       main row 58: the countdown on lg flap tiles (the system's live timer
//         text drawn over tiles, so it counts with no updates from the app),
//         the phase on an xs flap and one 14 pt line, the actions on the right
//       glyph grass 28: the system progress bar masked to glyph rows; gold
//         for work, teal for rest and holds, red when time ran out
//   - Information stays on flaps. Actions are carved rune stones (look B):
//     bundled PNGs (Assets.xcassets/rune-<pause|skip|play>-<gold|teal>),
//     symbols only, wired to the App Intents in TimerIntents.swift.
//   - Per state: round and rest = pause + skip; a strength set = no button,
//     a quiet TAP TO LOG › (tapping the card opens the app); between holds =
//     start; time ran out = skip only (ending belongs in the app); finish =
//     no buttons, the crest, WELL TRAVELED, one line, the grass full.
//   - "Time ran out" is drawn when the running timer's end has passed: the
//     content goes stale at endsAt (timerStaleDate), so the system redraws
//     the card then with context.isStale, even with the app suspended.
// Only the timer and the grass move (iOS draws no flip animation).
//
// The bag round's card (mockup page 55 "combo on two lines", approved
// 2026-10-19), drawn when the state carries a combo: today's card tightened.
//   header 18: crest, BAG WORK · 3/6 (counting rounds), the icon
//   main row 44: the countdown on lg tiles, FIGHT (gold) / REST (teal), the
//     stones (exactly 44)
//   the combo: its own centred line, or two balanced centred lines broken at
//     an arrow when long, at the session's one size (19 pt at most)
//   glyph grass: three rows (21), unchanged
// In rest it shows the next round's combo and counts that round. Nothing
// changes in the last 10 s: iOS can't redraw then; the 10-second bell does it.

// MARK: - Palette (mockups shared/flap.css + page 44)

extension Color {
    init(wmHex hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255.0,
            green: Double((hex >> 8) & 0xFF) / 255.0,
            blue: Double(hex & 0xFF) / 255.0,
            opacity: opacity
        )
    }

    static let wmCard = Color(wmHex: 0x040A08)
    static let wmCardEdge = Color(wmHex: 0xB8984A, opacity: 0.30)
    static let wmBody = Color(wmHex: 0xF0EAD6)
    static let wmBodyDim = Color(wmHex: 0xF0EAD6, opacity: 0.72)
    static let wmTile = Color(wmHex: 0x262A26)
    static let wmTile2 = Color(wmHex: 0x1D201D)
    static let wmInk = Color(wmHex: 0xF0E6C0)
    static let wmGold = Color(wmHex: 0xB8984A)
    static let wmGold2 = Color(wmHex: 0xA0823C)
    static let wmGoldInk = Color(wmHex: 0x1C1608)
    static let wmTeal = Color(wmHex: 0x45796A)
    static let wmTeal2 = Color(wmHex: 0x3A6658)
    static let wmTealInk = Color(wmHex: 0xE8E2C8)
    static let wmClay = Color(wmHex: 0x9C5A40)
    static let wmClay2 = Color(wmHex: 0x864A34)
    static let wmClayInk = Color(wmHex: 0xF2E4D6)
    static let wmGrassGold = Color(wmHex: 0xE8C878)
    static let wmGrassTeal = Color(wmHex: 0x8FD4B8)
    static let wmGrassRed = Color(wmHex: 0xE0623F)
    static let wmGrassOff = Color(wmHex: 0x6E9858, opacity: 0.45)
    static let wmTapNote = Color(wmHex: 0xF0E6C0, opacity: 0.6)
    static let wmCardEdgeTeal = Color(wmHex: 0x5FA08C, opacity: 0.35)
}

// MARK: - Flap tiles

private enum FlapTone {
    case ink, dim, gold, teal, clay

    var top: Color {
        switch self {
        case .ink, .dim: return .wmTile
        case .gold: return .wmGold
        case .teal: return .wmTeal
        case .clay: return .wmClay
        }
    }

    var bottom: Color {
        switch self {
        case .ink, .dim: return .wmTile2
        case .gold: return .wmGold2
        case .teal: return .wmTeal2
        case .clay: return .wmClay2
        }
    }

    var ink: Color {
        switch self {
        case .ink: return .wmInk
        case .dim: return Color.wmInk.opacity(0.74)
        case .gold: return .wmGoldInk
        case .teal: return .wmTealInk
        case .clay: return .wmClayInk
        }
    }
}

// Flap sizes from the mockups (font size in pt): xs 14, sm 17, md 20, lg 32.
private enum FlapSize {
    static let xs: CGFloat = 14
    static let sm: CGFloat = 17
    static let md: CGFloat = 20
    static let lg: CGFloat = 32
}

// Gap between tiles: lg 3, xs 1 (shared/flap.css).
private func flapGap(_ size: CGFloat) -> CGFloat {
    max(1, size * 0.09)
}

// One tile: two halves and the dark split line across the middle.
private struct FlapTileBackground: View {
    let tone: FlapTone
    let radius: CGFloat

    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                Rectangle().fill(tone.top)
                Rectangle().fill(tone.bottom)
            }
            Rectangle()
                .fill(Color.black.opacity(0.45))
                .frame(height: 1)
        }
        .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
        .shadow(color: Color.black.opacity(0.4), radius: 1.5, x: 0, y: 1)
    }
}

private func flapFont(_ size: CGFloat) -> Font {
    .system(size: size, weight: .heavy, design: .monospaced)
}

// A static flap label: one tile per character; a space is a clear gap.
// `gap` overrides the space between tiles (the lock combo's 1.5).
private struct FlapText: View {
    let text: String
    let size: CGFloat
    var tone: FlapTone = .ink
    var gap: CGFloat? = nil

    var body: some View {
        HStack(spacing: gap ?? flapGap(size)) {
            ForEach(Array(text.enumerated()), id: \.offset) { item in
                if item.element == " " {
                    Color.clear
                        .frame(width: size * 0.38, height: size * 1.28)
                } else {
                    Text(String(item.element))
                        .font(flapFont(size))
                        .foregroundStyle(tone.ink)
                        .shadow(color: Color.black.opacity(0.5), radius: 0, x: 0, y: 1)
                        .frame(width: size * 0.74, height: size * 1.28)
                        .background(FlapTileBackground(tone: tone, radius: size * 0.12))
                }
            }
        }
        .fixedSize()
    }
}

// A flap label never truncates: it steps down a size, and only as a last
// resort becomes plain text.
private struct FitFlap: View {
    let text: String
    let size: CGFloat
    var tone: FlapTone = .ink

    var body: some View {
        ViewThatFits(in: .horizontal) {
            FlapText(text: text, size: size, tone: tone)
            FlapText(text: text, size: size * 0.85, tone: tone)
            FlapText(text: text, size: size * 0.7, tone: tone)
            Text(text)
                .font(flapFont(size * 0.85))
                .foregroundStyle(tone == .gold ? Color.wmGold : Color.wmBody)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
    }
}

// MARK: - Countdown on flap tiles

// "m:ss", or "h:mm:ss" from an hour up: the same shape the system timer text
// uses, so the tile count matches what it draws.
private func formatDuration(_ seconds: TimeInterval) -> String {
    let total = Int(max(0, seconds.rounded()))
    let h = total / 3600
    let m = (total % 3600) / 60
    let s = total % 60
    if h > 0 { return String(format: "%d:%02d:%02d", h, m, s) }
    return String(format: "%d:%02d", m, s)
}

// Advance of one character in the monospaced flap font: the pitch at which
// the live timer's characters sit, so each can be cut out into its own tile.
private func monoAdvance(_ size: CGFloat) -> CGFloat {
    let font = UIFont.monospacedSystemFont(ofSize: size, weight: .heavy)
    let width = ("0" as NSString).size(withAttributes: [.font: font]).width
    return width > 0 ? width : size * 0.6
}

@available(iOS 16.2, *)
private func safeRange(_ s: WaymarkActivityAttributes.ContentState) -> ClosedRange<Date> {
    let lo = min(s.startedAt, s.endsAt)
    let hi = max(s.startedAt, s.endsAt)
    return lo...hi
}

// How many tiles the countdown needs: as many characters as its longest
// value. Below that (12:00 → 9:59) the leading tile stays blank, as a flap
// row keeps its padding tiles.
@available(iOS 16.2, *)
private func clockCells(_ s: WaymarkActivityAttributes.ContentState) -> Int {
    var n = formatDuration(s.endsAt.timeIntervalSince(s.startedAt)).count
    if s.isPaused, let remaining = s.pausedRemaining {
        n = max(n, formatDuration(remaining).count)
    }
    return min(7, max(4, n))
}

@available(iOS 16.2, *)
private func clockText(_ s: WaymarkActivityAttributes.ContentState) -> Text {
    if s.isPaused, let remaining = s.pausedRemaining {
        return Text(formatDuration(remaining))
    }
    return Text(timerInterval: safeRange(s), countsDown: true)
}

// The live countdown in flap tiles. Every tile draws the same right-aligned
// timer text, shifted so that only its own character shows through; the
// system keeps that text counting on the lock screen by itself.
@available(iOS 16.2, *)
private struct FlapClock: View {
    let state: WaymarkActivityAttributes.ContentState
    let size: CGFloat
    let tone: FlapTone

    // Spare width to the left of the text, so a timer that measures wider
    // than its digits can never wrap or truncate; trailing alignment keeps
    // the digits at the right edge.
    private let slackCells: CGFloat = 4

    var body: some View {
        let adv = monoAdvance(size)
        let n = clockCells(state)
        let tileW = max(size * 0.74, adv + 2)
        let tileH = size * 1.28
        HStack(spacing: flapGap(size)) {
            ForEach(0..<n, id: \.self) { i in
                clockText(state)
                    .font(flapFont(size))
                    .foregroundStyle(tone.ink)
                    .lineLimit(1)
                    .multilineTextAlignment(.trailing)
                    .frame(width: adv * (CGFloat(n) + slackCells), alignment: .trailing)
                    .offset(x: -adv * (slackCells + CGFloat(i)))
                    .frame(width: adv, alignment: .leading)
                    .clipped()
                    .frame(width: tileW, height: tileH)
                    .background(FlapTileBackground(tone: tone, radius: size * 0.12))
            }
        }
        .fixedSize()
    }
}

// MARK: - Glyph grass strip

private let grassGlyphs: [Character] = Array("/\\|'`,.;:")

// Three rows of blades, the same pattern as the mockup's GRASS().
private let grassRows: [String] = (0..<3).map { r in
    String((0..<120).map { i -> Character in
        if r == 0 && i % 3 != 0 { return " " }
        return grassGlyphs[(i * 7 + r * 13 + (i * i) % 5) % grassGlyphs.count]
    })
}

// Page 44's grass: 10 pt glyphs on 7 pt rows (they overlap, as drawn).
private enum Grass {
    static let fontSize: CGFloat = 10
    static let rowHeight: CGFloat = 7
    static let band: CGFloat = 28
}

private struct GrassGlyphs: View {
    let fontSize: CGFloat
    let rowHeight: CGFloat

    var body: some View {
        // The rows are wider than any card; drawn in an overlay so they never
        // widen the layout, then clipped to the strip.
        Color.clear
            .frame(maxWidth: .infinity)
            .frame(height: rowHeight * 3)
            .overlay(alignment: .topLeading) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(0..<3, id: \.self) { r in
                        Text(grassRows[r])
                            .font(.system(size: fontSize, weight: .heavy, design: .monospaced))
                            .lineLimit(1)
                            .fixedSize()
                            .frame(height: rowHeight, alignment: .leading)
                    }
                }
            }
            .clipped()
    }
}

private enum GrassFill {
    case timer(ClosedRange<Date>)
    case value(Double)
}

private enum GrassTone {
    case gold, teal, red

    var lit: Color {
        switch self {
        case .gold: return .wmGrassGold
        case .teal: return .wmGrassTeal
        case .red: return .wmGrassRed
        }
    }
}

// The grass is a picture filled by the system's own progress bar: the bar,
// stretched to the strip's height, shows only through the glyphs.
private struct GrassStrip: View {
    let fill: GrassFill
    let tone: GrassTone
    var fontSize: CGFloat = Grass.fontSize
    var rowHeight: CGFloat = Grass.rowHeight

    var body: some View {
        ZStack {
            GrassGlyphs(fontSize: fontSize, rowHeight: rowHeight)
                .foregroundStyle(Color.wmGrassOff)
            bar
                .progressViewStyle(.linear)
                .tint(tone.lit)
                .frame(maxWidth: .infinity)
                .scaleEffect(x: 1, y: rowHeight * 3, anchor: .center)
                .frame(height: rowHeight * 3)
                .mask {
                    GrassGlyphs(fontSize: fontSize, rowHeight: rowHeight)
                }
        }
        .frame(height: rowHeight * 3)
    }

    @ViewBuilder
    private var bar: some View {
        switch fill {
        case .timer(let range):
            ProgressView(timerInterval: range, countsDown: false) {
                EmptyView()
            } currentValueLabel: {
                EmptyView()
            }
        case .value(let v):
            ProgressView(value: min(1, max(0, v)))
        }
    }
}

// MARK: - Content helpers

// Extracts (current, total) from "Round 3 of 6", "Set 2 of 5". Fallback for
// states sent before stepIndex / setIndex existed.
private func parseCount(_ label: String) -> (current: Int, total: Int)? {
    let pattern = #"(\d+)\s+of\s+(\d+)"#
    guard let re = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) else { return nil }
    let ns = label as NSString
    guard let m = re.firstMatch(in: label, range: NSRange(location: 0, length: ns.length)) else { return nil }
    guard m.numberOfRanges >= 3 else { return nil }
    let cur = Int(ns.substring(with: m.range(at: 1))) ?? 0
    let tot = Int(ns.substring(with: m.range(at: 2))) ?? 0
    guard cur > 0, tot > 0, cur <= tot else { return nil }
    return (cur, tot)
}

private let knownIconKeys: Set<String> = [
    "strength", "bag", "mt", "zone2", "run", "rope",
    "foundation", "reset", "core", "mobility", "waybook",
]

// Asset name of the painted session icon (Assets.xcassets/session-<key>).
@available(iOS 16.2, *)
private func iconAsset(_ context: ActivityViewContext<WaymarkActivityAttributes>) -> String {
    if let key = context.state.iconKey, knownIconKeys.contains(key) {
        return "session-\(key)"
    }
    switch context.attributes.sessionType {
    case "bag_work": return "session-bag"
    case "strength": return "session-strength"
    case "skip_rope": return "session-rope"
    case "run", "running": return "session-run"
    case "foundation_run": return "session-zone2"
    case "recovery", "active_recovery": return "session-reset"
    case "mt_class": return "session-mt"
    case "core": return "session-core"
    default: return "session-foundation"
    }
}

// The actions a state offers (page 44, "Per state").
private enum RuneAction {
    case pause, resume, skip, startHold
}

@available(iOS 16.2, *)
private struct LAInfo {
    let state: WaymarkActivityAttributes.ContentState
    let sessionLabel: String
    // A running timer whose end has passed ("time ran out").
    let timeUp: Bool

    init(context: ActivityViewContext<WaymarkActivityAttributes>, now: Date = Date()) {
        state = context.state
        sessionLabel = context.attributes.sessionLabel
        let s = context.state
        let timer = s.phase != "complete" && s.phase != "exercise" && s.phase != "ready"
        timeUp = timer && !s.isPaused && (context.isStale || s.endsAt <= now)
    }

    var phase: String { state.phase }
    var isRest: Bool { phase == "rest" }
    var isComplete: Bool { phase == "complete" }
    var isExercise: Bool { phase == "exercise" }
    var isReady: Bool { phase == "ready" }
    var isCard: Bool { isExercise || isReady }
    var isTimer: Bool { !isComplete && !isCard }
    // Rest and holds (the hold itself and between holds) are teal.
    var isTeal: Bool { isRest || phase == "hold" || isReady }

    // Session-level count (round n of N, exercise n of N).
    var step: (current: Int, total: Int)? {
        if let i = state.stepIndex, let t = state.stepTotal, i > 0, t > 0 { return (min(i, t), t) }
        if phase == "active" { return parseCount(state.label) }
        return nil
    }

    // Strength set (or mobility hold) counter for the big tiles.
    var setCount: (current: Int, total: Int)? {
        if let i = state.setIndex, let t = state.setTotal, i > 0, t > 0 { return (min(i, t), t) }
        if isCard { return parseCount(state.label) }
        return nil
    }

    // A bag / rope round: the phase has a round count.
    var isRound: Bool {
        phase == "active" && (state.stepIndex != nil || state.label.lowercased().hasPrefix("round"))
    }

    var headerText: String {
        let session = sessionLabel.uppercased()
        if !isComplete, let c = step { return "\(session) · \(c.current)/\(c.total)" }
        return session
    }

    // The phase on a flap: ROUND 3 (gold) / REST (teal) / SET 2 OF 3 (gold) /
    // NEXT HOLD (teal) / TIME (clay).
    var phaseFlap: String {
        if timeUp { return "TIME" }
        switch phase {
        case "rest": return "REST"
        case "exercise":
            if let c = setCount { return "SET \(c.current) OF \(c.total)" }
            return (state.exerciseName ?? state.detail ?? state.label).uppercased()
        case "ready": return "NEXT HOLD"
        default:
            if isRound, let c = step { return "ROUND \(c.current)" }
            return state.label.uppercased()
        }
    }

    // The one line beside the phase flap: the combo, what's next, the lift,
    // the hold, or what just finished.
    var phaseLine: String? {
        if timeUp {
            if isRound, let c = step { return "Round \(c.current) done" }
            let what = state.label.trimmingCharacters(in: .whitespaces)
            return what.isEmpty ? nil : "\(what) done"
        }
        let line: String?
        switch phase {
        case "exercise":
            line = state.exerciseName ?? state.detail
        case "ready":
            line = state.exerciseName ?? state.detail ?? (setCount == nil ? state.label : nil)
        default:
            line = state.detail
        }
        guard let l = line, !l.isEmpty else { return nil }
        return l
    }

    var phaseTone: FlapTone {
        if timeUp { return .clay }
        if isTeal { return .teal }
        return .gold
    }

    var clockTone: FlapTone {
        if timeUp { return .clay }
        if isTeal { return .teal }
        return state.isPaused ? .dim : .ink
    }

    var grassTone: GrassTone {
        if timeUp { return .red }
        return isTeal ? .teal : .gold
    }

    var grass: GrassFill {
        if isComplete || timeUp { return .value(1) }
        if isCard {
            if let c = setCount { return .value(Double(c.current) / Double(c.total)) }
            return .value(0)
        }
        if state.isPaused, let remaining = state.pausedRemaining {
            let total = max(1, state.endsAt.timeIntervalSince(state.startedAt))
            return .value(1 - remaining / total)
        }
        return .timer(safeRange(state))
    }

    // Round and rest: pause + skip. Other running timers: pause. Between
    // holds: start. Time ran out: skip. Strength set and finish: none.
    var actions: [RuneAction] {
        if isComplete || isExercise { return [] }
        if isReady { return [.startHold] }
        if timeUp { return [.skip] }
        let skips = isRound || isRest
        let first: RuneAction = state.isPaused ? .resume : .pause
        return skips ? [first, .skip] : [first]
    }

    // Time ran out keeps the gold stone (page 44); rest and holds are teal.
    var runesTeal: Bool { isTeal && !timeUp }

    // MARK: The bag round's card (page 55)

    // The combo on the card: this round's in a round, the next round's in rest.
    var shownCombo: [String]? {
        let combo = isRest ? state.nextCombo : (phase == "active" ? state.combo : nil)
        guard let c = combo, !c.isEmpty else { return nil }
        return c
    }

    // The bag round's card is drawn whenever there is a combo to show.
    var isBagCard: Bool { !isComplete && shownCombo != nil }

    // The round the card is about (in rest, the round coming), kept apart
    // from the step count; an older JS bundle falls back to the step.
    var roundCount: (current: Int, total: Int)? {
        if let r = state.round, let t = state.roundTotal, r > 0, t > 0 {
            let n = isRest ? r + 1 : r
            return (min(n, t), t)
        }
        return step
    }

    var bagHeaderText: String {
        let session = sessionLabel.uppercased()
        if let c = roundCount { return "\(session) · \(c.current)/\(c.total)" }
        return session
    }

    // FIGHT (gold) or REST (teal) beside the clock; TIME (clay) when it ran out.
    var bagPhaseFlap: String {
        if timeUp { return "TIME" }
        return isRest ? "REST" : "FIGHT"
    }

    // The session's one combo size, sent by the app (14-19 pt).
    var comboSize: CGFloat {
        let pt = state.comboSize ?? Double(LockComboSize.max)
        guard pt.isFinite else { return LockComboSize.max }
        return min(LockComboSize.max, max(LockComboSize.min, CGFloat(pt)))
    }

    // Long-press island: ROUND 3 OF 12, SET 2 OF 3, REST, TIME.
    var islandFlap: String {
        if isComplete { return "WELL TRAVELED" }
        if timeUp { return "TIME" }
        if isRest { return "REST" }
        if isRound, let c = step { return "ROUND \(c.current) OF \(c.total)" }
        return phaseFlap
    }

    var islandLine: String? {
        if isComplete { return state.completeMessage }
        return phaseLine
    }
}

// MARK: - Crest and icon

private struct CrestImage: View {
    var big = false

    var body: some View {
        Image(big ? "crest-big" : "crest-small")
            .resizable()
            .interpolation(.high)
            .scaledToFit()
    }
}

@available(iOS 16.2, *)
private struct SessionIcon: View {
    let context: ActivityViewContext<WaymarkActivityAttributes>

    var body: some View {
        Image(iconAsset(context))
            .resizable()
            .interpolation(.high)
            .scaledToFit()
    }
}

// MARK: - Rune stones (the actions)

// The stone with its carved, glowing symbol, rendered from the mockup at 3x
// (Assets.xcassets/rune-*). No words on them.
private struct RuneStone: View {
    let symbol: String  // "pause", "skip", "play"
    let teal: Bool
    var size: CGFloat = 44

    var body: some View {
        Image("rune-\(symbol)-\(teal ? "teal" : "gold")")
            .resizable()
            .interpolation(.high)
            .scaledToFit()
            .frame(width: size, height: size)
    }
}

@available(iOS 17.0, *)
private struct RuneButton<I: AppIntent>: View {
    let intent: I
    let symbol: String
    let teal: Bool
    let name: String
    var size: CGFloat = 44

    var body: some View {
        Button(intent: intent) {
            RuneStone(symbol: symbol, teal: teal, size: size)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(name))
    }
}

// The row of rune stones a state offers, wired to the existing intents.
@available(iOS 16.2, *)
private struct RuneRow: View {
    let info: LAInfo
    var spacing: CGFloat = 10
    var size: CGFloat = 44

    var body: some View {
        if #available(iOS 17.0, *) {
            HStack(spacing: spacing) {
                ForEach(Array(info.actions.enumerated()), id: \.offset) { item in
                    rune(item.element)
                }
            }
        }
    }

    @available(iOS 17.0, *)
    @ViewBuilder
    private func rune(_ action: RuneAction) -> some View {
        let teal = info.runesTeal
        switch action {
        case .pause:
            RuneButton(intent: PauseTimerIntent(), symbol: "pause", teal: teal, name: "Pause", size: size)
        case .resume:
            RuneButton(intent: ResumeTimerIntent(), symbol: "play", teal: teal, name: "Resume", size: size)
        case .skip:
            RuneButton(intent: AdvancePhaseIntent(), symbol: "skip", teal: teal, name: "Skip", size: size)
        case .startHold:
            RuneButton(intent: StartHoldIntent(), symbol: "play", teal: teal, name: "Start hold", size: size)
        }
    }
}

// The quiet note on a strength set: the card itself opens the app to log.
private struct TapToLog: View {
    var body: some View {
        Text("TAP TO LOG ›")
            .font(.system(size: 11, weight: .heavy))
            .tracking(1.5)
            .foregroundStyle(Color.wmTapNote)
            .lineLimit(1)
            .fixedSize()
    }
}

// MARK: - Big tiles (the countdown, or the set / hold counter)

@available(iOS 16.2, *)
private struct BigTiles: View {
    let info: LAInfo
    let size: CGFloat

    var body: some View {
        if info.timeUp {
            FlapText(text: formatDuration(0), size: size, tone: .clay)
        } else if info.isCard {
            let tone: FlapTone = info.isReady ? .teal : .gold
            if let c = info.setCount {
                FlapText(text: "\(c.current)/\(c.total)", size: size, tone: tone)
            } else {
                FlapText(text: "GO", size: size, tone: tone)
            }
        } else {
            FlapClock(state: info.state, size: size, tone: info.clockTone)
        }
    }
}

// MARK: - The combo on the lock card (page 55)

private enum LockComboSize {
    static let max: CGFloat = 19
    static let min: CGFloat = 14
}

// Two balanced lines broken at an arrow (page 55 `split2`, and
// lib/timers/bagRound.ts splitTwoLines): the break that makes the longer line
// shortest, counting letters and 1.6 per strike. One strike stays one line.
private func splitTwoLines(_ strikes: [String]) -> [[String]] {
    guard strikes.count >= 2 else { return [strikes] }
    func weight(_ part: ArraySlice<String>) -> Double {
        Double(part.joined().count) + Double(part.count) * 1.6
    }
    var bestIndex = 1
    var bestWeight = Double.infinity
    for i in 1..<strikes.count {
        let m = max(weight(strikes[0..<i]), weight(strikes[i...]))
        if m < bestWeight {
            bestWeight = m
            bestIndex = i
        }
    }
    return [Array(strikes[0..<bestIndex]), Array(strikes[bestIndex...])]
}

// The combo, centred: one line when it fits, else two balanced lines, at the
// session's size. Strikes are ink flap tiles joined by gold (teal in rest) ›;
// a combo found in class ends on the small MT glove (page 49). Only a phone
// narrower than the app planned for steps the size down.
private struct LockCombo: View {
    let strikes: [String]
    let size: CGFloat
    let teal: Bool
    let fromClass: Bool

    var body: some View {
        let two = splitTwoLines(strikes)
        ViewThatFits(in: .horizontal) {
            lines([strikes], size: size)
            lines(two, size: size)
            lines(two, size: max(LockComboSize.min, size - 1))
            lines(two, size: max(LockComboSize.min, size - 2))
            lines(two, size: LockComboSize.min)
                .minimumScaleFactor(0.7)
        }
    }

    private func lines(_ parts: [[String]], size: CGFloat) -> some View {
        VStack(alignment: .center, spacing: 3) {
            ForEach(Array(parts.enumerated()), id: \.offset) { item in
                line(item.element, more: item.offset < parts.count - 1, last: item.offset == parts.count - 1, size: size)
            }
        }
    }

    private func line(_ part: [String], more: Bool, last: Bool, size: CGFloat) -> some View {
        HStack(spacing: 4) {
            ForEach(Array(part.enumerated()), id: \.offset) { item in
                if item.offset > 0 {
                    arrow
                }
                FlapText(text: item.element, size: size, tone: .ink, gap: 1.5)
            }
            if more {
                arrow
            }
            if last && fromClass {
                Image("session-mt")
                    .resizable()
                    .interpolation(.high)
                    .scaledToFit()
                    .frame(width: size, height: size)
                    .accessibilityLabel(Text("From class"))
            }
        }
        .fixedSize()
    }

    private var arrow: some View {
        Text("›")
            .font(.system(size: 14, weight: .heavy, design: .monospaced))
            .foregroundStyle(teal ? Color.wmGrassTeal : Color.wmGrassGold)
            .accessibilityHidden(true)
    }
}

// MARK: - Lock screen

@available(iOS 16.2, *)
private struct LockScreenView: View {
    let context: ActivityViewContext<WaymarkActivityAttributes>

    var body: some View {
        let info = LAInfo(context: context)
        if info.isBagCard {
            bagCard(info)
        } else {
            card(info)
        }
    }

    // Today's card (page 44): every session but a bag round with its combo.
    private func card(_ info: LAInfo) -> some View {
        VStack(spacing: 0) {
            header(info)
            Spacer(minLength: 0)
            if info.isComplete {
                finish(info)
            } else {
                mainRow(info)
            }
            Spacer(minLength: 0)
            GrassStrip(fill: info.grass, tone: info.grassTone)
                .padding(.horizontal, -2)
                .frame(height: Grass.band, alignment: .top)
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity)
        .frame(height: 160)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(Color.wmCardEdge, lineWidth: 1)
        )
    }

    // The bag round's card (page 55 "combo on two lines"): header 18, main row
    // 44, the combo on one or two centred lines, the grass's three rows (21);
    // padding 9 / 8 / 12; 160 pt tall.
    private func bagCard(_ info: LAInfo) -> some View {
        VStack(spacing: 0) {
            bagHeader(info)
            Spacer(minLength: 0)
            bagMainRow(info)
            Spacer(minLength: 0)
            LockCombo(
                strikes: info.shownCombo ?? [],
                size: info.comboSize,
                teal: info.isRest,
                fromClass: info.state.fromClass ?? false
            )
            // The lines may run a little into the side padding (page 55).
            .padding(.horizontal, -8)
            .frame(maxWidth: .infinity)
            Spacer(minLength: 0)
            GrassStrip(fill: info.grass, tone: info.grassTone)
                .padding(.horizontal, -2)
                .frame(height: Grass.rowHeight * 3, alignment: .top)
        }
        .padding(.top, 9)
        .padding(.bottom, 8)
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity)
        .frame(height: 160)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(info.isRest ? Color.wmCardEdgeTeal : Color.wmCardEdge, lineWidth: 1)
        )
    }

    // 18 pt: crest 16, BAG WORK · 3/6 on an xs flap, the icon 20.
    private func bagHeader(_ info: LAInfo) -> some View {
        HStack(spacing: 7) {
            CrestImage()
                .frame(width: 16, height: 18)
            FitFlap(text: info.bagHeaderText, size: FlapSize.xs)
                .layoutPriority(1)
            Spacer(minLength: 4)
            SessionIcon(context: context)
                .frame(width: 20, height: 20)
        }
        .frame(height: 18)
    }

    // 44 pt: the lg countdown, FIGHT / REST beside it, the stones on the right.
    private func bagMainRow(_ info: LAInfo) -> some View {
        HStack(alignment: .center, spacing: 10) {
            BigTiles(info: info, size: FlapSize.lg)
            FitFlap(text: info.bagPhaseFlap, size: FlapSize.sm, tone: info.phaseTone)
            Spacer(minLength: 0)
            RuneRow(info: info, spacing: 8)
        }
        .frame(height: 44)
    }

    // 22 pt: crest 18, the session and count on an xs flap, the icon 24.
    private func header(_ info: LAInfo) -> some View {
        HStack(spacing: 7) {
            CrestImage()
                .frame(width: 18, height: 20)
            FitFlap(text: info.headerText, size: FlapSize.xs)
                .layoutPriority(1)
            Spacer(minLength: 4)
            SessionIcon(context: context)
                .frame(width: 24, height: 24)
        }
        .frame(height: 22)
    }

    // 58 pt: the lg tiles, the phase flap and one line, the actions.
    private func mainRow(_ info: LAInfo) -> some View {
        HStack(alignment: .center, spacing: 10) {
            BigTiles(info: info, size: FlapSize.lg)
            VStack(alignment: .leading, spacing: 5) {
                FitFlap(text: info.phaseFlap, size: FlapSize.xs, tone: info.phaseTone)
                if let line = info.phaseLine {
                    Text(line)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color.wmBody)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .layoutPriority(1)
            if info.isExercise {
                TapToLog()
            } else {
                RuneRow(info: info)
            }
        }
        .frame(height: 58)
    }

    // The crest, WELL TRAVELED and one line (the grass below is full).
    private func finish(_ info: LAInfo) -> some View {
        HStack(alignment: .center, spacing: 12) {
            CrestImage(big: true)
                .frame(width: 56, height: 62)
                .shadow(color: Color.wmGrassGold.opacity(0.55), radius: 7)
            VStack(alignment: .leading, spacing: 6) {
                FitFlap(text: "WELL TRAVELED", size: FlapSize.sm, tone: .gold)
                if let msg = info.state.completeMessage, !msg.isEmpty {
                    Text(msg)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color.wmBody)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Dynamic Island

// Compact: the countdown on small gold flap tiles (teal in rest and holds);
// the set counter on a strength set; the crest at the finish.
@available(iOS 16.2, *)
private struct CompactTrailing: View {
    let context: ActivityViewContext<WaymarkActivityAttributes>

    var body: some View {
        let info = LAInfo(context: context)
        if info.isComplete {
            CrestImage()
                .frame(width: 18, height: 20)
        } else if info.timeUp {
            FlapText(text: formatDuration(0), size: FlapSize.xs, tone: .clay)
        } else if info.isCard {
            let tone: FlapTone = info.isReady ? .teal : .gold
            if let c = info.setCount {
                FlapText(text: "\(c.current)/\(c.total)", size: FlapSize.xs, tone: tone)
            } else {
                FlapText(text: "GO", size: FlapSize.xs, tone: tone)
            }
        } else {
            // xs (14) for m:ss; smaller for the rare long timer so it fits.
            let cells = clockCells(info.state)
            let size: CGFloat = cells <= 4 ? FlapSize.xs : (cells == 5 ? 12 : 10)
            FlapClock(state: info.state, size: size, tone: info.isTeal ? .teal : (info.state.isPaused ? .dim : .gold))
        }
    }
}

@available(iOS 16.2, *)
private struct ExpandedCenter: View {
    let context: ActivityViewContext<WaymarkActivityAttributes>

    var body: some View {
        let info = LAInfo(context: context)
        VStack(alignment: .leading, spacing: 4) {
            FitFlap(text: info.islandFlap, size: FlapSize.xs, tone: info.isComplete ? .gold : info.phaseTone)
            if let line = info.islandLine, !line.isEmpty {
                Text(line)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.wmBody)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

@available(iOS 16.2, *)
private struct ExpandedTrailing: View {
    let context: ActivityViewContext<WaymarkActivityAttributes>

    var body: some View {
        let info = LAInfo(context: context)
        Group {
            if info.isComplete {
                CrestImage(big: true)
                    .frame(width: 36, height: 40)
                    .shadow(color: Color.wmGrassGold.opacity(0.55), radius: 6)
            } else {
                BigTiles(info: info, size: FlapSize.md)
            }
        }
        .frame(maxHeight: .infinity)
        .padding(.trailing, 2)
    }
}

// The grass, then the same rune stones centred under it.
@available(iOS 16.2, *)
private struct ExpandedBottom: View {
    let context: ActivityViewContext<WaymarkActivityAttributes>

    var body: some View {
        let info = LAInfo(context: context)
        VStack(spacing: 8) {
            GrassStrip(fill: info.grass, tone: info.grassTone)
            if !info.actions.isEmpty {
                RuneRow(info: info, spacing: 16)
                    .frame(maxWidth: .infinity)
            }
        }
        .padding(.top, 4)
    }
}

// MARK: - Widget entry point

@available(iOS 16.2, *)
struct WaymarkActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WaymarkActivityAttributes.self) { context in
            LockScreenView(context: context)
                .activityBackgroundTint(Color.wmCard.opacity(0.94))
                .activitySystemActionForegroundColor(Color.wmBody)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    SessionIcon(context: context)
                        .frame(width: 36, height: 36)
                        .frame(maxHeight: .infinity)
                        .padding(.leading, 2)
                }
                DynamicIslandExpandedRegion(.center) {
                    ExpandedCenter(context: context)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    ExpandedTrailing(context: context)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    ExpandedBottom(context: context)
                }
            } compactLeading: {
                SessionIcon(context: context)
                    .frame(width: 24, height: 24)
            } compactTrailing: {
                CompactTrailing(context: context)
            } minimal: {
                SessionIcon(context: context)
                    .frame(width: 22, height: 22)
            }
        }
    }
}
