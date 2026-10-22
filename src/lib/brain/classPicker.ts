// Class days (coach-brain.md §9; Josh 2026-10-20 "no set days yet, the coach
// should suggest days"; 2026-10-21: classes are not always in the evening).
// Pure. The nightly solver (outline.ts) reads these to place MT classes as
// suggestions, never rules:
//
// - Candidate days: Settings' class days (settings.mtClassDays). None set:
//   every day is a candidate and his own adherence picks.
// - The slot on each day: slotForClassDay. His Settings choice per lit day
//   (page 70: AM, PM or ANY; a new day starts PM on weekdays, ANY on the
//   weekend) always wins. 'any' lets the solver take whichever slot fits that
//   day, leaning to the slot he has actually used there (a class he moved to
//   the other slot counts; the setting never changes by itself). With no class
//   days set, each day's slot is learned from the classes he did, else weekday
//   evenings and weekend mornings.
// - The ladder 1 → 2 → 3 a week, starting at one: two classes done with next
//   morning soreness 3 or less step it up the next week; soreness 4+ after a
//   class steps it down; two classes the coach placed that were skipped or
//   missed with no reason step it down (from one: a week off) and that day is
//   not suggested again for 3 weeks, so the class moves to the next-best day.
//   Skips for time ("class time doesn't fit") count against the day's fit,
//   never against him. Skips for how he felt say nothing about the day.
// - A class is a fixed 60-minute hard session; the coach picks only the day
//   and slot, never what is taught.

import { cellOf } from './athleteModel'
import type { ClassDaySlot } from '../classSlots'
import { type AthleteModel, type ModelCheckIn, type ModelSession } from './types'

export type ClassSlot = 'am' | 'pm'
/** What a class day's slot can be: fixed, or 'any' (the solver picks the slot that fits). Settings' choice (page 70). */
export type ClassSlotChoice = ClassDaySlot

export const CLASS_LADDER_MAX = 3
/** Days a class day that was skipped twice with no reason stays off the suggestions. */
export const AVOID_DAYS = 21
export const DAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const OWN_SOURCES: ReadonlySet<string> = new Set(['ad_hoc', 'replace'])

/** Weekday of a local epoch day (0 = Sunday; epoch day 0 was a Thursday). */
export const dowOf = (day: number) => ((day % 7) + 11) % 7
const mondayOf = (day: number) => day - ((dowOf(day) + 6) % 7)
const isWeekend = (dow: number) => dow === 0 || dow === 6

/** Classes he did per weekday, by slot: the start time when there is one, else the slot it sat in. */
export function learnedClassSlots(sessions: readonly Pick<ModelSession, 'type' | 'status' | 'day' | 'slot' | 'startMin'>[], today: number): Record<number, { am: number; pm: number }> {
  const out: Record<number, { am: number; pm: number }> = {}
  for (let d = 0; d < 7; d++) out[d] = { am: 0, pm: 0 }
  for (const s of sessions) {
    if (s.type !== 'mt_class' || s.day > today || (s.status !== 'completed' && s.status !== 'in_progress')) continue
    const slot: ClassSlot = s.startMin != null ? (s.startMin >= 720 ? 'pm' : 'am') : s.slot === 'am' ? 'am' : 'pm'
    out[dowOf(s.day)][slot]++
  }
  return out
}

/**
 * The slot for a class on weekday `dow`. His Settings choice always wins (page
 * 70: AM, PM or ANY on each lit day); a day he did not light (no class days
 * set at all) takes what he has done on that weekday, else weekday evenings
 * and weekend mornings.
 */
export function slotForClassDay(dow: number, learned: Record<number, { am: number; pm: number }>, setting?: ClassSlotChoice | null): ClassSlotChoice {
  if (setting === 'am' || setting === 'pm' || setting === 'any') return setting
  const c = learned[dow]
  if (c && c.am !== c.pm) return c.am > c.pm ? 'am' : 'pm'
  return isWeekend(dow) ? 'am' : 'pm'
}

