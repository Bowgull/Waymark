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
// takes a 5-week gap. Checks: no placement rule broken by any accepted change,
// gaps handled per the return table, the week counter pauses, nothing crammed,
// big changes never applied on their own, and every missed session produces
// an ask with only safe options.

import { getDayTemplate } from '../weeklyTemplate'
import { keySessionCompletionRate, prescribeRunWalk, singleRunCap, weeklyRunAllowanceSec, RESTART_SESSION_SEC } from '../blockZero'
import {
  KEY_TYPES,
  RUN_TYPES,
  anchorMondayFor,
  checkSessionChange,
  inLeadIn,
  optionalDay,
  pickDayOption,
  planDayTemplate,
  classifyReplan,
  estimatedMinutes,
  injuryFlag,
  missedSessionOptions,
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
  blockZeroEffortTarget,
  consistentlyEasier,
  noEasierReadFor,
  feltHardEase,
  fighterTmDecision,
  freshStreak,
  makeRegularAsk,
  makeRegularCandidates,
  rampUpAsk,
  summarizeEffort,
  tmProposal,
  typicalRpe,
  weekRuleEases,
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
const backNotes: Array<{ epochDay: number; text: string | null }> = []
const asks: Array<{ sessionId: string; day: number; options: ReturnType<typeof missedSessionOptions>['options'] }> = []
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
    injury: injuryFlag(skips, backNotes, today),
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

let stackingAttempts = 0
let stackingRefused = 0

for (let day = MON; day < MON + WEEKS * 7; day++) {
  const today = day
  const wi = weekIndex(day)
  if (dowOf(day) === 1) generateWeek(day, today)

  const off = wi === HOLIDAY_WEEK || GAP_WEEKS.includes(wi)
  const flag = injuryFlag(skips, backNotes, today)
  const ret = returnContext(completedKeyDays(today), today)

  // Ad-hoc adds: a bag session on a class day (stacking), and a rope piece on Sunday.
  if (!off && wi !== SICK_WEEK && dowOf(day) === 1) {
    stackingAttempts++
    const r = tryChange({ kind: 'add', type: 'bag_work', label: 'Bag Work', epochDay: day, timeSlot: 'am' }, today, `w${wi} stacked bag`)
    if (!r.ok) stackingRefused++ // stacked_hard, or an earlier rule (injury flag) first
    const rope = tryChange({ kind: 'add', type: 'skip_rope', label: 'Rope', epochDay: day + 6, timeSlot: 'am' }, today, `w${wi} rope`)
    if (rope.ok) all.push({ id: `a${nextId++}`, type: 'skip_rope', label: 'Rope', epochDay: day + 6, timeSlot: rope.change.timeSlot, status: 'planned', weekNumber: weekByMonday.get(mondayOf(day)) ?? 1, source: 'ad_hoc' })
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
      backNotes.push({ epochDay: day, text: 'Stiff and achy after the deadlifts.' })
      continue
    }
    if (day === KNEE_DAY && sess.type === 'strength') {
      sess.status = 'skipped'
      skips.push({ epochDay: day, skipReason: 'injury', detail: 'Knee', notes: null })
      continue
    }
    // Injury flags apply to sessions touching the region (no red flag in this script).
    if (flag?.redFlag && KEY_TYPES.has(sess.type)) violations.push(`loaded on a red flag day ${day}`)

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

  // Nightly: rollover, then an ask per missed key session; the athlete takes
  // the first move sometimes. Nothing is rescheduled without an answer.
  const tomorrow = day + 1
  for (const sess of all.filter(s => s.status === 'planned' && s.epochDay < tomorrow)) {
    sess.status = 'missed'
    if (!KEY_TYPES.has(sess.type)) continue
    const ctx = context(sess.epochDay, tomorrow)
    const ask = missedSessionOptions(sess, ctx)
    asks.push({ sessionId: sess.id, day: tomorrow, options: ask.options })
    for (const o of ask.options) {
      if (o.kind === 'drop') continue
      const change = o.kind === 'move'
        ? { kind: 'add' as const, type: sess.type, label: sess.label, notes: sess.notes, epochDay: o.epochDay, timeSlot: o.timeSlot }
        : { kind: 'add' as const, type: o.type, label: o.label, notes: o.notes ?? null, epochDay: o.epochDay, timeSlot: o.timeSlot }
      if (o.epochDay < tomorrow || mondayOf(o.epochDay) !== mondayOf(sess.epochDay)) violations.push(`ask option outside the week for ${sess.id}`)
      if (!checkSessionChange(change, ctx, { alternatives: false }).ok) violations.push(`unsafe ask option for ${sess.id}`)
    }
    const move = ask.options.find(o => o.kind === 'move')
    if (move && move.kind === 'move' && sess.type === 'strength' && !off) {
      const r = tryChange({ kind: 'add', type: sess.type, label: sess.label, notes: sess.notes, epochDay: move.epochDay, timeSlot: move.timeSlot }, tomorrow, `accept move ${sess.id}`)
      if (r.ok) all.push({ id: `c${nextId++}`, type: sess.type, label: sess.label, notes: sess.notes, epochDay: move.epochDay, timeSlot: r.change.timeSlot, status: 'planned', weekNumber: sess.weekNumber, source: 'coach' })
    }
  }
}

// ─── Checks ──────────────────────────────────────────────────

assert(violations.length === 0, `no rule broken by any accepted change or offered option${violations.length ? `: ${violations.slice(0, 5).join('; ')}` : ''}`)
assert(stackingAttempts > 0 && stackingRefused === stackingAttempts, `every stacking attempt refused (${stackingRefused}/${stackingAttempts})`)
assert(proposals.length > 0 && proposals.every(p => !p.applied), `big coach changes never applied on their own (${proposals.length} proposals)`)

const missedKey = all.filter(s => s.status === 'missed' && KEY_TYPES.has(s.type))
assert(missedKey.length > 0 && missedKey.every(m => asks.some(a => a.sessionId === m.id)), `every missed key session produced an ask (${missedKey.length})`)
assert(asks.every(a => a.options[0].kind === 'drop'), 'every ask offers to let it go')

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
  const live = all.filter(s => s.epochDay >= monday && s.epochDay <= monday + 6 && (s.status === 'completed' || s.status === 'planned'))
  const load = live.filter(s => KEY_TYPES.has(s.type)).reduce((n, s) => n + plannedLoad(s, 'fighter', wk), 0)
  if (load > planLoad(wk) * 1.05) violations.push(`week of ${monday} crammed: ${load} > ${planLoad(wk)}`)
}
assert(violations.length === 0, 'no week went past its planned load')

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
  const rampAsks: Array<{ day: number; easeToday: boolean; streak: number }> = []
  const passRuns = new Map<string, number>()
  const preparedWeeks: Array<{ monday: number; status: string; why: string; changes: Array<{ reason: string; was: string }> }> = []
  const easeLog: Array<{ day: number; target: string; reason: string }> = []
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

    // Nightly: felt hard (next-morning soreness), then the ramp-up rule.
    const upcoming = planned.filter(p => p.status === 'planned' && p.epochDay > day)
    for (const d of done.filter(x => x.epochDay === day - 1)) {
      const ease = feltHardEase({ done: d, nextMorningSoreness: rByDay.get(day)?.epochDay === day ? checkIns.find(ci => ci.epochDay === day)?.soreness ?? null : null, upcoming, todayEpochDay: day, nowSec: day * 86400 })
      if (!ease) continue
      const t = planned.find(p => p.id === ease.targetSessionId)!
      t.eased = true
      t.reason = ease.ease.reason
      easeLog.push({ day, target: t.type, reason: ease.ease.reason })
    }
    const r = rByDay.get(day)
    const easeToday = Boolean(r?.ease) || planned.some(p => p.epochDay === day && p.eased)
    const askedThisWeek = rampAsks.some(a => mondayOf(a.day) === monday)
    const effort = summarizeEffort(done.filter(x => x.epochDay >= day - 7 && x.epochDay < day))
    const weekSessions = planned.filter(p => mondayOf(p.epochDay) === monday)
    const ask = rampUpAsk(
      { todayEpochDay: day, readiness: readiness.filter(x => x.epochDay <= day), effort, liftPush: false, easeToday, noPush: false, askedThisWeek },
      { ctx: { ...context(day, day), weekNumber: wi + 1, planWeekLoad: planLoad(wi + 1), sessions: weekSessions, easeDays: weekSessions.filter(p => p.eased).map(p => p.epochDay) }, upcoming: weekSessions.filter(p => p.status === 'planned'), blockType: 'fighter', weekNumber: wi + 1, liftPush: false, classDays: MT_DAYS },
    )
    if (ask) {
      rampAsks.push({ day, easeToday, streak: freshStreak(readiness.filter(x => x.epochDay <= day), day) })
      for (const o of ask.options) {
        if (o.epochDay < day || mondayOf(o.epochDay) !== monday) violations.push(`ramp option outside the week on ${day}`)
        if (o.kind === 'add' && !checkSessionChange({ kind: 'add', type: o.type, label: o.sessionLabel, epochDay: o.epochDay, timeSlot: o.timeSlot }, { ...context(day, day), sessions: weekSessions, planWeekLoad: null }, { alternatives: false }).ok) violations.push(`unsafe ramp add on ${day}`)
        if (weekSessions.some(p => p.eased && p.epochDay === o.epochDay)) violations.push(`ramp option on an eased day ${o.epochDay}`)
      }
    }

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
      const weekEases = weekRuleEases(signals, nextTemplate)
      preparedWeeks.push({ monday: target, status: 'active', why: whyThisWeek(signals, weekEases), changes: weekEases.map(e => ({ reason: e.reason, was: e.was })) })
      // The prepared week becomes next week's plan, eases applied.
      for (let i = 0; i < nextTemplate.length; i++) {
        const t = nextTemplate[i]
        const e = weekEases.find(x => x.index === i)
        planned.push({ ...t, id: `p${aid++}`, eased: e != null, reason: e?.reason })
      }
    }
  }

  // Ramp-up asks.
  assert(rampAsks.length >= 2, `sim: well-rested streaks produced ramp-up asks (${rampAsks.length})`)
  const perWeek = new Map<number, number>()
  for (const a of rampAsks) perWeek.set(mondayOf(a.day), (perWeek.get(mondayOf(a.day)) ?? 0) + 1)
  assert([...perWeek.values()].every(n => n <= 1), 'sim: at most one ramp-up ask a week')
  assert(rampAsks.every(a => !a.easeToday && a.streak >= 2), 'sim: never on an ease day, always after a 2-day fresh streak')
  assert(rampAsks.every(a => restedWeeks.has(aWeekOf(a.day))), 'sim: asks only in well-rested weeks')
  assert(!rampAsks.some(a => aWeekOf(a.day) === 5), 'sim: long sleep with good energy never triggers a push')

  // Hard session + next-day soreness.
  const w8 = easeLog.find(e => aWeekOf(e.day) === 8)
  assert(w8 != null && w8.target === 'strength' && w8.reason.includes('eases'), `sim: RPE 9 then soreness 4 eases the next strength day (${w8?.reason})`)

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
  assert(afterTired != null && afterTired.changes.length >= 1, `sim: after the week with three bad check-in days the next week eases (${afterTired?.why})`)
  assert(violations.length === 0, `sim: no rule broken by the adaptive coach${violations.length ? `: ${violations.slice(0, 5).join('; ')}` : ''}`)
}

