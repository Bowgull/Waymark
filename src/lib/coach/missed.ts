// Missed sessions (page 56 §5, approved 2026-10-19): the coach never asks.
// When a session is missed it applies its fix and marks the day with an ember
// Nauthiz rune; tapping the day says what was missed, what the coach did, and
// UNDO. Missed work is never crammed (F14):
// - A missed strength session: its main lifts go into the next strength
//   session within the next few days, one set fewer than the week's target;
//   its accessories are dropped.
// - Anything else (a run, bag, rope, a class): it goes. Runs don't stack (R2).
// Pure: the server loads the week and the sessions to come and applies the fix.

import { getStrengthTemplate } from '../strengthTemplates'
import { strengthDayFor } from '../blockZero/weekPlan'
import { estimatedMinutes, dowOf, nameAtStart, sessionName, type BlockKind, type SessionLike } from './sessions'
import { liftWord, strengthShape } from './rebalance'
import { setsReps } from './changes'
import { WORK_SET_SEC } from '../plannedLength'

/** How far ahead a missed strength session's lifts may go. */
export const MISSED_REACH_DAYS = 4

const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY3 = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

/** context_json.mergedLifts on the session that takes a missed session's main lifts. */
export interface MergedLifts {
  fromSessionId: string
  fromLabel: string
  /** The missed session's weekday (its template). */
  fromDow: number
  exerciseIds: string[]
  /** Working sets for each merged lift. */
  sets: number
}

export type MissedFix =
  | {
    kind: 'merge'
    /** The session that takes the lifts, or null when its week isn't prepared yet. */
    targetSessionId: string | null
    targetDay: number
    targetLabel: string
    merged: MergedLifts
    why: string
    detail: string
    show: { before: string; after: string }
    put: { line: string; dim: string }
  }
  | { kind: 'let_go'; why: string; detail: string | null; show: { before: string; after: string } }

/** "Strength C" -> "C". */
function letter(label: string | null | undefined): string {
  return label?.match(/Strength ([ABC])\b/)?.[1] ?? ''
}

/** The main lifts of a session's template. */
function mainLifts(dow: number, week: number, blockType: BlockKind, label: string | null | undefined) {
  return getStrengthTemplate(dow, week, blockType, label ?? null).exercises.filter(e => e.section === 'main' && (blockType === 'block_zero' || !/pull-up/i.test(e.label)))
}

/** A merged working set: about 40 s of work and the main lifts' 3 min rest (lib/plannedLength). */
const MERGED_SET_SEC = WORK_SET_SEC + 180

function round5(n: number): number {
  return Math.round(n / 5) * 5
}

/**
 * What the coach does about a missed session. `upcoming` is every planned
 * session from the day after the miss through the reach (next week's too when
 * prepared); `nextStrengthDay` is the template's next strength day when that
 * week isn't prepared yet (null when there is none in reach).
 */
