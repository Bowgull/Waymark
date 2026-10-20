// Run: tsx src/lib/blockZero/guardrails.test.ts
//
// Every guardrail rule, fed crafted AI outputs, adversarial ones included:
// classes the planner may not schedule, a class on the rest day, a 50-min run after a 20-min
// longest, three strength days in a row, loads above the rules' next load.

import type { ReactiveReplanOutput, WeekPlanOutput } from '../prompts/tools'
import {
  capLoad,
  checkPlacement,
  guardCalibrationStarts,
  guardCalibrationWrites,
  guardLoadProposals,
  guardMtCap,
  guardReactiveReplan,
  guardWeekPlan,
  houseVoice,
  isBlockZeroRestDay,
  type BlockZeroGuardContext,
  type Clamp,
  type GuardSession,
} from './guardrails'
import { getBlockZeroWeekTemplate } from './weekPlan'
import { nextLoad } from './strength'
import { retestCeilingKg } from './testData'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
  console.log(`ok: ${msg}`)
}

const has = (clamps: Clamp[], code: Clamp['code']) => clamps.some(c => c.code === code)
const voiceOk = (s: string) => !/[!—–]/.test(s) && s.trim().length > 0

let MON = 20000
while (new Date(MON * 86400000).getUTCDay() !== 1) MON++
const dowOf = (d: number) => new Date(d * 86400000).getUTCDay()
const dayFor = (dow: number) => MON + ((dow + 6) % 7)

/** The rules' own week as a WeekPlanOutput (what a perfect AI would return). */
function templatePlan(week: number): WeekPlanOutput {
  const t = getBlockZeroWeekTemplate(week)
  return {
    narrative: 'Week as planned.',
    days: [0, 1, 2, 3, 4, 5, 6].map(d => ({ dayOfWeek: d, sessions: t[d].map(s => ({ type: s.type as never, timeSlot: s.timeSlot, label: s.label, estimatedMin: s.estimatedMin })) })),
    mtSessionsThisWeek: 0,
  }
}

const hardCount = (p: WeekPlanOutput) => p.days.flatMap(d => d.sessions).filter(s => s.type !== 'mobility' && s.type !== 'active_recovery').length
const day = (p: WeekPlanOutput, dow: number) => p.days.find(d => d.dayOfWeek === dow)?.sessions ?? []

// ─── House voice ────────────────────────────────────────────────

assert(houseVoice('Big week — go hard!') === 'Big week, go hard.', 'em dash and exclamation mark cleaned')
assert(houseVoice('Steady. Hold.') === 'Steady. Hold.', 'clean text untouched')

// ─── Week plan: rules-only output passes untouched ──────────────

for (const w of [1, 2, 3, 4, 5, 6, 7, 8]) {
  const g = guardWeekPlan(templatePlan(w), { weekNumber: w })
  assert(g.clamps.length === 0, `week ${w}: the rules' own week passes with no clamps`)
}
{
  // With run history that allows the plan (week 3 after a 24-min longest, 72 min last week).
  const g = guardWeekPlan(templatePlan(3), { weekNumber: 3, run: { longestLast30Sec: 24 * 60 + 15, lastWeekRunSec: 73 * 60 } })
  assert(g.clamps.length === 0, 'week 3 with normal run history: no clamps')
}

// ─── Week plan: adversarial outputs ─────────────────────────────

