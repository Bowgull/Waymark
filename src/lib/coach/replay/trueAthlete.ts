// The rebuild's "true athlete" (rebuild plan, Phase 1): a made-up returner
// whose real strength and real 5K the coach never sees, only what he logs.
// The 24-week simulator (scenarios24.ts) drives the real coach with him and
// then measures how close the coach's numbers came to his true ones.
//
// - Strength: a true 8-rep max per lift that rises with every session done,
//   by a share of what is left to its ceiling (diminishing returns), and
//   fades after 14 days off (0.5% a day, as the app's own model assumes).
// - Reps left: honest but about one rep off (strength.md, Halperin 2022),
//   reported 0, 1, 2 or 3 (3 = "3+"). A set heavier than he can do for the
//   reps comes out short with 0 left.
// - Running: a true 5K that starts at 30:00 and improves each week with easy
//   kilometres and hard runs, slower as it gets faster, and fades in a week
//   with no runs. Easy runs go at about 78% of 5K speed (Daniels).
// - He misses about 1 session in 10 (Foundation never), by a fixed hash so
//   every run of the simulator is the same.
//
// Made-up numbers in the range of the strength research (strength.md),
// never real data. Pure.

import { liftPattern } from './history'
import { isLandmine } from '../../landmine'

/** True 8-rep max (kg) at the start and the most he can reach in the 24 weeks, by exercise. */
const LIFT_START: Record<string, { start: number; ceiling: number }> = {
  'ex-goblet-squat': { start: 28, ceiling: 45 },
  'ex-front-squat': { start: 50, ceiling: 85 },
  'ex-db-rdl': { start: 30, ceiling: 50 },
  'ex-block-pull': { start: 75, ceiling: 120 },
  'ex-trap-bar-deadlift': { start: 80, ceiling: 130 },
  'ex-bench-press': { start: 47, ceiling: 75 },
  'ex-ohp': { start: 30, ceiling: 48 },
  'ex-db-row': { start: 25, ceiling: 40 },
  'ex-bent-over-row': { start: 45, ceiling: 72 },
  'ex-reverse-lunge': { start: 16, ceiling: 30 },
  // Landmine moves (rebuild Phase 5): the 8-rep max as felt at the hand (see LANDMINE_HAND).
  'ex-landmine-press': { start: 14, ceiling: 24 },
  'ex-lm-press-standing': { start: 15, ceiling: 26 },
  'ex-lm-reverse-lunge': { start: 22, ceiling: 40 },
  'ex-lm-punch': { start: 16, ceiling: 26 },
}
/**
 * The landmine's load at the hand from the weight on the bar end (landmine.md
 * section 3): the empty bar about 19 lb (8.6 kg), each plate about 80%.
 */
const LANDMINE_HAND = (endKg: number) => 8.6 + 0.8 * endKg
/** Anything else, by pattern. */
const PATTERN_START: Record<string, { start: number; ceiling: number }> = {
  squat: { start: 30, ceiling: 50 },
  hinge: { start: 35, ceiling: 60 },
  press: { start: 25, ceiling: 40 },
  pull: { start: 25, ceiling: 40 },
  other: { start: 15, ceiling: 25 },
}
/** Share of the gap to the ceiling closed by one session of the lift (16 sessions: about 60%). */
const LIFT_GAIN = 0.06
const START_5K_SEC = 30 * 60
/** The fastest 5K the model lets him reach (a floor on the curve, not a goal). */
const FLOOR_5K_SEC = 19 * 60

/** A stable 0..1 from a few numbers (no randomness: every run is the same). */
export function hash01(...xs: Array<number | string>): number {
  let h = 2166136261
  for (const ch of xs.join('|')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) }
  return ((h >>> 0) % 10000) / 10000
}

/** Reps he can do at `kg` from an 8-rep max (Epley both ways). */
export function repsPossible(true8Kg: number, kg: number): number {
  if (!(kg > 0)) return 30
  const e1 = true8Kg * (1 + 8 / 30)
  return Math.max(0, 30 * (e1 / kg - 1))
}

export interface LiftSet { exerciseId: string; weightKg: number | null; reps: number; setNumber: number; day: number }
export interface RunIn {
  day: number
  /** 'foundation_run' or 'running'. */
  type: string
  /** Run category: tempo, intervals, 5k_test, or null. */
  notes: string | null
  targetDurSec: number | null
  runWalk: { runSec: number; walkSec: number; rounds: number; warmupSec: number } | null
  z2CeilingBpm: number | null
  walkOnly: boolean
}
export interface RunOut { durationSec: number; distanceKm: number; avgHr: number | null; maxHr: number | null; fiveKSec?: number }

export class TrueAthlete {
  private lifts = new Map<string, { kg: number; ceiling: number; lastDay: number | null; sessions: Set<number> }>()
  private runs: Array<{ day: number; km: number; hard: boolean }> = []
  private fiveK = START_5K_SEC
  private fiveKWeek = 0
  /** His 5K at the start of each week, as it was then (the report reads it afterwards). */
  private fiveKByWeek: number[] = [START_5K_SEC]
  readonly startDay: number
  /** Share of sessions he misses (default 1 in 10). */
  readonly missRate: number

  constructor(startDay: number, opts: { missRate?: number } = {}) {
    this.startDay = startDay
    this.missRate = opts.missRate ?? 0.1
  }

