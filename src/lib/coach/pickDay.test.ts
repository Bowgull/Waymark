// Run: tsx src/lib/coach/pickDay.test.ts
// "+ Add session always adds" (page 56 item 4): nothing is refused, nothing
// greyed out, no preview line. Strength on a day with no lifting brings the
// week's remaining session lightest on the legs after yesterday here (R10);
// the coach then rebalances the rest (rebalance.ts).
import { getDayTemplate } from '../weeklyTemplate'
import type { PlacementContext } from './placement'
import { pickDayOption, strengthLetterFor, strengthToPull } from './pickDay'
import type { SessionLike } from './sessions'
import { MON, assert, ctx } from './testUtil'

const dow = (d: number) => new Date(d * 86400000).getUTCDay()

/** A Block Zero week from the template, Monday `monday`, all planned. */
function bzWeek(monday: number, week: number): Array<SessionLike & { id: string }> {
  const out: Array<SessionLike & { id: string }> = []
  for (let d = monday; d < monday + 7; d++) {
    for (const t of getDayTemplate('block_zero', week, dow(d), new Set())) {
      out.push({ id: `${t.type}-${d - monday}`, type: t.type, label: t.label, epochDay: d, timeSlot: t.timeSlot, status: 'planned' })
    }
  }
  return out
}
const W2 = MON + 7
function weekCtx(today: number, sessions: SessionLike[], over: Partial<PlacementContext> = {}): PlacementContext {
  return ctx({ blockType: 'block_zero', weekNumber: 2, todayEpochDay: today, sessions, planWeekLoad: 1, run: { longestLast30Sec: 23 * 60, lastWeekRunSec: 69 * 60, thisWeekRunSec: 0 }, ...over })
}
const set = (list: Array<SessionLike & { id: string }>, id: string, status: string) => list.map(s => (s.id === id ? { ...s, status } : s))

// ─── Every row adds: nothing is refused ──────────────────────
const fullWeek = bzWeek(W2, 2)
for (const type of ['bag_work', 'skip_rope', 'mt_class', 'foundation_run', 'running', 'active_recovery', 'mobility']) {
  for (const day of [W2 + 1, W2 + 6]) {
    const r = pickDayOption({ type, timeSlot: 'pm' }, day, weekCtx(day, fullWeek, { readinessEase: true, loadFlag: true, injury: { region: 'knee', reason: 'Knee.' } }))
    assert(r.action.kind === 'add', `${type} on ${day === W2 + 6 ? 'the rest day' : 'a full day'}, on an ease day with a knee flag: added`)
  }
}
const bagTue = pickDayOption({ type: 'bag_work', timeSlot: 'pm' }, W2 + 1, weekCtx(W2 + 1, fullWeek))
assert(bagTue.action.kind === 'add' && bagTue.action.timeSlot === 'pm', 'bag on a run day is an add (the run stays; REPLACE is the swap)')
assert(!('line' in bagTue), 'no preview line on the row')

// ─── Strength on a day with no lifting: pull forward ─────────
const missedMon = set(bzWeek(W2, 2), 'strength-0', 'missed')
const tue = pickDayOption({ type: 'strength', timeSlot: 'am' }, W2 + 1, weekCtx(W2 + 1, missedMon))
assert(tue.action.kind === 'pull_forward' && tue.action.sessionId === 'strength-2' && tue.action.fromEpochDay === W2 + 2, 'Tuesday after a missed Monday: Wednesday\'s Strength B comes forward')
assert(tue.action.kind === 'pull_forward' && tue.action.displaced.map(d => d.sessionId).join() === 'foundation_run-1', 'Tuesday\'s run-walk takes Wednesday\'s slot')

// R10: after Monday's A, the lightest on the legs comes: C, not B.
const doneMon = set(bzWeek(W2, 2), 'strength-0', 'completed')
const tueAfterA = pickDayOption({ type: 'strength', timeSlot: 'am' }, W2 + 1, weekCtx(W2 + 1, doneMon))
assert(tueAfterA.action.kind === 'pull_forward' && tueAfterA.action.sessionId === 'strength-4' && tueAfterA.action.label === 'Strength C', 'Tuesday after Monday\'s A: Friday\'s Strength C comes forward (R10), never refused')
assert(strengthToPull(W2 + 1, weekCtx(W2 + 1, doneMon))?.id === 'strength-4', 'R10: C after A')

// Work already under way today stays: the strength is simply added, with a letter.
const runStarted = pickDayOption({ type: 'strength', timeSlot: 'am' }, W2 + 1, weekCtx(W2 + 1, set(missedMon, 'foundation_run-1', 'in_progress')))
assert(runStarted.action.kind === 'add' && /Strength [ABC]/.test(runStarted.action.label ?? ''), `a run already under way: strength is added (${runStarted.action.kind})`)
const thu = pickDayOption({ type: 'strength', timeSlot: 'am' }, W2 + 3, weekCtx(W2 + 3, set(doneMon, 'strength-2', 'completed')))
assert(thu.action.kind === 'pull_forward' && thu.action.sessionId === 'strength-4', 'Thursday after Wednesday\'s B: Friday\'s C comes forward (the coach rebalances)')
const sat = pickDayOption({ type: 'strength', timeSlot: 'am' }, W2 + 5, weekCtx(W2 + 5, set(set(doneMon, 'strength-2', 'completed'), 'strength-4', 'completed')))
assert(sat.action.kind === 'add', 'Saturday, nothing left to pull: a plain add')
const eased = pickDayOption({ type: 'strength', timeSlot: 'am' }, W2 + 1, weekCtx(W2 + 1, missedMon, { readinessEase: true, easeReason: 'Check-ins are down two days running.' }))
assert(eased.action.kind !== undefined, 'an ease day: his pick stands (R9 eases the next hard day instead)')

// ─── Lead-in: an intro session, the weekday's letter ─────────
const leadCtx = ctx({ blockType: 'block_zero', weekNumber: 1, leadIn: true, todayEpochDay: MON + 4, planWeekLoad: null, sessions: [] })
const intro = pickDayOption({ type: 'strength', timeSlot: 'am' }, MON + 4, leadCtx)
assert(intro.action.kind === 'add' && intro.action.label === 'Strength C', 'lead-in Friday: intro Strength C is a plain add')
assert(strengthLetterFor(MON + 1, [], true) === 'B' && strengthLetterFor(MON + 5, [], true) === 'C', 'lead-in letters follow the weekday')

// ─── The letter for an added strength session (D8, R10) ──────
const weekAC = [{ type: 'strength', label: 'Strength A', epochDay: W2, timeSlot: 'am' as const, status: 'completed' }, { type: 'strength', label: 'Strength C', epochDay: W2 + 4, timeSlot: 'am' as const, status: 'planned' }]
assert(strengthLetterFor(W2 + 4, weekAC, false) === 'B', 'never a letter already in the week: B, not a second C')
assert(strengthLetterFor(W2 + 2, [], false) === 'B', 'free week: the weekday\'s own letter')
assert(strengthLetterFor(W2 + 1, [{ type: 'strength', label: 'Strength A', epochDay: W2, timeSlot: 'am', status: 'completed' }], false) === 'C', 'the day after A: C, lightest on the legs')

console.log('pick-a-day tests passed')
