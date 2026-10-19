// Run: tsx src/lib/blockZero/simulation.test.ts
//
// A scripted athlete runs through the Block Zero rules day by day. Nothing
// here touches the DB: it is the rules engine alone, the way the app will
// call it. Scenario: good weeks; a 4-day bad-sleep + high-soreness stretch in
// week 3; a missed week 4; back at 2 for 3 days in week 5; two MT classes
// asked for in week 3 (one is sparring). Plus a clean athlete and a
// persistently inconsistent one for the gate.
//
// Phase D: every week's plan comes from a fake "AI" that tries to break the
// rules (sparring, strength on the wrong days, 50-min runs, wrong labels) and
// goes through the guardrails before the athlete follows it. On ease days and
// class days the fake coach also pushes hard mid-week changes. The guardrails
// must correct every one.

import {
  BACK_FRIENDLY_SWAPS,
  RESTART_SESSION_SEC,
  backFriendlyVariation,
  backTrend,
  defaultMainLift,
  easeSession,
  evaluateClassRequest,
  evaluateReadiness,
  getBlockZeroWeekTemplate,
  getStrengthWeekTarget,
  keySessionCompletionRate,
  latestReadiness,
  longestGapInWindow,
  nextLoad,
  planTransition,
  retestDoneFrom,
  GATE_SQUAT_ID,
  prescribeRunWalk,
  rebalanceDayForClass,
  weeklyLoadFlag,
  weeklyLoadTotals,
  type CheckIn,
  type MainLiftSlot,
  type PlannedSession,
  type TransitionPlan,
} from './index'
import { extensionsUsed } from './weeks'
import { blockZeroWorkingLoad, checkInFromDailyLog, readinessReport, type DailyLogFields, type LoggedWorkingSet } from './index'
import { guardReactiveReplan, guardWeekPlan, type Clamp, type GuardSession } from './guardrails'
import { weeklyRunAllowanceSec } from './running'
import type { WeekPlanOutput } from '../prompts/tools'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
  console.log(`ok: ${msg}`)
}

// First Monday on or after epoch day 20000.
let START = 20000
while (new Date(START * 86400000).getUTCDay() !== 1) START++
const dow = (day: number) => new Date(day * 86400000).getUTCDay()
const weekOf = (day: number) => Math.floor((day - START) / 7) + 1

interface Script {
  name: string
  missedWeeks?: number[]
  badStretch?: number[] // day offsets from START
  backFlare?: number[]
  classes?: Array<{ offset: number; type: string }>
  skipEveryOther?: boolean
}

interface RunLog { day: number; sec: number; longest30: number; capped: boolean }
interface LoadStep { day: number; liftId: string; rpe: number; target: [number, number]; before: number; after: number }
interface BackPick { day: number; picked: string; original: string }
interface ClassLog { day: number; type: string; allowed: boolean; rampWeek: number; classType: string | null }
interface GuardWeek { week: number; plan: WeekPlanOutput; clamps: Clamp[]; longest30: number; lastWeek: number; shapeMatches: boolean }
interface GuardDay { day: number; kind: 'ease' | 'class'; action: string; type: string; label: string; clamps: Clamp[] }

/** A fake planner that tries to break every rule it can. */
function adversarialPlan(week: number): WeekPlanOutput {
  const t = getBlockZeroWeekTemplate(week)
  const days = [0, 1, 2, 3, 4, 5, 6].map(d => ({
    dayOfWeek: d,
    sessions: t[d].map(x => ({ type: x.type as never, timeSlot: x.timeSlot, label: x.label, estimatedMin: x.type === 'foundation_run' ? 50 : x.estimatedMin })),
  }))
  days[2].sessions.push({ type: 'mt_class' as never, timeSlot: 'pm', label: 'Sparring', estimatedMin: 90 })
  days[2].sessions.push({ type: 'strength' as never, timeSlot: 'am', label: 'Strength B', estimatedMin: 60 })
  days[0].sessions.push({ type: 'strength' as never, timeSlot: 'am', label: 'Strength D', estimatedMin: 75 })
  days[0].sessions.push({ type: 'mt_class' as never, timeSlot: 'pm', label: 'Open Mat', estimatedMin: 60 })
  for (const s of days[1].sessions) if (s.type === 'strength') s.label = 'Strength C'
  for (const s of days[4].sessions) if (s.type === 'foundation_run') Object.assign(s, { type: 'running', label: 'Tempo', runCategory: 'progression' })
  return { narrative: 'Big week \u2014 push it!', days, mtSessionsThisWeek: 3 }
}

