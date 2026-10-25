// Planned length of a session from its own prescription, for the done
// summary's "+N min" chip (page 33: "Done · 52 min +7 min · RPE 7"). Pure.
//
// Strength: every set's work plus the rest after it (the last set has no rest
// after it). A working set takes about 40 s, a warm-up about 25 s.
// Foundation: the routine's own estimate (lib/foundation estimateRoutineSec).
// Rounds (bag work, rope): the rounds and the rests between them.

export const WORK_SET_SEC = 40
export const WARMUP_SET_SEC = 25

export interface PlannedSet {
  isWarmup: boolean | number
  /** Rest after this set, seconds. */
  restSec: number | null | undefined
}

/** Minutes for a strength session's sets, in order (whole minutes). */
export function plannedStrengthMinutes(sets: ReadonlyArray<PlannedSet>): number | null {
  if (sets.length === 0) return null
  let sec = 0
  sets.forEach((s, i) => {
    sec += s.isWarmup === true || s.isWarmup === 1 ? WARMUP_SET_SEC : WORK_SET_SEC
    if (i < sets.length - 1) sec += Math.max(0, s.restSec ?? 0)
  })
  return Math.max(1, Math.round(sec / 60))
}

/** A main lift's warm-up ramp before its first heavy set (lib/strengthLoads: up to 3 sets, 60 s apart). */
export const ROW_RAMP_SETS = 3
/** Moving between exercises: set up, load the bar, find the bench. */
export const ROW_TRANSITION_SEC = 120

/**
 * The "~60min" on a strength row (m6): every set the template plans, one
 * main set fewer on each main lift when the coach eased it, the main lifts'
 * warm-up ramps and the moves between exercises, to the nearest 5 min.
 */
export function plannedRowStrengthMinutes(exercises: ReadonlyArray<{ section: string; sets: ReadonlyArray<PlannedSet> }>, opts: { oneSetLess?: boolean } = {}): number | null {
  if (exercises.length === 0) return null
  const sets: PlannedSet[] = []
  let mains = 0
  for (const e of exercises) {
    let list = [...e.sets]
    if (e.section === 'main') {
      mains++
      if (opts.oneSetLess) {
        const work = list.filter(st => !(st.isWarmup === true || st.isWarmup === 1)).length
        if (work > 1) list = list.slice(0, -1)
      }
    }
    sets.push(...list)
  }
  const base = plannedStrengthMinutes(sets)
  if (base == null) return null
  const extraSec = mains * ROW_RAMP_SETS * (WARMUP_SET_SEC + 60) + Math.max(0, exercises.length - 1) * ROW_TRANSITION_SEC
  return Math.max(5, Math.round((base * 60 + extraSec) / 300) * 5)
}

/** Minutes for timed rounds: every round, and the rest between rounds (none after the last). */
export function plannedRoundMinutes(rounds: ReadonlyArray<{ durationSec: number; restSec?: number | null }>): number | null {
  if (rounds.length === 0) return null
  const sec = rounds.reduce((t, r, i) => t + r.durationSec + (i < rounds.length - 1 ? Math.max(0, r.restSec ?? 0) : 0), 0)
  return Math.max(1, Math.round(sec / 60))
}

/**
 * Per-round actuals as the athlete did them (seconds per round, in order), as
 * stored at finish. Null when nothing was recorded (an older session).
 */
export function parseRoundSecs(raw: string | null | undefined): number[] | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) && v.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0) ? (v as number[]) : null
  } catch {
    return null
  }
}

/** Where a session's per-round seconds wait on the phone until it is finished. */
export function roundSecsKey(sessionId: string): string {
  return `waymark_round_secs:${sessionId}`
}

/** Set round `index` (0-based) to `sec`; rounds not reached stay out (the list is as long as the last round done). */
export function withRoundSec(list: ReadonlyArray<number>, index: number, sec: number): number[] {
  const next = Array.from({ length: Math.max(list.length, index + 1) }, (_, i) => list[i] ?? 0)
  next[index] = Math.max(0, Math.round(sec))
  return next
}

/**
 * The line under a session's name on its entrance (page 19 #en1 / #en2): the
 * session's own length. Rounds sessions lead with their rounds
 * ("6 ROUNDS · 40 MIN"), strength with its block week ("WEEK 3 · 45 MIN"),
 * anything else is just its minutes. Null when nothing is known.
 */
export function entranceLine(o: { type: string; rounds?: number | null; week?: number | null; minutes?: number | null }): string | null {
  const min = o.minutes != null && Number.isFinite(o.minutes) && o.minutes > 0 ? `${Math.round(o.minutes)} MIN` : null
  const lead = (o.type === 'bag_work' || o.type === 'skip_rope') && o.rounds != null && o.rounds > 0
    ? `${o.rounds} ${o.rounds === 1 ? 'ROUND' : 'ROUNDS'}`
    : o.type === 'strength' && o.week != null && o.week > 0
      ? `WEEK ${o.week}`
      : null
  if (lead && min) return `${lead} · ${min}`
  return lead ?? min
}

// ─── Rope and bag: one calculation every screen shares (audit #23) ───

/** Skip rope: 3 min rounds, 1 min rest between them (none after the last). */
export const ROPE_ROUND_SEC = 180
export const ROPE_REST_SEC = 60
/** Rope rounds: 5, or 3 on an AMBER / RED day or a walk-or-bike injury flag (lower-leg load, F11). */
export const ROPE_ROUNDS = 5
export const ROPE_EASED_ROUNDS = 3

/** The rope rounds for the day's read: the coach state (AMBER / RED eases it) and an injury flag. */
export function ropeRounds(state: string | null | undefined, injuryEased = false): number {
  return injuryEased || state === 'AMBER' || state === 'RED' || state === 'RECOVER' ? ROPE_EASED_ROUNDS : ROPE_ROUNDS
}

/** Rope minutes for its rounds: 5 rounds 19 min, 3 rounds 11 min. */
export function ropeMinutes(rounds: number, roundSec: number = ROPE_ROUND_SEC): number {
  return plannedRoundMinutes(Array.from({ length: Math.max(0, rounds) }, () => ({ durationSec: roundSec, restSec: ROPE_REST_SEC }))) ?? 0
}

/** Bag work opens with a 5 min rope warm-up before its rounds. */
export const BAG_WARMUP_SEC = 300
export const BAG_ROUND_SEC = 180
export const BAG_REST_SEC = 60

/**
 * Bag minutes: the rope warm-up, the rounds and the rests between them. 4 rounds: 20 min.
 * With the finisher (page 86, `finisherSec`: its sets and rests) the last round's rest
 * leads into it, so that rest counts too.
 */
export function bagMinutes(rounds: number | ReadonlyArray<{ durationSec: number; restSec?: number | null }>, finisherSec = 0): number {
  const list = typeof rounds === 'number' ? Array.from({ length: Math.max(0, rounds) }, () => ({ durationSec: BAG_ROUND_SEC, restSec: BAG_REST_SEC })) : rounds
  const fin = list.length > 0 && finisherSec > 0
  const sec = list.reduce((t, r, i) => t + r.durationSec + (i < list.length - 1 || fin ? Math.max(0, r.restSec ?? 0) : 0), 0)
  return Math.max(1, Math.round((BAG_WARMUP_SEC + sec + (fin ? finisherSec : 0)) / 60))
}
