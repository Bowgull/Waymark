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
//
// The run with the strap (mockup page 74, approved 2026-10-22), drawn when a
// run's state carries hrZone: the run card with the distance top right, the
// heart container (14) and the bpm under RUNNING / EASE OFF, the rule and
// grass in the zone's tint (teal / gold / ember); the island's heart and bpm.
// The heart can't beat here: it glows once per heart-rate update (hrSeq).
// Nothing on a run's card or island ends, logs or discards it: an easy run
// has one wide pause / play stone filling the pair's slot; a run-walk has
// pause / play and skip (the next piece). The stones take the zone's colour.
//
// Every card's grass (mockup page 82, approved 2026-10-23): the grass is the
// system's own progress fill and never sways. It takes the moment's colour
// (glowTone from the app; on a strap run the widget reads the zone itself) and
// glows softly in it; when the change counter (glowSeq, like the heart's
// hrSeq) moves, it glows brighter once and eases back. A colour change alone
// (bag work's and the timer's orange) never flashes. Reduce Motion: no flash.
// The island's big number glows and flashes with it.
//
// The interval timer's card (mockup page 81): the crest, INTERVAL TIMER, ROUND
// 3 OF 8; the countdown to the part's end, the phase word (WORK gold, REST and
// GET READY teal, orange near the end), the pause stone only; the grass fills
// the part. Its island: 3/8 and the time in the phase colour; long-press for
// the big time, ROUND 3/8, the phase and the pause stone. Nothing ends or logs.

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
    // Page 82's moment colours (mockup ZC).
    static let wmGlowTeal = Color(wmHex: 0x4ACAAA)
    static let wmGlowGold = Color(wmHex: 0xE8C878)
    static let wmGlowEmber = Color(wmHex: 0xEC8A5E)
    static let wmGlowOrange = Color(wmHex: 0xF0A060)
    // Page 86: the bag finisher's own red (its clock digits).
    static let wmGlowRed = Color(wmHex: 0xF27C6C)
}

// glowTone from the app ("teal", "gold", "ember", "orange", "red").
private func glowColor(_ raw: String?) -> Color? {
    switch raw {
    case "teal": return .wmGlowTeal
    case "gold": return .wmGlowGold
    case "ember": return .wmGlowEmber
    case "orange": return .wmGlowOrange
    case "red": return .wmGlowRed
    default: return nil
    }
}

// MARK: - Flap tiles

private enum FlapTone {
    case ink, dim, gold, teal, clay, orange

    var top: Color {
        switch self {
        case .ink, .dim: return .wmTile
        case .gold: return .wmGold
        case .teal: return .wmTeal
        case .clay: return .wmClay
        case .orange: return Color(wmHex: 0xE0904A)
        }
    }

    var bottom: Color {
        switch self {
        case .ink, .dim: return .wmTile2
        case .gold: return .wmGold2
        case .teal: return .wmTeal2
        case .clay: return .wmClay2
        case .orange: return Color(wmHex: 0xCF7F3A)
        }
    }