const SLOT_BY_DAY: Record<string, MainLiftSlot> = { A: 'squat', B: 'hinge', C: 'row' }
const REGION: Record<MainLiftSlot, 'upper' | 'lower'> = { squat: 'lower', hinge: 'lower', row: 'upper' }

function topSetRpe(week: number, eased: boolean, firstBackAfterGap: boolean): number {
  if (eased) return 8
  if (firstBackAfterGap) return 8.5
  return ({ 1: 6.5, 2: 6, 3: 6, 4: 7, 5: 7.5, 6: 7 } as Record<number, number>)[week] ?? 6.5
}

function simulate(script: Script) {
  const missed = new Set(script.missedWeeks ?? [])
  const bad = new Set((script.badStretch ?? []).map(o => START + o))
  const flare = new Set((script.backFlare ?? []).map(o => START + o))
  const classByDay = new Map((script.classes ?? []).map(c => [START + c.offset, c.type]))

  let totalWeeks = 6
  const checkIns: CheckIn[] = []
  const runs: RunLog[] = []
  const loadSteps: LoadStep[] = []
  const backPicks: BackPick[] = []
  const classes: ClassLog[] = []
  const easeDays: number[] = []
  const gateSessions: Array<{ type: string; status: string; scheduledDate: number }> = []
  const loadEntries: Array<{ epochDay: number; rpe: number; minutes: number }> = []
  const weights = new Map<string, number>()
  const plans: Array<{ week: number; plan: TransitionPlan }> = []
  const guardWeeks: GuardWeek[] = []
  const guardDays: GuardDay[] = []
  let firstClassDay: number | null = null
  let classesThisWeek = 0
  let skipToggle = false
  let lastTrainedWeek = 0

  for (let week = 1; week <= totalWeeks; week++) {
    classesThisWeek = 0
    const template = getBlockZeroWeekTemplate(week)

    // The fake planner's week, through the guardrails, is the week the athlete follows.
    const monday = START + (week - 1) * 7
    const longest30 = runs.filter(r => r.day >= monday - 30 && r.day < monday).reduce((m, r) => Math.max(m, r.sec), 0)
    const lastWeekRun = runs.filter(r => r.day >= monday - 7 && r.day < monday).reduce((n, r) => n + r.sec, 0)
    const guarded = guardWeekPlan(adversarialPlan(week), { weekNumber: week, run: { longestLast30Sec: longest30 || null, lastWeekRunSec: lastWeekRun } })
    const shapeMatches = [0, 1, 2, 3, 4, 5, 6].every(d => {
      const got = (guarded.output.days.find(x => x.dayOfWeek === d)?.sessions ?? []).map(x => `${x.type}:${x.type === 'strength' ? x.label : ''}`).sort().join(',')
      const want = template[d].map(x => `${x.type}:${x.type === 'strength' ? x.label : ''}`).sort().join(',')
      return got === want
    })
    guardWeeks.push({ week, plan: guarded.output, clamps: guarded.clamps, longest30, lastWeek: lastWeekRun, shapeMatches })
    const weekPlan: Record<number, PlannedSession[]> = {}
    for (const d of guarded.output.days) weekPlan[d.dayOfWeek] = d.sessions.map(x => ({ type: x.type, label: x.label, timeSlot: x.timeSlot, estimatedMin: x.estimatedMin }))
    for (let i = 0; i < 7; i++) {
      const day = START + (week - 1) * 7 + i
      const isMissed = missed.has(week)

      // Daily check-in (none during the missed week).
      if (!isMissed) {
        const off = bad.has(day)
        checkIns.push({
          epochDay: day,
          sleepHours: off ? 5 : 7.5,
          soreness: off ? 4 : 2,
          energy: off ? 2 : 4,
          stress: 2,
          mood: 4,
          backToday: flare.has(day) ? 2 : 4,
        })
      }
      const readiness = latestReadiness(checkIns.filter(c => c.epochDay <= day))
      const easeToday = !isMissed && readiness.ease && readiness.epochDay === day
      if (easeToday) easeDays.push(day)
      const backToday = flare.has(day) ? 2 : 4

      let sessions: PlannedSession[] = weekPlan[dow(day)] ?? []

      // Mid-week: on an ease day or a class day the fake coach pushes hard work.
      const classAsk = classByDay.get(day)
      if (!isMissed && (easeToday || classAsk)) {
        const guardSessions: GuardSession[] = [0, 1, 2, 3, 4, 5, 6].flatMap(k => (weekPlan[dow(monday + k)] ?? []).map((x, j) => ({
          id: `${monday + k}-${j}`, type: x.type, epochDay: monday + k, timeSlot: x.timeSlot, status: monday + k < day ? 'completed' : 'planned', label: x.label,
        })))
        const ctx = {
          weekNumber: week,
          todayEpochDay: day,
          sessions: guardSessions,
          readinessEase: easeToday,
          loadFlag: false,
          easeReason: easeToday ? readiness.reason : null,
          run: { longestLast30Sec: runs.filter(r => r.day >= day - 30 && r.day < day).reduce((m, r) => Math.max(m, r.sec), 0) || null, lastWeekRunSec: lastWeekRun, thisWeekRunSec: runs.filter(r => r.day >= monday && r.day < day).reduce((n, r) => n + r.sec, 0) },
          mt: { weeksSinceFirstClass: firstClassDay == null ? null : Math.floor((day - firstClassDay) / 7), classesThisWeek, profileCap: null },
        }
        const ask = easeToday
          ? { note: 'Push through.', shiftAction: 'add_recovery' as const, shiftReason: 'Add a heavy day!', targetSessionType: 'strength' as const, targetLabel: 'Heavy Strength', targetDay: dow(day), targetTimeSlot: 'pm' as const }
          : { note: 'Spar tonight.', shiftAction: 'swap' as const, shiftReason: 'Sparring builds timing.', targetSessionType: 'mt_class' as const, targetLabel: 'Hard Sparring', targetDay: dow(day), targetTimeSlot: 'pm' as const }
        const r = guardReactiveReplan(ask, ctx)
        guardDays.push({
          day, kind: easeToday ? 'ease' : 'class', action: r.output.shiftAction, type: r.output.targetSessionType, label: r.output.targetLabel,
          clamps: [...r.clamps],
        })
      }

      // Athlete asks for a class.
      const classType = classByDay.get(day)
      if (classType && !isMissed) {
        const weeksSinceFirst = firstClassDay == null ? null : Math.floor((day - firstClassDay) / 7)
        const decision = evaluateClassRequest({ classType, weeksSinceFirstClass: weeksSinceFirst, classesThisWeek })
        classes.push({ day, type: classType, allowed: decision.allowed, rampWeek: decision.rampWeek, classType: decision.classType })
        if (decision.allowed) {
          if (firstClassDay == null) firstClassDay = day
          classesThisWeek++
          sessions = rebalanceDayForClass(sessions, { type: 'mt_class', label: 'MT Class', timeSlot: 'pm', estimatedMin: 90, classType: decision.classType ?? 'technical' }).sessions
        }
      }

      for (const planned of sessions) {
        const key = planned.type !== 'mobility'
        const eased = easeToday ? easeSession(planned, { readinessEase: true, readinessReason: readiness.reason }) : { session: planned, eased: false }
        const s = eased.session
        let status = 'completed'
        if (isMissed) status = 'missed'
        else if (script.skipEveryOther && key) { skipToggle = !skipToggle; if (skipToggle) status = 'skipped' }
        if (key) gateSessions.push({ type: planned.type, status, scheduledDate: day })
        if (status !== 'completed') continue
        if (key) lastTrainedWeek = Math.max(lastTrainedWeek, week)

        if (s.type === 'strength') {
          const t = getStrengthWeekTarget(week)
          const strengthDay = planned.label.slice(-1)
          const slot = SLOT_BY_DAY[strengthDay]
          const original = defaultMainLift(slot, week).exerciseId
          const pick = backFriendlyVariation(original, backToday)
          if (backToday <= 2) backPicks.push({ day, picked: pick.exerciseId, original })
          const liftId = pick.exerciseId
          const before = weights.get(liftId) ?? 40
          const target: [number, number] = eased.eased && s.rpe ? s.rpe : t.rpe
          const rpe = topSetRpe(week, eased.eased, week > 1 && lastTrainedWeek < week && missed.has(week - 1))
          const next = nextLoad({ weightKg: before, reps: t.reps, rpe }, { reps: t.reps, rpe: target }, REGION[slot])
          loadSteps.push({ day, liftId, rpe, target, before, after: next.weightKg })
          weights.set(liftId, next.weightKg)
          loadEntries.push({ epochDay: day, rpe: 7, minutes: s.estimatedMin })
        } else if (s.type === 'foundation_run') {
          const monday = START + (week - 1) * 7
          const inWindow = runs.filter(r => r.day >= day - 30 && r.day < day)
          const longest30 = inWindow.reduce((m, r) => Math.max(m, r.sec), 0)
          const lastWeek = runs.filter(r => r.day >= monday - 7 && r.day < monday).reduce((n, r) => n + r.sec, 0)
          const soFar = runs.filter(r => r.day >= monday && r.day < day).reduce((n, r) => n + r.sec, 0)
          const left = [0, 1, 2, 3, 4, 5, 6].map(k => monday + k).filter(d => d >= day && template[dow(d)].some(x => x.type === 'foundation_run')).length
          const p = prescribeRunWalk({ week, longestLast30Sec: longest30 || null, weekly: { lastWeekRunSec: lastWeek, thisWeekSoFarSec: soFar, sessionsLeftThisWeek: Math.max(1, left) } })
          if (p.totalSec > 0) runs.push({ day, sec: p.totalSec, longest30, capped: p.capped })
          loadEntries.push({ epochDay: day, rpe: 4, minutes: Math.round(p.totalSec / 60) })
        } else if (s.type === 'mt_class') {
          loadEntries.push({ epochDay: day, rpe: 6, minutes: s.estimatedMin })
        } else if (key) {
          loadEntries.push({ epochDay: day, rpe: 3, minutes: s.estimatedMin })
        }
      }
    }

    // End gate at the block's last week.
    if (week === totalWeeks) {
      const today = START + week * 7 - 1
      const completedDays = gateSessions.filter(s => s.status === 'completed').map(s => s.scheduledDate)
      // No test week: the front squat estimate comes from week 5/6 strength sets, the talk test from a week-6 run-walk.
      const squatSets = gateSessions.some(s => s.type === 'strength' && s.status === 'completed' && weekOf(s.scheduledDate) >= 5)
      const talkWeeks = gateSessions.some(s => s.type === 'foundation_run' && s.status === 'completed' && weekOf(s.scheduledDate) >= 6) ? [6] : []
      const retestDone = retestDoneFrom(squatSets ? new Map([[GATE_SQUAT_ID, 100]]) : new Map(), talkWeeks)
      const plan = planTransition({
        gate: {
          completionRate: keySessionCompletionRate(gateSessions, today + 1),
          longestRecentGapDays: longestGapInWindow(completedDays, today, START),
          backTrend: backTrend(checkIns, START, today),
          retestDone,
          extensionsUsed: extensionsUsed(totalWeeks),
        },
        aiDecision: null,
        aiTargets: [],
        retestE1rms: new Map(),
        totalWeeks,
        atEndBoundary: true,
      })
      plans.push({ week, plan })
      totalWeeks = plan.newTotalWeeks
    }
  }

  return { checkIns, runs, loadSteps, backPicks, classes, easeDays, plans, totalWeeks, loadEntries, guardWeeks, guardDays }
}