{
  // Week 1: sparring on Tuesday, a class on Sunday, bag work Sunday, mtSessionsThisWeek 2.
  const p = templatePlan(1)
  day(p, 2).push({ type: 'mt_class', timeSlot: 'pm', label: 'Sparring', estimatedMin: 90 })
  day(p, 0).push({ type: 'mt_class', timeSlot: 'pm', label: 'MT Class', estimatedMin: 60 })
  day(p, 0).push({ type: 'bag_work', timeSlot: 'am', label: 'Bag', estimatedMin: 30 })
  p.mtSessionsThisWeek = 2
  const g = guardWeekPlan(p, { weekNumber: 1 })
  const all = g.output.days.flatMap(d => d.sessions)
  assert(!all.some(s => s.type === 'mt_class'), 'the planner never schedules classes in Block Zero (he adds them); the rest-day class goes too')
  assert(g.output.mtSessionsThisWeek === 0, 'mtSessionsThisWeek forced to 0')
  assert(day(g.output, 0).every(s => s.type === 'mobility'), 'Sunday keeps back care only')
  assert(has(g.clamps, 'mt_class_dropped') && has(g.clamps, 'rest_day'), 'clamps: mt_class_dropped, rest_day')
  assert(g.clamps.every(c => voiceOk(c.reason) && c.detail.length > 0), 'every clamp has a machine detail and a house-voice reason')
}
{
  // 50-min run after a 20-min longest (week 3).
  const p = templatePlan(3)
  day(p, 2)[1] = { type: 'foundation_run', timeSlot: 'am', label: 'Run-Walk', estimatedMin: 50 }
  const g = guardWeekPlan(p, { weekNumber: 3, run: { longestLast30Sec: 20 * 60, lastWeekRunSec: 60 * 60 } })
  const tue = day(g.output, 2).find(s => s.type === 'foundation_run')
  assert(tue != null && tue.estimatedMin <= 22, `50-min run after a 20-min longest is capped at 110% (${tue?.estimatedMin} min)`)
  assert(has(g.clamps, 'duration') && has(g.clamps, 'run_single_cap'), 'clamps: duration (over the plan) and run_single_cap')
  const runs = g.output.days.flatMap(d => d.sessions).filter(s => s.type === 'foundation_run')
  assert(runs.reduce((n, s) => n + s.estimatedMin, 0) <= 78, 'week run total within +30% of last week (78 min)')
}
{
  // Weekly cap: last week 40 min (under the week-1 floor of 69), plan has 3 x 26.
  const g = guardWeekPlan(templatePlan(3), { weekNumber: 3, run: { longestLast30Sec: 26 * 60, lastWeekRunSec: 40 * 60 } })
  const total = g.output.days.flatMap(d => d.sessions).filter(s => s.type === 'foundation_run').reduce((n, s) => n + s.estimatedMin, 0)
  assert(total <= 69 && total >= 60 && has(g.clamps, 'run_weekly_cap'), `weekly run cap floors at week-1 volume: ${total} min <= 69, not 52 (130% of 40)`)
}
{
  // Three strength days in a row, wrong labels.
  const p = templatePlan(3)
  day(p, 1)[1].label = 'Strength C'
  day(p, 2).push({ type: 'strength', timeSlot: 'am', label: 'Strength B', estimatedMin: 60 })
  day(p, 3)[1].label = 'Strength A'
  const g = guardWeekPlan(p, { weekNumber: 3 })
  const strengthDays = g.output.days.filter(d => d.sessions.some(s => s.type === 'strength')).map(d => d.dayOfWeek)
  assert(strengthDays.join(',') === '1,3,5', `strength only Mon/Wed/Fri (${strengthDays.join(',')})`)
  assert(day(g.output, 1).find(s => s.type === 'strength')?.label === 'Strength A' && day(g.output, 3).find(s => s.type === 'strength')?.label === 'Strength B', 'labels A/B/C restored')
  assert(has(g.clamps, 'strength_day') && has(g.clamps, 'strength_label'), 'clamps: strength_day, strength_label')
}
{
  // 'running' becomes a run-walk; rope on Saturday has no slot; bag work Wednesday has none either.
  const p = templatePlan(3)
  day(p, 4)[1] = { type: 'running', timeSlot: 'am', label: 'Tempo', estimatedMin: 26, runCategory: 'progression' }
  day(p, 6)[1] = { type: 'skip_rope', timeSlot: 'am', label: 'Rope', estimatedMin: 15 }
  day(p, 3).push({ type: 'bag_work', timeSlot: 'pm', label: 'Bag', estimatedMin: 40 })
  const g = guardWeekPlan(p, { weekNumber: 3 })
  const thu = day(g.output, 4).find(s => s.type === 'foundation_run')
  assert(thu?.label === 'Run-Walk' && thu.runCategory == null && has(g.clamps, 'run_type'), 'running becomes a run-walk, no tempo category')
  assert(!day(g.output, 6).some(s => s.type === 'skip_rope') && !day(g.output, 3).some(s => s.type === 'bag_work'), 'off-template sessions dropped')
  assert(has(g.clamps, 'off_template'), 'clamp: off_template')
  assert(hardCount(g.output) <= hardCount(templatePlan(3)), 'never more hard sessions than the rules planned')
}
{
  // Rope allowed on Tue as the alternative; walk instead of Thursday's run is fine.
  const p = templatePlan(3)
  day(p, 2)[1] = { type: 'skip_rope', timeSlot: 'am', label: 'Rope', estimatedMin: 20 }
  day(p, 4)[1] = { type: 'active_recovery', timeSlot: 'am', label: 'Easy Walk', estimatedMin: 25, notes: 'Legs heavy from Wednesday. Walk instead.' }
  const g = guardWeekPlan(p, { weekNumber: 3 })
  assert(day(g.output, 2).some(s => s.type === 'skip_rope') && day(g.output, 4).some(s => s.type === 'active_recovery'), 'allowed alternative and a softer session pass')
  assert(day(g.output, 4).find(s => s.type === 'active_recovery')?.notes === 'Legs heavy from Wednesday. Walk instead.', 'the one-line why in notes survives')
  assert(g.clamps.length === 0, 'no clamps for allowed choices')
}
{
  // AI drops Friday strength in a build week: not re-added. Drops Tuesday back care: restored.
  const p = templatePlan(4)
  p.days[5].sessions = p.days[5].sessions.filter(s => s.type !== 'strength')
  p.days[2].sessions = p.days[2].sessions.filter(s => s.type !== 'mobility')
  const g = guardWeekPlan(p, { weekNumber: 4 })
  assert(!day(g.output, 5).some(s => s.type === 'strength'), 'build week: a dropped strength day is not re-added')
  assert(day(g.output, 2).some(s => s.type === 'mobility') && has(g.clamps, 'back_care'), 'back care restored daily')
}
{
  // Test week: dropped strength comes back; a rope session added on Monday has no slot (the fixed-effort test is gone).
  const p = templatePlan(1)
  p.days[3].sessions = p.days[3].sessions.filter(s => s.type !== 'strength')
  day(p, 1).push({ type: 'skip_rope', timeSlot: 'am', label: 'Rope: Fixed-Effort Test', estimatedMin: 20 })
  const g = guardWeekPlan(p, { weekNumber: 1 })
  assert(day(g.output, 3).some(s => s.type === 'strength' && s.label === 'Strength B'), 'test week: Strength B restored')
  assert(!day(g.output, 1).some(s => s.type === 'skip_rope'), 'test week: no rope test session')
}
{
  // Week 6: Monday back in its order (Foundation, then Strength A); no rope test any more.
  const p = templatePlan(6)
  const mon = day(p, 1)
  mon.reverse()
  const g = guardWeekPlan(p, { weekNumber: 6 })
  const out = day(g.output, 1)
  assert(out.map(s => s.type).join(',') === 'mobility,strength', 'week 6 Monday: Foundation then Strength A, no rope test')
}
{
  // Duration bounds and bad days; voice.
  const p = templatePlan(2)
  day(p, 1)[1].estimatedMin = 200
  day(p, 0)[0].estimatedMin = 1
  p.days.push({ dayOfWeek: 9, sessions: [{ type: 'strength', timeSlot: 'am', label: 'Strength D', estimatedMin: 60 }] })
  p.narrative = 'Huge week — let’s go!'
  const g = guardWeekPlan(p, { weekNumber: 2 })
  assert(day(g.output, 1).find(s => s.type === 'strength')!.estimatedMin === 75 && day(g.output, 0)[0].estimatedMin === 5, 'minutes clamped to sane bounds')
  assert(has(g.clamps, 'bad_day') && !g.output.days.some(d => d.dayOfWeek === 9), 'a day outside 0-6 is dropped')
  assert(voiceOk(g.output.narrative) && has(g.clamps, 'voice'), 'narrative cleaned to the house voice')
}

