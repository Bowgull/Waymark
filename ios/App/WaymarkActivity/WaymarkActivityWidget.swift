import ActivityKit
import SwiftUI
import WidgetKit

// MARK: - Brand palette
// Muted charcoal-forest background, warm parchment text, soft gold accent,
// teal for hold / mobility. Matches Waymark's lofi + fantasy-book aesthetic.
extension Color {
    static let waymarkBg = Color(red: 10.0 / 255.0, green: 10.0 / 255.0, blue: 10.0 / 255.0)
    static let waymarkBgDeep = Color(red: 6.0 / 255.0, green: 22.0 / 255.0, blue: 18.0 / 255.0)
    static let waymarkBgForest = Color(red: 18.0 / 255.0, green: 46.0 / 255.0, blue: 38.0 / 255.0)
    static let waymarkText = Color(red: 240.0 / 255.0, green: 230.0 / 255.0, blue: 210.0 / 255.0)
    static let waymarkTextMuted = Color(red: 240.0 / 255.0, green: 230.0 / 255.0, blue: 210.0 / 255.0).opacity(0.65)
    static let waymarkTextFaint = Color(red: 240.0 / 255.0, green: 230.0 / 255.0, blue: 210.0 / 255.0).opacity(0.35)
    static let waymarkGold = Color(red: 220.0 / 255.0, green: 180.0 / 255.0, blue: 90.0 / 255.0)
    static let waymarkGoldDim = Color(red: 150.0 / 255.0, green: 120.0 / 255.0, blue: 56.0 / 255.0)
    static let waymarkTeal = Color(red: 74.0 / 255.0, green: 202.0 / 255.0, blue: 170.0 / 255.0)
    static let waymarkEmber = Color(red: 196.0 / 255.0, green: 90.0 / 255.0, blue: 60.0 / 255.0)
    // Widget-only per-session tints. Intentionally distinct from the
    // in-app getSessionAccent() palette — the LA uses these so each
    // session reads differently at a glance on the lock screen.
    static let waymarkSessionGreen = Color(red: 78.0 / 255.0, green: 168.0 / 255.0, blue: 106.0 / 255.0) // skip_rope
    static let waymarkSessionAmber = Color(red: 232.0 / 255.0, green: 155.0 / 255.0, blue: 74.0 / 255.0) // run
    static let waymarkSessionSage = Color(red: 138.0 / 255.0, green: 184.0 / 255.0, blue: 122.0 / 255.0) // active_recovery
}

// Per-session glyph tint. Each workout type gets a distinct hue so the
// lock-screen icon alone tells you what you're doing.
//
// Palette:
//   bag_work      → red (ember)
//   strength      → gold
//   mobility      → teal
//   mt_class      → teal (shares mobility; same body practice)
//   skip_rope     → green
//   run / fr      → amber
//   recovery      → sage
@available(iOS 16.2, *)
private func sessionTint(for sessionType: String) -> Color {
    switch sessionType {
    case "bag_work":
        return .waymarkEmber
    case "skip_rope":
        return .waymarkSessionGreen
    case "run", "running", "foundation_run":
        return .waymarkSessionAmber
    case "recovery", "active_recovery":
        return .waymarkSessionSage
    case "mobility", "mt_class":
        return .waymarkTeal
    case "strength":
        return .waymarkGold
    default:
        return .waymarkGold
    }
}

// MARK: - Format

private func formatDuration(_ seconds: TimeInterval) -> String {
    let clamped = max(0, seconds.rounded())
    let total = Int(clamped)
    let m = total / 60
    let r = total % 60
    return String(format: "%d:%02d", m, r)
}

// MARK: - Round-pip parsing
// Extracts (current, total) from strings like "Round 3 of 6", "Set 2 of 5".
// Returns nil for non-counter labels ("Rest", "Hold", etc.).

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

// MARK: - Waymark logo mark (simplified SwiftUI)
// Shield + rim. When a sessionType is passed, the session's glyph is drawn
// inside the shield (mobility → spine, strength → dumbbell, etc.) so the
// lock-screen at-a-glance reads "what am I doing" rather than just branding.
// Without a sessionType, falls back to the classic Waymark eye.

private struct WaymarkLogoMark: View {
    var tint: Color = .waymarkGold
    var darkFill: Color = Color(red: 4.0 / 255.0, green: 16.0 / 255.0, blue: 13.0 / 255.0)
    var sessionType: String? = nil

