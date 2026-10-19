// Run: tsx src/lib/coach/pickDay.test.ts
// "I want a ___ day" (Part C): the board offers only what passes. Strength
// pulls the week's next strength forward when safe, bag on a run day is a
// swap for the run, and refusals say why in one line.
import { getDayTemplate } from '../weeklyTemplate'
import { checkSessionChange, type PlacementContext } from './placement'
import { pickDayOption, strengthLetterFor } from './pickDay'
import { KEY_TYPES, plannedLoad, type SessionLike } from './sessions'
import { MON, assert, ctx } from './testUtil'

const houseVoice = (t: string | null) => t == null || !/[!—–]/.test(t)
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
function planLoad(week: number): number {
  let n = 0
  for (let d = 0; d < 7; d++) for (const t of getDayTemplate('block_zero', week, d, new Set())) if (KEY_TYPES.has(t.type)) n += plannedLoad({ type: t.type, label: t.label, notes: null, estimatedMin: null }, 'block_zero', week)
  return n
}
const W2 = MON + 7
function weekCtx(today: number, sessions: SessionLike[], over: Partial<PlacementContext> = {}): PlacementContext {
  return ctx({ blockType: 'block_zero', weekNumber: 2, todayEpochDay: today, sessions, planWeekLoad: planLoad(2), run: { longestLast30Sec: 23 * 60, lastWeekRunSec: 69 * 60, thisWeekRunSec: 0 }, ...over })
}
const set = (list: Array<SessionLike & { id: string }>, id: string, status: string) => list.map(s => (s.id === id ? { ...s, status } : s))

// ─── Strength on a non-strength day ──────────────────────────
const doneMon = set(bzWeek(W2, 2), 'strength-0', 'completed')
const tueAfterA = pickDayOption({ type: 'strength', timeSlot: 'am' }, W2 + 1, weekCtx(W2 + 1, doneMon))
assert(tueAfterA.action.kind === 'refused' && /back to back/.test(tueAfterA.line ?? ''), `Tuesday after Monday's A: not today, one line (${tueAfterA.line})`)

const missedMon = set(bzWeek(W2, 2), 'strength-0', 'missed')
const tue = pickDayOption({ type: 'strength', timeSlot: 'am' }, W2 + 1, weekCtx(W2 + 1, missedMon))
assert(tue.action.kind === 'pull_forward' && tue.action.sessionId === 'strength-2' && tue.action.fromEpochDay === W2 + 2, 'Tuesday after a missed Monday: Wednesday\'s Strength B comes forward')
assert(tue.action.kind === 'pull_forward' && tue.action.displaced.map(d => d.sessionId).join() === 'foundation_run-1', 'Tuesday\'s run-walk takes Wednesday\'s slot')
assert(tue.line === "Wednesday's Strength B comes here. Run-Walk moves to Wednesday." && houseVoice(tue.line), `the row says it in one line: ${tue.line}`)
// The week after the swap still passes every rule, both moves.
if (tue.action.kind === 'pull_forward') {
  const after = missedMon.map(s => (s.id === 'strength-2' ? { ...s, epochDay: W2 + 1 } : s.id === 'foundation_run-1' ? { ...s, epochDay: W2 + 2 } : s))
  const c = weekCtx(W2 + 1, after)
  const okStr = checkSessionChange({ kind: 'move', type: 'strength', label: 'Strength B', epochDay: W2 + 1, timeSlot: 'am', sessionId: 'strength-2', fromEpochDay: W2 + 2 }, c, { alternatives: false })
  const okRun = checkSessionChange({ kind: 'move', type: 'foundation_run', label: 'Run-Walk', epochDay: W2 + 2, timeSlot: 'am', sessionId: 'foundation_run-1', fromEpochDay: W2 + 1 }, c, { alternatives: false })
  assert(okStr.ok && okRun.ok, 'pull forward: both moves pass the placement rules')
}
const runStarted = pickDayOption({ type: 'strength', timeSlot: 'am' }, W2 + 1, weekCtx(W2 + 1, set(missedMon, 'foundation_run-1', 'in_progress')))
assert(runStarted.action.kind === 'refused' && runStarted.line === 'Run-Walk is under way today. Strength B stays on Wed.', `a run already under way stays; the row says so (${runStarted.line})`)
const thu = pickDayOption({ type: 'strength', timeSlot: 'am' }, W2 + 3, weekCtx(W2 + 3, set(doneMon, 'strength-2', 'completed')))
assert(thu.action.kind === 'refused' && /back to back/.test(thu.line ?? ''), `Thursday after Wednesday's B: refused (${thu.line})`)
const sat = pickDayOption({ type: 'strength', timeSlot: 'am' }, W2 + 5, weekCtx(W2 + 5, set(set(doneMon, 'strength-2', 'completed'), 'strength-4', 'completed')))
assert(sat.action.kind === 'refused' && houseVoice(sat.line), `Saturday, nothing left to pull: refused with its reason (${sat.line})`)
const eased = pickDayOption({ type: 'strength', timeSlot: 'am' }, W2 + 1, weekCtx(W2 + 1, missedMon, { readinessEase: true, easeReason: 'Check-ins are down two days running.' }))
assert(eased.action.kind === 'refused' && /No hard sessions added|ease/i.test(eased.line ?? ''), `an ease day: no strength pulled forward (${eased.line})`)

