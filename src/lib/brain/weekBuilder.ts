// The one plan's week (rebuild plan Phase 2; page 93 approved 2026-10-25).
// Every block uses this week: there is no switch to the old Fighter week.
//
// The coach's day step sets what the week holds (page 93's table
// and 2026-10-26: two short runs from week 1, so 4 days holds 2 runs):
//
//   step                          lifts  runs  hard runs  Muay Thai
//   4 days                          2      2       0      class days; none set: one Bag Conditioning
//   5 days                          2      2       0      class days, plus Bag Work
//   6 days                          2      3       1      class days, plus Bag Work
//   6 days, 2 mornings doubled      2      4       2      class days, plus Bag Work
//
// - Classes only on his Settings class days (none set: no classes), in the
//   slot he set (ANY: weekday evening, weekend morning), under the profile cap
//   and as many as the hard-day cap leaves beside the 2 lifts and the hard
//   runs: 1 at 4 and 5 days, 1 at 6, 2 doubled (the plan's 1-2-3 ladder);
//   spread out when not every day fits.
// - Bag Conditioning (lib/coach/bagConditioning.ts) by that week's classes and
//   his stage: with no class days one a week (two once at 6 days and the week
//   has room); with class days, none (class is the conditioning). At 4 days
//   it only comes with no class, steady for the first 2 weeks. Never the same
//   day as Bag Work and 48 h from it, not the day before a class, never with
//   heavy legs. Which workout and how long: the Muay Thai track's
//   pickConditioning (its level from the plan week, steady when the week's
//   hard days are full, kicks inside the week's budget shared with the finisher).
// - Hard days: lifts, hard runs, classes, Bag Work from week 3 (pressure and
//   finisher rounds; technique only before), a hard Bag Conditioning. At most
//   3 hard days a week at 4 and 5 days, 4 at 6; never 3 in a row; at least one
//   full rest day. A hard-run morning with that day's lift in the evening is
//   one hard day (a doubled morning: only at the last step, run first).
// - Spacing: no hard run in the 48 h after heavy legs (every lift has squat,
//   hinge or lunges); no heavy legs in the 24 h before a class; no heavy hinge
//   in the 24 h after one. An easy run pairs with an evening class.
// - Hard runs from week 4, once he runs 10 minutes straight.
// - When the week can't keep every rule, the coach eases the least important
//   hard session first: Bag Work to technique, Bag Conditioning to its steady
//   form, then a hard run to an easy one. A class is never moved or eased (it
//   is his), lifts are never dropped.
// - Every session is planned at 60 minutes or less (each dose caps its own).
//
// Pure: the server stores the week's build on its week plan and makes each
// day's sessions from it (server/coachData.ts).

import type { TemplateSession } from '../weeklyTemplate'
import { FOUNDATION_LABEL } from '../foundation'
import { HARD_FROM_WEEK, HARD_NOTES, HARD_START_LABEL } from './hardRuns'
import { conditioningLevel, pickConditioning, type StepEntry } from '../coach/bagConditioning'
import { kicksLeft } from '../coach/kickBudget'
import { techniqueGroups } from '../coach/bagFinisher'

/** Bag Conditioning (page 93; the session itself is the Muay Thai track's lib/coach/bagConditioning.ts). */
export const BAG_CONDITIONING_TYPE = 'bag_conditioning'
export const BAG_CONDITIONING_LABEL = 'Bag Conditioning'
import { FINISHER_SIZE } from '../coach/bagFinisher'
import type { ClassDaySlot } from '../classSlots'

export type DayStep = 4 | 5 | 6 | 7
export const MIN_STEP: DayStep = 4
export const MAX_STEP: DayStep = 7

export interface StepShape { days: number; runs: number; hardRuns: number; doubled: number }
export const STEP_SHAPE: Readonly<Record<DayStep, StepShape>> = {
  4: { days: 4, runs: 2, hardRuns: 0, doubled: 0 },
  5: { days: 5, runs: 2, hardRuns: 0, doubled: 0 },
  6: { days: 6, runs: 3, hardRuns: 1, doubled: 0 },
  7: { days: 6, runs: 4, hardRuns: 2, doubled: 2 },
}