// ─── Mid-week context ───────────────────────────────────────────

function weekSessions(week: number, today: number): GuardSession[] {
  const t = getBlockZeroWeekTemplate(week)
  const out: GuardSession[] = []
  for (let k = 0; k < 7; k++) {
    const d = MON + k
    for (const s of t[dowOf(d)]) out.push({ id: `${d}-${s.type}`, type: s.type, epochDay: d, timeSlot: s.timeSlot, status: d < today ? 'completed' : 'planned', label: s.label })
  }
  return out
}

function ctx(today: number, over: Partial<BlockZeroGuardContext> = {}): BlockZeroGuardContext {
  return {
    weekNumber: 3,
    todayEpochDay: today,
    sessions: weekSessions(3, today),
    readinessEase: false,
    loadFlag: false,
    easeReason: null,
    run: { longestLast30Sec: 26 * 60, lastWeekRunSec: 75 * 60, thisWeekRunSec: 26 * 60 },
    mt: { weeksSinceFirstClass: null, classesThisWeek: 0, profileCap: null },
    ...over,
  }
}

const WED = dayFor(3)
const replan = (o: Partial<ReactiveReplanOutput>): ReactiveReplanOutput => ({
  note: 'Shift.',
  shiftAction: 'swap',
  shiftReason: 'Thursday changes.',
  targetSessionType: 'mobility',
  targetLabel: 'Mobility',
  targetDay: 4,
  targetTimeSlot: 'am',
  ...o,
})

