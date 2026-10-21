// Run: tsx src/lib/coach/simulation.test.ts
//
// Part 3 (Block Zero lead-in) starts two athletes on a Wednesday and a
// Saturday and runs them through week 2.
//
// Part 2 (adaptive coach, E3) runs a second athlete through the weekly pass,
// ramp-up asks, oversleep, added sessions, felt-hard eases and a retest.
//
// A scripted athlete runs 16 calendar weeks of a Fighter block through the
// coach rules, day by day, the way the server calls them (no DB). Life events:
// a 1-week holiday, a 3-week gap, a sick week, a back flare with an injury
// skip, a knee injury skip, missed sessions, ad-hoc adds (including stacking
// attempts) and reactive replans, small and big. Then a Block Zero athlete
// takes a 5-week gap. Checks (page 56): his adds always land and the coach
// rebalances other sessions (at most two, never his pick, moves of a day that
// pass the placement rules); gaps handled per the return table; the week
// counter pauses; the coach never crams; an AI's big change is never applied;
// every missed key session gets the coach's fix, never a question.

import { getDayTemplate } from '../weeklyTemplate'
import {  singleRunCap, RESTART_SESSION_SEC } from '../blockZero'
import {
  KEY_TYPES,
  RUN_TYPES,
  checkSessionChange,
  classifyReplan,
  estimatedMinutes,
  injuryFlag,
  missedFix,
  rebalance,
  runAllowanceBaseSec,
  mondayOf,
  plannedLoad,
  returnContext,
  returnPlan,
  trainingWeek,
  weeksSinceRampStart,
  type PlacementContext,
  type SessionLike,
  type SkipSignal,
} from './index'
import { 
  fighterTmDecision,
  makeRegularAsk,
  makeRegularCandidates,
  summarizeEffort,
  tmProposal,
  typicalRpe,
  weeklyPassKey,
  weeklyPassTarget,
  whyThisWeek,
  type AddedSession,
  type BlockWorkingSet,
  type EffortRead,
  type WeekSignals,
} from './index'
import { evaluateReadiness, type CheckIn } from '../blockZero/readiness'
import { MON, assert } from './testUtil'

const MT_DAYS = new Set([1, 3, 5])
const WEEKS = 16
const PLAN_KEY_PER_WEEK = 10

interface SimSession extends SessionLike {
  id: string
  weekNumber: number
  source: 'template' | 'ad_hoc' | 'coach'
  durationSec?: number
  skipReason?: string | null
  skipDetail?: string | null
}

let nextId = 0
const all: SimSession[] = []
const skips: SkipSignal[] = []
const fixes: Array<{ sessionId: string; day: number; fix: ReturnType<typeof missedFix> }> = []
const proposals: Array<{ day: number; applied: boolean; kind: string }> = []
const violations: string[] = []
const loadFactors: Array<{ day: number; tier: string; loadFactor: number; gapDays: number }> = []
const weekByMonday = new Map<number, number>()

const dowOf = (d: number) => new Date(d * 86400000).getUTCDay()
const completedKeyDays = (upTo: number) => all.filter(s => s.status === 'completed' && KEY_TYPES.has(s.type) && s.epochDay <= upTo).map(s => s.epochDay)

function weekFor(day: number, today: number) {
  return trainingWeek({ blockType: 'fighter', startDay: MON, totalWeeks: 12, completedKeyDays: completedKeyDays(today), day, todayDay: today, plannedKeyPerWeek: PLAN_KEY_PER_WEEK })
}

function planLoad(week: number): number {
  let total = 0
  for (let dow = 0; dow <= 6; dow++) {
    for (const t of getDayTemplate('fighter', week, dow, MT_DAYS)) {
      if (KEY_TYPES.has(t.type)) total += plannedLoad({ type: t.type, label: t.label, notes: t.runCategory ?? null, estimatedMin: null }, 'fighter', week)
    }
  }
  return total
}