/** The two lifts (page 93: "Strength A and Strength B everywhere"). */
export const LIFT_LABELS = ['Strength A', 'Strength B'] as const
/** Bag Work is technique only (not a hard day) before this plan week. */
export const BAG_HARD_FROM_WEEK = 3

/** The week's hard-day cap: 3 at 4 and 5 days, 4 at 6. */
export function hardCapFor(step: DayStep): number {
  return STEP_SHAPE[step].days >= 6 ? 4 : 3
}

export function stepWords(step: DayStep): string {
  return step === 7 ? '6 days, 2 mornings doubled' : `${step} days`
}

export type Role = 'lift' | 'run' | 'long' | 'hard_run' | 'class' | 'bag' | 'bag_cond'

/** One planned session of the week. */
export interface PlanEntry extends TemplateSession {
  dow: number
  role: Role
  /** Counts as a hard day. */
  hard: boolean
  /** Bag Conditioning's planned minutes, effort and kicks; Bag Work's technique flag. */
  plan?: { hard: boolean; minutes?: number; effort?: number; kicksPerSide?: number; workoutId?: string | null; long?: boolean }
}

/** A session that stays where it is (done, his own, an earlier day): it counts toward the week. */
export interface KeptSession {
  dow: number
  slot: 'am' | 'pm'
  type: string
  label?: string | null
  notes?: string | null
  /** Hard as it stands (a done hard run, a class, a lift...). */
  hard?: boolean
}

export interface WeekBuildIn {
  /** The plan week (1-based): hard runs from week 4, Bag Work pressure from week 3. */
  week: number
  step: DayStep
  /** His Settings class days and slots. */
  classDays: ReadonlyArray<{ dow: number; slot: ClassDaySlot }>
  /** Profile cap on classes a week (null: none). */
  classCap?: number | null
  /** Weekdays (0 = Sunday) the builder may fill. Missing: every day. */
  open?: readonly number[]
  /** Sessions that stay: done, his own, extras, earlier days of the week. */
  kept?: readonly KeptSession[]
  /** Last week's Saturday and Sunday were hard days (for "never 3 in a row"). */
  prevHard?: readonly [boolean, boolean]
  /** Last week's Saturday (2) and Sunday (1) lifts: their 48 h reach into Monday and Tuesday. */
  prevLifts?: ReadonlyArray<{ daysBefore: 1 | 2; slot: 'am' | 'pm'; label?: string | null }>
  /** He runs 10 minutes straight (hard runs need it, from week 4). */
  runsReady: boolean
  /**
   * For the Bag Conditioning pick (lib/coach/bagConditioning pickConditioning): his
   * level (default from the plan week), Settings switches, the last workout and his steps.
   */
  conditioning?: { level?: 1 | 2 | 3; switches?: readonly string[]; lastTemplateId?: string | null; history?: readonly StepEntry[] }
}

export interface WeekBuild {
  entries: PlanEntry[]
  cap: number
  hardDays: number
  trainingDays: number
  /** What the coach eased to keep the rules (plain words). */
  eased: string[]
  /** Rules it could not keep (too many classes for the cap, say). */
  broken: string[]
  /** The week's line (page 93: the app's own line under THIS WEEK). */
  why: string
}

// ─── Days ────────────────────────────────────────────────────

/** Monday first: index 0..6 → weekday (0 = Sunday). */
const ORDER = [1, 2, 3, 4, 5, 6, 0] as const
const idxOf = (dow: number) => (dow + 6) % 7
const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const SLOT_H = { am: 8, pm: 18 } as const

const RUN_TYPES = new Set(['foundation_run', 'running'])
const HARD_RUN_NOTES = new Set(['tempo', 'intervals', '5k_test'])

interface Placed { idx: number; slot: 'am' | 'pm'; role: Role; hard: boolean; legs: boolean; hinge: boolean; label?: string | null; kept?: boolean; type: string; notes?: string | null; plan?: PlanEntry['plan'] }

