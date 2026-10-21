// Coach brain P2 (coach-brain.md §5.2 "the week outline", §6.3, §9): the
// nightly solver for the rest of the week. It starts from the week as it
// stands (the template's shape, his own picks, earlier coach changes) and
// looks for at most 2 changes that make the week clearly better:
//
// - limits (never broken): no heavy legs in the 24 h before a class, no 3
//   hard days in a row, never two non-class key sessions on one day (no
//   cramming), at least one full rest day in the week;
// - class nights SUGGESTED from Settings' class nights, a 1 → 2 → 3 ladder
//   (the athlete model's class tolerance), never before the block's second
//   week, on the night his history says works (class-night fit × evening
//   adherence); a skipped class (any reason) is never made up that week, and
//   a class he took off with UNDO is not offered again that week;
// - rest days are the coach's call: rest lands where he likes to rest (his
//   moves teach it), and a second rest day comes when he needs one;
// - sessions sit where he actually trains (AM vs PM adherence).
//
// His own changes and anything held by an UNDO are fixed. Every change costs
// a little (stability), more for days 4+ out, so a day only moves for a clear
// gain. A class is a fixed 60-minute hard session: the solver only picks the
// night, never what is taught. Pure.

import { isHard, isHeavyLegs, type BlockKind } from '../coach/sessions'
import { KEY_TYPES } from '../keyTypes'
import { cellOf } from './athleteModel'
import type { AthleteModel } from './types'
import type { ReadinessState } from './readiness'

export const MAX_CHANGES = 2
export const CHANGE_COST = 0.35
export const FAR_CHANGE_COST = 0.7
export const FAR_DAYS = 4
const VIOLATION = 100

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
  /** Settings' class nights (0 = Sunday). */
  classNights: readonly number[]
  /** Profile cap on classes a week (null: none). */
  classCap: number | null
  /** A class the coach added was taken off with UNDO this week: no more class suggestions this week. */
  classHeld: boolean
  /** The last two classes the coach suggested were both not done: the ladder steps down a week (§9). */
  classPaused?: boolean
  model: AthleteModel
  state: ReadinessState
  /** A second rest day is due (RED, soreness 4+ two mornings, 5+ training days running with energy falling). */
  restDue: string | null
}

export type OutlineChange =
  | { kind: 'add'; type: 'mt_class'; day: number; slot: 'pm'; why: string; tempId: string }
  | { kind: 'move'; sessionId: string; type: string; label: string | null; fromDay: number; fromSlot: 'am' | 'pm'; day: number; slot: 'am' | 'pm'; why: string }
  | { kind: 'rest'; sessionId: string; type: string; label: string | null; day: number; why: string }

interface Plan { sessions: OutlineSession[]; changes: OutlineChange[] }

const live = (s: OutlineSession) => s.status !== 'skipped' && s.status !== 'missed'
const dow = (day: number) => ((day % 7) + 11) % 7
const DAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const like = (s: OutlineSession) => ({ type: s.type, label: s.label, notes: null, estimatedMin: null })

/** Classes the week aims for: none before week 2 of Block Zero, then the model's tolerance (1 → 2 → 3), under the profile cap. */
export function classTarget(inp: Pick<OutlineIn, 'blockType' | 'blockStart' | 'monday' | 'model' | 'classCap' | 'classNights' | 'classPaused'>): number {
  if (inp.blockType !== 'block_zero' || inp.classNights.length === 0) return 0
  if (inp.monday + 6 < inp.blockStart + 7) return 0
  if ((inp as { classPaused?: boolean }).classPaused) return 0
  return Math.max(0, Math.min(inp.model.klass.perWeekTolerated, inp.classCap ?? 3, inp.classNights.length))
}