    var ink: Color {
        switch self {
        case .ink: return .wmInk
        case .dim: return Color.wmInk.opacity(0.74)
        case .gold: return .wmGoldInk
        case .teal: return .wmTealInk
        case .clay: return .wmClayInk
        case .orange: return Color(wmHex: 0x141008)
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
    // Page 84: the 5K test's open piece counts up from its start.
    if s.countsUp == true {
        return Text(timerInterval: s.startedAt...s.startedAt.addingTimeInterval(6 * 3600), countsDown: false)
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
    // Page 74: the strap run's zone tint (teal / gold / ember).
    case tint(Color)

    var lit: Color {
        switch self {
        case .gold: return .wmGrassGold
        case .teal: return .wmGrassTeal
        case .red: return .wmGrassRed
        case .tint(let c): return c
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
    // The unlit blades (page 74: the zone colour at .28 on a strap run).
    var off: Color = .wmGrassOff
    // Page 82: the lit blades' steady soft glow, and what makes them flash
    // once (a new key). Nil: no glow (an older state).
    var glow: Color? = nil
    var flashKey: String = ""

    var body: some View {
        ZStack {
            GrassGlyphs(fontSize: fontSize, rowHeight: rowHeight)
                .foregroundStyle(off)
            if let g = glow {
                lit.modifier(FlashOnChange(key: flashKey, color: g, soft: 2.5, peak: 7))
            } else {
                lit
            }
        }
        .frame(height: rowHeight * 3)
    }

    private var lit: some View {
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

// MARK: - The glow and the flash (page 82)

// One level of the glow: k 0 = the steady soft glow, k 1 = the flash's peak.
private struct GlowLevel: ViewModifier {
    let color: Color
    let k: Double
    let soft: CGFloat
    let peak: CGFloat

    func body(content: Content) -> some View {
        content
            .brightness(0.42 * k)
            .shadow(color: color.opacity(0.55 + 0.4 * k), radius: soft + (peak - soft) * CGFloat(k))
    }
}

// A steady soft glow in `color`; when `key` changes, the view comes back at
// the flash's peak and eases to the soft glow (about 0.9 s), once. Live
// Activities can't loop: this is the heart's hrSeq transition, for anything.
private struct FlashOnChange: ViewModifier {
    let key: String
    let color: Color
    var soft: CGFloat = 2.5
    var peak: CGFloat = 8
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        ZStack {
            content
                .id(key)
                .transition(flashOnce)
        }
        .animation(reduceMotion ? nil : .easeOut(duration: 0.9), value: key)
    }

    private var flashOnce: AnyTransition {
        let steady = GlowLevel(color: color, k: 0, soft: soft, peak: peak)
        if reduceMotion { return AnyTransition.modifier(active: steady, identity: steady) }
        return AnyTransition.asymmetric(
            insertion: AnyTransition.modifier(active: GlowLevel(color: color, k: 1, soft: soft, peak: peak), identity: steady),
            removal: AnyTransition.identity
        )
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

// MARK: - The strap run's zone (page 74)

// hrZone from the recorder: "in" teal, "gold" the top of the zone, "over"
// ember (EASE OFF), "none" a dim heart and "--". Nil: not a strap run.
private enum HRZone {
    case inZone, gold, over, off

    init?(_ raw: String?) {
        guard let raw = raw else { return nil }
        switch raw {
        case "in": self = .inZone
        case "gold": self = .gold
        case "over": self = .over
        case "none": self = .off
        default: return nil
        }
    }

    var isLive: Bool { self != .off }

    // The number (mockup ZC / .hrl b): teal, gold, ember, dim.
    var number: Color {
        switch self {
        case .inZone: return Color(wmHex: 0x4ACAAA)
        case .gold: return Color(wmHex: 0xE8C878)
        case .over: return Color(wmHex: 0xE8946E)
        case .off: return Color(wmHex: 0x87918C)
        }
    }

    // The grass tint (mockup .la.z-* .lgrass).
    var tint: Color {
        switch self {
        case .inZone: return Color(wmHex: 0x4ACAAA)
        case .gold: return Color(wmHex: 0xE8C878)
        case .over: return Color(wmHex: 0xEC8A5E)
        case .off: return .wmGrassGold
        }
    }

    // The card's rule and its soft glow (mockup .la.z-in / .z-gold / .z-over).
    var edge: Color {
        switch self {
        case .inZone: return Color(wmHex: 0x4ACAAA, opacity: 0.55)
        case .gold: return Color(wmHex: 0xE8C860, opacity: 0.62)
        case .over: return Color(wmHex: 0xEC8A5E, opacity: 0.70)
        case .off: return .wmCardEdge
        }
    }

    var edgeGlow: Color {
        switch self {
        case .inZone: return Color(wmHex: 0x4ACAAA, opacity: 0.12)
        case .gold: return Color(wmHex: 0xE8C860, opacity: 0.14)
        case .over: return Color(wmHex: 0xEC8A5E, opacity: 0.16)
        case .off: return .clear
        }
    }

    var runeTone: RuneTone? {
        switch self {
        case .inZone: return .teal
        case .gold: return .gold
        case .over: return .ember
        case .off: return nil
        }
    }

    var heart: HeartPal {
        switch self {
        case .inZone: return .under
        case .gold: return .gold
        case .over: return .over
        case .off: return .idle
        }
    }
}

@available(iOS 16.2, *)
private struct LAInfo {
    let state: WaymarkActivityAttributes.ContentState
    let sessionLabel: String
    // A running timer whose end has passed ("time ran out").
    let timeUp: Bool
    // The run's Live Activity (page 74 draws its strap card).
    let isRun: Bool
    // Page 81: the hidden interval timer's card.
    let isInterval: Bool

    init(context: ActivityViewContext<WaymarkActivityAttributes>, now: Date = Date()) {
        state = context.state
        sessionLabel = context.attributes.sessionLabel
        isRun = context.attributes.sessionType == "run" || context.attributes.sessionType == "running"
        isInterval = context.attributes.sessionType == "interval_timer"
        let s = context.state
        let timer = s.phase != "complete" && s.phase != "exercise" && s.phase != "ready"
        timeUp = timer && !s.isPaused && s.countsUp != true && (context.isStale || s.endsAt <= now)
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
        // Page 82: a whole-session fill (Reset) when the app sends one.
        if state.isPaused, let v = state.fillValue, v.isFinite { return .value(min(1, max(0, v))) }
        if !state.isPaused, let from = state.fillFrom, let to = state.fillTo, to > from { return .timer(from...to) }
        if state.isPaused, let remaining = state.pausedRemaining {
            let total = max(1, state.endsAt.timeIntervalSince(state.startedAt))
            // Page 84: counting up, pausedRemaining is the time in.
            if state.countsUp == true { return .value(remaining / total) }
            return .value(1 - remaining / total)
        }
        return .timer(safeRange(state))
    }

    // MARK: Every card's grass (page 82)

    // The moment's colour: the lit grass, its glow, the island's big number.
    // A strap run reads the zone itself (the recorder changes it locked):
    // Zone 2 teal / gold / ember; run-walk teal walking, the zone running;
    // tempo / intervals ember when well over, teal easy, gold hard. Otherwise
    // the app's glowTone, else today's colours. Time ran out stays red.
    var momentColor: Color {
        if timeUp { return .wmGrassRed }
        if isStrapRun {
            let z = zone ?? .off
            if isHardRun { return z == .over ? .wmGlowEmber : (isRest ? .wmGlowTeal : .wmGlowGold) }
            if isRunWalk && isRest { return .wmGlowTeal }
            return z.isLive ? z.tint : .wmGlowGold
        }
        if let c = glowColor(state.glowTone) { return c }
        return grassTone.lit
    }

    // What makes the grass flash once: the app's change counter; on a Zone 2
    // run also a zone change and the run's time being reached; on a hard run
    // also EASE OFF. A run-walk flashes at its switches only.
    var flashKey: String {
        let seq = state.glowSeq ?? 0
        if isRun {
            if isHardRun { return "\(seq)|\(zone == .over)" }
            if isRunWalk { return "\(seq)" }
            return "\(seq)|\(state.hrZone ?? "")|\(timeUp)"
        }
        return "\(seq)"
    }

    // MARK: The interval timer (page 81)

    var intervalRound: (current: Int, total: Int)? {
        if let r = state.round, let t = state.roundTotal, r > 0, t > 0 { return (min(r, t), t) }
        return step
    }

    var intervalRoundText: String {
        guard let c = intervalRound else { return "" }
        return "ROUND \(c.current) OF \(c.total)"
    }

    var intervalShortRound: String {
        guard let c = intervalRound else { return "" }
        return "\(c.current)/\(c.total)"
    }

    // WORK / REST / GET READY, PAUSED; the plate gold, teal, or orange near the end.
    var intervalPhase: (text: String, tone: FlapTone) {
        if state.isPaused { return ("PAUSED", .ink) }
        if timeUp { return ("TIME", .clay) }
        let word = state.label.trimmingCharacters(in: .whitespaces).uppercased()
        if state.glowTone == "orange" { return (word, .orange) }
        return (word, isRest ? .teal : .gold)
    }

    // Round and rest: pause + skip. Other running timers: pause. Between
    // holds: start. Time ran out: skip. Strength set and finish: none.
    // Page 74: nothing on the card or the island ends, logs or discards a
    // run. An easy run: pause / play only (never skip, even when its time ran
    // out); a run-walk: pause / play and skip (the next piece).
    var actions: [RuneAction] {
        if isComplete || isExercise { return [] }
        if isReady { return [.startHold] }
        // Page 81: the timer's one stone, pause / play. Never an end or a skip.
        if isInterval { return [state.isPaused ? .resume : .pause] }
        if isEasyRun || isRunWalk || isHardRun {
            let first: RuneAction = state.isPaused ? .resume : .pause
            return isRunWalk || isHardRun ? [first, .skip] : [first]
        }
        if timeUp { return [.skip] }
        let skips = isRound || isRest
        let first: RuneAction = state.isPaused ? .resume : .pause
        return skips ? [first, .skip] : [first]
    }

    // Time ran out keeps the gold stone (page 44); rest and holds are teal.
    var runesTeal: Bool { isTeal && !timeUp }

    // MARK: The strap run (page 74)

    var isEasyRun: Bool { state.runKind == "easy" }
    var isRunWalk: Bool { state.runKind == "runwalk" }
    // Page 76: a hard run (intervals, tempo, the 5K test): skip = the next piece.
    var isHardRun: Bool { state.runKind == "hard" }

    // The zone, on a run only (nil: not a strap run, today's card).
    var zone: HRZone? { isRun ? HRZone(state.hrZone) : nil }

    // The strap run's card and island are drawn while the run is going.
    var isStrapRun: Bool { zone != nil && !isComplete && !isCard }

    // The stones take the zone's colour (teal, gold, ember); with no strap
    // (or no zone) they keep today's colours.
    var runeTone: RuneTone {
        if !isComplete, let z = zone, let tone = z.runeTone { return tone }
        // The timer's stone: gold work, teal rest, ember for the orange (the nearest carved stone).
        if isInterval && !isComplete {
            if state.glowTone == "orange" { return .ember }
            return isRest ? .teal : .gold
        }
        return runesTeal ? .teal : .gold
    }

    // One control on an easy run: the stone fills the pair's slot.
    var soloStone: Bool { (isEasyRun || isInterval) && actions.count == 1 }

    var runTitle: String {
        if isRunWalk { return "RUN-WALK" }
        let l = state.label.trimmingCharacters(in: .whitespaces)
        return (l.isEmpty ? sessionLabel : l).uppercased()
    }

    // "1.41 km" (nil before the first fix and indoors).
    var kmText: String? {
        guard let km = state.distanceKm, km.isFinite, km >= 0 else { return nil }
        return String(format: "%.2f km", km)
    }

    // The number beside the heart: "--" with no strap or no reading.
    var bpmText: String {
        guard let z = zone, z.isLive, let hr = state.hr, hr > 0 else { return "--" }
        return "\(hr)"
    }

    // The heart's zone: dim when there's no reading.
    var heartZone: HRZone {
        guard let z = zone, state.hr != nil else { return .off }
        return z
    }

    var hrSeq: Int { state.hrSeq ?? 0 }

    // The lock card's flap under the clock: PAUSED, EASE OFF (clay) when
    // over, TIME when it ran out, WALK (teal) in a run-walk's walk, RUNNING.
    var runFlap: (text: String, tone: FlapTone) {
        if state.isPaused { return ("PAUSED", .ink) }
        if zone == .over { return ("EASE OFF", .clay) }
        if timeUp { return ("TIME", .clay) }
        if isRunWalk && isRest { return ("WALK", .teal) }
        if isHardRun, let p = state.runPhase, !p.isEmpty { return (p, isRest ? .teal : .gold) }
        return ("RUNNING", .gold)
    }

    // The run-walk's piece count on the island ("RUN 3 OF 6"), when the
    // app sends one.
    var runPieceFlap: String? {
        if isHardRun, let p = state.runPhase, let i = state.stepIndex, let t = state.stepTotal, i > 0, t > 0 { return "\(p) \(min(i, t)) OF \(t)" }
        guard isRunWalk, let i = state.stepIndex, let t = state.stepTotal, i > 0, t > 0 else { return nil }
        return "\(isRest ? "WALK" : "RUN") \(min(i, t)) OF \(t)"
    }

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

// The glowing glyph's colour: gold (work), teal (rest, holds, in the zone),
// ember (page 74: over the line). Assets.xcassets/rune-<symbol>-<asset>.
private enum RuneTone {
    case gold, teal, ember

    var asset: String {
        switch self {
        case .gold: return "gold"
        case .teal: return "teal"
        case .ember: return "ember"
        }
    }

    // The glyph and its glow, as carved into the PNG stones.
    var glyph: Color {
        switch self {
        case .gold: return Color(wmHex: 0xE8C878)
        case .teal: return Color(wmHex: 0x9EE0C6)
        case .ember: return Color(wmHex: 0xEC8A5E)
        }
    }

    var glow: Color {
        switch self {
        case .gold: return Color(wmHex: 0xE8C878, opacity: 0.8)
        case .teal: return Color(wmHex: 0x4ACAAA, opacity: 0.8)
        case .ember: return Color(wmHex: 0xEC8A5E, opacity: 0.8)
        }
    }
}

// The stone with its carved, glowing symbol, rendered from the mockup at 3x
// (Assets.xcassets/rune-*). No words on them. With a `width` wider than it is
// tall it becomes the wide solo stone (page 74).
private struct RuneStone: View {
    let symbol: String  // "pause", "skip", "play"
    let tone: RuneTone
    var size: CGFloat = 44
    var width: CGFloat? = nil

    var body: some View {
        if let w = width, w > size {
            WideRuneStone(symbol: symbol, tone: tone, width: w, height: size)
        } else {
            Image("rune-\(symbol)-\(tone.asset)")
                .resizable()
                .interpolation(.high)
                .scaledToFit()
                .frame(width: size, height: size)
        }
    }
}

// Page 74's one control: the same carved stone, widened to fill the pair's
// slot (98 x 44 on the lock card, 96 x 44 on the island). The blank stone
// (rune-stone-blank, the 44 pt stone without its glyph, @3x) keeps its
// rounded ends and only its plain middle stretches, so it never looks pulled;
// the glyph is drawn on it at the PNG glyph's size and glow.
private struct WideRuneStone: View {
    let symbol: String
    let tone: RuneTone
    let width: CGFloat
    var height: CGFloat = 44

    var body: some View {
        Image("rune-stone-blank")
            .resizable(capInsets: EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16), resizingMode: .stretch)
            .interpolation(.high)
            .frame(width: width, height: height)
            .overlay {
                RuneGlyph(symbol: symbol, tone: tone, scale: height / 44)
            }
    }
}

// The glyph alone, sized from the 132 px PNGs (pause: two 11 px bars 11 px
// apart, 38 px tall; play: 35 x 38 px), 1 pt = 3 px at 44 pt.
private struct RuneGlyph: View {
    let symbol: String
    let tone: RuneTone
    var scale: CGFloat = 1

    var body: some View {
        Group {
            if symbol == "play" {
                RunePlayShape()
                    .fill(tone.glyph)
                    .frame(width: 11.7 * scale, height: 12.7 * scale)
                    .offset(x: 0.7 * scale)
            } else {
                HStack(spacing: 3.67 * scale) {
                    RoundedRectangle(cornerRadius: 1.1 * scale, style: .continuous)
                        .fill(tone.glyph)
                        .frame(width: 3.67 * scale, height: 12.7 * scale)
                    RoundedRectangle(cornerRadius: 1.1 * scale, style: .continuous)
                        .fill(tone.glyph)
                        .frame(width: 3.67 * scale, height: 12.7 * scale)
                }
            }
        }
        .shadow(color: tone.glow, radius: 2.5 * scale)
        .accessibilityHidden(true)
    }
}

private struct RunePlayShape: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: rect.minX, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        p.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        p.closeSubpath()
        return p
    }
}

@available(iOS 17.0, *)
private struct RuneButton<I: AppIntent>: View {
    let intent: I
    let symbol: String
    let tone: RuneTone
    let name: String
    var size: CGFloat = 44
    var width: CGFloat? = nil

    var body: some View {
        Button(intent: intent) {
            RuneStone(symbol: symbol, tone: tone, size: size, width: width)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(name))
    }
}

// The row of rune stones a state offers, wired to the existing intents. An
// easy run's one stone fills the pair's slot: two stones and the gap between.
@available(iOS 16.2, *)
private struct RuneRow: View {
    let info: LAInfo
    var spacing: CGFloat = 10
    var size: CGFloat = 44

    var body: some View {
        if #available(iOS 17.0, *) {
            let solo: CGFloat? = info.soloStone ? size * 2 + spacing : nil
            HStack(spacing: spacing) {
                ForEach(Array(info.actions.enumerated()), id: \.offset) { item in
                    rune(item.element, width: solo)
                }
            }
        }
    }

    @available(iOS 17.0, *)
    @ViewBuilder
    private func rune(_ action: RuneAction, width: CGFloat?) -> some View {
        let tone = info.runeTone
        switch action {
        case .pause:
            RuneButton(intent: PauseTimerIntent(), symbol: "pause", tone: tone, name: "Pause", size: size, width: width)
        case .resume:
            RuneButton(intent: ResumeTimerIntent(), symbol: "play", tone: tone, name: "Resume", size: size, width: width)
        case .skip:
            RuneButton(intent: AdvancePhaseIntent(), symbol: "skip", tone: tone, name: "Skip", size: size, width: width)
        case .startHold:
            RuneButton(intent: StartHoldIntent(), symbol: "play", tone: tone, name: "Start hold", size: size, width: width)
        }
    }
}

// MARK: - The heart container (page 74, option I)

// heart-family.js PAL / HeartContainer.tsx HEART_PAL: outline, rim, pip,
// body (lit), shade (mid), glow.
private struct HeartPal {
    let out: Color
    let rim: Color
    let pip: Color
    let lit: Color
    let mid: Color
    let glow: Color

    static let under = HeartPal(out: Color(wmHex: 0x04140F), rim: Color(wmHex: 0x9EE0C6), pip: Color(wmHex: 0xE8F8F4),
                                lit: Color(wmHex: 0x5AC8AA), mid: Color(wmHex: 0x2A8A6C), glow: Color(wmHex: 0x4ACAAA))
    static let gold = HeartPal(out: Color(wmHex: 0x1C1304), rim: Color(wmHex: 0xF6E2A0), pip: Color(wmHex: 0xFFF6DC),
                               lit: Color(wmHex: 0xEAC860), mid: Color(wmHex: 0xC8A030), glow: Color(wmHex: 0xE8C860))
    static let over = HeartPal(out: Color(wmHex: 0x1E0904), rim: Color(wmHex: 0xFFC7AA), pip: Color(wmHex: 0xFFF0E6),
                               lit: Color(wmHex: 0xEC8A5E), mid: Color(wmHex: 0xB0583A), glow: Color(wmHex: 0xEC8A5E))
    static let idle = HeartPal(out: Color(wmHex: 0x0A100E), rim: Color(wmHex: 0x87918C), pip: Color(wmHex: 0xA9B4B0),
                               lit: Color(wmHex: 0x6B7D77), mid: Color(wmHex: 0x495A54), glow: Color(wmHex: 0x000000, opacity: 0))
}

// The pixels (heart-family.js GI, 13 x 11): O outline, R rim, W pip, B body,
// D shade.
private let heartGrid: [[Character]] = [
    "..OOO...OOO..",
    ".ORRRO.ORRRO.",
    "ORWWBBOBBBBRO",
    "ORWBBBBBBBBDO",
    "ORBBBBBBBBBDO",
    ".OBBBBBBBBDO.",
    "..OBBBBBBDO..",
    "...OBBBBDO...",
    "....OBBDO....",
    ".....ODO.....",
    "......O......",
].map { Array($0) }

// One colour's pixels, as whole device-pixel squares centred in the box.
private struct HeartPixels: Shape {
    let code: Character
    let px: CGFloat
    let scale: CGFloat

    func path(in rect: CGRect) -> Path {
        var p = Path()
        let cols = CGFloat(heartGrid.first?.count ?? 13)
        let rows = CGFloat(heartGrid.count)
        let ox = rect.minX + ((rect.width - cols * px) * scale / 2).rounded(.down) / scale
        let oy = rect.minY + ((rect.height - rows * px) * scale / 2).rounded(.down) / scale
        for (y, row) in heartGrid.enumerated() {
            for (x, c) in row.enumerated() where c == code {
                p.addRect(CGRect(x: ox + CGFloat(x) * px, y: oy + CGFloat(y) * px, width: px, height: px))
            }
        }
        return p
    }
}

// The heart container, crisp: each heart pixel is a whole number of device
// pixels (as the mockup's drawPix: the box over 14 cells, at most the box
// over 13), so 14 pt draws 1 pt pixels, 22 pt 5 px, 44 pt 9 px at 3x.
private struct HeartContainer: View {
    let zone: HRZone
    let size: CGFloat
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        let scale = max(1, displayScale)
        let box = size * scale
        let dev = max(1, min((box / 13).rounded(.down), (box / 14).rounded()))
        let px = dev / scale
        let pal = zone.heart
        ZStack {
            HeartPixels(code: "O", px: px, scale: scale).fill(pal.out)
            HeartPixels(code: "R", px: px, scale: scale).fill(pal.rim)
            HeartPixels(code: "W", px: px, scale: scale).fill(pal.pip)
            HeartPixels(code: "B", px: px, scale: scale).fill(pal.lit)
            HeartPixels(code: "D", px: px, scale: scale).fill(pal.mid)
        }
        .frame(width: size, height: size)
    }
}

// The glow a heart-rate update brings: shown as the new heart arrives, then
// settling (the transition's active state to its identity).
private struct HeartGlow: ViewModifier {
    let color: Color
    let strength: Double
    let radius: CGFloat

    func body(content: Content) -> some View {
        content.shadow(color: color.opacity(strength), radius: radius)
    }
}

// The heart on the lock card and the island. Live Activities can't loop a
// beat: each heart-rate update (hrSeq) brings a new heart that arrives glowing
// softly and settles, once. `peak` is the glow's strength (very slight on the
// lock card). No glow when there's no strap.
@available(iOS 16.2, *)
private struct LiveHeart: View {
    let info: LAInfo
    let size: CGFloat
    var peak: Double = 0.4
    var radius: CGFloat = 4

    var body: some View {
        let zone = info.heartZone
        ZStack {
            HeartContainer(zone: zone, size: size)
                .id(info.hrSeq)
                .transition(glowOnce(zone))
        }
        .frame(width: size, height: size)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: zone.isLive ? "Heart rate \(info.bpmText)" : "No heart rate"))
    }

    private func glowOnce(_ zone: HRZone) -> AnyTransition {
        guard zone.isLive else { return AnyTransition.identity }
        let glow = zone.heart.glow
        return AnyTransition.asymmetric(
            insertion: AnyTransition.modifier(
                active: HeartGlow(color: glow, strength: peak, radius: radius),
                identity: HeartGlow(color: glow, strength: 0, radius: radius)
            ),
            removal: AnyTransition.opacity
        )
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
        if info.isInterval {
            intervalCard(info)
        } else if info.isBagCard {
            bagCard(info)
        } else if info.isStrapRun {
            runCard(info)
        } else {
            card(info)
        }
    }

    // MARK: The strap run's card (page 74 "LOCK", mockup LA())

    // Today's run card with the strap: header 22 (crest, the run on an xs
    // flap, the distance, the icon), main row 62 (the clock; RUNNING or EASE
    // OFF over the heart and bpm; the stones), the grass's three rows (21).
    // The rule and the grass take the zone's tint; padding 10 / 12; 160 pt.
    private func runCard(_ info: LAInfo) -> some View {
        let zone = info.zone ?? .off
        let tinted = zone.isLive
        return VStack(spacing: 0) {
            runHeader(info)
            Spacer(minLength: 0)
            runMainRow(info)
            Spacer(minLength: 0)
            GrassStrip(
                fill: info.grass,
                tone: .tint(info.momentColor),
                off: tinted ? zone.tint.opacity(0.28) : .wmGrassOff,
                glow: info.momentColor,
                flashKey: info.flashKey
            )
            .padding(.horizontal, -2)
            .frame(height: Grass.rowHeight * 3, alignment: .top)
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity)
        .frame(height: 160)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(zone.edge, lineWidth: 1)
                .shadow(color: zone.edgeGlow, radius: 9)
        )
    }

    // 22 pt: crest 18, EASY RUN / RUN-WALK on an xs flap, "1.41 km", the icon 22.
    private func runHeader(_ info: LAInfo) -> some View {
        HStack(spacing: 7) {
            CrestImage()
                .frame(width: 18, height: 20)
            FitFlap(text: info.runTitle, size: FlapSize.xs)
                .layoutPriority(1)
            Spacer(minLength: 4)
            if let km = info.kmText {
                Text(km)
                    .font(.system(size: 12.5, weight: .bold, design: .monospaced))
                    .foregroundStyle(Color.wmBody)
                    .lineLimit(1)
                    .fixedSize()
                    .padding(.trailing, 6)
            }
            SessionIcon(context: context)
                .frame(width: 22, height: 22)
        }
        .frame(height: 22)
    }

    // 62 pt: the lg clock, then RUNNING / EASE OFF over the heart (14) and
    // the bpm in the zone's colour, then the stones (the wide one on an easy
    // run, the pair on a run-walk, same right edge).
    private func runMainRow(_ info: LAInfo) -> some View {
        let flap = info.runFlap
        return HStack(alignment: .center, spacing: 10) {
            BigTiles(info: info, size: FlapSize.lg)
            VStack(alignment: .leading, spacing: 5) {
                FitFlap(text: flap.text, size: FlapSize.xs, tone: flap.tone)
                HStack(spacing: 3) {
                    LiveHeart(info: info, size: 14, peak: 0.3, radius: 2)
                    (Text(info.bpmText)
                        .font(.system(size: 13, weight: .heavy, design: .monospaced))
                        .foregroundStyle(info.heartZone.number)
                     + Text(" bpm")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.wmBody))
                        .lineLimit(1)
                }
            }
            .padding(.leading, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .layoutPriority(1)
            RuneRow(info: info, spacing: 10)
        }
        .frame(height: 62)
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
            GrassStrip(fill: info.grass, tone: .tint(info.momentColor), glow: info.momentColor, flashKey: info.flashKey)
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
            GrassStrip(fill: info.grass, tone: .tint(info.momentColor), glow: info.momentColor, flashKey: info.flashKey)
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

    // MARK: The interval timer's card (page 81 "Locked", mockup LA())

    // Header 22 (the crest, INTERVAL TIMER, ROUND 3 OF 8), main row 62 (the
    // countdown to the part's end on lg tiles, the phase plate, the pause
    // stone), the grass's three rows filling the part. The rule and its soft
    // glow take the phase colour. At the end: DONE · 8 ROUNDS.
    private func intervalCard(_ info: LAInfo) -> some View {
        let tint = info.momentColor
        return VStack(spacing: 0) {
            HStack(spacing: 7) {
                CrestImage()
                    .frame(width: 18, height: 20)
                FitFlap(text: "INTERVAL TIMER", size: FlapSize.xs)
                    .layoutPriority(1)
                Spacer(minLength: 4)
                if !info.isComplete {
                    Text(info.intervalRoundText)
                        .font(.system(size: 12.5, weight: .bold, design: .monospaced))
                        .tracking(1)
                        .foregroundStyle(Color.wmBody)
                        .lineLimit(1)
                        .fixedSize()
                }
            }
            .frame(height: 22)
            Spacer(minLength: 0)
            if info.isComplete {
                HStack(alignment: .center, spacing: 12) {
                    CrestImage(big: true)
                        .frame(width: 44, height: 50)
                        .shadow(color: Color.wmGrassGold.opacity(0.55), radius: 7)
                    FitFlap(text: (info.state.completeMessage ?? "DONE").uppercased(), size: FlapSize.sm, tone: .gold)
                    Spacer(minLength: 0)
                }
                .frame(height: 62)
            } else {
                let phase = info.intervalPhase
                HStack(alignment: .center, spacing: 10) {
                    BigTiles(info: info, size: FlapSize.lg)
                    FitFlap(text: phase.text, size: FlapSize.xs, tone: phase.tone)
                        .padding(.leading, 6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .layoutPriority(1)
                    RuneRow(info: info, spacing: 8)
                }
                .frame(height: 62)
            }
            Spacer(minLength: 0)
            GrassStrip(fill: info.grass, tone: .tint(tint), glow: tint, flashKey: info.flashKey)
                .padding(.horizontal, -2)
                .frame(height: Grass.rowHeight * 3, alignment: .top)
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity)
        .frame(height: 160)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(tint.opacity(0.62), lineWidth: 1)
                .shadow(color: tint.opacity(0.14), radius: 9)
                .animation(.easeOut(duration: 1.0), value: info.state.glowTone ?? "")
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
        if info.isInterval && !info.isComplete {
            // Page 81: the time left in the phase colour, counting by itself.
            IntervalTimeText(info: info, size: 15)
                .frame(maxWidth: 52, alignment: .trailing)
        } else if info.isStrapRun {
            // Page 74: the bpm in the zone's colour ("--" dim with no strap).
            Text(info.bpmText)
                .font(.system(size: 16, weight: .bold, design: .monospaced))
                .foregroundStyle(info.heartZone.number)
                .lineLimit(1)
                .fixedSize()
        } else if info.isComplete {
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
        if info.isInterval && !info.isComplete {
            // Page 81: INTERVAL TIMER over the big time in the phase colour, glowing; it flashes with the card.
            VStack(alignment: .center, spacing: 6) {
                FitFlap(text: "INTERVAL TIMER", size: FlapSize.xs)
                IntervalTimeText(info: info, size: 30)
                    .modifier(FlashOnChange(key: info.flashKey, color: info.momentColor, soft: 3, peak: 9))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        } else if info.isStrapRun {
            // Page 74: the run on an xs flap over the time (mono 30).
            VStack(alignment: .center, spacing: 6) {
                FitFlap(text: info.runTitle, size: FlapSize.xs)
                BigTimeText(info: info)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        } else {
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
}

@available(iOS 16.2, *)
private struct ExpandedTrailing: View {
    let context: ActivityViewContext<WaymarkActivityAttributes>

    var body: some View {
        let info = LAInfo(context: context)
        Group {
            if info.isInterval && !info.isComplete {
                // Page 81: 3/8 in the phase colour, ROUND small under it.
                VStack(alignment: .trailing, spacing: 4) {
                    Text(info.intervalShortRound)
                        .font(.system(size: 26, weight: .heavy, design: .monospaced))
                        .foregroundStyle(info.momentColor)
                        .shadow(color: info.momentColor.opacity(0.55), radius: 4)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    Text("ROUND")
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .tracking(1.3)
                        .foregroundStyle(Color(wmHex: 0xF0E6C0, opacity: 0.75))
                }
            } else if info.isStrapRun {
                // Page 74: the big bpm in the zone's colour, BPM small under it.
                VStack(alignment: .trailing, spacing: 4) {
                    Text(info.bpmText)
                        .font(.system(size: 34, weight: .heavy, design: .monospaced))
                        .foregroundStyle(info.heartZone.number)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .modifier(FlashOnChange(key: info.flashKey, color: info.momentColor, soft: 3, peak: 9))
                    Text("BPM")
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .tracking(1.3)
                        .foregroundStyle(Color(wmHex: 0xF0E6C0, opacity: 0.75))
                }
            } else if info.isComplete {
                CrestImage(big: true)
                    .frame(width: 36, height: 40)
                    .shadow(color: Color.wmGrassGold.opacity(0.55), radius: 6)
            } else {
                // Page 82: the big number glows in the moment's colour and flashes with the card.
                BigTiles(info: info, size: FlapSize.md)
                    .modifier(FlashOnChange(key: info.flashKey, color: info.momentColor, soft: 3, peak: 9))
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
        if info.isInterval && !info.isComplete {
            // Page 81: the phase plate and the pause stone (no end from the island).
            let phase = info.intervalPhase
            HStack(alignment: .center, spacing: 0) {
                FitFlap(text: phase.text, size: FlapSize.xs, tone: phase.tone)
                Spacer(minLength: 6)
                RuneRow(info: info, spacing: 8)
            }
            .padding(.horizontal, 6)
            .frame(height: 44)
        } else if info.isStrapRun {
            // Page 74: the distance, the flap, the stones (the wide 96 x 44 on
            // an easy run, the pair 44 + 44 with an 8 pt gap on a run-walk).
            HStack(alignment: .center, spacing: 0) {
                Text(info.kmText ?? "")
                    .font(.system(size: 15, weight: .semibold, design: .monospaced))
                    .foregroundStyle(Color(wmHex: 0xE8DCB4))
                    .lineLimit(1)
                    .fixedSize()
                Spacer(minLength: 6)
                IslandRunFlap(info: info)
                Spacer(minLength: 6)
                RuneRow(info: info, spacing: 8)
            }
            .padding(.horizontal, 6)
            .frame(height: 44)
        } else {
            VStack(spacing: 8) {
                GrassStrip(fill: info.grass, tone: .tint(info.momentColor), glow: info.momentColor, flashKey: info.flashKey)
                if !info.actions.isEmpty {
                    RuneRow(info: info, spacing: 16)
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(.top, 4)
        }
    }
}

// The time on the expanded island (mono 30 bold), counting by itself.
@available(iOS 16.2, *)
private struct BigTimeText: View {
    let info: LAInfo

    var body: some View {
        Group {
            if info.timeUp {
                Text(formatDuration(0))
            } else {
                clockText(info.state)
            }
        }
        .font(.system(size: 30, weight: .bold, design: .monospaced))
        .foregroundStyle(Color.wmInk.opacity(info.state.isPaused ? 0.74 : 1))
        .multilineTextAlignment(.center)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
    }
}

// Page 81: the timer's time left as plain mono text in the phase colour,
// counting by itself (the system's timer text); paused, it stands.
@available(iOS 16.2, *)
private struct IntervalTimeText: View {
    let info: LAInfo
    let size: CGFloat

    var body: some View {
        Group {
            if info.timeUp {
                Text(formatDuration(0))
            } else {
                clockText(info.state)
            }
        }
        .font(.system(size: size, weight: .bold, design: .monospaced))
        .foregroundStyle(info.momentColor.opacity(info.state.isPaused ? 0.74 : 1))
        .multilineTextAlignment(.trailing)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
    }
}

// The island's flap: PAUSED, EASE OFF (clay) when over, "no strap" (dim
// text), RUN 3 OF 6 on a run-walk when the app sends the piece, RUNNING.
@available(iOS 16.2, *)
private struct IslandRunFlap: View {
    let info: LAInfo

    var body: some View {
        if info.state.isPaused {
            FitFlap(text: "PAUSED", size: FlapSize.xs)
        } else if info.zone == .over {
            FitFlap(text: "EASE OFF", size: FlapSize.xs, tone: .clay)
        } else if !info.heartZone.isLive {
            Text("no strap")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color(wmHex: 0xA9B8B0))
                .lineLimit(1)
                .fixedSize()
        } else if let piece = info.runPieceFlap {
            FitFlap(text: piece, size: FlapSize.xs, tone: info.isRest ? .teal : .gold)
        } else if info.timeUp {
            FitFlap(text: "TIME", size: FlapSize.xs, tone: .clay)
        } else if info.isRunWalk && info.isRest {
            FitFlap(text: "WALK", size: FlapSize.xs, tone: .teal)
        } else {
            FitFlap(text: "RUNNING", size: FlapSize.xs, tone: .gold)
        }
    }
}

// Compact leading: the session icon, or (page 74) the heart container.
@available(iOS 16.2, *)
private struct CompactLeading: View {
    let context: ActivityViewContext<WaymarkActivityAttributes>

    var body: some View {
        let info = LAInfo(context: context)
        if info.isInterval {
            if info.isComplete {
                CrestImage().frame(width: 18, height: 20)
            } else {
                // Page 81: the round, 3/8, in the phase colour.
                Text(info.intervalShortRound)
                    .font(.system(size: 15, weight: .bold, design: .monospaced))
                    .foregroundStyle(info.momentColor)
                    .lineLimit(1)
                    .fixedSize()
            }
        } else if info.isStrapRun {
            LiveHeart(info: info, size: 22, peak: 0.35, radius: 3)
        } else {
            SessionIcon(context: context)
                .frame(width: 24, height: 24)
        }
    }
}

// Minimal: the session icon, or the heart alone.
@available(iOS 16.2, *)
private struct MinimalView: View {
    let context: ActivityViewContext<WaymarkActivityAttributes>

    var body: some View {
        let info = LAInfo(context: context)
        if info.isInterval {
            CrestImage().frame(width: 18, height: 20)
        } else if info.isStrapRun {
            LiveHeart(info: info, size: 22, peak: 0.35, radius: 3)
        } else {
            SessionIcon(context: context)
                .frame(width: 22, height: 22)
        }
    }
}

// Expanded leading: the session icon, or the heart at 44.
@available(iOS 16.2, *)
private struct ExpandedLeading: View {
    let context: ActivityViewContext<WaymarkActivityAttributes>

    var body: some View {
        let info = LAInfo(context: context)
        Group {
            if info.isInterval {
                CrestImage().frame(width: 30, height: 34)
            } else if info.isStrapRun {
                LiveHeart(info: info, size: 44, peak: 0.55, radius: 5)
            } else {
                SessionIcon(context: context)
                    .frame(width: 36, height: 36)
            }
        }
        .frame(maxHeight: .infinity)
        .padding(.leading, 2)
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
                // Page 61 (M6): a tap opens the running session, not wherever the app last was.
                .widgetURL(WaymarkLiveURL.session)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    ExpandedLeading(context: context)
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
                CompactLeading(context: context)
            } compactTrailing: {
                CompactTrailing(context: context)
            } minimal: {
                MinimalView(context: context)
            }
            .widgetURL(WaymarkLiveURL.session)
        }
    }
}

/// The running session (the app reads which one from the phone's live record).
enum WaymarkLiveURL {
    static let session = URL(string: "waymark://session/live")
}