/** A kept session's role from its type, notes and label. */
export function roleOf(s: Pick<KeptSession, 'type' | 'notes' | 'label'>): Role | null {
  if (s.type === 'strength') return 'lift'
  if (s.type === 'mt_class') return 'class'
  if (s.type === 'bag_work') return 'bag'
  if (s.type === BAG_CONDITIONING_TYPE) return 'bag_cond'
  if (RUN_TYPES.has(s.type)) return s.type === 'running' && HARD_RUN_NOTES.has(s.notes ?? '') ? 'hard_run' : 'run'
  return null
}

/** Heavy legs (the 48 h and class rules): every lift while each has squat, hinge or lunges as a main lift. */
export function liftIsHeavyLegs(_label: string | null | undefined): boolean {
  void _label
  return true
}
/** A heavy hip hinge (kept 24 h after a class): Strength B (the hinge day). */
export function liftIsHeavyHinge(label: string | null | undefined): boolean {
  return /Strength B\b/.test(label ?? '')
}

const hoursFrom = (a: Pick<Placed, 'idx' | 'slot'>, b: Pick<Placed, 'idx' | 'slot'>) => (b.idx * 24 + SLOT_H[b.slot]) - (a.idx * 24 + SLOT_H[a.slot])

/** The rules a placed week breaks (empty: it keeps them all). */
function check(p: readonly Placed[], cap: number, prevHard: readonly [boolean, boolean], maxDays: number): string[] {
  const out: string[] = []
  const on = (i: number) => p.filter(x => x.idx === i)
  const hardDay = (i: number) => i < 0 ? prevHard[i + 2] ?? false : on(i).some(x => x.hard)
  const hardDays = ORDER.map((_, i) => i).filter(hardDay)
  if (hardDays.length > cap) out.push(`${hardDays.length} hard days (cap ${cap})`)
  for (let i = -2; i <= 4; i++) if (hardDay(i) && hardDay(i + 1) && hardDay(i + 2)) { out.push('3 hard days in a row'); break }
  const days = ORDER.map((_, i) => i).filter(i => on(i).length > 0).length
  if (days > maxDays) out.push(`${days} training days`)
  if (days >= 7) out.push('no rest day')
  for (const legs of p.filter(x => x.legs)) {
    for (const run of p.filter(x => x.role === 'hard_run')) {
      const h = hoursFrom(legs, run)
      if (h > 0 && h < 48) out.push('hard run within 48 h after heavy legs')
    }
    for (const c of p.filter(x => x.role === 'class')) {
      const h = hoursFrom(legs, c)
      if (h >= 0 && h < 24) out.push('heavy legs before a class')
    }
  }
  for (const hinge of p.filter(x => x.hinge)) {
    for (const c of p.filter(x => x.role === 'class')) {
      const h = hoursFrom(c, hinge)
      if (h > 0 && h < 24) out.push('heavy hinge after a class')
    }
  }
  for (const b of p.filter(x => x.role === 'bag_cond')) {
    if (p.some(x => x.role === 'bag' && Math.abs(hoursFrom(x, b)) < 48)) out.push('Bag Conditioning within 48 h of Bag Work')
    if (p.some(x => x.role === 'class' && x.idx === b.idx + 1)) out.push('Bag Conditioning the day before a class')
    if (p.some(x => x.legs && x.idx === b.idx)) out.push('Bag Conditioning with heavy legs')
  }
  return out
}