/** Phase D: the fake planner and coach never get a rule past the guardrails. */
function assertGuarded(name: string, sim: ReturnType<typeof simulate>): void {
  for (const g of sim.guardWeeks) {
    const all = g.plan.days.flatMap(d => d.sessions)
    const tag = `${name} week ${g.week}`
    assert(!all.some(s => s.type === 'mt_class') && g.plan.mtSessionsThisWeek === 0, `${tag}: fake AI's sparring and open mat dropped`)
    const strengthDays = g.plan.days.filter(d => d.sessions.some(s => s.type === 'strength')).map(d => d.dayOfWeek).sort()
    assert(strengthDays.join(',') === '1,3,5', `${tag}: strength Mon/Wed/Fri only, never back to back`)
    assert(g.plan.days.every(d => d.sessions.filter(s => s.type === 'strength').every(s => s.label === `Strength ${({ 1: 'A', 3: 'B', 5: 'C' } as Record<number, string>)[d.dayOfWeek]}`)), `${tag}: labels A/B/C preserved`)
    assert(g.plan.days.every(d => d.sessions.some(s => s.type === 'mobility')), `${tag}: back care every day`)
    assert(g.shapeMatches, `${tag}: guarded week has exactly the rules' shape`)
    const runs = all.filter(s => s.type === 'foundation_run' || s.type === 'running')
    const single = g.longest30 > 0 ? Math.floor(g.longest30 * 1.1 / 60) : 23
    assert(runs.every(s => s.type === 'foundation_run' && s.estimatedMin <= single), `${tag}: 50-min runs cut to <= ${single} min`)
    const weekly = Math.floor(weeklyRunAllowanceSec(g.lastWeek) / 60)
    assert(runs.reduce((n, s) => n + s.estimatedMin, 0) <= weekly, `${tag}: run total within the weekly cap (${weekly} min)`)
    assert(g.clamps.length > 0 && g.clamps.every(c => c.reason.length > 0 && !/[!\u2014]/.test(c.reason)), `${tag}: ${g.clamps.length} clamps, each with a house-voice reason`)
    assert(!/[!\u2014]/.test(g.plan.narrative), `${tag}: narrative cleaned`)
  }
  for (const d of sim.guardDays) {
    const tag = `${name} day ${d.day - START} (${d.kind})`
    if (d.kind === 'ease') {
      assert(d.action !== 'add_recovery' && d.clamps.some(c => c.code === 'ease_day'), `${tag}: heavy strength on an ease day refused, ${d.action} instead`)
    } else {
      assert(!/spar/i.test(d.label), `${tag}: sparring never gets through (${d.action} ${d.type} ${d.label})`)
    }
  }
}

