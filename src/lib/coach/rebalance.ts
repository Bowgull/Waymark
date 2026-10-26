// The rebalance (spec "coach-changes-and-swaps" §3, R1-R12; page 56). His
// pick is never refused or changed: after any change he makes (replace, skip,
// add, pull forward) the coach adjusts OTHER sessions, quietly, and each
// adjustment is a change record with its rune and UNDO. No AI in the loop.
// Pure: the server loads the week as it is after his action and applies what
// this returns.
//
// Limits on what the coach does (§3, "Size rules now"): at most 2 changes per
// action, moves of 1 day. Anything bigger it simply doesn't do. Held sessions
// (a coach change he undid) are left alone that week. Sessions already eased
// are not eased again.
//
// Rules, in order:
//   R4  rope for a run is like for like: nothing else moves.
//   R8  a pick on a rough day / little sleep (or a stress skip): the next day's
//       hard session drops a set, even with only two hard days in a row.
//   R9  a hard pick on an easing day: the next hard day eases instead.
//   R5  three hard days in a row: the third one he didn't choose drops a set.
//   R5b three conditioning sessions on one day (page 56, Thursday): the next
//       run this week is one round shorter.
//   R11 Block Zero lifting on two days running: the other day drops a set.
//   R6  heavy legs and leg interference 24 h apart (F6): the other session
//       moves a day, else eases.
//   R7  no long run within 24 h after heavy legs or hard bag: the run eases.
//   R1  a run he skipped (or swapped for something that isn't conditioning)
//       moves to the next day when that day has no run; else R2: it goes,
//       runs don't stack.
//   R12 an injury flag: hard work never moves onto that region (placement).
//   R3  the weekly run allowance reads the larger of the last two weeks, so
//       one swap never shrinks next week's runs (runAllowanceBaseSec).
//   Load (F14): his pick takes the week past its planned load: the next hard
//       session drops a set (only when nothing else changed).

import { getRunWalkWeek, runWalkTotalSec } from '../blockZero/running'
import { getStrengthWeekTarget } from '../blockZero/strength'
import { getStrengthTemplate } from '../strengthTemplates'
import { backOnly, dayToken, letterOf, nameToken, roundsWord, setsReps } from './changes'
import { checkSessionChange, type PlacementContext } from './placement'
import {
  DAY_NAMES,
  RECOVERY_TYPES,
  RUN_TYPES,
  dowOf,
  estimatedMinutes,
  hoursBetween,
  isHard,
  isHeavyLegs,
  isLegInterference,
  isLongRun,
  mondayOf,
  plannedLoad,
  nameInSentence, sessionName,
  type SessionLike,
  type TimeSlot,
} from './sessions'

export const MAX_COACH_CHANGES = 2
/** Load tolerance before his pick counts as past the plan (same as placement). */
const PLAN_LOAD_TOLERANCE = 1.05
/** A coach ease on a run that isn't a run-walk: about 80% of the time. */
export const EASED_RUN_SHARE = 0.8

export type RebalanceRule = 'R1' | 'R5' | 'R5b' | 'R6' | 'R7' | 'R8' | 'R9' | 'R11' | 'load'

/** Reasons a pick or skip carries (REPLACE_REASONS and SKIP_REASONS codes). */
export const STRESS_REASONS: ReadonlySet<string> = new Set(['rough_day', 'low_sleep', 'tired', 'sick'])

export type RebalanceSession = SessionLike & { id: string; eased?: boolean }

export interface RebalanceAction {
  kind: 'swap' | 'skip' | 'add' | 'pull_forward'
  /** His session: the one added, swapped in, pulled forward, or skipped. */
  session: RebalanceSession
  /** swap: the session swapped away. */
  replaced?: RebalanceSession | null
  /** The optional reason tile (code), e.g. 'rough_day'. */
  reason: string | null
}

export interface RebalanceInput {
  action: RebalanceAction
  /** The week (and a day either side) as it is after his action. */
  week: RebalanceSession[]
  /** Placement context for the week; its sessions are replaced by `week`. */
  ctx: PlacementContext
  /** Sessions the coach leaves alone this week (he undid a change on them). */
  held: ReadonlySet<string>
}