    var body: some View {
        GeometryReader { geo in
            let s = min(geo.size.width, geo.size.height)
            ZStack {
                ShieldShape()
                    .fill(darkFill)
                ShieldShape()
                    .stroke(tint, lineWidth: max(1, s * 0.05))
                    .padding(s * 0.08)
                if let type = sessionType, SessionGlyph.hasGlyph(for: type) {
                    SessionGlyph(type: type)
                        .stroke(tint, style: StrokeStyle(
                            lineWidth: max(0.8, s * 0.075),
                            lineCap: .round,
                            lineJoin: .round
                        ))
                        .padding(s * 0.24)
                        .frame(width: s, height: s)
                } else {
                    Circle()
                        .fill(darkFill)
                        .frame(width: s * 0.46, height: s * 0.46)
                    Circle()
                        .stroke(tint, lineWidth: max(0.5, s * 0.035))
                        .frame(width: s * 0.46, height: s * 0.46)
                    EyeShape()
                        .fill(tint)
                        .frame(width: s * 0.18, height: s * 0.30)
                }
            }
            .frame(width: s, height: s)
            .position(x: geo.size.width / 2, y: geo.size.height / 2)
        }
    }

    private struct ShieldShape: Shape {
        func path(in rect: CGRect) -> Path {
            // Pointed-bottom shield. Normalized to rect.
            var p = Path()
            let w = rect.width, h = rect.height
            let topY = rect.minY + h * 0.05
            let shoulderY = rect.minY + h * 0.30
            let hipY = rect.minY + h * 0.70
            let tipY = rect.minY + h * 0.98
            p.move(to: CGPoint(x: rect.midX, y: topY))
            p.addCurve(
                to: CGPoint(x: rect.maxX - w * 0.05, y: shoulderY),
                control1: CGPoint(x: rect.maxX - w * 0.10, y: topY),
                control2: CGPoint(x: rect.maxX - w * 0.05, y: topY + h * 0.12)
            )
            p.addCurve(
                to: CGPoint(x: rect.maxX - w * 0.18, y: hipY),
                control1: CGPoint(x: rect.maxX - w * 0.02, y: shoulderY + h * 0.18),
                control2: CGPoint(x: rect.maxX - w * 0.08, y: hipY - h * 0.06)
            )
            p.addCurve(
                to: CGPoint(x: rect.midX, y: tipY),
                control1: CGPoint(x: rect.maxX - w * 0.28, y: hipY + h * 0.15),
                control2: CGPoint(x: rect.midX + w * 0.10, y: tipY - h * 0.04)
            )
            p.addCurve(
                to: CGPoint(x: rect.minX + w * 0.18, y: hipY),
                control1: CGPoint(x: rect.midX - w * 0.10, y: tipY - h * 0.04),
                control2: CGPoint(x: rect.minX + w * 0.28, y: hipY + h * 0.15)
            )
            p.addCurve(
                to: CGPoint(x: rect.minX + w * 0.05, y: shoulderY),
                control1: CGPoint(x: rect.minX + w * 0.08, y: hipY - h * 0.06),
                control2: CGPoint(x: rect.minX + w * 0.02, y: shoulderY + h * 0.18)
            )
            p.addCurve(
                to: CGPoint(x: rect.midX, y: topY),
                control1: CGPoint(x: rect.minX + w * 0.05, y: topY + h * 0.12),
                control2: CGPoint(x: rect.minX + w * 0.10, y: topY)
            )
            p.closeSubpath()
            return p
        }
    }

    private struct EyeShape: Shape {
        func path(in rect: CGRect) -> Path {
            var p = Path()
            let w = rect.width, h = rect.height
            p.move(to: CGPoint(x: rect.midX, y: rect.minY))
            p.addCurve(
                to: CGPoint(x: rect.midX, y: rect.maxY),
                control1: CGPoint(x: rect.midX + w * 0.9, y: rect.minY + h * 0.35),
                control2: CGPoint(x: rect.midX + w * 0.9, y: rect.minY + h * 0.65)
            )
            p.addCurve(
                to: CGPoint(x: rect.midX, y: rect.minY),
                control1: CGPoint(x: rect.midX - w * 0.9, y: rect.minY + h * 0.65),
                control2: CGPoint(x: rect.midX - w * 0.9, y: rect.minY + h * 0.35)
            )
            p.closeSubpath()
            return p
        }
    }
}

// MARK: - Session glyphs
// Ported from src/components/icons/SessionIcons.tsx — each glyph draws in
// a 24×24 virtual box and is scaled to fit the caller's rect. Stroke-only,
// so the widget applies one stroke style across all glyphs consistently.