// ─── Scripted athlete ───────────────────────────────────────────

const W3_TUE = 15
const scripted = simulate({
  name: 'scripted',
  badStretch: [W3_TUE, W3_TUE + 1, W3_TUE + 2, W3_TUE + 3], // week 3 Tue-Fri
  missedWeeks: [4],
  backFlare: [30, 31, 32], // week 5 Wed-Fri (Strength B and C fall inside)
  classes: [{ offset: W3_TUE, type: 'technique' }, { offset: W3_TUE + 2, type: 'sparring' }, { offset: 29, type: 'clinch' }, { offset: 31, type: 'sparring' }, { offset: 36, type: 'sparring' }],
})

assertGuarded('scripted', scripted)
assert(scripted.guardDays.some(d => d.kind === 'ease') && scripted.guardDays.some(d => d.kind === 'class'), 'the fake coach was tested on ease days and class days')

// Runs: R7 and R8 never broken.
assert(scripted.runs.length > 10, `${scripted.runs.length} runs logged`)
for (const r of scripted.runs) {
  const limit = r.longest30 > 0 ? Math.floor(r.longest30 * 1.1) : RESTART_SESSION_SEC
  assert(r.sec <= limit, `run day ${r.day - START}: ${r.sec}s within ${r.longest30 > 0 ? '110% of 30-day longest' : 'the week-1 restart'} (${limit}s)`)
}
const maxWeek = Math.max(...scripted.runs.map(r => weekOf(r.day)))
const weeklyRun = (w: number) => scripted.runs.filter(r => weekOf(r.day) === w).reduce((n, r) => n + r.sec, 0)
for (let w = 2; w <= maxWeek; w++) {
  const prev = weeklyRun(w - 1)
  const cur = weeklyRun(w)
  const limit = weeklyRunAllowanceSec(prev)
  assert(cur <= limit + 1, `week ${w} run time ${cur}s within +30% of last week, floored at week-1 volume (${Math.round(limit)}s)`)
}
assert(scripted.runs.some(r => r.capped), 'the guards actually capped something (return after the missed week)')

