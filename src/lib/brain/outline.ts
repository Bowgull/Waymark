// Coach brain P2 (coach-brain.md §5.2 "the week outline", §6.3, §9): the
// nightly solver for the rest of the week. It starts from the week as it
// stands (the template's shape, his own picks, earlier coach changes) and
// looks for at most 2 changes that make the week clearly better:
//
// - limits (never broken): no heavy legs in the 24 h before a class, no 3
//   hard days in a row, never two non-class key sessions on one day (no
//   cramming), at least one full rest day in the week;
// - class days SUGGESTED from Settings' class days (none set: any day), on a
//   1 → 2 → 3 ladder (classPicker.ts), never before the block's second week,
//   on the day and slot his history says works (the day's class fit × his
//   adherence in that slot; the slot learned per weekday, else weekday
//   evenings and weekend mornings); a skipped class (any reason) is never made
//   up that week, a class he took off with UNDO is not offered again that
//   week, and a planned class comes off when one he added himself leaves no
//   day between (page 69 §3);
// - rest days are the coach's call: rest lands where he likes to rest (his
//   moves teach it), and a second rest day comes when he needs one;
// - sessions sit where he actually trains (AM vs PM adherence);
// - a week with no strength in it at all (a block started mid-week from an
//   older plan) gets one strength session on the first free day, when the
//   caller names one (OutlineIn.strengthStart): strength starts this week,
//   not next Monday (Josh, 2026-10-21).
//
// His own changes and anything held by an UNDO are fixed. Every change costs
// a little (stability), more for days 4+ out, so a day only moves for a clear
// gain. A class is a fixed 60-minute hard session: the solver only picks the
// night, never what is taught. Pure.

import { isHard, isHardRun, isHeavyHinge, isHeavyLegs, type BlockKind } from '../coach/sessions'
import { KEY_TYPES } from '../keyTypes'
import { cellOf } from './athleteModel'
import type { AthleteModel } from './types'
import { classOffWhy, classSlotScore, classWhy, slotsOf, type ClassLadder, type ClassSlotChoice } from './classPicker'
import type { ReadinessState } from './readiness'

export const MAX_CHANGES = 2
export const CHANGE_COST = 0.35
export const FAR_CHANGE_COST = 0.7
export const FAR_DAYS = 4
const VIOLATION = 100
/** The worth of a week's first strength session when the week has none (OutlineIn.strengthStart). */
export const STRENGTH_START_VALUE = 3

export interface OutlineSession {
  id: string
  type: string
  label: string | null
  day: number
  slot: 'am' | 'pm'
  status: string
  source: string | null
  /** Fixed: his own pick or move, held by an UNDO, started or done, or a past day. */
  locked: boolean
  /** Run category ('tempo', 'progression', ...) for the spacing costs. */
  notes?: string | null
  /** Effort he logged (a done class: the why when a planned one comes off). */
  rpe?: number | null
}

export interface OutlineIn {
  /** First day the solver may change. */
  today: number
  /** The calendar week it plans (Monday). */
  monday: number
  blockType: BlockKind
  /** First day of the block (classes from its second week). */
  blockStart: number
  sessions: OutlineSession[]
  /** Candidate class days (0 = Sunday): the days he picked in Settings; none, no classes. */
  classDays: readonly number[]
  /** Settings has class days (the why says so when it doesn't). */
  classDaysSet?: boolean
  /** The slot for a class on each weekday (classPicker.slotForClassDay). Missing: weekday PM, weekend AM. */
  classSlots?: Readonly<Record<number, ClassSlotChoice>>
  /** On an ANY day, the slot he has used there more often (classPicker.classLean). */
  classLean?: Readonly<Record<number, 'am' | 'pm' | null>>
  /** Profile cap on classes a week (null: none). */
  classCap: number | null
  /** A class the coach added was taken off with UNDO this week: no more class suggestions this week. */
  classHeld: boolean
  /** The class ladder (§9): classes a week, a week off, days not suggested for now. Missing: one a week. */
  ladder?: ClassLadder | null
  model: AthleteModel
  state: ReadinessState
  /** A second rest day is due (RED, soreness 4+ two mornings, 5+ training days running with energy falling). */
  restDue: string | null
  /**
   * The strength session a week with none gets (its label and the why after the
   * day), or null/absent: no add. The add only goes in a week with no strength
   * session at all (done, planned, skipped or missed).
   */
  strengthStart?: { label: string; why: string } | null
  /** First day an add may land (default: today). A re-plan during the day starts tomorrow. */
  firstAddDay?: number
}

