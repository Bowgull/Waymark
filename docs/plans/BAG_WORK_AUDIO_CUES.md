# Bag Work & Skip Rope — Round Timer Audio Cues

> Boxing bell sounds and warning claps for round-based timers.
> Planned 2026-04-15.

---

## Problem

Bag work and skip rope timers auto-advance between fighting and rest phases, but the only feedback is visual (RingTimer countdown) and a single haptic on "Start Round." If you're hitting the bag or skipping rope, you're not watching your phone. You have no idea when a round ends, when rest starts, or when to pick up again.

---

## Solution

Synthesize boxing gym sounds using the Web Audio API (no audio files, no new dependencies) and fire them at every phase transition.

---

## Sound Palette

| Sound | How it's made | Duration | Use |
|---|---|---|---|
| `playBell()` | Two detuned sine oscillators (~830 Hz + ~1080 Hz) + overtone (~1620 Hz), fast attack, ~1.2s exponential decay | ~1.5s | Round start, rest end |
| `playDoubleBell()` | Two `playBell()` strikes 0.35s apart | ~1.8s | Round end |
| `playTripleBell()` | Three strikes at 0s, 0.25s, 0.5s | ~2s | Final round / session complete |
| `playWarningClap()` | Short percussive tone at a distinct frequency, fast decay | ~0.15s | 10-second warning |

AudioContext is lazy-created on first user gesture ("Start Round" button tap) and resumed if suspended (handles iOS backgrounding).

---

## When Sounds Fire

### BagWorkRoundView

| Moment | Sound | Haptic | Visual (already exists) |
|---|---|---|---|
| User taps "Start Round" | `playBell()` | `heavyHaptic()` (already there) | Timer starts counting down |
| 10 seconds left in round | `playWarningClap()` | -- | Label changes to "Finish", color goes red |
| Round timer hits 0 | `playDoubleBell()` | `heavyHaptic()` | Auto-transitions to rest phase |
| 10 seconds left in rest | `playWarningClap()` | -- | -- |
| Rest timer hits 0 | `playBell()` | `heavyHaptic()` | Auto-advances to next round "ready" screen |
| Last round timer hits 0 | `playTripleBell()` | `completeHaptic()` | Calls `onComplete()` |

### SkipRopeView

Same pattern, same sounds, same moments.

---

## Implementation Details

### Warning ref pattern

Use `useRef` flags (`roundWarnedRef`, `restWarnedRef`) to prevent the 10-second warning from firing more than once per phase. Reset both refs when phase changes.

```tsx
const roundWarnedRef = useRef(false)
const restWarnedRef = useRef(false)

useEffect(() => {
  if (phase === 'fighting' && roundTimer.secondsRemaining === 10 && !roundWarnedRef.current) {
    playWarningClap()
    roundWarnedRef.current = true
  }
}, [phase, roundTimer.secondsRemaining])
```

### SkipRopeView refactor

Convert render-time auto-advance check to a `useEffect` (matching BagWorkRoundView's pattern) so audio isn't called during render.

### iOS / Capacitor

- Web Audio API works in WKWebView -- no native plugin needed
- AudioContext created on first "Start Round" tap (user gesture), so subsequent programmatic plays work
- `ctx()` helper calls `.resume()` to handle returning from background

---

## Files Touched

| File | Action |
|---|---|
| `src/lib/audio.ts` | **Create** -- sound synthesis utilities |
| `src/features/session/BagWorkRoundView.tsx` | **Modify** -- add imports, audio calls, warning refs |
| `src/features/session/SkipRopeView.tsx` | **Modify** -- same pattern, refactor auto-advance to useEffect |

## What We're NOT Doing

- No settings toggle for audio on/off (can add later if annoying)
- No countdown beeps at 3-2-1 (the 10s warning clap + bell at 0 is enough)
- No changes to strength rest timers or other session types
- No audio file assets -- everything synthesized