// Readiness: ease fires on the bad stretch and nowhere else.
const stretch = [W3_TUE, W3_TUE + 1, W3_TUE + 2, W3_TUE + 3].map(o => START + o)
assert(scripted.easeDays.length > 0, `ease fired on ${scripted.easeDays.length} days`)
assert(scripted.easeDays.every(d => stretch.includes(d)), 'every ease day falls inside the bad stretch')
assert(stretch.slice(1).every(d => scripted.easeDays.includes(d)), 'ease fires from day 2 of the stretch to its end')
assert(!scripted.easeDays.includes(stretch[0]), 'day 1 alone does not ease (needs 2 days)')
const flareRead = evaluateReadiness(scripted.checkIns).filter(d => d.epochDay >= START + 30 && d.epochDay <= START + 32)
assert(flareRead.every(d => !d.flagged), 'the back flare alone (one item) does not trigger ease')

// Back-friendly variations when back <= 2.
assert(scripted.backPicks.length >= 2, `${scripted.backPicks.length} strength sessions on back-2 days`)
for (const p of scripted.backPicks) {
  assert(!(p.picked in BACK_FRIENDLY_SWAPS), `day ${p.day - START}: ${p.original} became ${p.picked}, not a spine-loading lift`)
}

// Load never increases when the top set was at or above target RPE.
assert(scripted.loadSteps.some(s => s.after > s.before), 'load went up at least once (easy weeks)')
assert(scripted.loadSteps.some(s => s.after < s.before), 'load came down at least once (bad days, return from the gap)')
for (const s of scripted.loadSteps) {
  if (s.rpe >= s.target[0]) assert(s.after <= s.before, `day ${s.day - START} ${s.liftId}: RPE ${s.rpe} vs ${s.target.join('-')}, no increase`)
}