export type OutlineChange =
  | { kind: 'add'; type: 'mt_class'; day: number; slot: 'am' | 'pm'; why: string; tempId: string }
  | { kind: 'add'; type: 'strength'; label: string; day: number; slot: 'am'; why: string; tempId: string }
  | { kind: 'move'; sessionId: string; type: string; label: string | null; fromDay: number; fromSlot: 'am' | 'pm'; day: number; slot: 'am' | 'pm'; why: string }
  | { kind: 'rest'; sessionId: string; type: string; label: string | null; day: number; why: string }

interface Plan { sessions: OutlineSession[]; changes: OutlineChange[] }

const live = (s: OutlineSession) => s.status !== 'skipped' && s.status !== 'missed'
const dow = (day: number) => ((day % 7) + 11) % 7
const DAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const like = (s: OutlineSession) => ({ type: s.type, label: s.label, notes: null, estimatedMin: null })

/** Classes the week aims for: none before week 2 of Block Zero, then the ladder (1 → 2 → 3), under the profile cap. */
export function classTarget(inp: Pick<OutlineIn, 'blockType' | 'blockStart' | 'monday' | 'classCap' | 'classDays' | 'ladder'>): number {
  if (inp.blockType !== 'block_zero' || inp.classDays.length === 0) return 0
  if (inp.monday + 6 < inp.blockStart + 7) return 0
  if (inp.ladder?.paused) return 0
  const days = inp.classDays.filter(d => !(inp.ladder?.avoidDays ?? []).includes(d)).length
  return Math.max(0, Math.min(inp.ladder?.level ?? 1, inp.classCap ?? 3, days))
}

/** The slot choice for a class on weekday `dow` (default: weekday evening, weekend morning). */
export function classSlotChoice(inp: Pick<OutlineIn, 'classSlots'>, dow: number): ClassSlotChoice {
  return inp.classSlots?.[dow] ?? (dow === 0 || dow === 6 ? 'am' : 'pm')
}

const SLOT_HOUR = { am: 8, pm: 18 } as const
/** Hours from session a to session b (negative: b is earlier). */
export function hoursAfter(a: Pick<OutlineSession, 'day' | 'slot'>, b: Pick<OutlineSession, 'day' | 'slot'>): number {
  return (b.day * 24 + SLOT_HOUR[b.slot]) - (a.day * 24 + SLOT_HOUR[a.slot])
}

/**
 * Spacing suggestions that cost a little but never block (idea 2, Schumann
 * 2022, Doma 2017, Robineau 2016): a hard run within 24 h after heavy legs
 * (inside 6 h would be a clash; the slots never allow it), and a run before
 * the lift on a shared day (lift first, 3 h+ apart).
 */
export function spacingCosts(sessions: readonly OutlineSession[], blockType: BlockKind, monday: number): Array<{ cost: number; why: string }> {
  const out: Array<{ cost: number; why: string }> = []
  const week = sessions.filter(s => live(s) && s.day >= monday - 1 && s.day <= monday + 6)
  for (const legs of week.filter(s => isHeavyLegs(s, blockType))) {
    for (const run of week.filter(s => isHardRun({ type: s.type, notes: s.notes ?? null, estimatedMin: null }))) {
      const h = hoursAfter(legs, run)
      if (h > 0 && h < 6) out.push({ cost: 3, why: `hard run within 6 h of ${DAY_NAME[dow(legs.day)]}'s heavy legs` })
      else if (h > 0 && h < 24) out.push({ cost: 0.5, why: `hard run the day after ${DAY_NAME[dow(legs.day)]}'s heavy legs` })
    }
  }
  for (const lift of week.filter(s => s.type === 'strength')) {
    const run = week.find(s => s.day === lift.day && (s.type === 'running' || s.type === 'foundation_run') && hoursAfter(s, lift) > 0)
    if (run) out.push({ cost: 0.4, why: `${DAY_NAME[dow(lift.day)]}: lift first, run later` })
  }
  // A class is hard interval work: a hard run within 24 h either side of it, by its real slot.
  const classes = week.filter(s => s.type === 'mt_class')
  for (const c of classes) {
    for (const run of week.filter(s => isHardRun({ type: s.type, notes: s.notes ?? null, estimatedMin: null }))) {
      if (Math.abs(hoursAfter(c, run)) < 24) out.push({ cost: 0.6, why: `hard run within 24 h of ${DAY_NAME[dow(c.day)]}'s class` })
    }
  }
  // Two classes inside 24 h of each other: no day between.
  for (let i = 0; i < classes.length; i++) for (let j = i + 1; j < classes.length; j++) {
    if (Math.abs(hoursAfter(classes[i], classes[j])) <= 24) out.push({ cost: 0.8, why: `classes ${DAY_NAME[dow(classes[i].day)]} and ${DAY_NAME[dow(classes[j].day)]} with no day between` })
  }
  return out
}

