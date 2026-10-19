// Run: tsx src/lib/coach/rebalance.test.ts
// The rebalance (§3 R1-R12, page 56): his pick stands; the coach adjusts
// other sessions, at most two, with one plain line each. The page 56 story
// (Block Zero week 4, his regular bag on Thursday) runs through it.
import { getDayTemplate } from '../weeklyTemplate'
import { weeklyRunAllowanceSec } from '../blockZero/running'
import { renderWhy } from './changes'
import { missedFix } from './missed'
import { rebalance, runAllowanceBaseSec, MAX_COACH_CHANGES, type RebalanceSession } from './rebalance'
import { KEY_TYPES, plannedLoad, type SessionLike } from './sessions'
import { MON, assert, ctx } from './testUtil'
import type { PlacementContext } from './placement'

const houseVoice = (t: string) => !/[!—–]/.test(t) && !/\b(load|volume|deload|building)\b/i.test(t)
const dow = (d: number) => new Date(d * 86400000).getUTCDay()

/** Block Zero week `week` from the template, plus his regular bag on Thursday PM. */
function week4(monday: number, week = 4): RebalanceSession[] {
  const out: RebalanceSession[] = []
  for (let d = monday; d < monday + 7; d++) {
    for (const t of getDayTemplate('block_zero', week, dow(d), new Set())) {
      out.push({ id: `${t.type}-${d - monday}`, type: t.type, label: t.label, epochDay: d, timeSlot: t.timeSlot, status: 'planned' })
    }
  }
  out.push({ id: 'bag-3', type: 'bag_work', label: 'Bag Work', epochDay: monday + 3, timeSlot: 'pm', status: 'planned' })
  return out
}
function planLoad(list: SessionLike[], week: number): number {
  return list.filter(s => KEY_TYPES.has(s.type)).reduce((n, s) => n + plannedLoad(s, 'block_zero', week), 0)
}
const set = (list: RebalanceSession[], id: string, patch: Partial<RebalanceSession>) => list.map(s => (s.id === id ? { ...s, ...patch } : s))
function bzCtx(today: number, sessions: SessionLike[], over: Partial<PlacementContext> = {}): PlacementContext {
  return ctx({ blockType: 'block_zero', weekNumber: 4, todayEpochDay: today, sessions, planWeekLoad: planLoad(week4(MON), 4), run: { longestLast30Sec: 28 * 60, lastWeekRunSec: 78 * 60, thisWeekRunSec: 0 }, ...over })
}

// ─── Tuesday 6:10 PM: run-walk -> bag, ROUGH DAY ─────────────
let wk = set(set(week4(MON), 'mobility-0', { status: 'completed' }), 'strength-0', { status: 'completed' })
wk = set(wk, 'mobility-1', { status: 'completed' })
wk = set(wk, 'foundation_run-1', { status: 'skipped' })
const bagTue: RebalanceSession = { id: 'bag-tue', type: 'bag_work', label: 'Bag Work', epochDay: MON + 1, timeSlot: 'pm', status: 'planned' }
const tueWeek = [...wk, bagTue]
const tue = rebalance({ action: { kind: 'swap', session: bagTue, replaced: wk.find(s => s.id === 'foundation_run-1') ?? null, reason: 'rough_day' }, week: tueWeek, ctx: bzCtx(MON + 1, tueWeek), held: new Set() })
assert(tue.length === 1, `one change only (${tue.map(c => c.rule).join(',')})`)
assert(tue[0].sessionId === 'strength-2' && tue[0].kind === 'ease' && tue[0].ease?.kind === 'one_set', "Wednesday's Strength B eases by one set")
assert(tue[0].show.before === '3×8' && tue[0].show.after === '2×8' && tue[0].show.logBefore === 'B 3×8', 'flaps: 3×8 -> 2×8, the log reads B 3×8')
assert(renderWhy(tue[0].why, MON + 2) === "Bag work yesterday on a rough day; one set less so Thursday's run stays easy.", `the why, read on Wednesday: ${renderWhy(tue[0].why, MON + 2)}`)
assert(renderWhy(tue[0].why, MON + 2, 'log') === "Bag work yesterday on a rough day; one set less so Thursday's run stays easy.", 'the week log reads it against Wednesday too')
assert(tue[0].detail === 'Block pull and overhead press, same weights.', `detail names the lifts: ${tue[0].detail}`)
assert(renderWhy(tue[0].put.line, MON + 2) === 'Strength B is 3×8 again.' && tue[0].put.dim === 'The coach leaves it as you set it this week.', 'put back: Strength B is 3×8 again')
assert(houseVoice(renderWhy(tue[0].why, MON + 2)), 'house voice, no jargon')