private func drawInBox(_ rect: CGRect, _ build: (inout Path) -> Void) -> Path {
    let size = min(rect.width, rect.height)
    var p = Path()
    build(&p)
    let scale = size / 24.0
    let tx = rect.midX - size / 2
    let ty = rect.midY - size / 2
    return p.applying(CGAffineTransform(translationX: tx, y: ty).scaledBy(x: scale, y: scale))
}

private struct SessionGlyph: Shape {
    let type: String

    static func hasGlyph(for type: String) -> Bool {
        switch type {
        case "mobility", "strength", "bag_work", "skip_rope",
             "run", "running", "foundation_run",
             "recovery", "active_recovery":
            return true
        default:
            return false
        }
    }

    func path(in rect: CGRect) -> Path {
        switch type {
        case "mobility":
            return PostureGlyph().path(in: rect)
        case "strength":
            return StrengthGlyph().path(in: rect)
        case "bag_work":
            return BagWorkGlyph().path(in: rect)
        case "skip_rope":
            return SkipRopeGlyph().path(in: rect)
        case "run", "running", "foundation_run":
            return RunningGlyph().path(in: rect)
        case "recovery", "active_recovery":
            return RecoveryGlyph().path(in: rect)
        default:
            return Path()
        }
    }
}

// Spine + stretch marks — posture / mobility.
private struct PostureGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        drawInBox(rect) { p in
            p.move(to: CGPoint(x: 12, y: 2)); p.addLine(to: CGPoint(x: 12, y: 10))
            p.move(to: CGPoint(x: 12, y: 14)); p.addLine(to: CGPoint(x: 12, y: 22))
            p.move(to: CGPoint(x: 8, y: 6)); p.addLine(to: CGPoint(x: 12, y: 4)); p.addLine(to: CGPoint(x: 16, y: 6))
            p.move(to: CGPoint(x: 8, y: 18)); p.addLine(to: CGPoint(x: 12, y: 20)); p.addLine(to: CGPoint(x: 16, y: 18))
            p.move(to: CGPoint(x: 9, y: 10)); p.addLine(to: CGPoint(x: 12, y: 12)); p.addLine(to: CGPoint(x: 15, y: 10))
        }
    }
}

// Dumbbell — strength.
private struct StrengthGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        drawInBox(rect) { p in
            // Outer plate caps
            p.move(to: CGPoint(x: 6.5, y: 6.5)); p.addLine(to: CGPoint(x: 17.5, y: 6.5))
            p.move(to: CGPoint(x: 6.5, y: 17.5)); p.addLine(to: CGPoint(x: 17.5, y: 17.5))
            // Left weight
            p.addRoundedRect(in: CGRect(x: 3, y: 8, width: 4, height: 8),
                             cornerSize: CGSize(width: 1, height: 1))
            // Right weight
            p.addRoundedRect(in: CGRect(x: 17, y: 8, width: 4, height: 8),
                             cornerSize: CGSize(width: 1, height: 1))
            // Grip bar
            p.move(to: CGPoint(x: 7, y: 12)); p.addLine(to: CGPoint(x: 17, y: 12))
        }
    }
}

// Punching bag — bag work.
private struct BagWorkGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        drawInBox(rect) { p in
            // Hook stem
            p.move(to: CGPoint(x: 12, y: 2)); p.addLine(to: CGPoint(x: 12, y: 5))
            // Strap
            p.move(to: CGPoint(x: 9, y: 5)); p.addLine(to: CGPoint(x: 15, y: 5))
            // Bag body
            p.addRoundedRect(in: CGRect(x: 8, y: 5, width: 8, height: 14),
                             cornerSize: CGSize(width: 3, height: 3))
            // Floor bar
            p.move(to: CGPoint(x: 10, y: 21)); p.addLine(to: CGPoint(x: 14, y: 21))
        }
    }
}

// Jump rope with handles — skip rope.
private struct SkipRopeGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        drawInBox(rect) { p in
            // Rope (U-shape with two lobes + bottom bar)
            p.move(to: CGPoint(x: 7, y: 20))
            p.addCurve(to: CGPoint(x: 4, y: 16),
                       control1: CGPoint(x: 5, y: 20),
                       control2: CGPoint(x: 4, y: 18))
            p.addCurve(to: CGPoint(x: 7, y: 12),
                       control1: CGPoint(x: 4, y: 14),
                       control2: CGPoint(x: 5, y: 12))
            p.addLine(to: CGPoint(x: 17, y: 12))
            p.addCurve(to: CGPoint(x: 20, y: 16),
                       control1: CGPoint(x: 19, y: 12),
                       control2: CGPoint(x: 20, y: 14))
            p.addCurve(to: CGPoint(x: 17, y: 20),
                       control1: CGPoint(x: 20, y: 18),
                       control2: CGPoint(x: 19, y: 20))
            // Handle shafts
            p.move(to: CGPoint(x: 7, y: 12)); p.addLine(to: CGPoint(x: 7, y: 4))
            p.move(to: CGPoint(x: 17, y: 12)); p.addLine(to: CGPoint(x: 17, y: 4))
        }
    }
}

