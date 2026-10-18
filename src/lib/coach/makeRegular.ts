// Added sessions that went well (plan §4). Pure.
//
// One added session already counts toward the week's load and placement
// rules (E1: every add is placement-checked; planned load counts it). When
// the same type was added in each of the last 2+ weeks, with effort at or
// under target and readiness not off trend that day, the weekly pass asks
// whether to make it part of the plan. The slot it offers is placement-
// checked against next week. A yes adds it to the plan template for the
// weeks after; a no changes nothing (and the coach waits 4 weeks to ask again).

import { checkSessionChange, type PlacementContext } from './placement'
import { DAY_NAMES, dowOf, isoOf, mondayOf, plannedLoad, sessionName, type TimeSlot } from './sessions'
import { effortVerdict } from './feltHard'

export const MAKE_REGULAR_MIN_WEEKS = 2
/** After a no (or a lapse), the same type is not asked about again for this long. */
export const MAKE_REGULAR_COOLDOWN_DAYS = 28

export interface AddedSession {
  type: string
  label?: string | null
  notes?: string | null
  epochDay: number
  timeSlot: TimeSlot
  status: string
  rpe: number | null
  rir?: number | null
  /** Check-ins were off trend (flagged) that day or the morning after. */
  readinessOff?: boolean
}

export interface MakeRegularCandidate {
  type: string
  label: string | null
  notes: string | null
  /** Most common weekday and slot it was added on. */
  dayOfWeek: number
  timeSlot: TimeSlot
  weeks: number
}

function wentWell(a: AddedSession): boolean {
  if (a.status !== 'completed') return false
  if (a.readinessOff) return false
  const v = effortVerdict({ epochDay: a.epochDay, type: a.type, label: a.label, notes: a.notes, rpe: a.rpe, rir: a.rir })
  return v === 'easier' || v === 'on_target'
}

const keyOf = (a: Pick<AddedSession, 'type' | 'notes'>) => (a.type === 'running' && a.notes ? `${a.type}:${a.notes}` : a.type)

/**
 * Types added (and done well) in each of the MAKE_REGULAR_MIN_WEEKS calendar
 * weeks ending with the week of `lastMonday`. Recovery work is not tracked.
 */
