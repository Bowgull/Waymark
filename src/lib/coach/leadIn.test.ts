// Run: tsx src/lib/coach/leadIn.test.ts
// Block Zero lead-in (Part B): start each weekday Mon..Sun, the local start
// day, the intro strength session, felt-hard by Block Zero week, and the
// lead-in limits in placement.
import { countsFromDay, inLeadIn, optionalDay, pickWeekPlan, planDayTemplate, startedAtForLocalDay } from './leadIn'
import { hasCoachEase, whyThisWeek } from './weeklyPass'
import { anchorMondayFor } from './weekCounter'
import { checkSessionChange } from './placement'
import { blockZeroEffortTarget, consistentlyEasier, effortVerdict, noEasierReadFor, summarizeEffort, type EffortRead } from './effort'
import { bagRules } from './bag'
import { getStrengthTemplate } from '../strengthTemplates'
import { LEAD_IN_TARGET, introStartLoad } from '../blockZero/strength'
import { isoToEpochDay } from '../dates'
import { MON, assert, ctx, s } from './testUtil'

const MT = new Set([1, 3, 5])
const types = (start: number, day: number) => planDayTemplate({ blockType: 'block_zero', startDay: start, epochDay: day, weekNumber: 1, mtDays: MT }).sessions.map(x => x.type).join('+')
const houseVoice = (t: string) => !/[!—–]/.test(t)

// ─── Start each weekday Mon..Sun (coach brain P2: no lead-in) ─
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
for (let i = 0; i < 7; i++) {
  const start = MON + i
  assert(anchorMondayFor(start, 'block_zero') === MON && countsFromDay('block_zero', start) === MON, `${DOW[i]} start: its week is week 1`)
  const before = Array.from({ length: i }, (_, k) => MON + k)
  assert(before.every(d => planDayTemplate({ blockType: 'block_zero', startDay: start, epochDay: d, weekNumber: 1, mtDays: MT }).sessions.length === 0), `${DOW[i]} start: no sessions on the ${i} day(s) before it`)
  assert(!inLeadIn('block_zero', start, start) && !optionalDay('block_zero', start, start), `${DOW[i]} start: day 1 counts, nothing optional`)
  // Day 1 is the most reliable session, Strength A (Sunday stays rest).
  if (i < 6) assert(types(start, start) === 'mobility+strength' && planDayTemplate({ blockType: 'block_zero', startDay: start, epochDay: start, weekNumber: 1, mtDays: MT }).sessions.some(x => x.label === 'Strength A'), `${DOW[i]} start: day 1 is Foundation + Strength A`)
  else assert(types(start, start) === 'mobility', 'Sun start: day 1 is rest with Foundation')
  if (i < 5) assert(types(start, start + 1) === 'mobility+foundation_run', `${DOW[i]} start: day 2 is the first run-walk`)
}
assert(types(MON + 3, MON + 6) === 'mobility', 'Thu start: Sunday stays rest')
assert(types(MON + 3, MON + 7) === 'mobility+strength', 'Thu start: the next Monday is the normal week')
assert(planDayTemplate({ blockType: 'fighter', startDay: MON + 2, epochDay: MON + 1, weekNumber: 1, mtDays: MT }).sessions.length === 0, 'Fighter: nothing before the start either')
assert(!planDayTemplate({ blockType: 'fighter', startDay: MON + 2, epochDay: MON + 3, weekNumber: 1, mtDays: MT }).leadIn, 'Fighter has no lead-in template')

// ─── Local start day (D4) ────────────────────────────────────
// Wednesday 21:00 in Toronto is Thursday 01:00 UTC. The client's local date wins.
const wedLocal = isoToEpochDay('2026-10-21')
const utcThu = Math.floor(Date.UTC(2026, 9, 22, 1, 0) / 86400000)
const stored = startedAtForLocalDay(wedLocal)
assert(utcThu === wedLocal + 1 && Math.floor(stored / 86400) === wedLocal, 'Wednesday-evening start: stored as Wednesday (noon UTC of the local date), not Thursday')