// Runner silhouette — running.
private struct RunningGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        drawInBox(rect) { p in
            // Head (circle cx=14 cy=4 r=2)
            p.addEllipse(in: CGRect(x: 12, y: 2, width: 4, height: 4))
            // Body: M6 20 l3 -5 l3 1 l4 -6 l2 3
            p.move(to: CGPoint(x: 6, y: 20))
            p.addLine(to: CGPoint(x: 9, y: 15))
            p.addLine(to: CGPoint(x: 12, y: 16))
            p.addLine(to: CGPoint(x: 16, y: 10))
            p.addLine(to: CGPoint(x: 18, y: 13))
            // Back leg: M10 16 l-2 4
            p.move(to: CGPoint(x: 10, y: 16)); p.addLine(to: CGPoint(x: 8, y: 20))
        }
    }
}

// Leaf with vein — active recovery.
private struct RecoveryGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        drawInBox(rect) { p in
            // Outer leaf curve (approximation of A9 9 0 003 17)
            p.move(to: CGPoint(x: 17, y: 8))
            p.addCurve(to: CGPoint(x: 3, y: 17),
                       control1: CGPoint(x: 11, y: 8),
                       control2: CGPoint(x: 5, y: 11))
            // Vein from tip down to base
            p.move(to: CGPoint(x: 17, y: 8))
            p.addCurve(to: CGPoint(x: 3.82, y: 21.34),
                       control1: CGPoint(x: 8, y: 10),
                       control2: CGPoint(x: 5.9, y: 16.17))
            // Stem flourish
            p.move(to: CGPoint(x: 17, y: 8))
            p.addCurve(to: CGPoint(x: 22, y: 8),
                       control1: CGPoint(x: 20, y: 7),
                       control2: CGPoint(x: 22, y: 8))
            p.addCurve(to: CGPoint(x: 19, y: 13),
                       control1: CGPoint(x: 22, y: 8),
                       control2: CGPoint(x: 21, y: 11))
        }
    }
}

// MARK: - Gold progress arc
// Drains as time elapses. Uses a sliding window clamped in SwiftUI for
// smoothness without per-second widget updates.

private struct ProgressArc: View {
    let startedAt: Date
    let endsAt: Date
    let tint: Color
    let paused: Bool
    let pausedFraction: Double?
    var lineWidth: CGFloat = 3

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.waymarkText.opacity(0.08), lineWidth: lineWidth)
            TimelineView(.periodic(from: Date(), by: 1.0)) { timeline in
                let now = timeline.date
                let total = max(1, endsAt.timeIntervalSince(startedAt))
                let elapsed = max(0, now.timeIntervalSince(startedAt))
                let fraction: Double = paused ? (1 - (pausedFraction ?? 0)) : min(1, max(0, elapsed / total))
                Circle()
                    .trim(from: 0, to: 1 - fraction)
                    .stroke(tint, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.linear(duration: 0.5), value: fraction)
            }
        }
    }
}

// MARK: - Round / set pips

private struct RoundPips: View {
    let current: Int
    let total: Int

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<min(total, 10), id: \.self) { idx in
                Image(systemName: idx < current ? "diamond.fill" : "diamond")
                    .font(.system(size: 7, weight: .medium))
                    .foregroundStyle(idx < current ? Color.waymarkGold : Color.waymarkTextFaint)
            }
            if total > 10 {
                Text("+\(total - 10)")
                    .font(.system(size: 8, weight: .medium, design: .serif))
                    .foregroundStyle(Color.waymarkTextFaint)
            }
        }
    }
}

// MARK: - Shared pieces

@available(iOS 16.2, *)
private func phaseAccent(_ phase: String) -> Color {
    switch phase {
    case "hold": return .waymarkTeal
    case "rest": return .waymarkGoldDim
    case "complete": return .waymarkGold
    case "exercise", "ready": return .waymarkGold
    default: return .waymarkGold
    }
}

// Parses "Set 2 of 5" → "2/5". Falls back to the original label if no match.
private func shortCounter(_ label: String) -> String {
    if let c = parseCount(label) { return "\(c.current)/\(c.total)" }
    return label
}