// ─── Part 3: Block Zero mid-week starts (Part B lead-in) ──────
// A Wednesday start and a Saturday start, day by day through week 2, the way
// the server calls the rules: the day's template (planDayTemplate), the week
// counter, missed asks only from week 1's Monday, the run cap floor, intro
// strength on a lead-in day, felt-easy reads by week, and the board's picks.
function simulateStart(startDay: number, name: string) {
  const anchor = anchorMondayFor(startDay, 'block_zero')
  const end = anchor + 13
  const sess: Array<SessionLike & { id: string; durationSec?: number; rpe?: number; rir?: number; leadIn: boolean }> = []
  const asked: string[] = []
  const bzViolations: string[] = []
  const reads: EffortRead[] = []
  let id = 0
  const done = (upTo: number) => sess.filter(x => x.status === 'completed' && KEY_TYPES.has(x.type) && x.epochDay <= upTo).map(x => x.epochDay)
  const week = (day: number, today: number) => trainingWeek({ blockType: 'block_zero', startDay, totalWeeks: 6, completedKeyDays: done(today), day, todayDay: today, plannedKeyPerWeek: 6 })
  const bzPlanLoad = (w: number) => {
    let n = 0
    for (let d = 0; d < 7; d++) for (const t of getDayTemplate('block_zero', w, d, MT_DAYS)) if (KEY_TYPES.has(t.type)) n += plannedLoad({ type: t.type, label: t.label, notes: null, estimatedMin: null }, 'block_zero', w)
    return n
  }
  const runHist = (today: number) => {
    const runs = sess.filter(x => x.status === 'completed' && RUN_TYPES.has(x.type))
    const monday = mondayOf(today)
    return {
      longestLast30Sec: runs.filter(r => r.epochDay >= today - 30 && r.epochDay < today).reduce((m, r) => Math.max(m, r.durationSec ?? 0), 0) || null,
      lastWeekRunSec: runs.filter(r => r.epochDay >= monday - 7 && r.epochDay < monday).reduce((n, r) => n + (r.durationSec ?? 0), 0),
      thisWeekRunSec: runs.filter(r => r.epochDay >= monday && r.epochDay < today).reduce((n, r) => n + (r.durationSec ?? 0), 0),
    }
  }
  const bzCtx = (target: number, today: number): PlacementContext => {
    const tw = week(Math.max(target, today), today)
    const lead = inLeadIn('block_zero', startDay, target)
    const monday = mondayOf(target)
    return {
      blockType: 'block_zero', weekNumber: tw.week, todayEpochDay: today, sessions: sess.filter(x => x.epochDay >= monday - 1 && x.epochDay <= monday + 7),
      readinessEase: false, loadFlag: false, easeReason: null, easeDays: [], run: runHist(today),
      mt: { weeksSinceRampStart: null, profileCap: null }, planWeekLoad: lead ? null : bzPlanLoad(tw.week), injury: null, leadIn: lead,
    }
  }

  for (let day = startDay - 3; day <= end; day++) {
    const tw = week(day, day)
    const plan = planDayTemplate({ blockType: 'block_zero', startDay, epochDay: day, weekNumber: tw.week, mtDays: MT_DAYS })
    if (day < startDay && plan.sessions.length > 0) bzViolations.push(`${name}: sessions before the start on +${day - startDay}`)
    if (plan.leadIn !== tw.leadIn && day >= startDay) bzViolations.push(`${name}: lead-in flag disagrees on +${day - startDay}`)
    for (const t of plan.sessions) sess.push({ id: `${name}${id++}`, type: t.type, label: t.label, epochDay: day, timeSlot: t.timeSlot, status: 'planned', leadIn: plan.leadIn })

    // The athlete: Foundation daily; the first lead-in run done, the second missed.
    const today = sess.filter(x => x.epochDay === day)
    for (const x of today) {
      if (x.type === 'mobility') x.status = 'completed'
      if (x.type === 'foundation_run') {
        const leadRuns = sess.filter(r => r.leadIn && r.type === 'foundation_run' && r.epochDay < day)
        if (x.leadIn && leadRuns.length >= 1) { x.status = 'missed'; continue }
        const p = prescribeRunWalk({ week: tw.week, longestLast30Sec: runHist(day).longestLast30Sec, weekly: { lastWeekRunSec: runHist(day).lastWeekRunSec, thisWeekSoFarSec: runHist(day).thisWeekRunSec, sessionsLeftThisWeek: sess.filter(r => RUN_TYPES.has(r.type) && r.epochDay >= day && r.epochDay <= mondayOf(day) + 6 && r.status === 'planned').length } })
        if (!x.leadIn && tw.week === 1 && p.totalSec < RESTART_SESSION_SEC) bzViolations.push(`${name}: week-1 run shrunk to ${p.totalSec}s after the lead-in`)
        x.status = 'completed'
        x.durationSec = p.totalSec
      }
      if (x.type === 'strength') {
        // Week 2's Monday A is missed on the Saturday start (the pull-forward case).
        if (name === 'sat' && tw.week === 2 && dowOf(day) === 1) { x.status = 'missed'; continue }
        x.status = 'completed'
        const info = { type: 'strength', blockType: 'block_zero', blockWeek: tw.week, leadIn: x.leadIn, weekNumber: tw.week }
        // "3 or more" left at the top of the band, every session.
        reads.push({ epochDay: day, type: 'strength', rpe: tw.week <= 2 ? 6 : 7, rir: 3, target: blockZeroEffortTarget(info), noEasierRead: noEasierReadFor(info) })
      }
    }

    // Lead-in strength: pick it on the first lead-in Friday (or Saturday) the board allows.
    if (inLeadIn('block_zero', startDay, day) && (dowOf(day) === 5 || dowOf(day) === 6) && !sess.some(x => x.leadIn && x.type === 'strength')) {
      const pick = pickDayOption({ type: 'strength', timeSlot: 'am' }, day, bzCtx(day, day))
      if (pick.action.kind === 'add') {
        if (!checkSessionChange({ kind: 'add', type: 'strength', label: pick.action.label, epochDay: day, timeSlot: pick.action.timeSlot }, bzCtx(day, day), { alternatives: false }).ok) bzViolations.push(`${name}: board offered an intro that the route refuses`)
        sess.push({ id: `${name}${id++}`, type: 'strength', label: pick.action.label, epochDay: day, timeSlot: pick.action.timeSlot, status: 'completed', leadIn: true })
        const info = { type: 'strength', blockType: 'block_zero', blockWeek: 1, leadIn: true, weekNumber: 1 }
        reads.push({ epochDay: day, type: 'strength', rpe: 4, rir: 3, target: blockZeroEffortTarget(info), noEasierRead: noEasierReadFor(info) })
      }
    }

    // The nightly asks: missed key sessions from week 1's Monday only.
    for (const m of sess.filter(x => x.status === 'missed' && KEY_TYPES.has(x.type) && x.epochDay < day && !asked.includes(x.id))) {
      if (optionalDay('block_zero', startDay, m.epochDay)) continue
      asked.push(m.id)
      const ask = missedSessionOptions(m, bzCtx(m.epochDay, day))
      for (const o of ask.options) {
        if (o.kind === 'drop') continue
        const ok = checkSessionChange({ kind: 'add', type: o.kind === 'move' ? m.type : o.type, label: o.kind === 'move' ? m.label : o.label, epochDay: o.epochDay, timeSlot: o.timeSlot }, bzCtx(o.epochDay, day), { alternatives: false }).ok
        if (!ok) bzViolations.push(`${name}: unsafe missed option ${JSON.stringify(o)}`)
      }
    }
  }
  return { anchor, sess, asked, bzViolations, reads, bzCtx, week }
}

