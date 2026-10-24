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

// ─── Swipe back (page 85): the plan moves, the run clock never does ───
// A swipe up skips to the next piece; a swipe down restarts the piece (again
// within 3 s: the piece before). Distance, time, heart rate and the recording
// keep going: only the plan's pieces move against the run clock. The move is
// one number, the plan shift: the plan's clock is the run clock plus the shift.
// The screen, the lock card, the recorder's pieces and cues all take the plan
// as pieces on the run clock (planOnRunClock), so they follow at once.

/** Any run piece (a Run-Walk segment, a hard run's piece): its start and length on the plan. Infinity: open. */
export interface PlanPiece {
  startSec: number
  sec: number
}

export type PlanMove = 'skip' | 'restart' | 'previous'

/** The plan's pieces on the run clock: each start less the shift (a piece already passed can start below 0). */
export function planOnRunClock<T extends PlanPiece>(pieces: readonly T[], shiftSec: number): T[] {
  if (!shiftSec) return pieces.slice()
  return pieces.map(p => ({ ...p, startSec: p.startSec - shiftSec }))
}

/** The piece the plan's clock is in (past the end: the last one, `done`). */
function planIndex(pieces: readonly PlanPiece[], planSec: number): { index: number; done: boolean } {
  const t = Math.max(0, planSec)
  for (let i = 0; i < pieces.length; i++) if (t < pieces[i].startSec + pieces[i].sec) return { index: i, done: false }
  return { index: pieces.length - 1, done: true }
}

/**
 * The plan shift after a swipe at run clock `elapsedSec` (null: nothing to
 * move). Skip: the next piece starts now; never past the last piece, and never
 * out of an open piece (the 5K test's 5 km ends with the finish hold). Restart:
 * the piece you're in starts again now (past the end: the last piece).
 * Previous: the piece before starts now (the first piece: it restarts).
 */
export function movePlan(pieces: readonly PlanPiece[], shiftSec: number, elapsedSec: number, move: PlanMove): number | null {
  if (pieces.length === 0) return null
  const planSec = Math.max(0, elapsedSec + shiftSec)
  const { index, done } = planIndex(pieces, planSec)
  const p = pieces[index]
  let to: number
  if (move === 'skip') {
    if (done || index >= pieces.length - 1 || !Number.isFinite(p.sec)) return null
    to = pieces[index + 1].startSec
  } else {
    to = pieces[move === 'previous' ? Math.max(0, index - 1) : index].startSec
  }
  const next = to - Math.max(0, elapsedSec)
  return next === shiftSec ? null : next
}