// ─── The intro template is gone with the lead-in (coach brain P2) ─
const full = getStrengthTemplate(1, 1, 'block_zero', 'Strength A')
assert(full.exercises.some(e => e.exerciseId === 'ex-neck-iso-4way'), 'week 1 keeps its durability finisher')
void LEAD_IN_TARGET
void introStartLoad

// ─── Felt hard / felt easy by Block Zero week (D5) ───────────
const bzStrength = (week: number, rpe: number | null, rir: number | null, leadIn = false): EffortRead => {
  const info = { type: 'strength', blockType: 'block_zero', blockWeek: week, leadIn, weekNumber: week }
  return { epochDay: MON, type: 'strength', rpe, rir, target: blockZeroEffortTarget(info), noEasierRead: noEasierReadFor(info) }
}
assert(effortVerdict(bzStrength(1, 7, 3)) === 'on_target' && effortVerdict(bzStrength(2, 6, 3)) === 'on_target', 'weeks 1-2: RPE 6-7 with "3 or more" (logged 3) left is on target')
assert(effortVerdict({ epochDay: MON, type: 'strength', rpe: 7, rir: 3 }) === 'easier', 'the fixed RPE 7 / 2 RIR target would have read it as easier (the bug)')
assert(effortVerdict(bzStrength(2, 9, null)) === 'way_harder' && effortVerdict(bzStrength(2, 8, null)) === 'harder', 'weeks 1-2: RPE 8 harder, RPE 9 way harder')
assert(effortVerdict(bzStrength(4, 7, 3)) === 'easier' && effortVerdict(bzStrength(4, 8, 2)) === 'on_target', 'weeks 3-5: "3 or more" left reads easier than RPE 7-8; RPE 8 is on target')
assert(effortVerdict(bzStrength(1, 7, null, true)) === 'harder' && effortVerdict(bzStrength(1, 5, 4, true)) === 'on_target', 'lead-in: RPE 5-6 is the target')
const weeks12 = summarizeEffort([bzStrength(2, 6, 3), bzStrength(2, 6, 3), bzStrength(2, 6, 3)])
assert(!consistentlyEasier(weeks12), 'week 2: three on-target sessions never trigger a push')
const week1 = summarizeEffort([bzStrength(1, 5, 3), bzStrength(1, 5, 3)])
assert(week1.sessions === 0 && !consistentlyEasier(week1), 'week 1 (the work-up) never reads as easier')
const leadIn = summarizeEffort([bzStrength(1, 4, 3, true), bzStrength(1, 4, 3, true)])
assert(leadIn.sessions === 0 && !consistentlyEasier(leadIn), 'lead-in work never reads as "ready to push"')
assert(summarizeEffort([bzStrength(1, 9, null, true)]).wayHarder === 1, 'a lead-in session way over target still counts as harder')
assert(consistentlyEasier(summarizeEffort([bzStrength(4, 6, 3), bzStrength(5, 6, 3)])), 'weeks 4-5: easier than RPE 7-8 twice still feeds the push')