/** The limits a week must keep. Each broken one is a violation. */
export function violations(sessions: readonly OutlineSession[], blockType: BlockKind, monday: number): string[] {
  const out: string[] = []
  const days = Array.from({ length: 9 }, (_, i) => monday - 1 + i)
  const on = (d: number) => sessions.filter(s => s.day === d && live(s))
  for (const d of days) {
    const cls = on(d).filter(s => s.type === 'mt_class')
    if (cls.length && (on(d).some(s => isHeavyLegs(s, blockType) && !(s.slot === 'pm' && cls.every(c => c.slot === 'am'))) || on(d - 1).some(s => isHeavyLegs(s, blockType) && s.slot === 'pm'))) out.push(`heavy legs before ${DAY_NAME[dow(d)]}'s class`)
    const key = on(d).filter(s => KEY_TYPES.has(s.type) && s.type !== 'mt_class')
    if (key.length > 1 && d >= monday && d <= monday + 6) out.push(`${DAY_NAME[dow(d)]} holds ${key.length} sessions`)
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
  const counted = classes.filter(x => x.status !== 'missed') // a skipped one still fills its slot: never made up
  const nightScore = (x: OutlineSession) => inp.model.klass.nights[dow(x.day)].p * 0.5 + cells[cellOf(x.day, 'pm', null)].p * 0.5
  const ranked = counted.map(nightScore).sort((a, b) => b - a)
  for (let i = 0; i < Math.min(target, ranked.length); i++) v += 1.5 + ranked[i]
  if (counted.length > Math.max(target, classes.filter(c => c.locked).length)) v -= 2 * (counted.length - target)
  // A class pairs best with an easy run-walk that morning.
  for (const c of classes.filter(live)) if (s.some(x => x.day === c.day && x.slot === 'am' && (x.type === 'foundation_run' || x.type === 'running') && live(x))) v += 0.2
  // Rest where he likes it.
  const keyOn = (d: number) => s.some(x => x.day === d && live(x) && KEY_TYPES.has(x.type))
  for (const d of inp.model.adherence.preferredRestDays) {
    const day = inp.monday + ((d + 6) % 7)
    if (day >= inp.today && !keyOn(day)) v += 0.8
  }
  // A second rest day when it is due: tomorrow-ish (the first changeable day or the one after).
  if (inp.restDue && (plan.changes.some(c => c.kind === 'rest'))) v += 2.5
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

function nightWhy(inp: OutlineIn, day: number): string {
  const n = inp.model.klass.nights[dow(day)]
  const name = DAY_NAME[dow(day)]
  if (n.attended > 0) return `Of your class nights, ${name} fits: ${n.attended} of ${n.attended + n.scheduleSkips + n.unexplained} done there.`
  return `Of your class nights, ${name} fits the week: no heavy legs that day or the night before.`
}

/** Single edits from a plan. */
function edits(plan: Plan, inp: OutlineIn): Plan[] {
  const out: Plan[] = []
  const s = plan.sessions
  const days = Array.from({ length: 7 }, (_, i) => inp.monday + i).filter(d => d >= inp.today)
  // Only this week's own sessions move, and only to this week's days.
  const free = (x: OutlineSession) => !x.locked && x.status === 'planned' && x.day >= inp.today && x.day >= inp.monday && x.day <= inp.monday + 6 && plan.changes.every(c => !('sessionId' in c) || c.sessionId !== x.id)
  // Add a class.
  const target = classTarget(inp)
  const weekClasses = s.filter(x => x.type === 'mt_class' && x.day >= inp.monday && x.day <= inp.monday + 6 && x.status !== 'missed')
  if (!inp.classHeld && weekClasses.length < target && inp.state !== 'RED') {
    for (const d of days) {
      // A class never before the block's eighth day (§7: week 2 at the earliest).
      if (d < inp.blockStart + 7 || !inp.classNights.includes(dow(d)) || s.some(x => x.day === d && x.type === 'mt_class')) continue
      const tempId = `class-${d}`
      out.push({ sessions: [...s, { id: tempId, type: 'mt_class', label: 'MT Class', day: d, slot: 'pm', status: 'planned', source: 'coach', locked: false }], changes: [...plan.changes, { kind: 'add', type: 'mt_class', day: d, slot: 'pm', why: nightWhy(inp, d), tempId }] })
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
  const cells = inp.model.adherence.cells
  const gain = cells[cellOf(c.day, c.slot, null)].p - cells[cellOf(c.fromDay, c.fromSlot, null)].p
  if (gain >= 0.15) return `${name} moves to ${DAY_NAME[dow(c.day)]}: ${dow(c.day) === 0 || dow(c.day) === 6 ? 'weekends' : 'weekday mornings'} are when you get it done.`
  const rest = inp.model.adherence.preferredRestDays.includes(dow(c.fromDay))
  if (rest) return `${name} moves to ${DAY_NAME[dow(c.day)]}: ${DAY_NAME[dow(c.fromDay)]} is your rest day.`
  return `${name} moves to ${DAY_NAME[dow(c.day)]}: easy and hard days stay apart.`
}