  private lift(exerciseId: string) {
    let l = this.lifts.get(exerciseId)
    if (!l) {
      const base = LIFT_START[exerciseId] ?? PATTERN_START[liftPattern(exerciseId)]
      l = { kg: base.start, ceiling: base.ceiling, lastDay: null, sessions: new Set() }
      this.lifts.set(exerciseId, l)
    }
    return l
  }

  /** His true 8-rep max today (after any fade for time off). */
  true8(exerciseId: string, day: number): number {
    const l = this.lift(exerciseId)
    if (l.lastDay != null && day - l.lastDay > 14) return l.kg * Math.max(0.6, 1 - 0.005 * (day - l.lastDay - 14))
    return l.kg
  }

  /** One main set as he does it: the reps he gets and the reps left he taps. */
  set(s: LiftSet): { reps: number; rir: number; feel: number } {
    const l = this.lift(s.exerciseId)
    const now = this.true8(s.exerciseId, s.day)
    // A new session of this lift: the fade is real now, then the session's gain.
    if (!l.sessions.has(s.day)) {
      l.kg = now
      l.sessions.add(s.day)
      l.lastDay = s.day
      l.kg += LIFT_GAIN * Math.max(0, l.ceiling - l.kg)
    }
    const can = repsPossible(now, isLandmine(s.exerciseId) ? LANDMINE_HAND(s.weightKg ?? 0) : (s.weightKg ?? 0))
    if (can < s.reps) return { reps: Math.max(1, Math.floor(can)), rir: 0, feel: 0 }
    const noise = [-1, 0, 0, 1][Math.floor(hash01(s.exerciseId, s.day, s.setNumber) * 4)]
    const feel = Math.max(0, can - s.reps + noise)
    return { reps: s.reps, rir: Math.max(0, Math.min(3, Math.round(feel))), feel }
  }

  /** Does he miss this session? Foundation never; else about missRate of the rest. */
  misses(day: number, type: string): boolean {
    if (type === 'mobility') return false
    return hash01('miss', day, type) < this.missRate
  }

  /** His true 5K on `day` (weeks are stepped from the runs he did). */
  fiveKOn(day: number): number {
    const week = Math.floor((day - this.startDay) / 7)
    if (week < this.fiveKWeek) return Math.round(this.fiveKByWeek[Math.max(0, week)])
    while (this.fiveKWeek < week) {
      const from = this.startDay + this.fiveKWeek * 7
      const done = this.runs.filter(r => r.day >= from && r.day < from + 7)
      const easyKm = done.filter(r => !r.hard).reduce((n, r) => n + r.km, 0)
      const hard = done.filter(r => r.hard).length
      if (done.length === 0) this.fiveK = Math.min(START_5K_SEC * 1.05, this.fiveK * 1.01)
      else {
        // Easy kilometres and hard runs both help, less as he gets faster (Seiler; Daniels).
        const room = Math.max(0, (this.fiveK - FLOOR_5K_SEC) / (START_5K_SEC - FLOOR_5K_SEC))
        const g = Math.min(0.014, 0.0006 * easyKm + 0.003 * Math.min(2, hard)) * Math.max(0.25, room)
        this.fiveK = this.fiveK * (1 - g)
      }
      this.fiveKWeek++
      this.fiveKByWeek[this.fiveKWeek] = this.fiveK
    }
    return Math.round(this.fiveK)
  }

  /** A run as he does it: the time, distance and heart rate he logs. */
  run(r: RunIn): RunOut {
    const five = this.fiveKOn(r.day)
    const v5 = 5 * 3600 / five
    const easy = v5 * 0.78
    const hard = r.notes === 'tempo' || r.notes === 'intervals' || r.notes === '5k_test'
    let out: RunOut
    if (r.notes === '5k_test') {
      const warm = 10 * 60
      out = { durationSec: warm + five, distanceKm: Math.round((5 + warm / 3600 * easy) * 100) / 100, avgHr: null, maxHr: null, fiveKSec: five }
    } else if (r.walkOnly) {
      const sec = r.targetDurSec ?? 1800
      out = { durationSec: sec, distanceKm: Math.round(sec / 3600 * 5.5 * 100) / 100, avgHr: null, maxHr: null }
    } else if (r.runWalk && r.runWalk.walkSec > 0) {
      const runSec = r.runWalk.runSec * r.runWalk.rounds
      const walkSec = r.runWalk.walkSec * r.runWalk.rounds + r.runWalk.warmupSec
      out = { durationSec: runSec + walkSec, distanceKm: Math.round((runSec / 3600 * easy + walkSec / 3600 * 5.5) * 100) / 100, avgHr: null, maxHr: null }
    } else {
      const sec = r.targetDurSec ?? (r.runWalk ? r.runWalk.runSec * r.runWalk.rounds : 1800)
      // A hard run's pieces average a little over easy speed once the warm-up and jogs are in.
      out = { durationSec: sec, distanceKm: Math.round(sec / 3600 * easy * (hard ? 1.12 : 1) * 100) / 100, avgHr: null, maxHr: null }
    }
    if (r.z2CeilingBpm != null && !hard) { out.avgHr = r.z2CeilingBpm - 8; out.maxHr = r.z2CeilingBpm - 1 }
    this.runs.push({ day: r.day, km: out.distanceKm, hard })
    return out
  }
}