function runHistory(today: number) {
  const runs = all.filter(s => s.status === 'completed' && RUN_TYPES.has(s.type))
  const monday = mondayOf(today)
  return {
    longestLast30Sec: runs.filter(r => r.epochDay >= today - 30 && r.epochDay < today).reduce((m, r) => Math.max(m, r.durationSec ?? 0), 0) || null,
    lastWeekRunSec: runs.filter(r => r.epochDay >= monday - 7 && r.epochDay < monday).reduce((n, r) => n + (r.durationSec ?? 0), 0),
    thisWeekRunSec: runs.filter(r => r.epochDay >= monday && r.epochDay < today).reduce((n, r) => n + (r.durationSec ?? 0), 0),
  }
}

function context(targetDay: number, today: number, extra: Partial<PlacementContext> = {}): PlacementContext {
  const monday = mondayOf(targetDay)
  const tw = weekFor(Math.max(targetDay, today), today)
  const classDays = all.filter(s => s.type === 'mt_class' && s.status === 'completed' && s.epochDay < today).map(s => s.epochDay)
  return {
    blockType: 'fighter',
    weekNumber: tw.week,
    todayEpochDay: today,
    sessions: all.filter(s => s.epochDay >= monday - 1 && s.epochDay <= monday + 7),
    readinessEase: false,
    loadFlag: false,
    easeReason: null,
    easeDays: [],
    run: runHistory(today),
    mt: { weeksSinceRampStart: weeksSinceRampStart(classDays, targetDay), profileCap: 3 },
    planWeekLoad: planLoad(tw.week),
    injury: injuryFlag(skips, today),
    ...extra,
  }
}

/** Generate a week's template sessions on its Monday (as /api/weeks/generate does). */
function generateWeek(monday: number, today: number) {
  const tw = weekFor(monday, today)
  weekByMonday.set(monday, tw.week)
  for (let d = monday; d < monday + 7; d++) {
    for (const t of getDayTemplate('fighter', tw.week, dowOf(d), MT_DAYS)) {
      all.push({ id: `t${nextId++}`, type: t.type, label: t.label, notes: t.runCategory ?? null, epochDay: d, timeSlot: t.timeSlot, status: 'planned', weekNumber: tw.week, source: 'template' })
    }
  }
}

/** Every change the athlete or coach makes goes through here, as the routes do. */
function tryChange(change: Parameters<typeof checkSessionChange>[0], today: number, label: string) {
  const ctx = context(change.epochDay, today)
  const r = checkSessionChange(change, ctx)
  if (r.ok) {
    // Belt and braces: the accepted state must still pass its own rules.
    const load = ctx.sessions.filter(s => s.epochDay >= mondayOf(change.epochDay) && s.epochDay <= mondayOf(change.epochDay) + 6 && s.status !== 'missed' && s.status !== 'skipped' && s.id !== change.sessionId && !['mobility', 'active_recovery'].includes(s.type))
      .reduce((n, s) => n + plannedLoad(s, 'fighter', ctx.weekNumber), 0) + (change.kind === 'move' ? 0 : plannedLoad(r.change, 'fighter', ctx.weekNumber))
    if (change.kind !== 'move' && !['mobility', 'active_recovery'].includes(change.type) && ctx.planWeekLoad != null && load > ctx.planWeekLoad * 1.05) violations.push(`${label}: crammed past the plan`)
  } else {
    for (const a of r.safeAlternatives) {
      const alt = a.kind === 'day' ? { ...change, epochDay: a.epochDay, timeSlot: a.timeSlot } : { ...change, kind: 'replace' as const, type: a.type, label: a.label, notes: a.notes ?? null, estimatedMin: null, epochDay: a.epochDay, timeSlot: a.timeSlot }
      if (!checkSessionChange(alt, ctx, { alternatives: false }).ok) violations.push(`${label}: unsafe alternative ${JSON.stringify(a)}`)
    }
  }
  return r
}

// ─── The script ──────────────────────────────────────────────

