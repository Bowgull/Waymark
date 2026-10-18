import ActivityKit
import AppIntents
import SwiftUI
import UIKit
import WidgetKit

// The Live Activity and Dynamic Island, as approved on mockup page 44
// (design-decisions.md, "Live Activity", reworked 2026-10-18):
//   - the countdown in big split-flap digit tiles. The digits are the
//     system's live timer text (fixed-width font) drawn over tiles, so they
//     keep counting on the lock screen with no updates from the app;
//   - a glyph grass strip that lights as the phase goes (gold for work, teal
//     for rest). It is the system progress bar masked by the glyphs, so it
//     fills by itself;
//   - labels and buttons as flaps; the crest and the painted session icon
//     (images in this extension's Assets.xcassets);
//   - strength: the set counter in gold tiles and LOG SET →;
//   - finish: the large lit crest, WELL TRAVELED, one line, the grass lit.
// iOS limit: no flip animation. The lock-screen card must stay under the
// system's 160 pt height, so the page-44 card is drawn at a smaller scale.

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
    static let wmGrassGold = Color(wmHex: 0xE8C878)
    static let wmGrassTeal = Color(wmHex: 0x8FD4B8)
    static let wmGrassOff = Color(wmHex: 0x6E9858, opacity: 0.45)
    static let wmBtn = Color(wmHex: 0x080D0B, opacity: 0.42)
    static let wmBtnEdge = Color(wmHex: 0xE8C860, opacity: 0.26)
    static let wmBtnPrimary = Color(wmHex: 0x1E1806, opacity: 0.50)
    static let wmBtnPrimaryEdge = Color(wmHex: 0xE8C860, opacity: 0.55)
}

// MARK: - Flap tiles

private enum FlapTone {
    case ink, dim, gold, teal

    var top: Color {
        switch self {
        case .ink, .dim: return .wmTile
        case .gold: return .wmGold
        case .teal: return .wmTeal
        }
    }

    var bottom: Color {
        switch self {
        case .ink, .dim: return .wmTile2
        case .gold: return .wmGold2
        case .teal: return .wmTeal2
        }
    }

    var ink: Color {
        switch self {
        case .ink: return .wmInk
        case .dim: return Color.wmInk.opacity(0.74)
        case .gold: return .wmGoldInk
        case .teal: return .wmTealInk
        }
    }
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
private struct FlapText: View {
    let text: String
    let size: CGFloat
    var tone: FlapTone = .ink