// No reason: R5, three hard days in a row (lift, bag, lift), the third one eases.
const plain = rebalance({ action: { kind: 'swap', session: bagTue, replaced: null, reason: null }, week: tueWeek, ctx: bzCtx(MON + 1, tueWeek), held: new Set() })
assert(plain.length === 1 && plain[0].rule === 'R5' && plain[0].sessionId === 'strength-2', 'no reason: R5 eases Wednesday all the same')
assert(renderWhy(plain[0].why, MON + 1) === 'Lift, bag, lift: three hard days in a row. One set off Wednesday, same weights.', `R5 line: ${renderWhy(plain[0].why, MON + 1)}`)

// Held: he undid the ease, so the coach leaves Wednesday alone.
const held = rebalance({ action: { kind: 'swap', session: bagTue, replaced: null, reason: 'rough_day' }, week: tueWeek, ctx: bzCtx(MON + 1, tueWeek), held: new Set(['strength-2']) })
assert(held.every(c => c.sessionId !== 'strength-2'), 'a held session is never changed again that week')

// R4: rope for the run-walk is like for like.
const ropeTue: RebalanceSession = { id: 'rope-tue', type: 'skip_rope', label: 'Skip Rope', epochDay: MON + 1, timeSlot: 'pm', status: 'planned' }
assert(rebalance({ action: { kind: 'swap', session: ropeTue, replaced: wk.find(s => s.id === 'foundation_run-1') ?? null, reason: 'rough_day' }, week: [...wk, ropeTue], ctx: bzCtx(MON + 1, [...wk, ropeTue]), held: new Set() }).length === 0, 'R4: rope for a run-walk moves nothing')

// ─── Thursday 7:30 PM: + Skip Rope after run-walk and bag ────
let thu = set(tueWeek, 'bag-tue', { status: 'completed' })
thu = set(thu, 'mobility-2', { status: 'completed' })
thu = set(thu, 'strength-2', { status: 'completed', eased: false })
thu = set(thu, 'mobility-3', { status: 'completed' })
thu = set(thu, 'foundation_run-3', { status: 'completed' })
thu = set(thu, 'bag-3', { status: 'completed' })
const rope: RebalanceSession = { id: 'rope-thu', type: 'skip_rope', label: 'Skip Rope', epochDay: MON + 3, timeSlot: 'pm', status: 'planned' }
const thuWeek = [...thu, rope]
const add = rebalance({ action: { kind: 'add', session: rope, reason: null }, week: thuWeek, ctx: bzCtx(MON + 3, thuWeek), held: new Set() })
assert(add.length === 1 && add[0].rule === 'R5b' && add[0].sessionId === 'foundation_run-5', `Saturday's run-walk is the one change (${add.map(c => `${c.rule}:${c.sessionId}`).join(',')})`)
assert(add[0].ease?.kind === 'rounds' && add[0].ease.rounds === 4 && add[0].ease.minutes === 23 && add[0].ease.fromMinutes === 28, '5 rounds -> 4 rounds, 28 min -> 23 min')
assert(add[0].show.before === '5 ROUNDS' && add[0].show.after === '4 ROUNDS', 'flaps: 5 ROUNDS -> 4 ROUNDS')
assert(renderWhy(add[0].why, MON + 3) === 'Run-walk, bag and rope today. Saturday is 4 rounds, not 5: 23 min, not 28.', `the day's back on Thursday: ${renderWhy(add[0].why, MON + 3)}`)
assert(renderWhy(add[0].why, MON + 5, 'log') === 'Run-walk, bag and rope Thursday. 4 rounds, not 5: 23 min.', `the week log on Saturday: ${renderWhy(add[0].why, MON + 5, 'log')}`)
assert(renderWhy(add[0].put.line, MON + 3) === "Saturday's run-walk is 5 rounds again.", 'put back, read on Thursday')