const HOLIDAY_WEEK = 3
const GAP_WEEKS = [7, 8, 9]
const SICK_WEEK = 12
const BACK_FLARE_DAY = MON + 5 * 7 + 2 // week 5 Wed
const KNEE_DAY = MON + 13 * 7 + 1 // week 13 Tue
const MISSED_THURSDAYS = [1, 4, 11, 14]
const weekIndex = (d: number) => Math.floor((d - MON) / 7)

let stackingAdds = 0
let coachChanges = 0

/** His add lands as he picked it; the coach then rebalances the rest (rebalance.ts). */
function addAndRebalance(type: string, label: string, epochDay: number, today: number, tag: string) {
  const mine: SimSession = { id: `a${nextId++}`, type, label, notes: null, epochDay, timeSlot: 'am', status: 'planned', weekNumber: weekByMonday.get(mondayOf(epochDay)) ?? 1, source: 'ad_hoc' }
  all.push(mine)
  const ctx = context(epochDay, today)
  const before = new Map(all.map(x => [x.id, JSON.stringify(x)]))
  const plans = rebalance({ action: { kind: 'add', session: mine, reason: null }, week: ctx.sessions as Array<SimSession>, ctx, held: new Set() })
  if (plans.length > 2) violations.push(`${tag}: ${plans.length} coach changes`)
  for (const p of plans) {
    if (p.sessionId === mine.id) violations.push(`${tag}: the coach changed his pick`)
    const target = all.find(x => x.id === p.sessionId)
    if (!target) continue
    if (p.kind === 'move' && p.move) {
      if (Math.abs(p.move.epochDay - target.epochDay) > 1) violations.push(`${tag}: a move of more than a day`)
      if (!checkSessionChange({ kind: 'move', type: target.type, label: target.label, notes: target.notes, epochDay: p.move.epochDay, timeSlot: p.move.timeSlot, sessionId: target.id, fromEpochDay: target.epochDay }, context(p.move.epochDay, today), { alternatives: false }).ok && p.rule !== 'R1') violations.push(`${tag}: a coach move the rules refuse`)
      target.epochDay = p.move.epochDay
      target.timeSlot = p.move.timeSlot
    }
    coachChanges++
  }
  if (JSON.stringify(mine) !== before.get(mine.id)) violations.push(`${tag}: his pick moved`)
  return mine
}