/** Soft costs (lower is better): spread hard days, lifts apart, hard runs apart, long run at the weekend, Sunday rest. */
function cost(p: readonly Placed[]): number {
  let c = 0
  const on = (i: number) => p.filter(x => x.idx === i)
  const hardDay = (i: number) => on(i).some(x => x.hard)
  for (let i = 0; i < 6; i++) if (hardDay(i) && hardDay(i + 1)) c += 0.3
  const lifts = p.filter(x => x.role === 'lift').map(x => x.idx).sort((a, b) => a - b)
  for (let i = 1; i < lifts.length; i++) if (lifts[i] - lifts[i - 1] < 2) c += 1
  const hr = p.filter(x => x.role === 'hard_run').map(x => x.idx).sort((a, b) => a - b)
  for (let i = 1; i < hr.length; i++) if (hr[i] - hr[i - 1] < 2) c += 3
  for (const l of p.filter(x => x.role === 'long')) if (l.idx < 5) c += 0.5
  // Sunday stays the rest day when the week allows (Block Zero's own rest day; his moves can't land there).
  if (on(6).some(x => !x.kept && x.role !== 'class')) c += 1.5
  // A hard run the day after a class: legs still heavy from the kicks.
  for (const r of p.filter(x => x.role === 'hard_run')) if (p.some(x => x.role === 'class' && Math.abs(hoursFrom(x, r)) < 24)) c += 0.6
  // An easy run the morning of an evening class pairs well.
  for (const r of p.filter(x => (x.role === 'run' || x.role === 'long') && !x.kept)) if (p.some(x => x.role === 'class' && x.idx === r.idx && x.slot === 'pm')) c -= 0.2
  // The week opens with Strength A where it can (page 64: day 1 is Strength A), now that the
  // first days also hold two runs (2026-10-26).
  const fresh = p.filter(x => !x.kept && x.idx >= 0)
  if (fresh.length) {
    const first = Math.min(...fresh.map(x => x.idx))
    if (!fresh.some(x => x.idx === first && x.role === 'lift' && x.label === LIFT_LABELS[0])) c += 0.4
  }
  // Earlier days first among equals (a stable pick).
  for (const x of p) if (!x.kept) c += x.idx * 0.001
  return c
}

interface Unit { role: Role; hard: boolean; legs: boolean; hinge: boolean; label: string | null; type: string; notes: string | null; plan?: PlanEntry['plan'] }

/** Where a unit may go on a day, given what is there. */
function slotsFor(u: Unit, here: readonly Placed[], doubledLeft: number): Array<'am' | 'pm'> {
  const am = here.filter(x => x.slot === 'am')
  const pm = here.filter(x => x.slot === 'pm')
  // Bag Conditioning stands in for a class: an evening session an easy morning run can pair with.
  if (here.length === 0) return u.role === 'bag_cond' ? ['am', 'pm'] : ['am']
  const eveningMt = pm.length === 1 && (pm[0].role === 'class' || pm[0].role === 'bag_cond') && am.length === 0
  // An easy run the morning of an evening class (or Bag Conditioning).
  if ((u.role === 'run' || u.role === 'long') && eveningMt) return ['am']
  if (u.role === 'bag_cond' && here.length === 1 && am.length === 1 && (am[0].role === 'run' || am[0].role === 'long')) return ['pm']
  // A doubled morning: the hard run first, the lift that evening.
  if (doubledLeft > 0 && u.role === 'lift' && here.length === 1 && am.length === 1 && am[0].role === 'hard_run') return ['pm']
  return []
}

/** Search steps per try: the best week found within it stands (a week has few good shapes; this keeps a night cheap). */
const NODE_BUDGET = 8000

