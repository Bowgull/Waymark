// The lock card and the Island count the piece you're in, as the app does
// (page 84, item 14). On a Run-Walk and a hard run the card used to count down
// the whole run (runStartedAt + the run's length) while the screen counted the
// piece. A piece's times, from the run clock: its start and end on the wall
// clock, what is left when paused, and the 5K test's open piece counting up.
// The recorder gets the same pieces (pieces()) to move the card on by itself
// at each change while the phone is locked.

export interface RunPiece {
  /** Seconds on the run clock (pauses left out). */
  startSec: number
  /** Infinity: the test's open 5 km. */
  sec: number
  /** The open piece's planned length, for the grass. */
  estSec?: number
}

export interface PieceTimes {
  startedAt: number
  endsAt: number
  pausedRemaining?: number
  /** The open piece: the lock card counts up from startedAt. */
  countsUp?: boolean
}

/**
 * `runStartedAtMs` is the run clock's zero on the wall clock (pauses pushed in),
 * `elapsedSec` the run clock now. Paused, the times stand where they were.
 */
export function pieceTimes(p: RunPiece, runStartedAtMs: number, elapsedSec: number, paused: boolean): PieceTimes {
  const open = !Number.isFinite(p.sec)
  const len = open ? Math.max(1, p.estSec ?? 1500) : p.sec
  const startedAt = runStartedAtMs + p.startSec * 1000
  const endsAt = startedAt + len * 1000
  if (open) {
    const inSec = Math.max(0, Math.floor(elapsedSec - p.startSec))
    return { startedAt, endsAt, countsUp: true, ...(paused ? { pausedRemaining: inSec } : {}) }
  }
  if (!paused) return { startedAt, endsAt }
  const left = Math.max(0, Math.ceil(p.startSec + p.sec - elapsedSec))
  return { startedAt, endsAt, pausedRemaining: left }
}

/** What the recorder needs to move the card on at each piece while JS sleeps. */
export interface RecorderPiece {
  startSec: number
  /** 0 with `open`. */
  sec: number
  open: boolean
  /** The open piece's planned length. */
  estSec: number
  /** "active" (work) or "rest" (walk, easy jog, easy). */
  phase: 'active' | 'rest'
  /** A hard run's piece word (RUN HARD, EASY JOG, TEMPO, 5K, EASY); none on a Run-Walk. */
  word?: string
  /** The piece's round (0: none) and the rounds in all. */
  round: number
  total: number
  /** The change counter (lib/lockGlow): the card flashes once at each piece. */
  seq: number
}