export function slotsOf(choice: ClassSlotChoice): ClassSlot[] {
  return choice === 'any' ? ['am', 'pm'] : [choice]
}

/** On an ANY day, the slot he has actually used there more often (a move he made counts), or null. */
export function classLean(dow: number, learned: Record<number, { am: number; pm: number }>): ClassSlot | null {
  const c = learned[dow]
  return c && c.am !== c.pm ? (c.am > c.pm ? 'am' : 'pm') : null
}

/** Every weekday's slot choice. */
export function classSlotChoices(sessions: readonly ModelSession[], today: number, settings: Partial<Record<number, ClassSlotChoice | null>> = {}): Record<number, ClassSlotChoice> {
  const learned = learnedClassSlots(sessions, today)
  const out: Record<number, ClassSlotChoice> = {}
  for (let d = 0; d < 7; d++) out[d] = slotForClassDay(d, learned, settings[d] ?? null)
  return out
}

/** Candidate class days: Settings' days, else every day (the coach suggests from his own adherence). */
export function candidateClassDays(settingDays: readonly number[]): number[] {
  const set = settingDays.filter(d => Number.isInteger(d) && d >= 0 && d <= 6)
  return set.length > 0 ? [...new Set(set)] : [0, 1, 2, 3, 4, 5, 6]
}

// ─── The ladder ──────────────────────────────────────────────

export interface ClassLadder {
  /** Classes a week the coach aims for in the week asked about (1-3). */
  level: number
  /** A week off after two placed classes in a row went undone at one a week. */
  paused: boolean
  /** Weekdays not suggested for now (skipped twice with no reason). */
  avoidDays: number[]
  /** The last step and its evidence, for the why line. */
  step: { dir: 'up' | 'down'; day: number; soreness?: number[]; fromDow?: number } | null
}

interface Step { from: number; delta: number; pause?: boolean; info: NonNullable<ClassLadder['step']> }

/** Where the ladder stands for the week starting `monday`, from every class so far. */
export function classLadder(sessions: readonly Pick<ModelSession, 'type' | 'status' | 'day' | 'skipReason' | 'source'>[], checkIns: readonly Pick<ModelCheckIn, 'day' | 'soreness'>[], today: number, monday: number): ClassLadder {
  const classes = sessions.filter(s => s.type === 'mt_class' && (s.day < today || (s.day === today && s.status === 'completed'))).sort((a, b) => a.day - b.day)
  const sore = new Map(checkIns.map(c => [c.day, c.soreness]))
  const steps: Step[] = []
  const avoid = new Map<number, number>()
  let okRun: number[] = []
  let skipRun: Array<{ day: number }> = []
  for (const c of classes) {
    if (c.status === 'completed') {
      skipRun = []
      const s = sore.get(c.day + 1)
      if (s != null && s >= 4) {
        steps.push({ from: c.day + 1, delta: -1, info: { dir: 'down', day: c.day, soreness: [s] } })
        okRun = []
      } else if (s != null && s <= 3) {
        okRun.push(s)
        if (okRun.length >= 2) {
          // Up the next week.
          steps.push({ from: mondayOf(c.day) + 7, delta: 1, info: { dir: 'up', day: c.day, soreness: okRun.slice(-2) } })
          okRun = []
        }
      }
      continue
    }
    if (c.status !== 'skipped' && c.status !== 'missed') continue
    // Only a class the coach placed, gone with no reason: the coach's own rest day, a skip
    // for time, or for how he felt never count against him.
    const reason = c.skipReason ?? ''
    if (OWN_SOURCES.has(c.source ?? '') || (reason !== '' && reason !== 'other')) continue
    skipRun.push({ day: c.day })
    if (skipRun.length >= 2) {
      const dowSkipped = dowOf(c.day)
      steps.push({ from: c.day + 1, delta: -1, pause: true, info: { dir: 'down', day: c.day, fromDow: dowSkipped } })
      avoid.set(dowSkipped, c.day + AVOID_DAYS)
      skipRun = []
      okRun = []
    }
  }
  let level = 1
  let paused = false
  let last: ClassLadder['step'] = null
  for (const st of steps) {
    if (st.from > monday + 6) continue
    // From one a week, a step down is a week off (the rest of that week and the next), then one again on another day.
    if (st.delta < 0 && st.pause && level === 1 && monday >= mondayOf(st.info.day) && monday <= mondayOf(st.info.day) + 7) paused = true
    level = Math.max(1, Math.min(CLASS_LADDER_MAX, level + st.delta))
    last = st.info
  }
  return { level, paused, avoidDays: [...avoid.entries()].filter(([, until]) => until >= monday).map(([d]) => d), step: last }
}