export function missedFix(
  missed: SessionLike & { id: string },
  upcoming: ReadonlyArray<SessionLike & { id: string }>,
  opts: { blockType: BlockKind; weekNumber: number; nextWeekNumber?: number; nextStrength?: { epochDay: number; label: string } | null; held?: ReadonlySet<string> },
): MissedFix {
  const name = nameAtStart(sessionName(missed))
  const dayShow = `${DAY3[dowOf(missed.epochDay)]}`
  if (missed.type !== 'strength') {
    const runs = missed.type === 'foundation_run' || missed.type === 'running'
    return {
      kind: 'let_go',
      why: runs ? `${name} missed. Not made up: runs don't stack.` : `${name} missed. Not made up; the week goes on as written.`,
      detail: null,
      show: { before: dayShow, after: 'LET GO' },
    }
  }
  const held = opts.held ?? new Set<string>()
  const target = upcoming
    .filter(s => s.type === 'strength' && s.status === 'planned' && !held.has(s.id) && s.epochDay > missed.epochDay && s.epochDay <= missed.epochDay + MISSED_REACH_DAYS)
    .sort((a, b) => a.epochDay - b.epochDay)[0]
  const into = target ? { epochDay: target.epochDay, label: target.label ?? 'Strength', id: target.id as string | null } : opts.nextStrength && opts.nextStrength.epochDay > missed.epochDay && opts.nextStrength.epochDay <= missed.epochDay + MISSED_REACH_DAYS ? { ...opts.nextStrength, id: null } : null
  const lifts = mainLifts(dowOf(missed.epochDay), opts.weekNumber, opts.blockType, missed.label)
  if (!into || lifts.length === 0) {
    return { kind: 'let_go', why: `${name} missed. No strength day close enough to take its lifts; it goes.`, detail: null, show: { before: dayShow, after: 'LET GO' } }
  }
  const intoWeek = into.epochDay - missed.epochDay > 3 && opts.nextWeekNumber != null ? opts.nextWeekNumber : opts.weekNumber
  const shape = strengthShape({ label: into.label, epochDay: into.epochDay }, opts.blockType, intoWeek)
  const sets = Math.max(1, shape.sets - 1)
  const words = lifts.map(l => liftWord(l.label))
  const liftLine = words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1].toLowerCase()}`
  const intoDay = DAY_LONG[dowOf(into.epochDay)]
  const intoName = into.label
  const intoDow = dowOf(into.epochDay)
  const fromMin = estimatedMinutes({ type: 'strength', notes: null, estimatedMin: null }, opts.blockType, intoWeek)
  const toMin = fromMin + (lifts.length * sets * MERGED_SET_SEC) / 60
  const minutesLine = ` ${intoDay} runs about ${round5(toMin)} min, not ${round5(fromMin)}.`
  const fromLetter = letter(missed.label)
  const intoLetter = letter(into.label)
  return {
    kind: 'merge',
    targetSessionId: into.id,
    targetDay: into.epochDay,
    targetLabel: into.label,
    merged: { fromSessionId: missed.id, fromLabel: missed.label ?? 'Strength', fromDow: dowOf(missed.epochDay), exerciseIds: lifts.map(l => l.exerciseId), sets },
    why: `${name} missed. Its main lifts move into ${intoDay}'s ${intoName}; accessories dropped.`,
    detail: `${liftLine}, ${setsReps(sets, shape.reps)} each.${minutesLine}`,
    show: { before: fromLetter ? `${dayShow} ${fromLetter}` : dayShow, after: intoLetter ? `INTO ${DAY3[intoDow]} ${intoLetter}` : `INTO ${DAY3[intoDow]}` },
    put: { line: `${intoDay} is ${intoName} as written.`, dim: `${name} stays missed. Nothing else moves.` },
  }
}

/** The merged lifts stored on a session's context_json, or null. */
export function mergedLiftsFrom(contextJson: string | null | undefined): MergedLifts | null {
  if (!contextJson) return null
  try {
    const m = (JSON.parse(contextJson) as { mergedLifts?: MergedLifts }).mergedLifts
    if (!m || !Array.isArray(m.exerciseIds) || typeof m.sets !== 'number' || typeof m.fromDow !== 'number') return null
    return m
  } catch {
    return null
  }
}

/** The missed session's template day for a merged lift set ("Strength C" keeps C). */
export function mergedTemplateDay(m: MergedLifts): number {
  const d = strengthDayFor(m.fromDow, m.fromLabel)
  return d === 'A' ? 1 : d === 'B' ? 3 : 5
}

/**
 * A strength template with a missed session's main lifts added after its own
 * main lifts (one set fewer than the week's target, page 56 §5). Unchanged
 * when the session carries none.
 */
export function withMergedLifts<T extends { exercises: Array<{ exerciseId: string; section: string; label: string; notes?: string; sets: Array<{ isWarmup: boolean }> }> }>(template: T, contextJson: string | null | undefined, week: number, blockType: BlockKind): T {
  const m = mergedLiftsFrom(contextJson)
  if (!m) return template
  const from = getStrengthTemplate(mergedTemplateDay(m), week, blockType, m.fromLabel)
  const have = new Set(template.exercises.map(e => e.exerciseId))
  const extra = from.exercises
    .filter(e => e.section === 'main' && m.exerciseIds.includes(e.exerciseId) && !have.has(e.exerciseId))
    .map(e => {
      const warm = e.sets.filter(s => s.isWarmup)
      const work = e.sets.filter(s => !s.isWarmup).slice(0, Math.max(1, m.sets))
      return { ...e, sets: [...warm, ...work], notes: `From ${m.fromLabel}, missed. ${e.notes ?? ''}`.trim() }
    })
  if (extra.length === 0) return template
  const lastMain = template.exercises.map(e => e.section).lastIndexOf('main')
  const at = lastMain >= 0 ? lastMain + 1 : template.exercises.length
  return { ...template, exercises: [...template.exercises.slice(0, at), ...extra, ...template.exercises.slice(at)] as T['exercises'] }
}