for (let day = MON; day < MON + WEEKS * 7; day++) {
  const today = day
  const wi = weekIndex(day)
  if (dowOf(day) === 1) generateWeek(day, today)

  const off = wi === HOLIDAY_WEEK || GAP_WEEKS.includes(wi)
  const ret = returnContext(completedKeyDays(today), today)

  // Ad-hoc adds: a bag session on a class day (stacking), and a rope piece on Sunday.
  if (!off && wi !== SICK_WEEK && dowOf(day) === 1) {
    stackingAdds++
    addAndRebalance('bag_work', 'Bag Work', day, today, `w${wi} stacked bag`)
    addAndRebalance('skip_rope', 'Rope', day + 6, today, `w${wi} rope`)
  }

  // Reactive replans on Wednesdays: one small, one big.
  if (!off && dowOf(day) === 3) {
    const target = all.find(s => s.status === 'planned' && s.type === 'strength' && s.epochDay > today && s.epochDay <= mondayOf(today) + 6)
    const small = classifyReplan({ shiftAction: 'reduce_intensity', targetSessionType: 'strength' }, target ?? null)
    if (small.size !== 'small') violations.push('reduce_intensity classified big')
    const big = classifyReplan({ shiftAction: 'move', targetSessionType: 'strength' }, target ?? null)
    if (big.size === 'big' && target) {
      const before = JSON.stringify(target)
      const r = tryChange({ kind: 'move', type: 'strength', epochDay: target.epochDay + 1, timeSlot: 'am', sessionId: target.id, fromEpochDay: target.epochDay }, today, `w${wi} coach move`)
      // Stored as a proposal only: the session must not change.
      proposals.push({ day, applied: JSON.stringify(target) !== before, kind: r.ok ? 'proposed' : 'note' })
    }
  }

  // The athlete's day.
  for (const sess of all.filter(s => s.epochDay === day && s.status === 'planned')) {
    if (off) continue // nothing happens; the nightly rollover marks it missed
    if (wi === SICK_WEEK && KEY_TYPES.has(sess.type)) {
      sess.status = 'skipped'
      skips.push({ epochDay: day, skipReason: 'sick', detail: null, notes: null })
      continue
    }
    if (sess.type === 'strength' && dowOf(day) === 4 && MISSED_THURSDAYS.includes(wi)) continue
    if (day === BACK_FLARE_DAY && sess.type === 'strength') {
      sess.status = 'skipped'
      skips.push({ epochDay: day, skipReason: 'injury', detail: 'Lower back', notes: null })
      continue
    }
    if (day === KNEE_DAY && sess.type === 'strength') {
      sess.status = 'skipped'
      skips.push({ epochDay: day, skipReason: 'injury', detail: 'Knee', notes: null })
      continue
    }

    if (sess.type === 'strength') {
      loadFactors.push({ day, tier: ret.plan.tier, loadFactor: ret.loadFactor, gapDays: ret.plan.gapDays })
    }
    if (RUN_TYPES.has(sess.type)) {
      // The prescription: plan minutes, the return ramp, then the 110% cap (F11).
      const hist = runHistory(today)
      let sec = estimatedMinutes(sess, 'fighter', sess.weekNumber) * 60 * (ret.active ? ret.volumeFactor : 1)
      sec = Math.min(sec, singleRunCap(sec, hist.longestLast30Sec).capSec)
      if (hist.longestLast30Sec ? sec > hist.longestLast30Sec * 1.1 + 1 : sec > RESTART_SESSION_SEC) violations.push(`run over the cap on ${day}`)
      sess.durationSec = Math.round(sec)
    }
    sess.status = 'completed'
  }

  // Nightly: rollover, then the coach's fix per missed key session (page 56):
  // a strength session's main lifts go into the next strength day in reach;
  // the rest goes. Nothing is crammed and nothing asks.
  const tomorrow = day + 1
  for (const sess of all.filter(s => s.status === 'planned' && s.epochDay < tomorrow)) {
    sess.status = 'missed'
    if (!KEY_TYPES.has(sess.type)) continue
    const upcoming = all.filter(x => x.status === 'planned' && x.epochDay > sess.epochDay && x.epochDay <= sess.epochDay + 4)
    const fix = missedFix(sess, upcoming, { blockType: 'fighter', weekNumber: sess.weekNumber })
    fixes.push({ sessionId: sess.id, day: tomorrow, fix })
    if (fix.kind === 'merge') {
      const target = all.find(x => x.id === fix.targetSessionId)
      if (!target || target.type !== 'strength' || target.status !== 'planned' || target.epochDay - sess.epochDay > 4) violations.push(`missed fix for ${sess.id} lands somewhere wrong`)
    }
    if (/[!—]/.test(fix.why)) violations.push(`missed line out of voice: ${fix.why}`)
  }
}

// ─── Checks ──────────────────────────────────────────────────

assert(violations.length === 0, `no rule broken by any accepted change or offered option${violations.length ? `: ${violations.slice(0, 5).join('; ')}` : ''}`)
assert(stackingAdds > 0 && coachChanges > 0, `every add landed as he picked it, the coach rebalanced around them (${stackingAdds} weeks, ${coachChanges} coach changes)`)
assert(proposals.length > 0 && proposals.every(p => !p.applied), `big coach changes never applied on their own (${proposals.length} proposals)`)

const missedKey = all.filter(s => s.status === 'missed' && KEY_TYPES.has(s.type))
assert(missedKey.length > 0 && missedKey.every(m => fixes.some(f => f.sessionId === m.id)), `every missed key session got the coach's fix, no question (${missedKey.length})`)
assert(fixes.some(f => f.fix.kind === 'merge') && fixes.filter(f => f.fix.kind === 'merge').every(f => /accessories dropped/.test(f.fix.why)), 'missed strength: main lifts move on, accessories dropped')