export function makeRegularCandidates(adds: AddedSession[], lastMonday: number): MakeRegularCandidate[] {
  const byKey = new Map<string, AddedSession[]>()
  for (const a of adds) {
    if (a.type === 'mobility' || a.type === 'active_recovery') continue
    if (!wentWell(a)) continue
    const k = keyOf(a)
    byKey.set(k, [...(byKey.get(k) ?? []), a])
  }
  const out: MakeRegularCandidate[] = []
  for (const list of byKey.values()) {
    let weeks = 0
    for (let w = 0; w < MAKE_REGULAR_MIN_WEEKS; w++) {
      const mon = lastMonday - 7 * w
      if (list.some(a => mondayOf(a.epochDay) === mon)) weeks++
      else break
    }
    if (weeks < MAKE_REGULAR_MIN_WEEKS) continue
    const counts = new Map<string, number>()
    for (const a of list) {
      const k = `${dowOf(a.epochDay)}:${a.timeSlot}`
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    const [best] = [...counts.entries()].sort((x, y) => y[1] - x[1])
    const [dow, slot] = best[0].split(':')
    const latest = [...list].sort((x, y) => y.epochDay - x.epochDay)[0]
    out.push({ type: latest.type, label: latest.label ?? null, notes: latest.notes ?? null, dayOfWeek: Number(dow), timeSlot: slot === 'pm' ? 'pm' : 'am', weeks })
  }
  return out
}

/** A weekly slot that passes placement next week. */
export interface RegularSlot {
  dayOfWeek: number
  timeSlot: TimeSlot
  /** First day it lands on (next week). */
  epochDay: number
  date: string
  /** "WED PM" */
  label: string
}

/**
 * The choices on the coach screen ("The coach speaks"):
 *   usual        its usual slot every week (title e.g. WEDNESDAYS),
 *   another_day  a different weekly slot, picked from the safe days listed,
 *   keep_extra   I'LL ADD IT MYSELF: nothing in the plan changes; an added
 *                session still counts toward load and placement when added.
 */
export type MakeRegularOption =
  | { kind: 'make_regular'; id: 'usual'; title: string; detail: string; label: string; type: string; sessionLabel: string | null; notes: string | null; slot: RegularSlot }
  | { kind: 'make_regular'; id: 'another_day'; title: 'ANOTHER DAY'; detail: string; label: string; type: string; sessionLabel: string | null; notes: string | null; safeSlots: RegularSlot[] }
  | { kind: 'keep_extra'; id: 'keep_extra'; title: "I'LL ADD IT MYSELF"; detail: string; label: string }

export interface MakeRegularAsk {
  question: string
  /** One line of why. */
  why: string
  options: MakeRegularOption[]
  defaultOption: MakeRegularOption
  expiresOnDay: number
}

const DAY_PLURAL = ['SUNDAYS', 'MONDAYS', 'TUESDAYS', 'WEDNESDAYS', 'THURSDAYS', 'FRIDAYS', 'SATURDAYS']

/** Every weekly slot next week that passes placement for this session, its usual day first. */
export function safeRegularSlots(c: Pick<MakeRegularCandidate, 'type' | 'label' | 'notes' | 'dayOfWeek' | 'timeSlot'>, ctx: PlacementContext, nextMonday: number): RegularSlot[] {
  // It becomes part of the plan, so the plan's load grows with it (F14 still
  // stops anything else being crammed on top).
  const planCtx: PlacementContext = { ...ctx, planWeekLoad: ctx.planWeekLoad != null ? ctx.planWeekLoad + plannedLoad({ type: c.type, label: c.label, notes: c.notes, estimatedMin: null }, ctx.blockType, ctx.weekNumber) : null }
  const usual = nextMonday + ((c.dayOfWeek + 6) % 7)
  const days = [usual, ...Array.from({ length: 7 }, (_, i) => nextMonday + i).filter(d => d !== usual)]
  const out: RegularSlot[] = []
  for (const d of days) {
    for (const slot of [c.timeSlot, c.timeSlot === 'am' ? 'pm' : 'am'] as TimeSlot[]) {
      const r = checkSessionChange({ kind: 'add', type: c.type, label: c.label, notes: c.notes, epochDay: d, timeSlot: slot }, planCtx, { alternatives: false })
      if (!r.ok) continue
      out.push({ dayOfWeek: dowOf(d), timeSlot: r.change.timeSlot, epochDay: d, date: isoOf(d), label: `${DAY_NAMES[dowOf(d)].toUpperCase()} ${r.change.timeSlot.toUpperCase()}` })
      break
    }
  }
  return out
}

/**
 * The ask for one candidate against next week (ctx is next week's placement
 * context, starting `nextMonday`). Null when no weekly slot passes.
 */
export function makeRegularAsk(c: MakeRegularCandidate, ctx: PlacementContext, nextMonday: number): MakeRegularAsk | null {
  const slots = safeRegularSlots(c, ctx, nextMonday)
  if (slots.length === 0) return null
  const name = sessionName({ type: c.type, label: c.label, notes: c.notes })
  const first = slots[0]
  const usualIsUsual = first.dayOfWeek === c.dayOfWeek
  const base = { type: c.type, sessionLabel: c.label, notes: c.notes }
  const usual: MakeRegularOption = {
    kind: 'make_regular', id: 'usual', ...base, slot: first,
    title: DAY_PLURAL[first.dayOfWeek],
    detail: `${name}, ${first.timeSlot.toUpperCase()}, every week`,
    label: `${name} every ${DAY_NAMES[first.dayOfWeek]} ${first.timeSlot.toUpperCase()}`,
  }
  const others = slots.slice(1)
  const options: MakeRegularOption[] = [usual]
  if (others.length > 0) {
    options.push({ kind: 'make_regular', id: 'another_day', ...base, title: 'ANOTHER DAY', safeSlots: others, detail: `Safe days: ${others.map(s => s.label).join(', ')}`, label: `${name} on another day` })
  }
  options.push({ kind: 'keep_extra', id: 'keep_extra', title: "I'LL ADD IT MYSELF", detail: 'Plan stays as it is. Added sessions still count.', label: 'Keep adding it yourself' })
  const why = `${name} was added ${c.weeks} weeks running and went well.`
  return {
    question: `${why} Make it part of the plan? Accept adds it ${DAY_NAMES[first.dayOfWeek]} ${first.timeSlot.toUpperCase()} from next week.${usualIsUsual ? '' : ' Its usual day is not safe next week.'}`,
    why,
    options,
    defaultOption: usual,
    expiresOnDay: nextMonday + 7,
  }
}