// ─── Lead-in limits in placement ─────────────────────────────
const leadCtx = (over: Parameters<typeof ctx>[0] = {}) => ctx({ blockType: 'block_zero', weekNumber: 1, leadIn: true, planWeekLoad: 100, todayEpochDay: MON + 2, ...over })
const introOk = checkSessionChange({ kind: 'add', type: 'strength', label: 'Strength B', epochDay: MON + 2, timeSlot: 'am' }, leadCtx())
assert(introOk.ok, 'lead-in: an intro strength session passes (no cramming check against the lead-in plan)')
const third = checkSessionChange({ kind: 'add', type: 'strength', label: 'Strength A', epochDay: MON + 4, timeSlot: 'am' }, leadCtx({ todayEpochDay: MON + 4, sessions: [s('strength', MON, { label: 'Strength C', status: 'completed' }), s('strength', MON + 2, { label: 'Strength B', status: 'completed' })] }))
assert(!third.ok && third.code === 'lead_in_cap' && houseVoice(third.reason), `lead-in: a third intro session is refused (${third.ok ? '' : third.reason})`)
const sunday = checkSessionChange({ kind: 'add', type: 'strength', label: 'Strength A', epochDay: MON + 6, timeSlot: 'am' }, leadCtx({ todayEpochDay: MON + 6 }))
assert(!sunday.ok && sunday.code === 'rest_day', 'lead-in: no intro strength on Sunday')
const b2b = checkSessionChange({ kind: 'add', type: 'strength', label: 'Strength C', epochDay: MON + 5, timeSlot: 'am' }, leadCtx({ todayEpochDay: MON + 5, sessions: [s('strength', MON + 4, { label: 'Strength C', status: 'completed' })] }))
assert(!b2b.ok && b2b.code === 'strength_back_to_back', 'lead-in: intro sessions never back to back')
const bag3 = checkSessionChange({ kind: 'add', type: 'bag_work', epochDay: MON + 5, timeSlot: 'pm' }, leadCtx({ todayEpochDay: MON + 5, sessions: [s('bag_work', MON + 2, { status: 'completed' }), s('bag_work', MON + 3, { status: 'completed' })] }))
assert(!bag3.ok && bag3.code === 'lead_in_cap', 'lead-in: at most 2 bag sessions')
const bagLead = bagRules({ blockType: 'block_zero', weekNumber: 1, eased: false, easeReason: null, returnActive: false, gapDays: 0, returnReason: null, leadIn: true })
assert(bagLead.maxRounds === 4 && bagLead.noFinishers && bagLead.promptLines.some(l => /lead-in/i.test(l)), 'lead-in bag: 4 technique rounds, no finishers')

// ─── M1 (E2E 2026-10-19b): a mid-week start has two plans numbered week 1 ───
// Newest first, as the server reads them: next Monday's week 1 was prepared
// during the lead-in, after the lead-in plan.
const LEAD = JSON.stringify({ leadIn: true })
const plansNewestFirst = [
  { plan: 'week1', contexts: [null, null, '{"coachEase":null}'] },
  { plan: 'leadin', contexts: [LEAD, LEAD, null] },
]
assert(pickWeekPlan(plansNewestFirst, true) === 'leadin', 'M1: the lead-in is asked for, the lead-in plan comes back (not next week)')
assert(pickWeekPlan(plansNewestFirst, false) === 'week1', 'M1: week 1 is asked for, the real week 1 comes back')
assert(pickWeekPlan([{ plan: 'leadin', contexts: [LEAD] }], false) === null, 'M1: before week 1 is prepared, week 1 is not the lead-in')
assert(pickWeekPlan([{ plan: 'empty', contexts: [] }], false) === 'empty', 'M1: an empty plan is a normal week')
assert(pickWeekPlan([{ plan: 'new', contexts: [null] }, { plan: 'old', contexts: [null] }], false) === 'new', 'M1: a repeated week number still reads the newest plan')
const leadLineSignals = { weekNumber: 1, totalWeeks: 6, blockType: 'block_zero' as const, returnRamp: { active: false, gapDays: 0, reason: null } } as unknown as Parameters<typeof whyThisWeek>[0]
const leadLine = whyThisWeek(leadLineSignals, [], { leadIn: true })
assert(/^Week 1\./.test(leadLine) && !/lead-in/i.test(leadLine), `no lead-in line any more (coach brain P2): ${leadLine}`)

// m2: an undone ease leaves "coachEase":null, which is not an ease.
assert(!hasCoachEase('{"coachEase":null}') && hasCoachEase('{"coachEase":{"kind":"set"}}') && !hasCoachEase(null), 'm2: an undone weekly ease drops out of the week line')

console.log('lead-in tests passed')