/** The best placement of `units` on the open days, or null when none keeps the rules. */
function search(units: Unit[], kept: Placed[], open: ReadonlySet<number>, cap: number, prevHard: readonly [boolean, boolean], maxDays: number, doubled: number): Placed[] | null {
  let best: Placed[] | null = null
  let bestCost = Infinity
  const placed: Placed[] = [...kept]
  const lastIdx = new Map<string, number>()
  let nodes = 0
  const step = (k: number, doubledLeft: number) => {
    if (++nodes > NODE_BUDGET) return
    if (k === units.length) {
      if (check(placed, cap, prevHard, maxDays).length > 0) return
      const c = cost(placed)
      if (c < bestCost) { bestCost = c; best = placed.map(x => ({ ...x })) }
      return
    }
    // Bound: Bag Work, every hard run and each lift no evening can take need a day of their own.
    const used = new Set(placed.map(x => x.idx)).size
    const rest = units.slice(k)
    const fresh = rest.filter(x => x.role === 'bag' || x.role === 'hard_run').length + Math.max(0, rest.filter(x => x.role === 'lift').length - doubledLeft)
    if (used + fresh > maxDays) return
    const u = units[k]
    // Identical units go in day order (no duplicate orderings).
    const key = `${u.role}|${u.label ?? ''}`
    const from = lastIdx.get(key) ?? 0
    for (let i = from; i < 7; i++) {
      if (!open.has(ORDER[i])) continue
      const here = placed.filter(x => x.idx === i)
      for (const slot of slotsFor(u, here, doubledLeft)) {
        const pairDoubled = u.role === 'lift' && slot === 'pm'
        placed.push({ idx: i, slot, role: u.role, hard: u.hard, legs: u.legs, hinge: u.hinge, label: u.label, type: u.type, notes: u.notes, plan: u.plan })
        // Prune: a partial week already over the day count, the cap or the 3-in-a-row rule can't come back.
        if (check(placed, cap, prevHard, maxDays).length === 0) {
          const prev = lastIdx.get(key)
          lastIdx.set(key, i)
          step(k + 1, doubledLeft - (pairDoubled ? 1 : 0))
          if (prev == null) lastIdx.delete(key); else lastIdx.set(key, prev)
        }
        placed.pop()
      }
    }
  }
  step(0, doubled)
  return best
}

// ─── The week ────────────────────────────────────────────────

/** Spread `n` days out of `days` (Monday-first indexes), keeping the widest gaps. */
function spread(days: number[], n: number): number[] {
  if (n >= days.length) return days
  let best: number[] = days.slice(0, n)
  let bestGap = -1
  const pick = (start: number, acc: number[]) => {
    if (acc.length === n) {
      const gaps = acc.slice(1).map((d, i) => d - acc[i])
      const min = gaps.length ? Math.min(...gaps) : 7
      if (min > bestGap) { bestGap = min; best = [...acc] }
      return
    }
    for (let i = start; i < days.length; i++) pick(i + 1, [...acc, days[i]])
  }
  pick(0, [])
  return best
}

function classSlot(dow: number, s: ClassDaySlot): 'am' | 'pm' {
  return s === 'am' || s === 'pm' ? s : dow === 0 || dow === 6 ? 'am' : 'pm'
}