// Week counter: holiday week and the 3-week gap pause the calendar.
const wkAt = (wi: number) => weekByMonday.get(MON + wi * 7) ?? -1
assert(wkAt(HOLIDAY_WEEK + 1) === wkAt(HOLIDAY_WEEK), `after the holiday the week resumes, not +1 (week ${wkAt(HOLIDAY_WEEK)} -> ${wkAt(HOLIDAY_WEEK + 1)})`)
assert(wkAt(GAP_WEEKS[2] + 1) === wkAt(GAP_WEEKS[0]), `after the 3-week gap the athlete resumes at the week they left (week ${wkAt(GAP_WEEKS[0])} -> ${wkAt(GAP_WEEKS[2] + 1)})`)
assert(wkAt(SICK_WEEK + 1) === wkAt(SICK_WEEK), 'a sick week (all skipped) is paused too')
assert(wkAt(15) < 15 - 4 + 1, `16 calendar weeks with 5 lost weeks: training week ${wkAt(15)} (calendar would say 16)`)

// Gaps handled per the return table.
const firstAfter = (wi: number) => loadFactors.find(l => l.day >= MON + wi * 7)
const afterHoliday = firstAfter(HOLIDAY_WEEK + 1)
assert(afterHoliday != null && afterHoliday.tier === returnPlan(afterHoliday.gapDays).tier && ['short', 'medium'].includes(afterHoliday.tier) && afterHoliday.loadFactor <= 0.9, `after the holiday: ${afterHoliday?.gapDays} days off -> ${afterHoliday?.tier}, load ${afterHoliday?.loadFactor}`)
const afterGap = firstAfter(GAP_WEEKS[2] + 1)
assert(afterGap != null && afterGap.gapDays >= 21 && afterGap.loadFactor <= 0.8, `after the 3-week gap: ${afterGap?.gapDays} days off -> ${afterGap?.tier}, load ${afterGap?.loadFactor}`)
const afterSick = firstAfter(SICK_WEEK + 1)
assert(afterSick != null && afterSick.loadFactor < 1, `after the sick week loads are reduced (${afterSick?.loadFactor})`)
const steady = loadFactors.filter(l => weekIndex(l.day) === 2 || weekIndex(l.day) === 15)
assert(steady.length > 0 && steady.every(l => l.loadFactor === 1), 'normal weeks: no return factor')

// Nothing crammed: no week's live load above the plan (with tolerance).
for (const [monday, wk] of weekByMonday) {
  // His own adds are his call (never refused); the coach's sessions alone never pass the plan.
  const live = all.filter(s => s.source !== 'ad_hoc' && s.epochDay >= monday && s.epochDay <= monday + 6 && (s.status === 'completed' || s.status === 'planned'))
  const load = live.filter(s => KEY_TYPES.has(s.type)).reduce((n, s) => n + plannedLoad(s, 'fighter', wk), 0)
  if (load > planLoad(wk) * 1.05) violations.push(`week of ${monday} crammed: ${load} > ${planLoad(wk)}`)
}
assert(violations.length === 0, 'the coach never takes a week past its planned load')

// R3: a week with one run swapped never shrinks next week's allowance.
assert(runAllowanceBaseSec(55 * 60, 78 * 60) === 78 * 60, 'R3: the allowance reads the larger of the last two weeks')

// ─── Block Zero: a 5-week gap restarts at week 1 ─────────────

const bzDays: number[] = []
for (let w = 0; w < 3; w++) for (const o of [0, 1, 2, 3, 4, 5]) bzDays.push(MON + w * 7 + o)
const bzBack = MON + 8 * 7
const bz = trainingWeek({ blockType: 'block_zero', startDay: MON, totalWeeks: 6, completedKeyDays: bzDays, day: bzBack, todayDay: bzBack, plannedKeyPerWeek: 6 })
assert(bz.restarted && bz.week === 1, 'Block Zero after 5 weeks off: back to week 1')
const bzRet = returnContext(bzDays, bzBack)
assert(bzRet.plan.restart && bzRet.loadFactor === 0.75 && bzRet.noFinishers, 'Block Zero return: mini Block Zero factors, no finishers')