// MT ramp.
const allowed = scripted.classes.filter(c => c.allowed)
assert(allowed.length >= 2, `${allowed.length} classes allowed`)
for (const c of scripted.classes.filter(x => x.rampWeek <= 2 && x.allowed)) {
  assert(c.classType === 'technical' || c.classType === 'padwork', `ramp week ${c.rampWeek} class is ${c.classType}: technique/pads only`)
}
assert(scripted.classes.filter(c => c.type === 'sparring').length === 3 && scripted.classes.filter(c => c.type === 'sparring').every(c => !c.allowed), 'sparring refused every time (3 attempts)')
assert(scripted.classes.some(c => c.type === 'clinch' && c.rampWeek === 3 && c.allowed), 'light clinch allowed from ramp week 3')

// Load: return from the missed week trips the soft flag.
const weeklyLoad = weeklyLoadTotals(scripted.loadEntries, START, 8)
assert(weeklyLoad[3] === 0 && weeklyLoadFlag(weeklyLoad[3], weeklyLoad[4]).flagged, 'week 5 load after a zero week 4: soft flag')

// Gate: the missed week extends, then the block moves on.
assert(scripted.plans[0].week === 6 && scripted.plans[0].plan.decision === 'extend', 'missed-week athlete: gate extends at week 6')
assert(scripted.plans[0].plan.reasons.some(r => r.includes('gap')), 'extension reason names the gap')
assert(scripted.plans[scripted.plans.length - 1].plan.decision === 'proceed', 'after the extension week the gate proceeds')
assert(scripted.plans[scripted.plans.length - 1].plan.nextBlock?.blockType === 'fighter', 'proceed hands over to a Fighter block')
assert(scripted.totalWeeks - 6 <= 2, `extensions used: ${scripted.totalWeeks - 6} (max 2)`)
// Extension week strength = week-5 levels, not week 1.
assert(getStrengthWeekTarget(7).loadPct === getStrengthWeekTarget(5).loadPct, 'extension week loads at week-5 levels')