/** The limits a week must keep. Each broken one is a violation. */
export function violations(sessions: readonly OutlineSession[], blockType: BlockKind, monday: number): string[] {
  const out: string[] = []
  const days = Array.from({ length: 9 }, (_, i) => monday - 1 + i)
  const on = (d: number) => sessions.filter(s => s.day === d && live(s))
  for (const d of days) {
    // No heavy legs in the 24 h before a class, by the class's real slot (a weekend morning class too).
    const cls = on(d).filter(s => s.type === 'mt_class')
    if (cls.some(c => [...on(d - 1), ...on(d)].some(s => isHeavyLegs(s, blockType) && hoursAfter(s, c) >= 0 && hoursAfter(s, c) < 24))) out.push(`heavy legs before ${DAY_NAME[dow(d)]}'s class`)
    const key = on(d).filter(s => KEY_TYPES.has(s.type) && s.type !== 'mt_class')
    if (key.length > 1 && d >= monday && d <= monday + 6) out.push(`${DAY_NAME[dow(d)]} holds ${key.length} sessions`)
  }
  // Interference spacing (approved 2026-10-21, idea 2): no heavy hip hinge in the 24 h after a
  // class either (kicks load the hips and lower back). A clash moves the lift, never the class.
  for (const d of days) {
    for (const c of on(d).filter(s => s.type === 'mt_class')) {
      const hinge = [...on(d), ...on(d + 1)].find(s => isHeavyHinge(s, blockType) && hoursAfter(c, s) > 0 && hoursAfter(c, s) < 24)
      if (hinge) out.push(`heavy hinge the ${hinge.day === d ? 'evening' : 'morning'} after ${DAY_NAME[dow(d)]}'s class`)
    }
  }
  const hard = (d: number) => on(d).some(s => isHard(like(s)))
  for (let d = monday - 2; d <= monday + 6; d++) if (hard(d) && hard(d + 1) && hard(d + 2) && d + 2 >= monday) out.push(`3 hard days from ${DAY_NAME[dow(d)]}`)
  const week = Array.from({ length: 7 }, (_, i) => monday + i)
  if (!week.some(d => !on(d).some(s => KEY_TYPES.has(s.type)))) out.push('no rest day')
  return out
}