/** The week: what it holds for the step and where each session goes. */
export function buildWeek(inp: WeekBuildIn): WeekBuild {
  const shape = STEP_SHAPE[inp.step]
  const cap = hardCapFor(inp.step)
  const open = new Set(inp.open ?? ORDER)
  const prevHard = inp.prevHard ?? [false, false]
  const kept: Placed[] = (inp.kept ?? []).map(k => {
    const role = roleOf(k) ?? 'run'
    const lift = role === 'lift'
    return {
      idx: idxOf(k.dow), slot: k.slot, role, kept: true, type: k.type, label: k.label ?? null, notes: k.notes ?? null,
      hard: k.hard ?? (role === 'lift' || role === 'hard_run' || role === 'class' || role === 'bag'),
      legs: lift && liftIsHeavyLegs(k.label), hinge: lift && liftIsHeavyHinge(k.label),
    }
  })
  const have = (r: Role) => kept.filter(x => x.role === r).length
  // Last weekend's lifts sit before Monday: only the spacing rules read them.
  const before: Placed[] = (inp.prevLifts ?? []).map(l => ({ idx: -l.daysBefore, slot: l.slot, role: 'lift', kept: true, type: 'strength', label: l.label ?? null, notes: null, hard: false, legs: true, hinge: liftIsHeavyHinge(l.label) }))

  // What the step holds, less what already stands.
  const hardOk = inp.week >= HARD_FROM_WEEK && inp.runsReady
  const runsLeft = Math.max(0, shape.runs - have('run') - have('long') - have('hard_run'))
  let hardRuns = Math.min(runsLeft, Math.max(0, (hardOk ? shape.hardRuns : 0) - have('hard_run')))
  // Classes: only Settings class days, as many as the hard-day cap leaves beside the 2 lifts and the
  // hard runs a lift can't share a day with (1 at 4 and 5 days, 1 or 2 at 6, 2 doubled), under the
  // profile cap; spread out when not every day fits.
  const ownDayHard = Math.max(0, (hardOk ? shape.hardRuns : 0) - shape.doubled)
  const maxClasses = Math.min(inp.classCap ?? 7, Math.max(1, cap - LIFT_LABELS.length - ownDayHard))
  const classRoom = Math.max(0, maxClasses - have('class'))
  const classIdx = spread(inp.classDays.filter(c => open.has(c.dow) && !kept.some(x => x.role === 'class' && x.idx === idxOf(c.dow))).map(c => idxOf(c.dow)).sort((a, b) => a - b), classRoom)
  const classes: Placed[] = classIdx.map(i => {
    const dow = ORDER[i]
    const set = inp.classDays.find(c => c.dow === dow)!
    return { idx: i, slot: classSlot(dow, set.slot), role: 'class', hard: true, legs: false, hinge: false, type: 'mt_class', label: 'MT Class', notes: null }
  })
  const classesThisWeek = have('class') + classes.length

  const liftsLeft = LIFT_LABELS.filter(l => !kept.some(x => x.role === 'lift' && x.label === l)).slice(0, Math.max(0, LIFT_LABELS.length - have('lift')))
  const bagWork = inp.step >= 5 ? Math.max(0, 1 - have('bag')) : 0
  const condWanted = classesThisWeek > 0 ? 0 : inp.step >= 6 ? 2 : 1
  let bagCond = Math.max(0, condWanted - have('bag_cond'))
  const bagHard = inp.week >= BAG_HARD_FROM_WEEK
  // One weekly kick budget a side, shared with the bag finisher (the week's Bag Work finishers come off it first).
  const condLevel = inp.conditioning?.level ?? conditioningLevel(inp.week - 1)
  const finisherKicks = (bagWork + have('bag')) * FINISHER_SIZE.ok.goal
  const kicks = kicksLeft(condLevel, [{ right: finisherKicks, left: finisherKicks }])
  let condForm: 'steady' | 'any' = inp.step === 4 && inp.week <= 2 ? 'steady' : 'any'

  const eased: string[] = []
  const doubled = Math.max(0, shape.doubled - kept.filter(x => x.role === 'lift' && x.slot === 'pm').length)
  let bagTechnique = !bagHard
  let dropRuns = 0
  const longWanted = shape.runs >= 3
  const make = (): Unit[] => {
    const units: Unit[] = []
    const each = { right: Math.floor(kicks.right / Math.max(1, bagCond)), left: Math.floor(kicks.left / Math.max(1, bagCond)) }
    const pick = pickConditioning({
      level: condLevel, readiness: 'ok', switches: techniqueGroups(inp.conditioning?.switches ? inp.conditioning.switches.join(',') : null),
      hardAllowed: condForm !== 'steady', freeMin: 60, lastTemplateId: inp.conditioning?.lastTemplateId ?? null, liftDay: false,
      history: inp.conditioning?.history ?? [], kicksLeft: each,
    })
    const cond = { hard: pick.hard, minutes: pick.minutes, effort: pick.template.effort, kicksPerSide: Math.min(each.right, each.left), workoutId: pick.template.id }
    const lifts: Unit[] = liftsLeft.map(l => ({ role: 'lift', hard: true, legs: liftIsHeavyLegs(l), hinge: liftIsHeavyHinge(l), label: l, type: 'strength', notes: null }))
    const hard: Unit[] = Array.from({ length: hardRuns }, () => ({ role: 'hard_run', hard: true, legs: false, hinge: false, label: null, type: 'running', notes: null }))
    // Doubled mornings: the hard runs go first so a lift can take their evening.
    units.push(...(doubled > 0 ? [...hard, ...lifts] : [...lifts, ...hard]))
    for (let i = 0; i < bagCond; i++) units.push({ role: 'bag_cond', hard: cond.hard, legs: false, hinge: false, label: BAG_CONDITIONING_LABEL, type: BAG_CONDITIONING_TYPE, notes: null, plan: { hard: cond.hard, minutes: cond.minutes, effort: cond.effort, kicksPerSide: cond.kicksPerSide, workoutId: cond.workoutId ?? null } })
    for (let i = 0; i < bagWork; i++) units.push({ role: 'bag', hard: !bagTechnique, legs: false, hinge: false, label: 'Bag Work', type: 'bag_work', notes: null, plan: { hard: !bagTechnique } })
    const easy = Math.max(0, runsLeft - hardRuns - dropRuns)
    const long = longWanted && have('long') === 0 && easy > 0 ? 1 : 0
    for (let i = 0; i < long; i++) units.push({ role: 'long', hard: false, legs: false, hinge: false, label: null, type: 'foundation_run', notes: null, plan: { hard: false, long: true } })
    for (let i = 0; i < easy - long; i++) units.push({ role: 'run', hard: false, legs: false, hinge: false, label: null, type: 'foundation_run', notes: null })
    return units
  }
  const base = [...before, ...kept, ...classes]
  let placed = search(make(), base, open, cap, prevHard, shape.days, doubled)
  // The ease ladder, least important hard session first.
  const ladder: Array<() => string | null> = [
    () => (bagWork > 0 && !bagTechnique ? (bagTechnique = true, 'Bag Work stays technique') : null),
    () => (bagCond > 0 && condForm !== 'steady' ? (condForm = 'steady', 'Bag Conditioning in its steady form') : null),
    () => (hardRuns > 0 ? (hardRuns--, 'a hard run goes easy') : null),
    () => (hardRuns > 0 ? (hardRuns--, 'a hard run goes easy') : null),
    () => (bagCond > 1 ? (bagCond--, 'one Bag Conditioning') : null),
    // If something doesn't fit, it's left out, not squeezed (plan: 60 minutes, hard cap).
    () => (runsLeft - hardRuns - dropRuns > 0 ? (dropRuns++, 'one easy run left out') : null),
    () => (bagCond > 0 ? (bagCond--, 'no Bag Conditioning') : null),
    // Still no room (classes on most days): more easy runs left out, one at a time.
    ...Array.from({ length: 4 }, () => () => (runsLeft - hardRuns - dropRuns > 0 ? (dropRuns++, 'one easy run left out') : null)),
  ]
  for (const ease of ladder) {
    if (placed) break
    const what = ease()
    if (!what) continue
    eased.push(what)
    placed = search(make(), base, open, cap, prevHard, shape.days, doubled)
  }
  // Still nothing (too many classes for the cap, say): the rules loosened, nothing dropped but Bag Conditioning.
  let broken: string[] = []
  if (!placed) {
    for (const loose of [{ cap: 7, days: 7 }, { cap: 7, days: 7, noCond: true }]) {
      if ('noCond' in loose && bagCond > 0) { bagCond = 0; eased.push('no Bag Conditioning') }
      placed = search(make(), base, open, loose.cap, [false, false], loose.days, doubled)
      if (placed) break
    }
    // Even loosened nothing fits: the lifts are never dropped quietly. Each goes on the open day
    // with the least on it (a lift-free one first) in the morning, and the broken rules say so.
    if (!placed) {
      const out: Placed[] = [...base]
      for (const u of make().filter(x => x.role === 'lift')) {
        const days = ORDER.map((d, i) => (open.has(d) ? i : -1)).filter(i => i >= 0)
        const load = (i: number) => out.filter(x => x.idx === i).length + (out.some(x => x.idx === i && x.role === 'lift') ? 10 : 0)
        const idx = days.sort((a, b) => load(a) - load(b) || a - b)[0]
        if (idx == null) { broken.push(`${u.label ?? 'a lift'} left out: no open day`); continue }
        out.push({ idx, slot: 'am', role: u.role, hard: u.hard, legs: u.legs, hinge: u.hinge, label: u.label, type: u.type, notes: u.notes, plan: u.plan })
      }
      placed = out
    }
    broken = [...broken, ...check(placed, cap, prevHard, shape.days)]
  }

  const entries: PlanEntry[] = []
  for (const x of (placed as Placed[]).filter(q => !q.kept && q.idx >= 0)) entries.push(entryOf(x, inp.week))
  // Foundation every day (the daily habit; never a training day).
  const foundationDays = ORDER.filter(d => open.has(d))
  for (const d of foundationDays) entries.push({ dow: d, role: 'run', hard: false, timeSlot: 'am', type: 'mobility', label: FOUNDATION_LABEL, estimatedMin: 12 })
  entries.sort((a, b) => idxOf(a.dow) - idxOf(b.dow) || (a.type === 'mobility' ? -1 : b.type === 'mobility' ? 1 : 0) || (a.timeSlot === 'am' ? -1 : 1))
  const all = (placed as Placed[]).filter(q => q.idx >= 0)
  const hardDays = new Set(all.filter(x => x.hard).map(x => x.idx)).size
  const trainingDays = new Set(all.map(x => x.idx)).size
  return { entries, cap, hardDays, trainingDays, eased, broken, why: weekWhy(inp.step, all, eased) }
}