// ─── Clean athlete ──────────────────────────────────────────────

const clean = simulate({ name: 'clean' })
assertGuarded('clean', clean)
assert(clean.plans.length === 1 && clean.plans[0].plan.decision === 'proceed' && clean.totalWeeks === 6, 'clean athlete: proceed at week 6, no extension')
assert(clean.easeDays.length === 0, 'clean athlete: no ease days')
for (let w = 2; w <= 6; w++) {
  const run = (wk: number) => clean.runs.filter(r => weekOf(r.day) === wk).reduce((n, r) => n + r.sec, 0)
  assert(run(w) <= run(w - 1) * 1.3, `clean week ${w}: run time within +30%`)
}
assert(clean.runs.every(r => r.longest30 === 0 || r.sec <= r.longest30 * 1.1), 'clean athlete: no run over 110%')

// ─── Inconsistent athlete: extensions cap at 2 ─────────────────

const flaky = simulate({ name: 'flaky', skipEveryOther: true })
assert(flaky.plans[0].plan.decision === 'extend', 'half the sessions skipped: extend')
assert(flaky.totalWeeks === 8, 'extended to 8 weeks at most')
const last = flaky.plans[flaky.plans.length - 1].plan
assert(last.decision === 'adjust' && last.gate.forced && last.nextBlock != null, 'at 8 weeks: forced move-on with conservative loads')
assert(flaky.plans.every(p => p.plan.newTotalWeeks <= 8), 'no plan ever goes past 8 weeks')


// ─── Phase B: readiness from daily_logs rows, loads from logged RIR ──
//
// The same athlete as the API sees them: check-ins arrive as daily_logs rows
// (sleep quality, energy, stress, mood, back today) and go through
// checkInFromDailyLog + readinessReport. Strength loads come from the RIR the
// athlete logs, through blockZeroWorkingLoad, starting from the week-1 work-up.
// A capacity model decides the RIR: true e1RM grows ~1.5% a week of training,
// reps to failure at a load follow Epley, and the athlete taps 0-3 (3 = 3+).