export type CoachEasePlan =
  | { kind: 'one_set'; sets: number; reps: number }
  | { kind: 'rounds'; rounds: number; fromRounds: number; minutes: number; fromMinutes: number }
  | { kind: 'reduce'; minutes: number | null; fromMinutes: number | null }

export interface CoachChangePlan {
  rule: RebalanceRule
  kind: 'ease' | 'move'
  /** The session it changes (move: the run it keeps; a copy lands on the new day). */
  sessionId: string
  ease?: CoachEasePlan
  move?: { epochDay: number; timeSlot: TimeSlot }
  /** The flaps: before -> after ("3×8" -> "2×8"); the log's before when it differs ("B 3×8"). */
  show: { before: string; after: string; logBefore?: string }
  /** One plain line with real numbers; tokens per renderWhy. */
  why: string
  detail: string | null
  /** The day's back once it is put back; tokens per renderWhy. */
  put: { line: string; dim: string }
}

// ─── R3: one swap mustn't shrink next week ───────────────────

/** The weekly run allowance's base: the larger of the last two weeks' run time. */
export function runAllowanceBaseSec(lastWeekSec: number, weekBeforeSec: number): number {
  return Math.max(Math.max(0, lastWeekSec), Math.max(0, weekBeforeSec))
}

// ─── Words ───────────────────────────────────────────────────

const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const LIVE = new Set(['planned', 'in_progress', 'completed'])
const CONDITIONING: ReadonlySet<string> = new Set(['foundation_run', 'running', 'bag_work', 'bag_conditioning', 'skip_rope', 'mt_class'])

function dayLong(d: number): string {
  return DAY_LONG[dowOf(d)]
}

/** A pick's name at the start of a line: "Bag work", "Strength C", "Run-walk". */
function pickName(s: Pick<SessionLike, 'type' | 'label' | 'notes'>): string {
  if (s.type === 'strength') return s.label ?? 'Lifting'
  const n = sessionName(s)
  return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase()
}

/** A session's word in a list: "run-walk", "bag", "rope", "class", "lift". */
function shortWord(s: Pick<SessionLike, 'type' | 'label' | 'notes'>): string {
  switch (s.type) {
    case 'foundation_run': return 'run-walk'
    case 'running': return s.notes === 'progression' ? 'run' : 'run'
    case 'bag_work': return 'bag'
    case 'skip_rope': return 'rope'
    case 'mt_class': return 'class'
    case 'strength': return 'lift'
    default: return sessionName(s).toLowerCase()
  }
}

