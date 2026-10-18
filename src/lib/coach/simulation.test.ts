// Run: tsx src/lib/coach/simulation.test.ts
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
import { singleRunCap, RESTART_SESSION_SEC } from '../blockZero'
import {
  KEY_TYPES,
  RUN_TYPES,
  checkSessionChange,
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
    const load = ctx.sessions.filter(s => s.epochDay >= mondayOf(change.epochDay) && s.epochDay <= mondayOf(change.epochDay) + 6 && s.status !== 'missed' && s.status !== 'skipped' && s.id !== change.sessionId)
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

console.log('coach simulation passed')