/** How good a week is (higher is better): limits first, then classes, rest, and where he trains. */
export function score(plan: Plan, inp: OutlineIn): number {
  const s = plan.sessions
  let v = -VIOLATION * violations(s, inp.blockType, inp.monday).length
  const week = s.filter(x => x.day >= inp.monday && x.day <= inp.monday + 6)
  const cells = inp.model.adherence.cells
  // Where he trains: each planned key session counts its slot's chance of getting done.
  for (const x of week) {
    if (!KEY_TYPES.has(x.type) || !live(x) || x.locked) continue
    if (x.type === 'mt_class') continue
    v += cells[cellOf(x.day, x.slot, null)].p
  }
  // Classes: up to the target, each worth its night's fit and the evening's chance.
  const target = classTarget(inp)
  const classes = week.filter(x => x.type === 'mt_class')
  // A skipped one still fills its slot (never made up); one the coach takes off tonight does not.
  const counted = classes.filter(x => x.status !== 'missed' && !plan.changes.some(c => c.kind === 'rest' && c.sessionId === x.id))
  const ranked = counted.map(x => classSlotScore(inp.model, x.day, x.slot, inp.classLean?.[dow(x.day)] ?? null)).sort((a, b) => b - a)
  for (let i = 0; i < Math.min(target, ranked.length); i++) v += 1.5 + ranked[i]
  if (counted.length > Math.max(target, classes.filter(c => c.locked).length)) v -= 2 * (counted.length - target)
  // Strength this week (strengthStart): the first session is worth more than any move.
  if (inp.strengthStart && week.some(x => x.type === 'strength' && live(x) && plan.changes.some(c => c.kind === 'add' && c.type === 'strength' && c.tempId === x.id))) v += STRENGTH_START_VALUE
  // An evening class pairs best with an easy run-walk that morning.
  for (const c of classes.filter(live)) if (c.slot === 'pm' && s.some(x => x.day === c.day && x.slot === 'am' && (x.type === 'foundation_run' || x.type === 'running') && !isHardRun({ type: x.type, notes: x.notes ?? null, estimatedMin: null }) && live(x))) v += 0.2
  // Rest where he likes it.
  const keyOn = (d: number) => s.some(x => x.day === d && live(x) && KEY_TYPES.has(x.type))
  for (const d of inp.model.adherence.preferredRestDays) {
    const day = inp.monday + ((d + 6) % 7)
    if (day >= inp.today && !keyOn(day)) v += 0.8
  }
  // A second rest day when it is due: tomorrow-ish (the first changeable day or the one after).
  if (inp.restDue && (plan.changes.some(c => c.kind === 'rest'))) v += 2.5
  // Spacing suggestions (idea 2): small costs, never blocks.
  for (const c of spacingCosts(s, inp.blockType, inp.monday)) v -= c.cost
  // Lifting on back-to-back days is a soft no.
  for (let d = inp.monday; d < inp.monday + 6; d++) {
    const lift = (x: number) => s.some(q => q.day === x && live(q) && q.type === 'strength')
    if (lift(d) && lift(d + 1)) v -= 0.6
  }
  // Stability.
  for (const c of plan.changes) v -= changeDay(c) - inp.today >= FAR_DAYS ? FAR_CHANGE_COST : CHANGE_COST
  return Math.round(v * 1000) / 1000
}

function changeDay(c: OutlineChange): number {
  return c.kind === 'move' ? Math.min(c.fromDay, c.day) : c.day
}