function joinAnd(words: string[]): string {
  if (words.length <= 1) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const STRESS_WORDS: Record<string, string> = {
  rough_day: 'on a rough day',
  low_sleep: 'on little sleep',
  tired: 'on a tired day',
  sick: 'while sick',
  readiness: 'on an easing day',
}

/** "Block Pull" -> "Block pull", "Bent-Over Row" -> "Row": the lift's word in a line. */
export function liftWord(label: string): string {
  const l = label.trim()
  if (/romanian deadlift/i.test(l)) return 'RDL'
  if (/\brow$/i.test(l) && /over|barbell|chest|seal|pendlay/i.test(l)) return 'Row'
  return capital(l.toLowerCase())
}

/** The main lifts of a strength session, in a line: "Block pull and overhead press". */
export function mainLiftsLine(s: Pick<SessionLike, 'label' | 'epochDay'>, blockType: 'fighter' | 'block_zero', week: number): string | null {
  const t = getStrengthTemplate(dowOf(s.epochDay), week, blockType, s.label ?? null)
  const names = t.exercises.filter(e => e.section === 'main' && (blockType === 'block_zero' || !/pull-up/i.test(e.label))).map(e => liftWord(e.label))
  if (names.length === 0) return null
  return capital(joinAnd(names.map((n, i) => (i === 0 ? n : n === 'RDL' ? n : n.toLowerCase()))))
}

/** Main-lift working sets and reps for a strength session this week. */
export function strengthShape(s: Pick<SessionLike, 'label' | 'epochDay'>, blockType: 'fighter' | 'block_zero', week: number): { sets: number; reps: number } {
  if (blockType === 'block_zero') {
    const t = getStrengthWeekTarget(week)
    return { sets: t.mainSets, reps: t.reps }
  }
  const t = getStrengthTemplate(dowOf(s.epochDay), week, 'fighter', s.label ?? null)
  const main = t.exercises.find(e => e.section === 'main')
  const work = (main?.sets ?? []).filter(x => !x.isWarmup)
  return { sets: work.length || 3, reps: work.find(x => x.targetReps > 0)?.targetReps ?? 5 }
}

// ─── Eases ───────────────────────────────────────────────────

interface EaseOut { ease: CoachEasePlan; show: CoachChangePlan['show']; put: CoachChangePlan['put']; detail: string | null }

const HOLD_LINE = 'The coach leaves it as you set it this week.'

/** What easing a session does, with its words. Null when it can't ease further. */
export function easeFor(s: RebalanceSession, ctx: Pick<PlacementContext, 'blockType' | 'weekNumber'>): EaseOut | null {
  const name = sessionName(s)
  if (s.type === 'strength') {
    const { sets, reps } = strengthShape(s, ctx.blockType, ctx.weekNumber)
    if (sets <= 1) return null
    const letter = letterOf(s.label)
    const lifts = mainLiftsLine(s, ctx.blockType, ctx.weekNumber)
    return {
      ease: { kind: 'one_set', sets: sets - 1, reps },
      show: { before: setsReps(sets, reps), after: setsReps(sets - 1, reps), ...(letter ? { logBefore: `${letter} ${setsReps(sets, reps)}` } : {}) },
      put: { line: `${nameToken(name, s.epochDay)} is ${setsReps(sets, reps)} again.`, dim: HOLD_LINE },
      detail: lifts ? `${lifts}, same weights.` : 'Same weights.',
    }
  }
  if (s.type === 'foundation_run' && ctx.blockType === 'block_zero') {
    const w = getRunWalkWeek(ctx.weekNumber)
    const from = s.estimatedMin != null && s.estimatedMin > 0 ? Math.min(w.rounds, Math.floor((s.estimatedMin * 60 - w.warmupSec) / (w.runSec + w.walkSec))) : w.rounds
    if (from <= 2) return null
    const rounds = from - 1
    const fromMinutes = Math.round(runWalkTotalSec({ ...w, rounds: from }) / 60)
    const minutes = Math.round(runWalkTotalSec({ ...w, rounds }) / 60)
    return {
      ease: { kind: 'rounds', rounds, fromRounds: from, minutes, fromMinutes },
      show: { before: roundsWord(from), after: roundsWord(rounds) },
      put: { line: `${nameToken(name, s.epochDay)} is ${roundsWord(from).toLowerCase()} again.`, dim: HOLD_LINE },
      detail: null,
    }
  }
  if (RUN_TYPES.has(s.type)) {
    const from = estimatedMinutes(s, ctx.blockType, ctx.weekNumber)
    const minutes = Math.round(from * EASED_RUN_SHARE)
    return {
      ease: { kind: 'reduce', minutes, fromMinutes: from },
      show: { before: `${from} MIN`, after: `${minutes} MIN` },
      put: { line: `${nameToken(name, s.epochDay)} is ${from} min again.`, dim: HOLD_LINE },
      detail: null,
    }
  }
  if (RECOVERY_TYPES.has(s.type)) return null
  // A class can't be made easier: what happens in it is the gym's call. It stays or moves.
  if (s.type === 'mt_class') return null
  return {
    ease: { kind: 'reduce', minutes: null, fromMinutes: null },
    show: { before: 'AS PLANNED', after: 'EASIER' },
    put: { line: `${nameToken(name, s.epochDay)} is back as planned.`, dim: HOLD_LINE },
    detail: null,
  }
}

// ─── The rebalance ───────────────────────────────────────────

export function rebalance(input: RebalanceInput): CoachChangePlan[] {
  const { action, ctx, held } = input
  const mine = new Set([action.session.id])
  const day = action.session.epochDay
  const monday = mondayOf(day)
  const sunday = monday + 6
  const today = ctx.todayEpochDay
  const week = input.week.map(s => ({ ...s }))
  const out: CoachChangePlan[] = []
  const touched = new Set<string>()

  const live = (s: RebalanceSession) => LIVE.has(s.status)
  const isMine = (s: RebalanceSession) => mine.has(s.id)
  /** Hard and still hard: an eased session no longer counts. */
  const hard = (s: RebalanceSession) => live(s) && !s.eased && isHard(s)
  /** A session the coach may change: planned, not his, not held, not changed already, today or later. */
  const free = (s: RebalanceSession) => s.status === 'planned' && !isMine(s) && !held.has(s.id) && !touched.has(s.id) && s.epochDay >= today && s.epochDay >= monday && s.epochDay <= sunday
  const room = () => out.length < MAX_COACH_CHANGES
  const sorted = () => [...week].sort((a, b) => a.epochDay - b.epochDay || (a.timeSlot === 'am' ? 0 : 1) - (b.timeSlot === 'am' ? 0 : 1))

  const ease = (s: RebalanceSession, rule: RebalanceRule, why: string, detailOver?: string | null): boolean => {
    if (!room() || !free(s) || s.eased) return false
    const e = easeFor(s, ctx)
    if (!e) return false
    out.push({ rule, kind: 'ease', sessionId: s.id, ease: e.ease, show: e.show, why, detail: detailOver !== undefined ? detailOver : e.detail, put: e.put })
    touched.add(s.id)
    s.eased = true
    return true
  }

  const pick = action.session
  const pickLive = action.kind !== 'skip' && live(pick)

  // R4: rope for a run is the template's own swap. Nothing else moves.
  if (action.kind === 'swap' && action.replaced && RUN_TYPES.has(action.replaced.type) && action.replaced.notes !== 'progression' && pick.type === 'skip_rope') return []

  const stress = action.reason && STRESS_REASONS.has(action.reason) ? action.reason : null
  const easeToday = ctx.readinessEase && day === today

  // R8: a hard pick on a rough day (or a skip for stress): the next day's hard session eases.
  if (stress && room()) {
    const reach = action.kind === 'skip' && (stress === 'sick' || stress === 'tired') ? 3 : 1
    const target = sorted().find(s => s.epochDay > day && s.epochDay <= day + reach && hard(s) && free(s))
    if (target && (action.kind === 'skip' || hard(pick))) {
      const runAfter = week.find(s => s.epochDay === target.epochDay + 1 && RUN_TYPES.has(s.type) && live(s))
      const lead = action.kind === 'skip' ? `${pickName(pick)} skipped` : pickName(pick)
      const set = target.type === 'strength' ? 'one set less' : 'a little easier'
      const tail = runAfter ? `so ${dayLong(runAfter.epochDay)}'s run stays easy` : `on ${dayLong(target.epochDay)}`
      ease(target, 'R8', `${lead} ${dayToken(day)} ${STRESS_WORDS[stress]}; ${set} ${tail}.`)
    }
  }

  // R9: the pick stands on an easing day; the next hard day eases instead.
  if (easeToday && pickLive && hard(pick) && room()) {
    const target = sorted().find(s => s.epochDay > day && s.epochDay <= day + 2 && hard(s) && free(s))
    if (target) ease(target, 'R9', `${pickName(pick)} ${dayToken(day)} ${STRESS_WORDS.readiness}; ${dayLong(target.epochDay)}'s ${nameInSentence(sessionName(target))} eases.`)
  }

  // R5: three hard days in a row with his pick in them: the third one he didn't choose eases.
  if (pickLive && hard(pick) && room()) {
    const hardOn = (d: number) => week.some(s => s.epochDay === d && hard(s))
    for (let start = day - 2; start <= day && room(); start++) {
      if (![start, start + 1, start + 2].every(hardOn)) continue
      const candidates = sorted().filter(s => s.epochDay >= start && s.epochDay <= start + 2 && hard(s) && free(s)).reverse()
      const target = candidates[0]
      if (!target) continue
      const words = [start, start + 1, start + 2].map(d => shortWord(week.find(s => s.epochDay === d && hard(s)) ?? pick))
      const set = target.type === 'strength' ? `One set off ${dayLong(target.epochDay)}, same weights.` : `${dayLong(target.epochDay)}'s ${nameInSentence(sessionName(target))} eases.`
      ease(target, 'R5', `${capital(words.join(', '))}: three hard days in a row. ${set}`)
    }
  }

  // R5b: three conditioning sessions on one day: the next run this week is one round shorter.
  if (pickLive && CONDITIONING.has(pick.type) && room()) {
    const sameDay = sorted().filter(s => s.epochDay === day && live(s) && CONDITIONING.has(s.type))
    if (sameDay.length >= 3) {
      const run = sorted().find(s => s.epochDay > day && RUN_TYPES.has(s.type) && free(s) && !s.eased)
      const e = run ? easeFor(run, ctx) : null
      if (run && e) {
        const list = capital(joinAnd(sameDay.map(shortWord)))
        const what = e.ease.kind === 'rounds'
          ? `${backOnly(`${dayLong(run.epochDay)} is `)}${e.ease.rounds} rounds, not ${e.ease.fromRounds}: ${e.ease.minutes} min${backOnly(`, not ${e.ease.fromMinutes}`)}.`
          : `${backOnly(`${dayLong(run.epochDay)}'s run is `)}${e.ease.kind === 'reduce' && e.ease.minutes != null ? `${e.ease.minutes} min, not ${e.ease.fromMinutes}` : 'easier'}.`
        ease(run, 'R5b', `${list} ${dayToken(day)}. ${what}`)
      }
    }
  }

  // R11 (Block Zero): lifting on two days running: the other day drops a set.
  if (ctx.blockType === 'block_zero' && pickLive && pick.type === 'strength' && room()) {
    const next = sorted().find(s => s.type === 'strength' && Math.abs(s.epochDay - day) === 1 && free(s))
    if (next) ease(next, 'R11', `Lifting ${dayToken(Math.min(day, next.epochDay))} and ${dayToken(Math.max(day, next.epochDay))}: no lifting days back to back. One set off ${dayLong(next.epochDay)}, same weights.`)
  }

  // R6: heavy legs and leg interference 24 h apart (F6). Never his pick.
  if (pickLive && room()) {
    const legs = isHeavyLegs(pick, ctx.blockType)
    const interf = isLegInterference(pick)
    if (legs || interf) {
      const clash = sorted().find(s => free(s) && hoursBetween(s, pick) < 24 && (legs ? isLegInterference(s) : isHeavyLegs(s, ctx.blockType)))
      if (clash) {
        const to = clash.epochDay + 1
        const moved = to <= sunday ? checkSessionChange({ kind: 'move', type: clash.type, label: clash.label, notes: clash.notes, epochDay: to, timeSlot: clash.timeSlot, sessionId: clash.id, fromEpochDay: clash.epochDay }, { ...ctx, sessions: week }, { alternatives: false }) : null
        const why = legs
          ? `Heavy legs ${dayToken(day)} need 24 hours from ${nameInSentence(sessionName(clash))}.`
          : `${pickName(pick)} ${dayToken(day)} needs 24 hours from the heavy leg day.`
        if (moved?.ok && room()) {
          out.push({
            rule: 'R6', kind: 'move', sessionId: clash.id, move: { epochDay: to, timeSlot: moved.change.timeSlot },
            show: { before: `${DAY_NAMES[dowOf(clash.epochDay)].toUpperCase()} ${clash.timeSlot.toUpperCase()}`, after: `${DAY_NAMES[dowOf(to)].toUpperCase()} ${moved.change.timeSlot.toUpperCase()}` },
            why: `${why} ${sessionName(clash)} moves to ${dayLong(to)}.`, detail: null,
            put: { line: `${sessionName(clash)} is back on ${dayLong(clash.epochDay)}.`, dim: HOLD_LINE },
          })
          touched.add(clash.id)
        } else {
          ease(clash, 'R6', why)
        }
      }
    }
  }

  // R7: no long run within 24 h after heavy legs or hard bag.
  if (pickLive && (isHeavyLegs(pick, ctx.blockType) || pick.type === 'bag_work') && room()) {
    const run = sorted().find(s => free(s) && isLongRun(s) && s.epochDay >= day && hoursBetween(pick, s) < 24 && (s.epochDay > day || s.timeSlot === 'pm'))
    if (run) ease(run, 'R7', `${pickName(pick)} ${dayToken(day)}: no long run within 24 hours. ${dayLong(run.epochDay)}'s run stays easy.`)
  }

  // R1: a run he let go moves to the next day when that day has no run (R2: else it goes).
  const lostRun = action.kind === 'skip' && RUN_TYPES.has(pick.type)
    ? pick
    : action.kind === 'swap' && action.replaced && RUN_TYPES.has(action.replaced.type) && !CONDITIONING.has(pick.type) ? action.replaced : null
  if (lostRun && room() && !held.has(lostRun.id)) {
    const to = lostRun.epochDay + 1
    if (to <= sunday && to >= today && !week.some(s => s.epochDay === to && RUN_TYPES.has(s.type) && live(s))) {
      const r = checkSessionChange({ kind: 'add', type: lostRun.type, label: lostRun.label, notes: lostRun.notes, epochDay: to, timeSlot: lostRun.timeSlot }, { ...ctx, sessions: week, planWeekLoad: null }, { alternatives: false })
      if (r.ok) {
        const lift = week.find(s => s.epochDay === to && s.type === 'strength' && live(s))
        const name = sessionName(lostRun)
        out.push({
          rule: 'R1', kind: 'move', sessionId: lostRun.id, move: { epochDay: to, timeSlot: r.change.timeSlot },
          show: { before: `${DAY_NAMES[dowOf(lostRun.epochDay)].toUpperCase()} ${lostRun.timeSlot.toUpperCase()}`, after: `${DAY_NAMES[dowOf(to)].toUpperCase()} ${r.change.timeSlot.toUpperCase()}` },
          why: `Moved, not dropped. ${dayLong(to)} is the nearest day without a run.`,
          detail: lift && r.change.timeSlot === 'pm' ? `It goes after ${sessionName(lift)}, 10 hours apart.` : null,
          put: { line: `${name} is off ${dayLong(to)} again.`, dim: 'It stays skipped. Nothing else moves.' },
        })
        touched.add(lostRun.id)
      }
    }
  }

  // Load (F14): his pick takes the week past its planned load: the next hard session eases.
  if (out.length === 0 && pickLive && ctx.planWeekLoad != null && ctx.planWeekLoad > 0 && !ctx.leadIn && !RECOVERY_TYPES.has(pick.type)) {
    const load = week.filter(s => s.epochDay >= monday && s.epochDay <= sunday && live(s) && !RECOVERY_TYPES.has(s.type)).reduce((n, s) => n + plannedLoad(s, ctx.blockType, ctx.weekNumber), 0)
    if (load > ctx.planWeekLoad * PLAN_LOAD_TOLERANCE) {
      const target = sorted().find(s => s.epochDay > day && hard(s) && free(s))
      const pct = Math.round((load / ctx.planWeekLoad - 1) * 100)
      if (target) ease(target, 'load', `${pickName(pick)} ${dayToken(day)} takes the week ${pct}% past its plan. ${target.type === 'strength' ? `One set off ${dayLong(target.epochDay)}, same weights.` : `${dayLong(target.epochDay)}'s ${nameInSentence(sessionName(target))} eases.`}`)
    }
  }

  return out
}