// Background — subtle forest → charcoal radial gradient inside a rounded
// card, plus a faint gold hairline that hints at the shield's rim.
@available(iOS 16.2, *)
private struct WaymarkCardBackground: View {
    var body: some View {
        ZStack {
            // Solid near-black base so the card reads over any wallpaper
            // (including high-chroma reds, whites, photos).
            Color.waymarkBg.opacity(0.92)
            RadialGradient(
                colors: [Color.waymarkBgForest.opacity(0.55), Color.waymarkBgDeep.opacity(0.85), Color.clear],
                center: UnitPoint(x: 0.15, y: 0.1),
                startRadius: 8,
                endRadius: 360
            )
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(Color.waymarkGold.opacity(0.25), lineWidth: 0.75)
        }
    }
}

// MARK: - Lock screen view

@available(iOS 16.2, *)
private struct LockScreenView: View {
    let context: ActivityViewContext<WaymarkActivityAttributes>

    var body: some View {
        let state = context.state
        let counter = parseCount(state.label)
        let accent = phaseAccent(state.phase)
        let showDetail = (state.detail?.isEmpty == false)

        ZStack {
            WaymarkCardBackground()
            VStack(alignment: .leading, spacing: 8) {
                headerRow(counter: counter, accent: accent)

                if state.phase == "complete" {
                    completeBody
                } else if state.phase == "exercise" || state.phase == "ready" {
                    readyBody(accent: accent)
                } else {
                    bodyRow(accent: accent, showDetail: showDetail)
                }

                if state.phase != "complete" {
                    controlRow
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
        }
    }

    @ViewBuilder
    private func readyBody(accent: Color) -> some View {
        let state = context.state
        let counter = parseCount(state.label)
        HStack(alignment: .center, spacing: 14) {
            if let c = counter {
                Text("\(c.current)/\(c.total)")
                    .font(.system(size: 30, weight: .regular, design: .serif))
                    .italic()
                    .monospacedDigit()
                    .foregroundStyle(Color.waymarkGold)
                    .fixedSize()
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("UP NEXT")
                    .font(.system(.caption2, design: .serif))
                    .tracking(1.0)
                    .foregroundStyle(Color.waymarkTextFaint)
                Text(state.exerciseName ?? state.detail ?? "—")
                    .font(.system(.callout, design: .serif))
                    .italic()
                    .foregroundStyle(Color.waymarkText)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private func headerRow(counter: (current: Int, total: Int)?, accent: Color) -> some View {
        let state = context.state
        let showPip = state.phase != "complete" && state.phase != "exercise" && state.phase != "ready"
        HStack(spacing: 6) {
            // Glyph is tinted per-session (bag_work red, strength gold,
            // mobility teal, etc.) so the icon alone conveys the workout.
            // The progress arc stays phase-accent so pause/hold/rest still
            // read through color language.
            WaymarkLogoMark(tint: sessionTint(for: context.attributes.sessionType), sessionType: context.attributes.sessionType)
                .frame(width: 14, height: 14)
            if showPip {
                ProgressArc(
                    startedAt: state.startedAt,
                    endsAt: state.endsAt,
                    tint: accent,
                    paused: state.isPaused,
                    pausedFraction: pausedFraction,
                    lineWidth: 1.5
                )
                .frame(width: 10, height: 10)
            }
            Text(headerLine(counter: counter))
                .font(.system(.caption2, design: .serif))
                .tracking(1.2)
                .foregroundStyle(Color.waymarkTextMuted)
                .lineLimit(1)
            Spacer()
        }
    }

    private func headerLine(counter: (current: Int, total: Int)?) -> String {
        let session = context.attributes.sessionLabel.uppercased()
        if let c = counter { return "\(session) · \(c.current)/\(c.total)" }
        return session
    }

    private func bodyRow(accent: Color, showDetail: Bool) -> some View {
        let state = context.state
        return HStack(alignment: .center, spacing: 14) {
            timerText
                .font(.system(size: 32, weight: .regular, design: .serif))
                .monospacedDigit()
                .foregroundStyle(timerTint(accent: accent))
                .frame(minWidth: 92, alignment: .leading)

            VStack(alignment: .leading, spacing: 2) {
                Text(phaseHeading)
                    .font(.system(.caption2, design: .serif))
                    .tracking(1.0)
                    .foregroundStyle(Color.waymarkTextMuted)
                if showDetail, let detail = state.detail {
                    Text(detail)
                        .font(.system(.callout, design: .serif))
                        .italic()
                        .foregroundStyle(Color.waymarkText)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private var completeBody: some View {
        let state = context.state
        HStack(alignment: .center, spacing: 14) {
            Text("✓")
                .font(.system(size: 32, weight: .semibold))
                .foregroundStyle(Color.waymarkGold)
                .fixedSize()
            VStack(alignment: .leading, spacing: 2) {
                Text("WELL TRAVELED")
                    .font(.system(.caption2, design: .serif))
                    .tracking(1.2)
                    .foregroundStyle(Color.waymarkGold.opacity(0.9))
                if let msg = state.completeMessage, !msg.isEmpty {
                    Text(msg)
                        .font(.system(.callout, design: .serif))
                        .italic()
                        .foregroundStyle(Color.waymarkText)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 0)
        }
    }

    // Every non-"complete" phase shows exactly ONE primary button. For
    // timer phases (hold, rest, active) the button morphs through three
    // states as time progresses:
    //   playing   → [Pause]
    //   paused    → [Resume]
    //   time up   → [Next →] (endsAt has passed; Resume would be a no-op)
    // Non-timer phases (exercise, ready) show their static advance button.
    @ViewBuilder
    private var controlRow: some View {
        if #available(iOS 17.0, *) {
            primaryButton(compact: false)
        }
    }

    @available(iOS 17.0, *)
    @ViewBuilder
    fileprivate func primaryButton(compact: Bool) -> some View {
        let state = context.state
        let minHeight: CGFloat = compact ? 30 : 32
        let font: Font = compact
            ? .system(.caption, design: .serif)
            : .system(.footnote, design: .serif)

        switch state.phase {
        case "exercise":
            // Strength exercise: single "Log Set →" (reads pending weight/
            // reps from the app UI; no timer to pause here).
            Button(intent: CompleteSetIntent()) {
                Text("Log Set →")
                    .font(font)
                    .tracking(1.4)
                    .frame(maxWidth: .infinity, minHeight: minHeight)
            }
            .tint(Color.waymarkGold)
            .buttonStyle(.borderedProminent)
        case "ready":
            // Mobility between holds: single "Start Hold →" (no active timer).
            Button(intent: StartHoldIntent()) {
                Text("Start Hold →")
                    .font(font)
                    .tracking(1.4)
                    .frame(maxWidth: .infinity, minHeight: minHeight)
            }
            .tint(Color.waymarkGold)
            .buttonStyle(.borderedProminent)
        default:
            // Timer phases (hold/rest/active) — single morphing button.
            // TimelineView ticks every second so we re-evaluate whether
            // endsAt has been reached and swap the intent accordingly.
            TimelineView(.periodic(from: Date(), by: 1.0)) { timeline in
                morphingTimerButton(
                    state: state,
                    now: timeline.date,
                    font: font,
                    minHeight: minHeight
                )
            }
        }
    }

    // Renders whichever of [Pause] / [Resume] / [Next →] applies right now.
    // Paused wins over time-up (a paused timer is never "done"). Otherwise
    // if endsAt has passed we prefer Next so the user can advance from the
    // lock screen without opening the app.
    @available(iOS 17.0, *)
    @ViewBuilder
    private func morphingTimerButton(
        state: WaymarkActivityAttributes.ContentState,
        now: Date,
        font: Font,
        minHeight: CGFloat
    ) -> some View {
        if state.isPaused {
            Button(intent: ResumeTimerIntent()) {
                Text("Resume")
                    .font(font)
                    .tracking(1.4)
                    .frame(maxWidth: .infinity, minHeight: minHeight)
            }
            .tint(Color.waymarkGoldDim)
            .buttonStyle(.bordered)
        } else if state.endsAt <= now {
            Button(intent: AdvancePhaseIntent()) {
                Text(advanceLabel(state.phase))
                    .font(font)
                    .tracking(1.4)
                    .frame(maxWidth: .infinity, minHeight: minHeight)
            }
            .tint(Color.waymarkGold)
            .buttonStyle(.borderedProminent)
        } else {
            Button(intent: PauseTimerIntent()) {
                Text("Pause")
                    .font(font)
                    .tracking(1.4)
                    .frame(maxWidth: .infinity, minHeight: minHeight)
            }
            .tint(Color.waymarkGoldDim)
            .buttonStyle(.bordered)
        }
    }

    // The morph only surfaces this button once endsAt has passed, so the
    // user is advancing a completed timer — "Skip" no longer applies.
    private func advanceLabel(_ phase: String) -> String {
        switch phase {
        case "hold": return "Done →"
        default: return "Next →"
        }
    }

    // MARK: Lock-screen helpers

    @ViewBuilder
    private var timerText: some View {
        let state = context.state
        if state.phase == "complete" {
            Text("✓")
        } else if state.isPaused, let remaining = state.pausedRemaining {
            Text(formatDuration(remaining))
        } else {
            Text(timerInterval: state.startedAt...state.endsAt, countsDown: true)
        }
    }

    private func timerTint(accent: Color) -> Color {
        if context.state.isPaused { return Color.waymarkTextMuted }
        return accent == .waymarkTeal ? .waymarkTeal : .waymarkText
    }

    private var phaseHeading: String {
        let s = context.state
        switch s.phase {
        case "rest": return "REST"
        case "hold": return "HOLD"
        case "complete": return "DONE"
        default:
            let stripped = s.label.replacingOccurrences(
                of: #"\s*\d+\s+of\s+\d+\s*"#,
                with: "",
                options: [.regularExpression, .caseInsensitive]
            ).trimmingCharacters(in: .whitespaces)
            return stripped.isEmpty ? s.label.uppercased() : stripped.uppercased()
        }
    }

    private var pausedFraction: Double? {
        let s = context.state
        guard s.isPaused, let remaining = s.pausedRemaining else { return nil }
        let total = max(1, s.endsAt.timeIntervalSince(s.startedAt))
        return min(1, max(0, remaining / total))
    }
}

// MARK: - Dynamic Island — compact + minimal

@available(iOS 16.2, *)
private struct CompactTrailingView: View {
    let context: ActivityViewContext<WaymarkActivityAttributes>
    var body: some View {
        let state = context.state
        Group {
            if state.phase == "complete" {
                Text("✓").foregroundStyle(Color.waymarkGold)
            } else if state.phase == "exercise" || state.phase == "ready" {
                Text(shortCounter(state.label))
                    .foregroundStyle(Color.waymarkGold)
            } else if state.isPaused, let remaining = state.pausedRemaining {
                Text(formatDuration(remaining))
            } else {
                Text(timerInterval: state.startedAt...state.endsAt, countsDown: true)
            }
        }
        .font(.caption2)
        .monospacedDigit()
        .frame(minWidth: 40, alignment: .trailing)
        .foregroundStyle(Color.waymarkText)
    }
}

// MARK: - Dynamic Island — expanded regions

@available(iOS 16.2, *)
private struct ExpandedLeadingView: View {
    let context: ActivityViewContext<WaymarkActivityAttributes>
    var body: some View {
        let counter = parseCount(context.state.label)
        let session = context.attributes.sessionLabel.uppercased()
        let headerText = counter.map { "\(session) · \($0.current)/\($0.total)" } ?? session
        HStack(spacing: 6) {
            WaymarkLogoMark(tint: sessionTint(for: context.attributes.sessionType), sessionType: context.attributes.sessionType)
                .frame(width: 14, height: 14)
            Text(headerText)
                .font(.system(.caption2, design: .serif))
                .tracking(1.0)
                .foregroundStyle(Color.waymarkTextMuted)
                .lineLimit(1)
        }
        .padding(.leading, 4)
    }
}

@available(iOS 16.2, *)
private struct ExpandedTrailingView: View {
    let context: ActivityViewContext<WaymarkActivityAttributes>
    var body: some View {
        let state = context.state
        let accent = phaseAccent(state.phase)
        let tint: Color = state.isPaused
            ? Color.waymarkTextMuted
            : (accent == .waymarkTeal ? Color.waymarkTeal : Color.waymarkGold)
        Group {
            if state.phase == "complete" {
                Text("✓")
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(Color.waymarkGold)
            } else if state.phase == "exercise" || state.phase == "ready" {
                Text(shortCounter(state.label))
                    .font(.system(size: 26, weight: .regular, design: .serif))
                    .monospacedDigit()
                    .foregroundStyle(Color.waymarkGold)
            } else if state.isPaused, let remaining = state.pausedRemaining {
                Text(formatDuration(remaining))
                    .font(.system(size: 26, weight: .regular, design: .serif))
                    .monospacedDigit()
                    .foregroundStyle(tint)
            } else {
                Text(timerInterval: state.startedAt...state.endsAt, countsDown: true)
                    .font(.system(size: 26, weight: .regular, design: .serif))
                    .monospacedDigit()
                    .multilineTextAlignment(.trailing)
                    .foregroundStyle(tint)
            }
        }
        .padding(.trailing, 4)
    }
}

@available(iOS 16.2, *)
private struct ExpandedBottomView: View {
    let context: ActivityViewContext<WaymarkActivityAttributes>
    var body: some View {
        let state = context.state
        VStack(alignment: .leading, spacing: 8) {
            // Detail / name line — always italic serif.
            if state.phase == "complete", let msg = state.completeMessage, !msg.isEmpty {
                Text(msg)
                    .font(.system(.callout, design: .serif))
                    .italic()
                    .foregroundStyle(Color.waymarkGold.opacity(0.9))
                    .lineLimit(2)
            } else if state.phase == "exercise" || state.phase == "ready" {
                Text(state.exerciseName ?? state.detail ?? "—")
                    .font(.system(.callout, design: .serif))
                    .italic()
                    .foregroundStyle(Color.waymarkText)
                    .lineLimit(1)
            } else if let detail = state.detail, !detail.isEmpty {
                Text(detail)
                    .font(.system(.callout, design: .serif))
                    .italic()
                    .foregroundStyle(Color.waymarkText)
                    .lineLimit(2)
            }

            if state.phase != "complete", #available(iOS 17.0, *) {
                ExpandedPrimaryButton(context: context)
            }
        }
    }
}

// Mirrors the lock-screen primary button in the Dynamic Island expanded view.
// Timer phases use the same single-button morph: playing → Pause,
// paused → Resume, time-up → Next →. Non-timer phases (exercise, ready)
// render their static context button.
@available(iOS 17.0, *)
private struct ExpandedPrimaryButton: View {
    let context: ActivityViewContext<WaymarkActivityAttributes>

    private let font: Font = .system(.caption, design: .serif)
    private let minHeight: CGFloat = 30

    var body: some View {
        let state = context.state
        Group {
            switch state.phase {
            case "exercise":
                Button(intent: CompleteSetIntent()) {
                    Text("Log Set →")
                        .font(font).tracking(1.0)
                        .frame(maxWidth: .infinity, minHeight: minHeight)
                }
                .tint(Color.waymarkGold)
                .buttonStyle(.borderedProminent)
            case "ready":
                Button(intent: StartHoldIntent()) {
                    Text("Start Hold →")
                        .font(font).tracking(1.0)
                        .frame(maxWidth: .infinity, minHeight: minHeight)
                }
                .tint(Color.waymarkGold)
                .buttonStyle(.borderedProminent)
            default:
                TimelineView(.periodic(from: Date(), by: 1.0)) { timeline in
                    morph(state: state, now: timeline.date)
                }
            }
        }
    }

    @ViewBuilder
    private func morph(state: WaymarkActivityAttributes.ContentState, now: Date) -> some View {
        if state.isPaused {
            Button(intent: ResumeTimerIntent()) {
                Text("Resume")
                    .font(font).tracking(1.0)
                    .frame(maxWidth: .infinity, minHeight: minHeight)
            }
            .tint(Color.waymarkGoldDim)
            .buttonStyle(.bordered)
        } else if state.endsAt <= now {
            Button(intent: AdvancePhaseIntent()) {
                Text(advanceLabel(state.phase))
                    .font(font).tracking(1.0)
                    .frame(maxWidth: .infinity, minHeight: minHeight)
            }
            .tint(Color.waymarkGold)
            .buttonStyle(.borderedProminent)
        } else {
            Button(intent: PauseTimerIntent()) {
                Text("Pause")
                    .font(font).tracking(1.0)
                    .frame(maxWidth: .infinity, minHeight: minHeight)
            }
            .tint(Color.waymarkGoldDim)
            .buttonStyle(.bordered)
        }
    }

    private func advanceLabel(_ phase: String) -> String {
        switch phase {
        case "hold": return "Done →"
        case "rest": return "Next →"
        default: return "Next →"
        }
    }
}

// MARK: - Widget entry point

@available(iOS 16.2, *)
struct WaymarkActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WaymarkActivityAttributes.self) { context in
            LockScreenView(context: context)
                .activityBackgroundTint(Color.waymarkBg)
                .activitySystemActionForegroundColor(Color.waymarkText)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    ExpandedLeadingView(context: context)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    ExpandedTrailingView(context: context)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    ExpandedBottomView(context: context)
                }
            } compactLeading: {
                WaymarkLogoMark(tint: sessionTint(for: context.attributes.sessionType), sessionType: context.attributes.sessionType)
                    .frame(width: 14, height: 14)
            } compactTrailing: {
                CompactTrailingView(context: context)
            } minimal: {
                WaymarkLogoMark(tint: sessionTint(for: context.attributes.sessionType), sessionType: context.attributes.sessionType)
                    .frame(width: 14, height: 14)
            }
        }
    }
}