/** Single edits from a plan. */
function edits(plan: Plan, inp: OutlineIn): Plan[] {
  const out: Plan[] = []
  const s = plan.sessions
  const days = Array.from({ length: 7 }, (_, i) => inp.monday + i).filter(d => d >= inp.today)
  // Only this week's own sessions move, and only to this week's days.
  const free = (x: OutlineSession) => !x.locked && x.status === 'planned' && x.day >= inp.today && x.day >= inp.monday && x.day <= inp.monday + 6 && plan.changes.every(c => ('sessionId' in c ? c.sessionId !== x.id : c.tempId !== x.id))
  // Add a class.
  const target = classTarget(inp)
  const weekClasses = s.filter(x => x.type === 'mt_class' && x.day >= inp.monday && x.day <= inp.monday + 6 && x.status !== 'missed')
  if (!inp.classHeld && weekClasses.length < target && inp.state !== 'RED') {
    for (const d of days) for (const slot of slotsOf(classSlotChoice(inp, dow(d)))) {
      // A class never before the block's eighth day (§7: week 2 at the earliest); none on a day
      // skipped twice lately; no new class today on an amber morning; never on a slot that holds a session.
      if (d < inp.blockStart + 7 || !inp.classDays.includes(dow(d)) || (inp.ladder?.avoidDays ?? []).includes(dow(d)) || s.some(x => x.day === d && x.type === 'mt_class')) continue
      if (d === inp.today && inp.state === 'AMBER') continue
      if (s.some(x => x.day === d && x.slot === slot && live(x) && KEY_TYPES.has(x.type))) continue
      const tempId = `class-${d}`
      const why = classWhy(inp.model, d, slot, { setDays: inp.classDaysSet !== false, ladder: inp.ladder ?? null, nth: weekClasses.length + 1 })
      const added: Plan = { sessions: [...s, { id: tempId, type: 'mt_class', label: 'MT Class', day: d, slot, status: 'planned', source: 'coach', locked: false }], changes: [...plan.changes, { kind: 'add', type: 'mt_class', day: d, slot, why, tempId }] }
      out.push(added)
      // The class clashes with a lift (heavy legs before it, a heavy hinge after it): the lift moves, never the class (idea 2).
      const before = violations(plan.sessions, inp.blockType, inp.monday).length
      if (violations(added.sessions, inp.blockType, inp.monday).length > before && added.changes.length < MAX_CHANGES) {
        const clashing = added.sessions.filter(x => free(x) && x.type === 'strength' && (isHeavyLegs(x, inp.blockType) || isHeavyHinge(x, inp.blockType)) && Math.abs(x.day - d) <= 1)
        for (const x of clashing) {
          for (const e of days) {
            if (e === x.day || added.sessions.some(y => y.day === e && live(y) && KEY_TYPES.has(y.type) && y.type !== 'mt_class')) continue
            out.push({
              sessions: added.sessions.map(y => (y.id === x.id ? { ...y, day: e } : y)),
              changes: [...added.changes, { kind: 'move', sessionId: x.id, type: x.type, label: x.label, fromDay: x.day, fromSlot: x.slot, day: e, slot: x.slot, why: '' }],
            })
          }
        }
      }
    }
  }
  // A planned class comes off when one he added himself leaves no day between, or the week holds more than the ladder (page 69 §3).
  const liveClasses = s.filter(x => x.type === 'mt_class' && x.day >= inp.monday && x.day <= inp.monday + 6 && live(x))
  if (liveClasses.length > 1) {
    for (const x of liveClasses.filter(free)) {
      const his = liveClasses.filter(c => c.id !== x.id && c.locked).sort((a, b) => Math.abs(hoursAfter(a, x)) - Math.abs(hoursAfter(b, x)))[0]
      if (!his) continue
      const kept = liveClasses.find(c => c.id !== x.id && c.id !== his.id) ?? null
      out.push({ sessions: s.map(y => (y.id === x.id ? { ...y, status: 'skipped' } : y)), changes: [...plan.changes, { kind: 'rest', sessionId: x.id, type: x.type, label: x.label, day: x.day, why: classOffWhy(x, { day: his.day, rpe: his.rpe ?? null, slot: his.slot }, kept, Math.max(1, target)) }] })
    }
  }
  // Strength this week: a week with no strength session at all gets one, alone on a free day.
  const strengthWeek = s.filter(x => x.type === 'strength' && x.day >= inp.monday && x.day <= inp.monday + 6)
  if (inp.strengthStart && strengthWeek.length === 0 && inp.state !== 'RED') {
    for (const d of days.filter(e => e >= (inp.firstAddDay ?? inp.today))) {
      if (s.some(x => x.day === d && live(x) && KEY_TYPES.has(x.type))) continue
      const tempId = `strength-${d}`
      const label = inp.strengthStart.label
      out.push({
        sessions: [...s, { id: tempId, type: 'strength', label, day: d, slot: 'am', status: 'planned', source: 'coach', locked: false }],
        changes: [...plan.changes, { kind: 'add', type: 'strength', label, day: d, slot: 'am', why: `${label} on ${DAY_NAME[dow(d)]}: ${inp.strengthStart.why}`, tempId }],
      })
    }
  }
  // Move a key session to another day (alone there), or swap two.
  for (const x of s.filter(free)) {
    if (!KEY_TYPES.has(x.type) || x.type === 'mt_class') continue
    for (const d of days) {
      if (d === x.day) continue
      const there = s.filter(y => y.day === d && live(y) && KEY_TYPES.has(y.type) && y.type !== 'mt_class')
      if (there.length === 0) {
        out.push({
          sessions: s.map(y => (y.id === x.id ? { ...y, day: d } : y)),
          changes: [...plan.changes, { kind: 'move', sessionId: x.id, type: x.type, label: x.label, fromDay: x.day, fromSlot: x.slot, day: d, slot: x.slot, why: '' }],
        })
      } else if (there.length === 1 && free(there[0])) {
        const y = there[0]
        out.push({
          sessions: s.map(q => (q.id === x.id ? { ...q, day: d, slot: y.slot } : q.id === y.id ? { ...q, day: x.day, slot: x.slot } : q)),
          changes: [...plan.changes,
            { kind: 'move', sessionId: x.id, type: x.type, label: x.label, fromDay: x.day, fromSlot: x.slot, day: d, slot: y.slot, why: '' },
            { kind: 'move', sessionId: y.id, type: y.type, label: y.label, fromDay: y.day, fromSlot: y.slot, day: x.day, slot: x.slot, why: '' }],
        })
      }
    }
    // An evening session he rarely does moves to the morning.
    if (x.slot === 'pm' && !s.some(y => y.day === x.day && y.slot === 'am' && live(y) && KEY_TYPES.has(y.type) && y.id !== x.id)) {
      out.push({ sessions: s.map(y => (y.id === x.id ? { ...y, slot: 'am' } : y)), changes: [...plan.changes, { kind: 'move', sessionId: x.id, type: x.type, label: x.label, fromDay: x.day, fromSlot: 'pm', day: x.day, slot: 'am', why: '' }] })
    }
  }
  // A second rest day: the next session on the first two changeable days comes off.
  if (inp.restDue) {
    for (const x of s.filter(free).filter(q => KEY_TYPES.has(q.type) && q.day <= inp.today + 1)) {
      out.push({ sessions: s.map(y => (y.id === x.id ? { ...y, status: 'skipped' } : y)), changes: [...plan.changes, { kind: 'rest', sessionId: x.id, type: x.type, label: x.label, day: x.day, why: inp.restDue }] })
    }
  }
  return out.filter(p => p.changes.length <= MAX_CHANGES)
}