// ─── Bag on a run day: a swap for the run ─────────────────────
const fullWeek = bzWeek(W2, 2)
const bagTue = pickDayOption({ type: 'bag_work', timeSlot: 'pm' }, W2 + 1, weekCtx(W2 + 1, fullWeek))
assert(bagTue.action.kind === 'replace' && bagTue.action.sessionId === 'foundation_run-1', 'bag on a run day, week at its planned load: offered as a swap for the run-walk')
assert(bagTue.line === "Instead of today's run-walk.", `swap line: ${bagTue.line}`)
const addCheck = checkSessionChange({ kind: 'add', type: 'bag_work', epochDay: W2 + 1, timeSlot: 'pm' }, weekCtx(W2 + 1, fullWeek), { alternatives: false })
assert(!addCheck.ok && addCheck.code === 'over_plan', 'adding the bag on top would pass the planned load (why the swap)')
const roomy = pickDayOption({ type: 'bag_work', timeSlot: 'pm' }, W2 + 1, weekCtx(W2 + 1, fullWeek, { planWeekLoad: planLoad(2) * 2 }))
assert(roomy.action.kind === 'add', 'with room in the week, bag is a plain add')
const bagSun = pickDayOption({ type: 'bag_work', timeSlot: 'am' }, W2 + 6, weekCtx(W2 + 6, fullWeek))
assert(bagSun.action.kind === 'refused' && bagSun.line === 'Sunday is the rest day. Foundation only.', 'Sunday: refused, rest day')
const recovery = pickDayOption({ type: 'active_recovery', timeSlot: 'pm' }, W2 + 1, weekCtx(W2 + 1, fullWeek))
assert(recovery.action.kind === 'add', 'an easy walk always fits')

// ─── Lead-in: an intro session, the weekday's letter ─────────
const leadCtx = ctx({ blockType: 'block_zero', weekNumber: 1, leadIn: true, todayEpochDay: MON + 4, planWeekLoad: null, sessions: [] })
const intro = pickDayOption({ type: 'strength', timeSlot: 'am' }, MON + 4, leadCtx)
assert(intro.action.kind === 'add' && intro.action.label === 'Strength C' && intro.line == null, 'lead-in Friday: intro Strength C is a plain add')
assert(strengthLetterFor(MON + 1, [], true) === 'B' && strengthLetterFor(MON + 5, [], true) === 'C', 'lead-in letters follow the weekday')

// ─── The letter for an added strength session (D8) ───────────
const weekAC = [{ type: 'strength', label: 'Strength A', epochDay: W2, timeSlot: 'am' as const, status: 'completed' }, { type: 'strength', label: 'Strength C', epochDay: W2 + 4, timeSlot: 'am' as const, status: 'planned' }]
assert(strengthLetterFor(W2 + 4, weekAC, false) === 'B', 'never a letter already in the week: B, not a second C')
assert(strengthLetterFor(W2 + 2, [], false) === 'B', 'free week: the weekday\'s own letter')

console.log('pick-a-day tests passed')
