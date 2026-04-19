import ActivityKit
import SwiftUI
import WidgetKit

// MARK: - Brand palette
// Muted charcoal background, warm parchment text, soft gold accent.
// Matches Waymark's lofi + fantasy-book aesthetic.
extension Color {
    static let waymarkBg = Color(red: 10.0 / 255.0, green: 10.0 / 255.0, blue: 10.0 / 255.0)
    static let waymarkText = Color(red: 240.0 / 255.0, green: 230.0 / 255.0, blue: 210.0 / 255.0)
    static let waymarkTextMuted = Color(red: 240.0 / 255.0, green: 230.0 / 255.0, blue: 210.0 / 255.0).opacity(0.7)
    static let waymarkGold = Color(red: 220.0 / 255.0, green: 180.0 / 255.0, blue: 90.0 / 255.0)
}

// MARK: - Formatting helpers
private func formatDuration(_ seconds: TimeInterval) -> String {
    let clamped = max(0, seconds.rounded())
    let total = Int(clamped)
    let m = total / 60
    let r = total % 60
    return String(format: "%d:%02d", m, r)
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
                Text("✦").foregroundStyle(Color.waymarkGold)
            } compactTrailing: {
                CompactTrailingView(context: context)
            } minimal: {
                Text("✦").foregroundStyle(Color.waymarkGold)
            }
        }
    }
}

// MARK: - Lock screen

@available(iOS 16.2, *)
private struct LockScreenView: View {
    let context: ActivityViewContext<WaymarkActivityAttributes>

    var body: some View {
        let state = context.state

        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text("✦").foregroundStyle(Color.waymarkGold)
                Text(context.attributes.sessionLabel.uppercased())
                    .font(.system(.caption, design: .serif))
                    .tracking(1.2)
                    .foregroundStyle(Color.waymarkTextMuted)
                Spacer()
            }

            Text(state.label)
                .font(.system(.title3, design: .serif))
                .foregroundStyle(Color.waymarkText)

            HStack(alignment: .firstTextBaseline) {
                timerText
                    .font(.system(size: 48, weight: .medium, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(phaseColor)
                Spacer()
            }

            if let detail = state.detail, !detail.isEmpty, state.phase != "complete" {
                Text(detail)
                    .font(.system(.footnote, design: .serif))
                    .italic()
                    .foregroundStyle(Color.waymarkTextMuted)
            }

            if state.phase == "complete", let msg = state.completeMessage {
                Text(msg)
                    .font(.system(.footnote, design: .serif))
                    .foregroundStyle(Color.waymarkGold.opacity(0.85))
            } else if state.phase != "hold", #available(iOS 17.0, *) {
                HStack {
                    Spacer()
                    if state.isPaused {
                        Button(intent: ResumeTimerIntent()) {
                            Text("Resume")
                                .font(.system(.footnote, design: .serif))
                                .tracking(1.0)
                        }
                        .tint(Color.waymarkGold)
                    } else {
                        Button(intent: PauseTimerIntent()) {
                            Text("Pause")
                                .font(.system(.footnote, design: .serif))
                                .tracking(1.0)
                        }
                        .tint(Color.waymarkTextMuted)
                    }
                }
            }
        }
        .padding(14)
    }

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

    private var phaseColor: Color {
        switch context.state.phase {
        case "rest": return Color.waymarkTextMuted
        case "hold": return Color.waymarkGold
        case "complete": return Color.waymarkGold
        default: return Color.waymarkText
        }
    }
}

// MARK: - Dynamic Island — compact

@available(iOS 16.2, *)
private struct CompactTrailingView: View {
    let context: ActivityViewContext<WaymarkActivityAttributes>
    var body: some View {
        let state = context.state
        Group {
            if state.phase == "complete" {
                Text("✓").foregroundStyle(Color.waymarkGold)
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

// MARK: - Dynamic Island — expanded

@available(iOS 16.2, *)
private struct ExpandedLeadingView: View {
    let context: ActivityViewContext<WaymarkActivityAttributes>
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(context.attributes.sessionLabel.uppercased())
                .font(.system(.caption2, design: .serif))
                .tracking(1.0)
                .foregroundStyle(Color.waymarkTextMuted)
            Text(context.state.label)
                .font(.system(.headline, design: .serif))
                .foregroundStyle(Color.waymarkText)
        }
        .padding(.leading, 4)
    }
}

@available(iOS 16.2, *)
private struct ExpandedTrailingView: View {
    let context: ActivityViewContext<WaymarkActivityAttributes>
    var body: some View {
        let state = context.state
        Group {
            if state.phase == "complete" {
                Text("✓")
                    .font(.system(size: 30, weight: .semibold))
                    .foregroundStyle(Color.waymarkGold)
            } else if state.isPaused, let remaining = state.pausedRemaining {
                Text(formatDuration(remaining))
                    .font(.system(size: 28, weight: .medium, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(Color.waymarkText)
            } else {
                Text(timerInterval: state.startedAt...state.endsAt, countsDown: true)
                    .font(.system(size: 28, weight: .medium, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(Color.waymarkText)
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
        HStack {
            if state.phase == "complete", let msg = state.completeMessage {
                Text(msg)
                    .font(.system(.caption, design: .serif))
                    .foregroundStyle(Color.waymarkGold.opacity(0.85))
                Spacer()
            } else {
                if let detail = state.detail, !detail.isEmpty {
                    Text(detail)
                        .font(.system(.caption, design: .serif))
                        .italic()
                        .foregroundStyle(Color.waymarkTextMuted)
                }
                Spacer()
                if state.phase != "hold", #available(iOS 17.0, *) {
                    if state.isPaused {
                        Button(intent: ResumeTimerIntent()) {
                            Text("Resume")
                                .font(.caption2)
                                .tracking(0.8)
                        }
                        .tint(Color.waymarkGold)
                        .buttonStyle(.bordered)
                    } else {
                        Button(intent: PauseTimerIntent()) {
                            Text("Pause")
                                .font(.caption2)
                                .tracking(0.8)
                        }
                        .tint(Color.waymarkTextMuted)
                        .buttonStyle(.bordered)
                    }
                }
            }
        }
    }
}