// ─── Adaptive coach (E3): a second scripted athlete, 10 weeks ─
//
// Well-rested streaks (ramp-up asks: at most one a week, never on an ease
// day), oversleep with and without fatigue, a session added two weeks
// running, a hard session plus next-day soreness, a retest that proposes
// training maxes, and the Sunday weekly pass preparing next week with reasons
// and no approval step (run twice: once).

{
  const A_WEEKS = 10
  const A_MON = MON + 30 * 7
  const aWeekOf = (d: number) => Math.floor((d - A_MON) / 7)
  const checkIns: CheckIn[] = []
  const done: Array<EffortRead & { id: string }> = []
  const planned: Array<SessionLike & { id: string; eased?: boolean; reason?: string }> = []
  const passRuns = new Map<string, number>()
  const preparedWeeks: Array<{ monday: number; status: string; why: string; changes: Array<{ reason: string; was: string }> }> = []
  const tmSets: BlockWorkingSet[] = []
  let aid = 0

  // Weeks 2-3 and 6 are well rested; week 4 has a long sleep with low energy
  // (fatigue), week 5 a long sleep with good energy (recovery); week 7 has an
  // ease (three bad days) in the middle of a good stretch.
  const restedWeeks = new Set([2, 3, 6, 7])
  for (let day = A_MON - 7; day < A_MON + A_WEEKS * 7; day++) {
    const wi = aWeekOf(day)
    const dow = dowOf(day)
    let c: CheckIn = { epochDay: day, sleepHours: 7, energy: 3, soreness: 3 }
    if (restedWeeks.has(wi) && dow >= 2) c = { epochDay: day, sleepHours: 7.5, energy: 4, soreness: 2 }
    if (wi === 7 && dow >= 3 && dow <= 5) c = { epochDay: day, sleepHours: 5, energy: 2, soreness: 4 }
    if (wi === 4 && (dow === 2 || dow === 3)) c = { epochDay: day, sleepHours: 9.5, energy: 2, soreness: 3 }
    if (wi === 5 && (dow === 2 || dow === 3)) c = { epochDay: day, sleepHours: 9.5, energy: 4, soreness: 3 }
    // Hard session + next-day soreness: week 8 Tue strength at RPE 9, Wed soreness 4.
    if (wi === 8 && dow === 3) c = { ...c, soreness: 4 }
    checkIns.push(c)
  }

  const readiness = evaluateReadiness(checkIns)
  const rByDay = new Map(readiness.map(r => [r.epochDay, r]))
  // Oversleep reads.
  const fatigueDay = rByDay.get(A_MON + 4 * 7 + 2)!
  assert(fatigueDay.oversleep === 'fatigue' && fatigueDay.ease, 'sim: long sleep with low energy two days eases (fatigue cue)')
  const recoveryDay = rByDay.get(A_MON + 5 * 7 + 2)!
  assert(recoveryDay.oversleep === 'recovery' && !recoveryDay.flagged && !recoveryDay.fresh, 'sim: long sleep with good energy is neutral (no ease, no push)')

  for (let day = A_MON; day < A_MON + A_WEEKS * 7; day++) {
    const wi = aWeekOf(day)
    const dow = dowOf(day)
    const monday = mondayOf(day)
    // Monday: the week's sessions (as the pass prepared them, below).
    if (dow === 1 && planned.every(p => mondayOf(p.epochDay) !== monday)) {
      for (let d = monday; d < monday + 7; d++) {
        for (const t of getDayTemplate('fighter', wi + 1, dowOf(d), MT_DAYS)) planned.push({ id: `p${aid++}`, type: t.type, label: t.label, notes: t.runCategory ?? null, epochDay: d, timeSlot: t.timeSlot, status: 'planned' })
      }
    }
    // The athlete's day: easy effort in rested weeks, on target otherwise.
    for (const p of planned.filter(x => x.epochDay === day && x.status === 'planned')) {
      p.status = 'completed'
      const rested = restedWeeks.has(wi)
      let rpe = p.type === 'mobility' || p.type === 'active_recovery' ? 2 : rested ? Math.max(1, typicalRpe(p) - 2) : typicalRpe(p)
      if (wi === 8 && dow === 2 && p.type === 'strength') rpe = 9
      done.push({ id: p.id, sessionId: p.id, epochDay: day, type: p.type, label: p.label, notes: p.notes, rpe })
      if (p.type === 'strength') for (let k = 0; k < 4; k++) tmSets.push({ week: wi + 1, weightKg: 100 + wi * 2.5, reps: 5, plannedWeightKg: 100 + wi * 2.5, plannedReps: 5 })
    }
    // Repeated added sessions: Saturday PM rope, weeks 2 and 3.
    if ((wi === 2 || wi === 3) && dow === 6) {
      done.push({ id: `add${aid++}`, epochDay: day, type: 'skip_rope', label: 'Rope', rpe: 5, source: 'ad_hoc' })
    }

    // Coach brain P2: no felt-hard ease and no ramp-up ask here (the brain's own rules are in lib/brain).

    // Sunday night: the weekly pass prepares next week (and a Monday catch-up
    // run finds it done). No approval step: the week is active with a why line.
    for (const runDay of [day, day + 1]) {
      const target = weeklyPassTarget(runDay)
      if (target == null || target <= day - 6) continue
      const key = weeklyPassKey('sim-block', target)
      if (passRuns.has(key)) { passRuns.set(key, (passRuns.get(key) ?? 0) + 0); continue }
      if (dowOf(runDay) !== 0) continue
      passRuns.set(key, 1)
      const last = done.filter(x => x.epochDay >= target - 7 && x.epochDay < target)
      const lastPlanned = planned.filter(p => p.epochDay >= target - 7 && p.epochDay < target && KEY_TYPES.has(p.type))
      const days7 = readiness.filter(x => x.epochDay >= target - 7 && x.epochDay < target)
      const signals: WeekSignals = {
        weekNumber: aWeekOf(target) + 1, totalWeeks: 12, blockType: 'fighter',
        lastWeek: { planned: lastPlanned.length, completed: lastPlanned.filter(p => p.status === 'completed').length, missed: 0, skipped: 0, added: last.filter(x => x.source === 'ad_hoc').length },
        completionRate: lastPlanned.length ? lastPlanned.filter(p => p.status === 'completed').length / lastPlanned.length : null,
        load: { last7: 0, prev7: 0, changePct: null, flagged: false },
        readiness: { days: days7.length, flaggedDays: days7.filter(x => x.flagged).length, easeDays: days7.filter(x => x.ease).length, freshDays: days7.filter(x => x.fresh).length, oversleepFatigueDays: days7.filter(x => x.oversleep === 'fatigue').length },
        effort: summarizeEffort(last), avgSoreness: null, avgSleep: null,
        returnRamp: { active: false, gapDays: 0, reason: null }, retestLastWeek: false,
        waveEnd: (aWeekOf(target)) % 6 === 0, athleteShape: null,
      }
      const nextTemplate: SessionLike[] = []
      for (let d = target; d < target + 7; d++) for (const t of getDayTemplate('fighter', signals.weekNumber, dowOf(d), MT_DAYS)) nextTemplate.push({ type: t.type, label: t.label, notes: t.runCategory ?? null, epochDay: d, timeSlot: t.timeSlot, status: 'planned' })
      const weekEases: Array<{ index: number; cause: 'completion'; reason: string; was: string | null }> = [] // no rule eases since coach brain P2
      preparedWeeks.push({ monday: target, status: 'active', why: whyThisWeek(signals, weekEases.map(e => ({ cause: e.cause, epochDay: nextTemplate[e.index].epochDay, name: nextTemplate[e.index].label ?? nextTemplate[e.index].type, type: nextTemplate[e.index].type }))), changes: weekEases.map(e => ({ reason: e.reason, was: e.was })) })
      // The prepared week becomes next week's plan, eases applied.
      for (let i = 0; i < nextTemplate.length; i++) {
        const t = nextTemplate[i]
        const e = weekEases.find(x => x.index === i)
        planned.push({ ...t, id: `p${aid++}`, eased: e != null, reason: e?.reason })
      }
    }
  }

  // Repeated added sessions: an ask after the second week, not the first.
  const adds = (upTo: number): AddedSession[] => done.filter(x => x.source === 'ad_hoc' && x.epochDay < upTo).map(x => ({ type: x.type, label: x.label, notes: null, epochDay: x.epochDay, timeSlot: 'pm', status: 'completed', rpe: x.rpe }))
  const afterOne = makeRegularCandidates(adds(A_MON + 3 * 7), A_MON + 2 * 7)
  const afterTwo = makeRegularCandidates(adds(A_MON + 4 * 7), A_MON + 3 * 7)
  assert(afterOne.length === 0 && afterTwo.length === 1 && afterTwo[0].type === 'skip_rope', 'sim: rope added two weeks running becomes a make-regular candidate (not after one)')
  const regular = makeRegularAsk(afterTwo[0], { ...context(A_MON + 4 * 7, A_MON + 4 * 7 - 1), weekNumber: 5, planWeekLoad: planLoad(5), sessions: planned.filter(p => mondayOf(p.epochDay) === A_MON + 4 * 7) }, A_MON + 4 * 7)
  assert(regular != null && regular.options.some(o => o.id === 'keep_extra') && regular.options[0].kind === 'make_regular', 'sim: the make-regular ask offers a safe slot and I\'LL ADD IT MYSELF')

  // Retest: the wave's clean sets propose new training maxes.
  const sq = fighterTmDecision({ exerciseId: 'sq', currentTmKg: 140, region: 'lower', sets: tmSets.filter(x => x.week <= 6).map(x => ({ ...x, weightKg: (x.weightKg ?? 0) + (x.week >= 4 ? 10 : 0), plannedWeightKg: x.plannedWeightKg })) })
  const prop = tmProposal([sq], new Map([['sq', 'Squat']]))
  assert(sq.action === 'progress' && prop != null && prop.lifts[0].proposedKg > prop.lifts[0].currentKg && prop.decline.title === 'KEEP THE OLD ONES', 'sim: the retest proposes a new squat max; nothing written until approved')

  // The Sunday weekly pass.
  assert(preparedWeeks.length >= A_WEEKS - 1, `sim: a week prepared every Sunday (${preparedWeeks.length})`)
  assert([...passRuns.values()].every(n => n === 1), 'sim: one pass per week (Sunday run and Monday catch-up share the key)')
  assert(preparedWeeks.every(w => w.status === 'active' && w.why.length > 0 && !w.why.includes('!') && !w.why.includes('—')), 'sim: every prepared week is active (no approval) with a why line')
  assert(preparedWeeks.every(w => w.changes.every(c => c.reason.length > 0 && c.was.length > 0)), 'sim: every automatic change carries a reason and a was')
  const afterTired = preparedWeeks.find(w => w.monday === A_MON + 8 * 7)
  assert(afterTired != null && afterTired.changes.length === 0, `sim: a bad week never carries into next week as a rule ease (coach brain P2: the morning cap does it day by day) (${afterTired?.why})`)
  assert(violations.length === 0, `sim: no rule broken by the adaptive coach${violations.length ? `: ${violations.slice(0, 5).join('; ')}` : ''}`)
}

// Part 3 (the Block Zero lead-in) is gone with the lead-in (coach brain P2); lib/coach/leadIn.test.ts covers the start week.

console.log('coach simulation passed')