assert(isBlockZeroRestDay(3, 0) && !isBlockZeroRestDay(3, 1), 'Sunday is the rest day')

// ─── Reactive replan ────────────────────────────────────────────

{
  const g = guardReactiveReplan(replan({ shiftAction: 'hold', targetSessionType: 'strength', targetLabel: 'Strength B', targetDay: 3 }), ctx(WED))
  assert(g.clamps.length === 0 && g.output.shiftAction === 'hold', 'hold passes untouched')
}
{
  // The AI swaps Thursday's run into "Sparring": the coach may place a class night, never name its kind.
  const g = guardReactiveReplan(replan({ targetSessionType: 'mt_class', targetLabel: 'Sparring', targetTimeSlot: 'pm', originalSessionId: `${dayFor(4)}-foundation_run` }), ctx(WED))
  assert(g.output.targetSessionType === 'mt_class' && g.output.targetLabel === 'MT Class', `a class the coach places is just a class (${g.output.targetLabel})`)
  assert(has(g.clamps, 'mt_class_content') && g.clamps.every(c => !/technique|pads|clinch/i.test(c.reason)), 'clamp: mt_class_content, and no class type suggested')
}
{
  // Any kind of class asked for, any week: the label is plain and nothing is suggested instead.
  const early = guardReactiveReplan(replan({ targetSessionType: 'mt_class', targetLabel: 'Clinch', targetTimeSlot: 'pm' }), ctx(WED))
  const later = guardReactiveReplan(replan({ targetSessionType: 'mt_class', targetLabel: 'Technique', targetTimeSlot: 'pm' }), ctx(WED, { mt: { weeksSinceFirstClass: 2, classesThisWeek: 0, profileCap: null } }))
  assert(early.output.targetLabel === 'MT Class' && later.output.targetLabel === 'MT Class', 'the coach never picks a kind of class, early or late')
}
{
  // Class cap reached: refused, the week holds.
  const g = guardReactiveReplan(replan({ targetSessionType: 'mt_class', targetLabel: 'Technique', targetTimeSlot: 'pm' }), ctx(WED, { mt: { weeksSinceFirstClass: 0, classesThisWeek: 2, profileCap: null } }))
  assert(g.output.shiftAction === 'hold' && has(g.clamps, 'mt_class_cap') && voiceOk(g.output.shiftReason), 'class over the cap refused, week holds with a reason')
}
{
  // Add strength today on an ease day: refused, the rules' auto-ease takes over.
  const c = ctx(WED, { readinessEase: true, easeReason: 'Sleep and energy are off your 7-day trend for 2 days.' })
  const g = guardReactiveReplan(replan({ shiftAction: 'add_recovery', targetSessionType: 'strength', targetLabel: 'Strength', targetDay: 3 }), c)
  assert(has(g.clamps, 'ease_day'), 'hard session on an ease day refused')
  assert(g.output.shiftAction === 'reduce_intensity' && g.output.targetSessionType === 'strength' && g.output.shiftReason.startsWith('Sleep and energy'), `auto-ease preferred: ${g.output.shiftReason}`)
}
{
  // Load flag on: a swap into a run becomes an easy walk or bike.
  const c = ctx(WED, { loadFlag: true, easeReason: 'Load is up 25% on last week.' })
  const g = guardReactiveReplan(replan({ targetSessionType: 'foundation_run', targetLabel: 'Run-Walk', targetDay: 4, originalSessionId: `${dayFor(4)}-foundation_run` }), c)
  assert(g.output.targetSessionType === 'active_recovery' && has(g.clamps, 'load_flag'), 'load flag: added run becomes walk or bike')
}
{
  // An extra run on Friday breaks the weekly cap (75 min last week -> 97 allowance; 26 done + 2 planned + 1 new = 104).
  const g = guardReactiveReplan(replan({ shiftAction: 'add_recovery', targetSessionType: 'foundation_run', targetLabel: 'Run-Walk', targetDay: 5, targetTimeSlot: 'pm' }), ctx(WED))
  assert(has(g.clamps, 'run_weekly_cap') && g.output.shiftAction === 'hold', 'extra run past +30% weekly refused')
}
{
  // No runs in 30 days: a week-3 run-walk (26 min) is past the week-1 restart.
  const c = ctx(WED, { run: { longestLast30Sec: null, lastWeekRunSec: 0, thisWeekRunSec: 0 } })
  const g = guardReactiveReplan(replan({ targetSessionType: 'foundation_run', targetLabel: 'Run-Walk', targetDay: 4, originalSessionId: `${dayFor(4)}-foundation_run` }), c)
  assert(has(g.clamps, 'run_single_cap'), 'run over 110% of the 30-day longest refused')
}
{
  // Move Friday's strength to Thursday: back to back with Wednesday.
  const g = guardReactiveReplan(replan({ shiftAction: 'move', targetSessionType: 'strength', targetLabel: 'Strength C', targetDay: 4, originalSessionId: `${dayFor(5)}-strength` }), ctx(WED))
  assert(has(g.clamps, 'strength_back_to_back') && g.output.shiftAction === 'hold', 'strength days back to back refused')
}
{
  // Move Friday's strength onto Wednesday (already a strength day).
  const g = guardReactiveReplan(replan({ shiftAction: 'move', targetSessionType: 'strength', targetLabel: 'Strength C', targetDay: 3, originalSessionId: `${dayFor(5)}-strength` }), ctx(WED))
  assert(has(g.clamps, 'strength_same_day'), 'two strength sessions on one day refused')
}
{
  // Move Saturday's run onto Friday (strength AM): the run goes to PM.
  const ok = guardReactiveReplan(replan({ shiftAction: 'move', targetSessionType: 'foundation_run', targetLabel: 'Run-Walk', targetDay: 5, targetTimeSlot: 'am', originalSessionId: `${dayFor(6)}-foundation_run` }), ctx(WED))
  assert(ok.output.shiftAction === 'move' && ok.output.targetTimeSlot === 'pm' && has(ok.clamps, 'strength_order'), 'run on a strength day goes after strength')
  // Same move when Friday's strength sits in the PM: wrong order, refused.
  const c = ctx(WED)
  c.sessions = c.sessions.map(s => (s.type === 'strength' && s.epochDay === dayFor(5) ? { ...s, timeSlot: 'pm' } : s))
  const bad = guardReactiveReplan(replan({ shiftAction: 'move', targetSessionType: 'foundation_run', targetLabel: 'Run-Walk', targetDay: 5, targetTimeSlot: 'am', originalSessionId: `${dayFor(6)}-foundation_run` }), c)
  assert(bad.output.shiftAction === 'hold' && has(bad.clamps, 'strength_order'), 'run before strength on the same day refused')
}
{
  // Past day; reduce_intensity on a sparring-labelled class.
  const past = guardReactiveReplan(replan({ targetDay: 1 }), ctx(WED))
  assert(has(past.clamps, 'bad_day') && past.output.shiftAction === 'hold', 'a past day is refused')
  const soft = guardReactiveReplan(replan({ shiftAction: 'reduce_intensity', targetSessionType: 'mt_class', targetLabel: 'Sparring', targetDay: 4 }), ctx(WED))
  assert(soft.output.shiftAction === 'hold' && has(soft.clamps, 'mt_class_content'), 'an ease on a class holds: never "go light in class"')
  assert(soft.output.targetLabel === 'Sparring', 'the class itself is left as it is')
}
{
  // Rest day: anything hard placed on Sunday is refused.
  const sun = dayFor(0)
  const r = checkPlacement({ type: 'mt_class', label: 'MT Class', epochDay: sun, timeSlot: 'pm', adds: true }, ctx(sun))
  assert(!r.ok && r.clamp.code === 'rest_day', 'MT on the rest day refused')
}