// ─── Score and words ─────────────────────────────────────────

/** How well a day and slot suit a class: the day's own class fit, his adherence in that slot, and on an ANY day the slot he leans to. */
export function classSlotScore(model: AthleteModel, day: number, slot: ClassSlot, lean: ClassSlot | null = null): number {
  const fit = model.klass.days[dowOf(day)]?.p ?? 0.5
  return fit * 0.5 + model.adherence.cells[cellOf(day, slot, null)].p * 0.5 + (lean === slot ? 0.15 : 0)
}

const SLOT_WORD: Record<ClassSlot, string> = { am: 'morning', pm: 'evening' }

/** The why on a placed class: one plain line with real numbers when there are any. */
export function classWhy(model: AthleteModel, day: number, slot: ClassSlot, opts: { setDays: boolean; ladder?: ClassLadder | null; nth?: number }): string {
  const dow = dowOf(day)
  const name = DAY_NAME[dow]
  const st = opts.ladder?.step
  if (st && st.dir === 'down' && st.fromDow != null && st.fromDow !== dow) return `${DAY_NAME[st.fromDow]}'s class was skipped twice, so it moves to ${name} ${SLOT_WORD[slot]}.`
  if (st && st.dir === 'up' && (opts.nth ?? 1) > 1 && st.soreness?.length === 2) return `Your last two classes were done, soreness ${st.soreness[0]} and ${st.soreness[1]} the next morning. ${name} is class ${opts.nth} this week.`
  const n = model.klass.days[dow]
  const tried = n ? n.attended + n.scheduleSkips + n.unexplained : 0
  if (n && n.attended > 0) return `Of your class days, ${name} fits: ${n.attended} of ${tried} done there.`
  if (!opts.setDays) return `No class days set, so the coach picked ${name} ${SLOT_WORD[slot]}: no heavy legs in the 24 h before.`
  return `Of your class days, ${name} ${SLOT_WORD[slot]} fits the week: no heavy legs in the 24 h before.`
}

/**
 * The why on a planned class that comes off after one he did (page 69 §3): no
 * day between the two, or the week already holds what the ladder aims for.
 */
export function classOffWhy(off: { day: number; slot?: ClassSlot }, his: { day: number; rpe: number | null; slot?: ClassSlot }, kept: { day: number } | null, perWeek = 1): string {
  const name = DAY_NAME[dowOf(off.day)]
  const hoursApart = Math.abs((off.day - his.day) * 24 + ((off.slot === 'am' ? 8 : 18) - (his.slot === 'am' ? 8 : 18)))
  if (hoursApart <= 30) {
    const when = his.day === off.day - 1 ? (his.slot === 'am' ? 'Class yesterday morning' : 'Class last night') : his.day === off.day + 1 ? `Class ${DAY_NAME[dowOf(his.day)]}` : 'Class today'
    const effort = his.rpe != null ? `: an hour at effort ${his.rpe}` : ': an hour of hard work'
    return `${when}${effort}. ${name}'s class comes off so you get a day between${kept ? `; ${DAY_NAME[dowOf(kept.day)]}'s stays` : ''}.`
  }
  return `${DAY_NAME[dowOf(his.day)]}'s class${his.rpe != null ? ` at effort ${his.rpe}` : ''} fills this week: ${perWeek === 1 ? 'one class a week' : `${perWeek} a week`} for now. ${name}'s comes off.`
}