    var body: some View {
        HStack(spacing: max(1, size * 0.09)) {
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
        HStack(spacing: max(1, size * 0.08)) {
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

// The grass is a picture filled by the system's own progress bar: the bar,
// stretched to the strip's height, shows only through the glyphs.
private struct GrassStrip: View {
    let fill: GrassFill
    let teal: Bool
    var fontSize: CGFloat = 7.5
    var rowHeight: CGFloat = 6

    var body: some View {
        let lit = teal ? Color.wmGrassTeal : Color.wmGrassGold
        ZStack {
            GrassGlyphs(fontSize: fontSize, rowHeight: rowHeight)
                .foregroundStyle(Color.wmGrassOff)
            bar
                .progressViewStyle(.linear)
                .tint(lit)
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

@available(iOS 16.2, *)
private struct LAInfo {
    let state: WaymarkActivityAttributes.ContentState
    let sessionLabel: String

    var phase: String { state.phase }
    var isRest: Bool { phase == "rest" }
    var isComplete: Bool { phase == "complete" }
    var isCard: Bool { phase == "exercise" || phase == "ready" }
    var isTimer: Bool { !isComplete && !isCard }

    // Session-level count (round n of N, exercise n of N).
    var step: (current: Int, total: Int)? {
        if let i = state.stepIndex, let t = state.stepTotal, i > 0, t > 0 { return (min(i, t), t) }
        if phase == "active" { return parseCount(state.label) }
        return nil
    }

    // Strength set (or mobility set) counter for the big tiles.
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

    // The phase on a flap: ROUND 3 (gold) / REST (teal) / the lift or hold.
    var phaseFlap: String {
        switch phase {
        case "rest": return "REST"
        case "exercise", "ready":
            return (state.exerciseName ?? state.detail ?? state.label).uppercased()
        default:
            if isRound, let c = step { return "ROUND \(c.current)" }
            return state.label.uppercased()
        }
    }

    // The words beside the phase flap: the combo, what's next, the side.
    var phaseDetail: String? {
        switch phase {
        case "exercise": return nil
        case "ready":
            return setCount == nil ? state.label : nil
        default:
            if let d = state.detail, !d.isEmpty { return d }
            return nil
        }
    }

    var phaseTone: FlapTone {
        if isRest { return .teal }
        if isCard { return .ink }
        return .gold
    }

    var clockTone: FlapTone {
        if isRest { return .teal }
        return state.isPaused ? .dim : .ink
    }

    var grass: GrassFill {
        if isComplete { return .value(1) }
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

    // Long-press island: ROUND 3 OF 12, SET 2 OF 3, REST, WELL TRAVELED.
    var islandFlap: String {
        if isComplete { return "WELL TRAVELED" }
        if isRest { return "REST" }
        if isCard, let c = setCount { return "SET \(c.current) OF \(c.total)" }
        if isRound, let c = step { return "ROUND \(c.current) OF \(c.total)" }
        return phaseFlap
    }

    var islandDetail: String? {
        if isComplete { return state.completeMessage }
        if isCard { return state.exerciseName ?? state.detail }
        return state.detail
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

// MARK: - Buttons (flaps on a board; primary = gold tiles)

@available(iOS 17.0, *)
private struct FlapButton<I: AppIntent>: View {
    let intent: I
    let text: String
    let primary: Bool
    var height: CGFloat = 28

    var body: some View {
        Button(intent: intent) {
            FitFlap(text: text, size: primary ? 12 : 11, tone: primary ? .gold : .ink)
                .padding(.horizontal, 6)
                .frame(maxWidth: .infinity, minHeight: height, maxHeight: height)
                .background(
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .fill(primary ? Color.wmBtnPrimary : Color.wmBtn)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .stroke(primary ? Color.wmBtnPrimaryEdge : Color.wmBtnEdge, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }
}

// Wording kept from the app: Pause / Resume, NEXT ROUND → and SKIP REST →
// beside it on a round or a rest (page 44), Next → / Done → once the timer
// has run out, LOG SET → on a strength set, START HOLD → between holds.
@available(iOS 17.0, *)
private struct ActionRow: View {
    let info: LAInfo

    var body: some View {
        let state = info.state
        switch state.phase {
        case "complete":
            EmptyView()
        case "exercise":
            FlapButton(intent: CompleteSetIntent(), text: "LOG SET →", primary: true)
        case "ready":
            FlapButton(intent: StartHoldIntent(), text: "START HOLD →", primary: true)
        default:
            TimelineView(.periodic(from: Date(), by: 1.0)) { timeline in
                timerButtons(now: timeline.date)
            }
        }
    }

    // A round or a rest offers its skip beside Pause from the start (page
    // 44); other timers show only Pause until they run out.
    private var skipLabel: String? {
        if info.isRest { return "SKIP REST →" }
        if info.isRound {
            if let c = info.step, c.current >= c.total { return "NEXT →" }
            return "NEXT ROUND →"
        }
        return nil
    }

    @ViewBuilder
    private func timerButtons(now: Date) -> some View {
        let state = info.state
        if !state.isPaused && state.endsAt <= now {
            FlapButton(intent: AdvancePhaseIntent(), text: state.phase == "hold" ? "DONE →" : "NEXT →", primary: true)
        } else {
            HStack(spacing: 8) {
                if state.isPaused {
                    FlapButton(intent: ResumeTimerIntent(), text: "RESUME", primary: skipLabel == nil)
                } else {
                    FlapButton(intent: PauseTimerIntent(), text: "PAUSE", primary: false)
                }
                if let skip = skipLabel {
                    FlapButton(intent: AdvancePhaseIntent(), text: skip, primary: true)
                }
            }
        }
    }
}

// MARK: - Lock screen

@available(iOS 16.2, *)
private struct LockScreenView: View {
    let context: ActivityViewContext<WaymarkActivityAttributes>

    var body: some View {
        let info = LAInfo(state: context.state, sessionLabel: context.attributes.sessionLabel)
        VStack(spacing: 4) {
            header(info)
            if info.isComplete {
                finish(info)
            } else {
                tiles(info)
                phaseRow(info)
            }
            GrassStrip(fill: info.grass, teal: info.isRest)
                .padding(.horizontal, -4)
            if !info.isComplete, #available(iOS 17.0, *) {
                ActionRow(info: info)
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 9)
        .padding(.bottom, 9)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(Color.wmCardEdge, lineWidth: 0.75)
        )
    }

    private func header(_ info: LAInfo) -> some View {
        HStack(spacing: 8) {
            CrestImage()
                .frame(width: 18, height: 20)
            FitFlap(text: info.headerText, size: 12)
                .layoutPriority(1)
            Spacer(minLength: 4)
            SessionIcon(context: context)
                .frame(width: 22, height: 22)
        }
        .frame(height: 20)
    }

    // The countdown, or the set counter (2/3 in gold) on a strength set.
    @ViewBuilder
    private func tiles(_ info: LAInfo) -> some View {
        if info.isCard {
            if let c = info.setCount {
                FlapText(text: "\(c.current)/\(c.total)", size: 28, tone: .gold)
                    .frame(height: 36)
            } else {
                FlapText(text: "GO", size: 28, tone: .gold)
                    .frame(height: 36)
            }
        } else {
            FlapClock(state: info.state, size: 28, tone: info.clockTone)
                .frame(height: 36)
        }
    }

    private func phaseRow(_ info: LAInfo) -> some View {
        HStack(spacing: 8) {
            FitFlap(text: info.phaseFlap, size: 12, tone: info.phaseTone)
                .layoutPriority(1)
            if let detail = info.phaseDetail {
                Text(detail)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.wmBody)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: 16)
    }

    private func finish(_ info: LAInfo) -> some View {
        VStack(spacing: 3) {
            CrestImage(big: true)
                .frame(height: 42)
                .shadow(color: Color.wmGrassGold.opacity(0.55), radius: 7)
            FitFlap(text: "WELL TRAVELED", size: 12, tone: .gold)
            if let msg = info.state.completeMessage, !msg.isEmpty {
                Text(msg)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.wmBodyDim)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Dynamic Island

// Compact: the countdown on small gold flap tiles (teal in rest); the set
// counter on a strength set; the crest at the finish.
@available(iOS 16.2, *)
private struct CompactTrailing: View {
    let context: ActivityViewContext<WaymarkActivityAttributes>

    var body: some View {
        let info = LAInfo(state: context.state, sessionLabel: context.attributes.sessionLabel)
        if info.isComplete {
            CrestImage()
                .frame(width: 18, height: 20)
        } else if info.isCard {
            if let c = info.setCount {
                FlapText(text: "\(c.current)/\(c.total)", size: 12, tone: .gold)
            } else {
                FlapText(text: "GO", size: 12, tone: .gold)
            }
        } else {
            FlapClock(state: info.state, size: 12, tone: info.isRest ? .teal : (info.state.isPaused ? .dim : .gold))
        }
    }
}

@available(iOS 16.2, *)
private struct ExpandedCenter: View {
    let context: ActivityViewContext<WaymarkActivityAttributes>

    var body: some View {
        let info = LAInfo(state: context.state, sessionLabel: context.attributes.sessionLabel)
        VStack(alignment: .leading, spacing: 4) {
            FitFlap(text: info.islandFlap, size: 11, tone: info.isRest ? .teal : .gold)
            if let detail = info.islandDetail, !detail.isEmpty {
                Text(detail)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.wmBody)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

@available(iOS 16.2, *)
private struct ExpandedTrailing: View {
    let context: ActivityViewContext<WaymarkActivityAttributes>

    var body: some View {
        let info = LAInfo(state: context.state, sessionLabel: context.attributes.sessionLabel)
        Group {
            if info.isComplete {
                CrestImage(big: true)
                    .frame(width: 36, height: 40)
                    .shadow(color: Color.wmGrassGold.opacity(0.55), radius: 6)
            } else if info.isCard {
                if let c = info.setCount {
                    FlapText(text: "\(c.current)/\(c.total)", size: 18, tone: .gold)
                } else {
                    FlapText(text: "GO", size: 18, tone: .gold)
                }
            } else {
                FlapClock(state: info.state, size: 18, tone: info.clockTone)
            }
        }
        .frame(maxHeight: .infinity)
        .padding(.trailing, 2)
    }
}

@available(iOS 16.2, *)
private struct ExpandedBottom: View {
    let context: ActivityViewContext<WaymarkActivityAttributes>

    var body: some View {
        let info = LAInfo(state: context.state, sessionLabel: context.attributes.sessionLabel)
        GrassStrip(fill: info.grass, teal: info.isRest)
            .padding(.top, 4)
    }
}

// MARK: - Widget entry point

@available(iOS 16.2, *)
struct WaymarkActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WaymarkActivityAttributes.self) { context in
            LockScreenView(context: context)
                .activityBackgroundTint(Color.wmCard.opacity(0.93))
                .activitySystemActionForegroundColor(Color.wmBody)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    SessionIcon(context: context)
                        .frame(width: 42, height: 42)
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
