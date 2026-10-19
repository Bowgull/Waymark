// The Block Zero run-walk on the run screen (e2e major 2). The server's
// prescription.runWalk (warm-up walk, then rounds of run / walk) becomes a list
// of segments on the one run clock: the screen counts down the segment you are
// in and names it (WALK / RUN, round n of N), and a cue marks every change.
// Pure: no React, no timers.

export interface RunWalkShape {
  runSec: number
  walkSec: number
  rounds: number
  warmupSec: number
}

export type RunWalkKind = 'warmup' | 'run' | 'walk'

export interface RunWalkSegment {
  kind: RunWalkKind
  /** 1-based round (0 for the warm-up walk). */
  round: number
  startSec: number
  sec: number
}

/** The run-walk as segments: warm-up walk, then run / walk per round. Null when it has no intervals. */
export function runWalkSegments(rw: RunWalkShape | null | undefined): RunWalkSegment[] | null {
  if (!rw || !(rw.rounds > 0) || !(rw.runSec > 0)) return null
  const out: RunWalkSegment[] = []
  let t = 0
  if (rw.warmupSec > 0) {
    out.push({ kind: 'warmup', round: 0, startSec: 0, sec: rw.warmupSec })
    t = rw.warmupSec
  }
  for (let r = 1; r <= rw.rounds; r++) {
    out.push({ kind: 'run', round: r, startSec: t, sec: rw.runSec })
    t += rw.runSec
    if (rw.walkSec > 0) {
      out.push({ kind: 'walk', round: r, startSec: t, sec: rw.walkSec })
      t += rw.walkSec
    }
  }
  return out
}

export interface RunWalkPosition {
  index: number
  segment: RunWalkSegment
  /** Seconds left in this segment (0 once the whole run-walk is done). */
  remainingSec: number
  /** Past the last segment. */
  done: boolean
}

/** Where the run clock is in the run-walk. */
export function runWalkAt(segments: RunWalkSegment[], elapsedSec: number): RunWalkPosition {
  const t = Math.max(0, elapsedSec)
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]
    if (t < s.startSec + s.sec) return { index: i, segment: s, remainingSec: s.startSec + s.sec - t, done: false }
  }
  const last = segments.length - 1
  return { index: last, segment: segments[last], remainingSec: 0, done: true }
}

/** The phase word on the clock. */
export function runWalkWord(kind: RunWalkKind): 'RUN' | 'WALK' {
  return kind === 'run' ? 'RUN' : 'WALK'
}

/** The count beside the title: "RUN 2/6", "WALK 2/6", "WARM-UP". */
export function runWalkCount(segment: RunWalkSegment, rounds: number): string {
  if (segment.kind === 'warmup') return 'WARM-UP'
  return `${runWalkWord(segment.kind)} ${segment.round}/${rounds}`
}

/** One cue per change after the start: [{ atSec, kind }] (the start of each segment but the first). */
export function runWalkCueTimes(segments: RunWalkSegment[]): Array<{ atSec: number; kind: RunWalkKind }> {
  return segments.slice(1).map(s => ({ atSec: s.startSec, kind: s.kind }))
}