{
  const lifts = [
    { id: 'ex-goblet-squat', day: 1, e1rm: 50 },
    { id: 'ex-bench-press', day: 1, e1rm: 70 },
    { id: 'ex-db-rdl', day: 3, e1rm: 60 },
    { id: 'ex-ohp', day: 3, e1rm: 45 },
  ]
  const badDays = new Set([START + 15, START + 16, START + 17]) // week 3 Tue-Thu
  const rows: DailyLogFields[] = []
  const history = new Map<string, LoggedWorkingSet[]>()
  const loadLog: Array<{ week: number; id: string; weight: number; rir: number; source: string; eased: boolean }> = []
  const easedDays: number[] = []
  const rirFor = (e1rm: number, weight: number, reps: number) => {
    const toFailure = Math.floor(30 * (e1rm / weight - 1))
    return Math.max(0, Math.min(3, toFailure - reps))
  }

  for (let week = 1; week <= 6; week++) {
    const target = getStrengthWeekTarget(week)
    for (let i = 0; i < 7; i++) {
      const day = START + (week - 1) * 7 + i
      const off = badDays.has(day)
      rows.push({ logDate: day, sleepHours: off ? 5.5 : 7.5, sleepQuality: off ? 2 : 4, energy: off ? 2 : 4, soreness: 2, stress: off ? 4 : 2, mood: 4, backToday: 4, alcoholScale: 0, herbScale: 0 })
      const report = readinessReport(rows.map(checkInFromDailyLog), day)
      if (report.ease) easedDays.push(day)

      for (const lift of lifts.filter(l => l.day === dow(day))) {
        const trueE1rm = lift.e1rm * (1 + 0.015 * (week - 1))
        let weight: number
        let source = 'rir'
        const planned = blockZeroWorkingLoad({ exerciseId: lift.id, history: history.get(lift.id) ?? [], target, eased: report.ease })
        if (planned) {
          weight = planned.weightKg
        } else {
          // Week 1 work-up: climb in 2.5 kg steps until the set of 8 has 3+ left, then stop.
          source = 'workup'
          weight = 10
          while (rirFor(trueE1rm, weight + 2.5, 8) >= 3) weight += 2.5
        }
        const rir = rirFor(trueE1rm, weight, 8)
        const at = day * 86400 + 3600
        const list = history.get(lift.id) ?? []
        list.push({ weightKg: weight, reps: 8, plannedReps: 8, rir, completedAt: at, setNumber: 1 })
        history.set(lift.id, list)
        loadLog.push({ week, id: lift.id, weight, rir, source, eased: report.ease })
      }
    }
  }

  assert(easedDays.length > 0 && easedDays.every(d => badDays.has(d)), `check-in rows drive ease on ${easedDays.length} bad-stretch day(s) only`)
  assert(!easedDays.includes(START + 15), 'first bad check-in alone does not ease')
  for (const lift of lifts) {
    const steps = loadLog.filter(l => l.id === lift.id)
    assert(steps[0].source === 'workup' && steps[0].rir === 3, `${lift.id}: week 1 work-up ends on a set of 8 with 3+ left`)
    assert(steps[1].weight === steps[0].weight, `${lift.id}: the work-up weight is the week-2 starting load (${steps[0].weight} kg)`)
    assert(steps.every(s => s.rir >= 1), `${lift.id}: never to failure (RIR >= 1 every session)`)
    for (let k = 1; k < steps.length; k++) {
      if (steps[k - 1].rir <= 2) assert(steps[k].weight <= steps[k - 1].weight, `${lift.id} week ${steps[k].week}: last top set had ${steps[k - 1].rir} left, no increase`)
      if (steps[k].eased) assert(steps[k].weight <= steps[k - 1].weight, `${lift.id} week ${steps[k].week}: eased day, no increase`)
    }
    assert(steps[steps.length - 1].weight > steps[0].weight, `${lift.id}: load rose over the block (${steps[0].weight} to ${steps[steps.length - 1].weight} kg)`)
  }
}

console.log('\nBlock Zero simulation passed')