for (const [startOffset, name] of [[2, 'wed'], [5, 'sat']] as const) {
  const START_DAY = MON + startOffset
  const r = simulateStart(START_DAY, name)
  const lead = r.sess.filter(x => x.epochDay < r.anchor)
  assert(r.anchor === MON + 7 && lead.every(x => x.leadIn && x.epochDay >= START_DAY), `${name} start: week 1 is the next Monday; lead-in only from the start day`)
  assert(!lead.some(x => x.type === 'strength' && x.label !== 'Strength C'), `${name} start: no week-1 strength in the lead-in (only the intro picked: ${lead.filter(x => x.type === 'strength').map(x => x.label).join(', ') || 'none'})`)
  const leadRuns = lead.filter(x => x.type === 'foundation_run').map(x => dowOf(x.epochDay))
  assert(leadRuns.join() === (name === 'wed' ? '4,6' : '6'), `${name} start: lead-in run-walks on ${leadRuns.join(',')} (Tue/Thu/Sat from the start)`)
  assert(lead.filter(x => x.type === 'mobility').length === MON + 7 - START_DAY, `${name} start: Foundation every lead-in day`)
  assert(!r.asked.some(id => lead.some(x => x.id === id)), `${name} start: a missed lead-in session makes no question`)
  assert(r.week(r.anchor, r.anchor).week === 1 && !r.week(r.anchor, r.anchor).leadIn && r.week(r.anchor + 7, r.anchor + 7).week === 2, `${name} start: week 1 on the Monday, week 2 a week later (the lead-in never counts a week)`)
  const w1 = r.sess.filter(x => x.epochDay >= r.anchor && x.epochDay < r.anchor + 7 && x.type === 'strength').map(x => `${dowOf(x.epochDay)}${x.label?.slice(-1)}`)
  assert(w1.join() === '1A,3B,5C', `${name} start: week 1 runs the full A/B/C week (${w1.join()})`)
  const w1Runs = r.sess.filter(x => x.epochDay >= r.anchor && x.epochDay < r.anchor + 7 && x.type === 'foundation_run')
  assert(w1Runs.length === 3 && w1Runs.every(x => x.durationSec === RESTART_SESSION_SEC), `${name} start: week 1 keeps three full 23-min run-walks after the lead-in (run cap floor)`)
  assert(weeklyRunAllowanceSec(RESTART_SESSION_SEC) === RESTART_SESSION_SEC * 3, `${name} start: one lead-in run sets an allowance of week-1 volume, not 30 min`)
  // Gate consistency from week 1's Monday: the missed lead-in run is not counted.
  const counted = r.sess.filter(x => !optionalDay('block_zero', START_DAY, x.epochDay))
  const rateAll = keySessionCompletionRate(r.sess.map(x => ({ type: x.type, status: x.status, scheduledDate: x.epochDay })), r.anchor + 14)
  const rate = keySessionCompletionRate(counted.map(x => ({ type: x.type, status: x.status, scheduledDate: x.epochDay })), r.anchor + 14)
  assert(rate != null && (name === 'sat' ? rate < 1 : rate === 1) && (name === 'wed' ? (rateAll ?? 1) < 1 : true), `${name} start: consistency counts from week 1 (${rate?.toFixed(2)}${name === 'wed' ? `, ${rateAll?.toFixed(2)} if the lead-in counted` : ''})`)
  // No false push in weeks 1-2: on-target "3 or more" sets, intro included.
  assert(!consistentlyEasier(summarizeEffort(r.reads)), `${name} start: weeks 1-2 on target never read as "ready to push"`)
  assert(r.bzViolations.length === 0, `${name} start: no rule broken${r.bzViolations.length ? `: ${r.bzViolations.slice(0, 4).join('; ')}` : ''}`)
}