// ─── Friday: Strength C missed -> its main lifts into Monday's A ──
const nextMon = MON + 7
const missed = missedFix(
  { id: 'strength-4', type: 'strength', label: 'Strength C', epochDay: MON + 4, timeSlot: 'am', status: 'missed' },
  [{ id: 'a-next', type: 'strength', label: 'Strength A', epochDay: nextMon, timeSlot: 'am', status: 'planned' }],
  { blockType: 'block_zero', weekNumber: 4, nextWeekNumber: 5 },
)
assert(missed.kind === 'merge' && missed.targetSessionId === 'a-next', "missed C: Monday's Strength A takes its main lifts")
if (missed.kind === 'merge') {
  assert(missed.why === "Strength C missed. Its main lifts move into Monday's Strength A; accessories dropped.", `why: ${missed.why}`)
  assert(missed.detail === 'Row and reverse lunge, 2×8 each. Monday runs about 75 min, not 60.', `detail: ${missed.detail}`)
  assert(missed.show.before === 'FRI C' && missed.show.after === 'INTO MON A', 'flaps: FRI C -> INTO MON A')
  assert(missed.merged.exerciseIds.includes('ex-reverse-lunge') && missed.merged.sets === 2, 'the merged lifts: row and reverse lunge, 2 sets each')
  assert(missed.put.line === 'Monday is Strength A as written.' && missed.put.dim === 'Strength C stays missed. Nothing else moves.', 'put back lines')
}
const pending = missedFix({ id: 'c', type: 'strength', label: 'Strength C', epochDay: MON + 4, timeSlot: 'am', status: 'missed' }, [], { blockType: 'block_zero', weekNumber: 4, nextWeekNumber: 5, nextStrength: { epochDay: nextMon, label: 'Strength A' } })
assert(pending.kind === 'merge' && pending.targetSessionId == null && pending.targetDay === nextMon, 'next week not prepared yet: the fix waits for Monday A')
const runMiss = missedFix({ id: 'r', type: 'foundation_run', label: 'Run-Walk', epochDay: MON + 1, timeSlot: 'am', status: 'missed' }, [], { blockType: 'block_zero', weekNumber: 4 })
assert(runMiss.kind === 'let_go' && /don't stack/.test(runMiss.why), 'a missed run is not made up: runs don\'t stack')
const far = missedFix({ id: 'c', type: 'strength', label: 'Strength C', epochDay: MON + 4, timeSlot: 'am', status: 'missed' }, [{ id: 'x', type: 'strength', label: 'Strength A', epochDay: MON + 12, timeSlot: 'am', status: 'planned' }], { blockType: 'block_zero', weekNumber: 4 })
assert(far.kind === 'let_go', 'no strength day in reach: it goes')

// ─── R1: a skipped run moves to the next day without a run ───
const skipWeek = set(week4(MON), 'foundation_run-1', { status: 'skipped' })
const skipRun = skipWeek.find(s => s.id === 'foundation_run-1') as RebalanceSession
const r1 = rebalance({ action: { kind: 'skip', session: skipRun, reason: null }, week: skipWeek, ctx: bzCtx(MON + 1, skipWeek), held: new Set() })
assert(r1.length === 1 && r1[0].rule === 'R1' && r1[0].move?.epochDay === MON + 2 && r1[0].move.timeSlot === 'pm', 'R1: the run-walk moves to Wednesday PM, after the lifting')
assert(r1[0].why === 'Moved, not dropped. Wednesday is the nearest day without a run.' && r1[0].detail === 'It goes after Strength B, 10 hours apart.', 'R1 lines')
const satSkip = set(week4(MON), 'foundation_run-5', { status: 'skipped' })
const r2 = rebalance({ action: { kind: 'skip', session: satSkip.find(s => s.id === 'foundation_run-5') as RebalanceSession, reason: null }, week: satSkip, ctx: bzCtx(MON + 5, satSkip), held: new Set() })
assert(r2.every(c => c.rule !== 'R1'), 'R2: Sunday is the rest day, so Saturday\'s run goes (nothing stacks)')

// R8 on a skip for stress: tomorrow's hard session eases.
const r8 = rebalance({ action: { kind: 'skip', session: skipRun, reason: 'rough_day' }, week: skipWeek, ctx: bzCtx(MON + 1, skipWeek), held: new Set() })
assert(r8.some(c => c.rule === 'R8' && c.sessionId === 'strength-2'), 'a rough-day skip eases tomorrow\'s Strength B')
assert(r8.length <= MAX_COACH_CHANGES, 'never more than two changes')