export interface OutlineResult {
  changes: OutlineChange[]
  before: number
  after: number
  violationsBefore: string[]
  violationsAfter: string[]
}

/** The best week reachable with at most 2 changes, or no change when nothing beats the week as it stands. */
export function solveOutline(inp: OutlineIn): OutlineResult {
  const start: Plan = { sessions: inp.sessions.map(s => ({ ...s })), changes: [] }
  const base = score(start, inp)
  const limit = violations(start.sessions, inp.blockType, inp.monday).length
  const ok = (p: Plan) => violations(p.sessions, inp.blockType, inp.monday).length <= limit
  let best = start
  let bestScore = base
  const first = edits(start, inp)
  const scored = first.map(p => ({ p, v: score(p, inp) })).sort((a, b) => b.v - a.v)
  for (const { p, v } of scored) if (v > bestScore + 1e-9 && ok(p)) { best = p; bestScore = v }
  // Second edits from the most promising first ones.
  for (const { p } of scored.slice(0, 12)) {
    if (p.changes.length >= MAX_CHANGES) continue
    for (const q of edits(p, inp)) {
      const v = score(q, inp)
      if (v > bestScore + 1e-9 && ok(q)) { best = q; bestScore = v }
    }
  }
  const changes = best.changes.map(c => (c.kind === 'move' && !c.why ? { ...c, why: moveWhy(c, best, inp) } : c))
  return { changes, before: base, after: bestScore, violationsBefore: violations(start.sessions, inp.blockType, inp.monday), violationsAfter: violations(best.sessions, inp.blockType, inp.monday) }
}

function moveWhy(c: Extract<OutlineChange, { kind: 'move' }>, plan: Plan, inp: OutlineIn): string {
  const name = c.label ?? (c.type === 'foundation_run' ? 'Run-Walk' : c.type === 'strength' ? 'Strength' : c.type)
  if (c.day === c.fromDay && c.slot === 'am') return `${name} moves to the morning: that is when you train.`
  const cls = plan.sessions.find(s => s.type === 'mt_class' && (s.day === c.fromDay || s.day === c.fromDay + 1) && live(s))
  if (cls && c.type === 'strength' && isHeavyLegs({ type: c.type, label: c.label }, inp.blockType)) return `${name} moves to ${DAY_NAME[dow(c.day)]}: no heavy legs before ${DAY_NAME[dow(cls.day)]}'s class.`
  const before = plan.sessions.find(s => s.type === 'mt_class' && (s.day === c.fromDay || s.day === c.fromDay - 1) && live(s))
  if (before && c.type === 'strength' && isHeavyHinge({ type: c.type, label: c.label }, inp.blockType)) return `${name} moves to ${DAY_NAME[dow(c.day)]}: no heavy hinge right after ${DAY_NAME[dow(before.day)]}'s class.`
  const cells = inp.model.adherence.cells
  const gain = cells[cellOf(c.day, c.slot, null)].p - cells[cellOf(c.fromDay, c.fromSlot, null)].p
  if (gain >= 0.15) return `${name} moves to ${DAY_NAME[dow(c.day)]}: ${dow(c.day) === 0 || dow(c.day) === 6 ? 'weekends' : 'weekday mornings'} are when you get it done.`
  const rest = inp.model.adherence.preferredRestDays.includes(dow(c.fromDay))
  if (rest) return `${name} moves to ${DAY_NAME[dow(c.day)]}: ${DAY_NAME[dow(c.fromDay)]} is your rest day.`
  return `${name} moves to ${DAY_NAME[dow(c.day)]}: easy and hard days stay apart.`
}