// The Wednesday start picks an intro strength on lead-in Friday: Strength C, at the intro band.
{
  const r = simulateStart(MON + 2, 'wed')
  const intro = r.sess.find(x => x.leadIn && x.type === 'strength')
  assert(intro?.label === 'Strength C' && dowOf(intro.epochDay) === 5, 'wed start: intro Strength C on lead-in Friday')
  const sat = pickDayOption({ type: 'strength', timeSlot: 'am' }, MON + 5, r.bzCtx(MON + 5, MON + 5))
  assert(sat.action.kind === 'refused' && /back to back/.test(sat.line ?? ''), `wed start: no intro the day after another (${sat.line})`)
  // Week 2 Tuesday: strength after Monday's A is refused; bag is offered as the run's swap.
  const tue = r.anchor + 8
  const str = pickDayOption({ type: 'strength', timeSlot: 'am' }, tue, r.bzCtx(tue, tue))
  assert(str.action.kind === 'refused', `wed start, week 2 Tuesday: no strength pulled forward after Monday's A (${str.line})`)
  const morning: PlacementContext = { ...r.bzCtx(tue, tue), sessions: r.bzCtx(tue, tue).sessions.map(x => (x.epochDay >= tue ? { ...x, status: 'planned' } : x)) }
  const bag = pickDayOption({ type: 'bag_work', timeSlot: 'pm' }, tue, morning)
  assert(bag.action.kind === 'replace' && bag.line === "Instead of today's run-walk.", `wed start, week 2 Tuesday at its planned load: bag is offered as the run's swap (${bag.line})`)
}
// The Saturday start misses week 2's Monday A: Tuesday's board pulls Wednesday's B forward.
{
  const r = simulateStart(MON + 5, 'sat')
  const tue = r.anchor + 8
  const ctx2 = r.bzCtx(tue, tue)
  const plannedTue = ctx2.sessions.filter(x => x.epochDay === tue)
  // Put Tuesday back as planned (the sim ran through week 2), as the board would see it that morning.
  const morning: PlacementContext = { ...ctx2, sessions: ctx2.sessions.map(x => (x.epochDay >= tue ? { ...x, status: 'planned' } : x)) }
  const str = pickDayOption({ type: 'strength', timeSlot: 'am' }, tue, morning)
  assert(plannedTue.length > 0 && str.action.kind === 'pull_forward' && str.action.fromEpochDay === tue + 1, `sat start, week 2 Tuesday after a missed Monday: ${str.line}`)
  const bag = pickDayOption({ type: 'bag_work', timeSlot: 'pm' }, tue, morning)
  assert(bag.action.kind === 'add', 'sat start, week 2 Tuesday: with Monday missed the week has room, so bag is a plain add')
}

console.log('coach simulation passed')