function entryOf(x: Placed, week: number): PlanEntry {
  const dow = ORDER[x.idx]
  const base = { dow, role: x.role, hard: x.hard, timeSlot: x.slot, ...(x.plan ? { plan: x.plan } : {}) }
  switch (x.role) {
    case 'lift': return { ...base, type: 'strength', label: x.label ?? LIFT_LABELS[0], estimatedMin: 50 }
    case 'class': return { ...base, type: 'mt_class', label: 'MT Class', estimatedMin: 60 }
    case 'bag': return { ...base, type: 'bag_work', label: 'Bag Work', estimatedMin: 35 }
    case 'bag_cond': return { ...base, type: BAG_CONDITIONING_TYPE, label: BAG_CONDITIONING_LABEL, estimatedMin: x.plan?.minutes ?? 30 }
    case 'hard_run': {
      // Steady hard first; the second is run hard / jog (the nightly hard-run pass keeps the kinds and places the test).
      const kind = 'steady' as const
      return { ...base, type: 'running', label: HARD_START_LABEL[kind], estimatedMin: 35, runCategory: HARD_NOTES[kind] as 'tempo' }
    }
    case 'long': return { ...base, type: 'foundation_run', label: 'Run-Walk', estimatedMin: 45 }
    default: return { ...base, type: 'foundation_run', label: 'Run-Walk', estimatedMin: week <= 2 ? 30 : 35 }
  }
}

function weekWhy(step: DayStep, p: readonly Placed[], eased: readonly string[]): string {
  const n = (r: Role) => p.filter(x => x.role === r).length
  const runs = n('run') + n('long') + n('hard_run')
  const mt: string[] = []
  if (n('class')) mt.push(n('class') === 1 ? 'your class' : `${n('class')} classes`)
  if (n('bag')) mt.push('Bag Work')
  if (n('bag_cond')) mt.push(n('bag_cond') === 1 ? 'Bag Conditioning' : `${n('bag_cond')} Bag Conditioning`)
  const hard = n('hard_run')
  const parts = [`${stepWords(step)}: 2 lifts`, `${runs} run${runs === 1 ? '' : 's'}${hard ? ` (${hard} hard)` : ''}`, ...mt]
  const last = parts.pop()
  const body = parts.length ? `${parts.join(', ')} and ${last}` : last
  return `${body}.${eased.length ? ` ${capital(eased[0])} to keep the hard days apart.` : ''}`
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** The entries of one weekday, as the day's template. */
export function dayEntries(build: Pick<WeekBuild, 'entries'>, dow: number): PlanEntry[] {
  return build.entries.filter(e => e.dow === dow)
}

export { DAY as WEEKDAY_NAMES }