// ─── Loads ──────────────────────────────────────────────────────

{
  const limit = nextLoad({ weightKg: 60, reps: 8, rpe: 7.5 }, { reps: 8, rpe: [7, 8] }, 'lower')
  const g = guardLoadProposals([{ exerciseId: 'ex-front-squat', weightKg: 80 }, { exerciseId: 'ex-ohp', weightKg: 40 }], new Map([['ex-front-squat', limit]]))
  assert(g.output.length === 1 && g.output[0].weightKg === 60 && has(g.clamps, 'load_cap'), 'load above nextLoad capped (80 -> 60); lift with no rules load left to the rules')
  assert(capLoad(50, 60, 'x', 'r').clamp === null, 'load under the limit passes')
}
{
  const ceilings = new Map([['ex-bench-press', 60]])
  const resolve = (name: string) => ({ 'Bench Press': 'ex-bench-press', 'Front Squat': 'ex-front-squat' } as Record<string, string>)[name] ?? null
  const starts = [{ exerciseName: 'Bench Press', startingWeightKg: 90, rationale: 'Strong lifter!' }, { exerciseName: 'Front Squat', startingWeightKg: 100, rationale: 'Guess.' }]
  const tested = guardCalibrationStarts(starts, resolve, ceilings)
  assert(tested.writes.length === 1 && tested.writes[0].weightKg === 60, 'calibration above the week-1 ceiling capped; untested lift not written once tests exist')
  assert(has(tested.clamps, 'calibration_cap') && has(tested.clamps, 'calibration_untested') && voiceOk(tested.output[0].rationale), 'clamps: calibration_cap, calibration_untested')
  const fresh = guardCalibrationStarts(starts, resolve, new Map())
  assert(fresh.writes.length === 0 && fresh.clamps.every(c => c.code === 'calibration_untested'), 'no tests yet: no untested max is written (map #8)')
}
{
  assert(guardMtCap(5).value === 3 && guardMtCap(2).clamp === null && guardMtCap(-1).value === 0, 'MT cap kept to 0-3')
  const writes = [
    { exerciseId: 'ex-bench-press', weightKg: 100, source: 'ai' as const },
    { exerciseId: 'ex-ohp', weightKg: 40, source: 'ai' as const },
    { exerciseId: 'ex-front-squat', weightKg: 90, source: 'retest' as const },
  ]
  const e1rms = new Map([['ex-bench-press', 80], ['ex-front-squat', 100]])
  const proceed = guardCalibrationWrites(writes, e1rms, 'proceed', retestCeilingKg)
  const adjust = guardCalibrationWrites(writes, e1rms, 'adjust', retestCeilingKg)
  assert(proceed.output[0].weightKg === 72 && adjust.output[0].weightKg === 68, 'AI target capped at 90% of the retest e1RM, 85% on adjust')
  assert(proceed.output[1].weightKg === 40 && proceed.output[2].weightKg === 90, 'no retest data or retest-sourced: untouched')
}

console.log('\nBlock Zero guardrails passed')
