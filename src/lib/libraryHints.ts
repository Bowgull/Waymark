// Live coach hints in the Library (page 60, approved by Josh 2026-10-20): the
// hint carries numbers from his own logs, as the mockup shows them.
//   A lift:     "Your main squat. ... Last time 105 lb × 8." (the last logged working set, lb from kg)
//   A combo:    "Open, in your Weapons rounds. Rate it after each round; it comes up more until it is Solid."
//   Run-walk:   "Every Block Zero run: Tue, Thu, Sat. Week 3: 7 rounds of 2 min run, 1 min walk. 26 min in all."
// No history (no sets, a locked combo, no Block Zero): the static hint from 0038.
// Pure, so the tests run under node; the server only gathers the numbers.

import { isLoggedWorkSet } from './loggedSets'
import { kgToLbs } from './units'

/** The last working set logged for an exercise (warm-ups and zero-rep sets left out). */
export interface LastSet {
  weightKg: number | null
  reps: number
  bandColor: string | null
  /** The session's epoch day. */
  day: number
}

/** This Block Zero week's run-walk shape (blockZero/running.ts), or null outside Block Zero. */
export interface RunWalkNow {
  week: number
  runSec: number
  walkSec: number
  rounds: number
  warmupSec: number
}

/** What GET /api/library/hints answers. */
export interface LibraryHintData {
  lastSets: Record<string, LastSet>
  runWalk: RunWalkNow | null
}

export interface SetRow {
  exerciseId: string
  weightKg: number | null
  reps: number
  bandColor: string | null
  isWarmup: number
  setNumber: number
  /** When the set was logged, unix seconds; null = pre-filled, never logged (lib/loggedSets). */
  completedAt: number | null
  /** The session's scheduled epoch day, if any. */
  day: number | null
}

/** The latest logged working set per exercise (the newest log, then the higher set number). */
export function lastWorkingSets(rows: ReadonlyArray<SetRow>): Record<string, LastSet> {
  const best = new Map<string, SetRow & { completedAt: number }>()
  for (const r of rows) {
    if (r.completedAt == null || !isLoggedWorkSet(r) || !(r.reps > 0)) continue
    const cur = best.get(r.exerciseId)
    const later = !cur || r.completedAt > cur.completedAt || (r.completedAt === cur.completedAt && r.setNumber > cur.setNumber)
    if (later) best.set(r.exerciseId, { ...r, completedAt: r.completedAt })
  }
  const out: Record<string, LastSet> = {}
  for (const [id, r] of best) {
    out[id] = { weightKg: r.weightKg, reps: r.reps, bandColor: r.bandColor, day: r.day ?? Math.floor(r.completedAt / 86400) }
  }
  return out
}

const join = (base: string | null | undefined, live: string) => {
  const b = (base ?? '').trim()
  return b ? `${b}${/[.!?]$/.test(b) ? '' : '.'} ${live}` : live
}

/** "105 lb × 8", "red band × 12", "8 reps". */
export function setText(s: Pick<LastSet, 'weightKg' | 'reps' | 'bandColor'>): string {
  if (s.weightKg != null && s.weightKg > 0) return `${kgToLbs(s.weightKg)} lb × ${s.reps}`
  if (s.bandColor) return `${s.bandColor} band × ${s.reps}`
  return `${s.reps} reps`
}

/** A lift's hint: the static one, then "Last time 105 lb × 8." */
export function exerciseHint(staticHint: string | null | undefined, last: LastSet | null | undefined): string | null {
  if (!last) return staticHint ?? null
  return join(staticHint, `Last time ${setText(last)}.`)
}

const TIER_WORD: Readonly<Record<string, string>> = {
  foundation: 'Fundamentals', weapons: 'Weapons', flow: 'Flow', deception: 'Deception', mastery: 'Mastery',
}

/** Mastered at 9 of 15 (libraryModel's MASTERED_AT). */
const MASTERED_AT = 9

/**
 * A combo's hint from its ratings: open and not yet mastered, the mockup's
 * line for its tier; still locked (or mastered), the static hint.
 */
export function comboHint(c: { tier: string; unlocked: number; masteryScore: number; coachHint?: string | null }): string | null {
  const tier = TIER_WORD[c.tier]
  if (!c.unlocked || !tier) return c.coachHint ?? null
  if (c.masteryScore < MASTERED_AT) return `Open, in your ${tier} rounds. Rate it after each round; it comes up more until it is Solid.`
  // mastered: the static hint, unless it was written while the combo was still locked
  return c.coachHint && !/^locked\b/i.test(c.coachHint.trim()) ? c.coachHint : `Open, in your ${tier} rounds.`
}

/** 2 min, 1.5 min, 75 sec. */
const span = (sec: number) => (sec % 30 === 0 ? `${sec / 60} min` : `${sec} sec`)
/** 26, 27.5 (a half minute exactly), else whole minutes. */
const minutes = (sec: number) => String(sec % 30 === 0 ? sec / 60 : Math.round(sec / 60))

/** The run-walk hint for this Block Zero week; other runs, or no Block Zero: the static hint. */
export function runHint(r: { runType: string; coachHint?: string | null }, now: RunWalkNow | null | undefined): string | null {
  if (r.runType !== 'run_walk' || !now) return r.coachHint ?? null
  const total = now.warmupSec + now.rounds * (now.runSec + now.walkSec)
  return `Every Block Zero run: Tue, Thu, Sat. Week ${now.week}: ${now.rounds} rounds of ${span(now.runSec)} run, ${span(now.walkSec)} walk. ${minutes(total)} min in all.`
}