// ─── R11: lifting two days running (pull forward on Tuesday) ──
const pulled = set(set(week4(MON), 'strength-0', { status: 'completed' }), 'strength-4', { epochDay: MON + 1 })
const pick = pulled.find(s => s.id === 'strength-4') as RebalanceSession
const r11 = rebalance({ action: { kind: 'pull_forward', session: pick, reason: null }, week: pulled, ctx: bzCtx(MON + 1, pulled), held: new Set() })
assert(r11.some(c => c.rule === 'R11' && c.sessionId === 'strength-2' && c.show.after === '2×8') || r11.some(c => c.sessionId === 'strength-2'), `Wednesday's B eases after C comes to Tuesday (${r11.map(c => c.rule).join(',')})`)
assert(r11.every(c => c.sessionId !== pick.id), 'his pick is never touched')

// ─── R6: heavy legs 24 h from a hard class (Fighter) ─────────
const fMon: RebalanceSession = { id: 'str', type: 'strength', label: null, epochDay: MON + 1, timeSlot: 'am', status: 'planned' }
const cls: RebalanceSession = { id: 'mt', type: 'mt_class', label: 'MT Class', epochDay: MON + 1, timeSlot: 'pm', status: 'planned' }
const fWeek = [fMon, cls]
const r6 = rebalance({ action: { kind: 'add', session: fMon, reason: null }, week: fWeek, ctx: ctx({ todayEpochDay: MON + 1, sessions: fWeek }), held: new Set() })
assert(r6.length === 1 && r6[0].rule === 'R6' && r6[0].sessionId === 'mt' && r6[0].kind === 'move' && r6[0].move?.epochDay === MON + 2, 'R6: the class moves a day, never his lifting')

// ─── R7: no long run within 24 h after heavy legs ────────────
const longRun: RebalanceSession = { id: 'lr', type: 'running', label: null, notes: 'progression', epochDay: MON + 2, timeSlot: 'am', status: 'planned' }
const fPm: RebalanceSession = { ...fMon, id: 'str-pm', timeSlot: 'pm' }
const r7Week = [fPm, longRun]
const r7 = rebalance({ action: { kind: 'add', session: fPm, reason: null }, week: r7Week, ctx: ctx({ todayEpochDay: MON + 1, sessions: r7Week }), held: new Set() })
assert(r7.some(c => (c.rule === 'R7' || c.rule === 'R6') && c.sessionId === 'lr'), `the long run the next morning eases or moves (${r7.map(c => c.rule).join(',')})`)

// ─── Load: past the plan, the next hard session eases (only when nothing else did) ──
const fullWeek = week4(MON)
const extraRun: RebalanceSession = { id: 'xr', type: 'running', notes: 'zone2', label: null, epochDay: MON + 1, timeSlot: 'pm', status: 'planned' }
const loadWeek = [...fullWeek, extraRun]
const lw = rebalance({ action: { kind: 'add', session: extraRun, reason: null }, week: loadWeek, ctx: bzCtx(MON + 1, loadWeek, { planWeekLoad: planLoad(fullWeek, 4) }), held: new Set() })
assert(lw.length <= MAX_COACH_CHANGES && lw.every(c => houseVoice(renderWhy(c.why, MON + 1))), 'every line in house voice, no jargon')

// ─── R3: one swap mustn't shrink next week's runs ────────────
// Week 3: three run-walks of 26 min (78 min). Week 4: one swapped for bag, two of 27.5 min.
const week3Sec = 3 * 26 * 60
const week4Sec = 2 * 1650
assert(weeklyRunAllowanceSec(runAllowanceBaseSec(week4Sec, week3Sec)) >= 3 * 30 * 60, `R3: week 5's three 30 min run-walks still fit (${Math.round(weeklyRunAllowanceSec(runAllowanceBaseSec(week4Sec, week3Sec)) / 60)} min)`)
assert(weeklyRunAllowanceSec(week4Sec) < 3 * 30 * 60, 'without R3 the swap would have shrunk week 5')

console.log('rebalance tests passed')
