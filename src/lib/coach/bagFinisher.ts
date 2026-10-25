// The bag finisher (page 86, approved 2026-10-25): after the last bag round,
// before the combo ratings, a few timed sets the way Thai camps end bag work.
//
// - Sets, in order: BODY KICK (right leg), SWITCH KICK (left leg), LEAD TEEP;
//   REAR KNEE last, only when KNEES is on in Settings. No head kicks.
// - Then the combo ratings (no cool-down screen; Josh: "ratings is fine").
// - Each set is a time box: a clock with GOAL n under it. The app never
//   counts; he does. The coach sizes it by how ready he is today:
//   LOW goal 10 in 0:25, OK goal 20 in 0:45, HIGH goal 30 in 1:05 (the rear
//   knee's goal is half again: 15, 30, 45).
// - 20 s rest between sets (teal), showing only the next set.
// - COACH and HYBRID sessions get it; CUSTOM stays exactly as he built it.
//
// Pure: the start route on the server writes the plan into the session's
// context_json; the phone runs it with the interval timer's part maths.

import type { Level } from '../brain/doses'
import { mmss, type IntervalPart } from '../timers/intervalTimer'
import type { BagMode } from './bagArc'

export type FinisherReadiness = 'low' | 'ok' | 'high'
export type FinisherSetKey = 'body_kick' | 'switch_kick' | 'lead_teep' | 'rear_knee'

export interface FinisherSet {
  key: FinisherSetKey
  /** The set's name on its red plate. */
  name: string
  /** The small word over it (the leg). */
  side: string
  /** The target he counts to. */
  goal: number
  /** The time box, seconds. */
  sec: number
}

export interface FinisherPlan {
  readiness: FinisherReadiness
  sets: FinisherSet[]
  /** Rest between sets, seconds. */
  restSec: number
}

/** Rest between sets (page 86). */
export const FINISHER_REST_SEC = 20

/** The time box and the kicks' goal, by readiness (page 86's sizing). */
export const FINISHER_SIZE: Readonly<Record<FinisherReadiness, { goal: number; sec: number }>> = {
  low: { goal: 10, sec: 25 },
  ok: { goal: 20, sec: 45 },
  high: { goal: 30, sec: 65 },
}

/** Knees go half again over the kicks (30 on an OK day). */
const KNEE_GOAL_K = 1.5

// Each set follows its Settings switch (Josh, 2026-10-25: an injury or a focus
// turns a group off, and the finisher leaves those sets out).
const SETS: ReadonlyArray<Omit<FinisherSet, 'goal' | 'sec'> & { group: string }> = [
  { key: 'body_kick', name: 'BODY KICK', side: 'RIGHT LEG', group: 'kicks' },
  { key: 'switch_kick', name: 'SWITCH KICK', side: 'LEFT LEG', group: 'kicks' },
  { key: 'lead_teep', name: 'LEAD TEEP', side: 'FRONT LEG', group: 'defensive' },
]
const KNEE: Omit<FinisherSet, 'goal' | 'sec'> = { key: 'rear_knee', name: 'REAR KNEE', side: 'RIGHT LEG' }

/**
 * Readiness from the bag session's own dose (lib/brain/doses bagDose, which
 * already folds in today's readiness state, an injury and his own eases):
 * an ease or less is LOW, a hold is OK, finishers earned (PROGRESS, PUSH) is
 * HIGH. No dose: OK.
 */
export function finisherReadiness(level: Level | null | undefined): FinisherReadiness {
  if (level === 'REST' || level === 'RECOVER' || level === 'EASE') return 'low'
  if (level === 'PROGRESS' || level === 'PUSH') return 'high'
  return 'ok'
}

/**
 * The finisher the coach adds, or null (CUSTOM: exactly his session, nothing
 * added; or every set's group switched off). `groups` is his Settings switches.
 */
export function planFinisher(opts: { mode: BagMode; readiness: FinisherReadiness; groups: ReadonlySet<string> }): FinisherPlan | null {
  if (opts.mode === 'custom') return null
  const size = FINISHER_SIZE[opts.readiness]
  const sets: FinisherSet[] = SETS.filter(s => opts.groups.has(s.group)).map(s => ({ key: s.key, name: s.name, side: s.side, goal: size.goal, sec: size.sec }))
  if (opts.groups.has('knees')) sets.push({ ...KNEE, goal: Math.round(size.goal * KNEE_GOAL_K), sec: size.sec })
  return sets.length ? { readiness: opts.readiness, sets, restSec: FINISHER_REST_SEC } : null
}

/** His Settings switches (the comma list of technique keys; none saved: the defaults, knees and elbows off). */
export function techniqueGroups(enabledTechniques: string | null | undefined): Set<string> {
  return new Set((enabledTechniques ?? 'boxing,kicks,defensive').split(',').map(s => s.trim()).filter(Boolean))
}

/** context_json.finisher as stored, or null when it isn't one. */
export function parseFinisher(raw: unknown): FinisherPlan | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.readiness !== 'low' && r.readiness !== 'ok' && r.readiness !== 'high') return null
  if (!Array.isArray(r.sets)) return null
  const keys = new Set<string>(['body_kick', 'switch_kick', 'lead_teep', 'rear_knee'])
  const whole = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null)
  const sets: FinisherSet[] = []
  for (const s of r.sets.slice(0, 6)) {
    if (!s || typeof s !== 'object') return null
    const x = s as Record<string, unknown>
    const goal = whole(x.goal, 1, 200), sec = whole(x.sec, 5, 600)
    if (typeof x.key !== 'string' || !keys.has(x.key) || typeof x.name !== 'string' || typeof x.side !== 'string' || goal == null || sec == null) return null
    sets.push({ key: x.key as FinisherSetKey, name: x.name.slice(0, 24), side: x.side.slice(0, 24), goal, sec })
  }
  if (sets.length === 0) return null
  return { readiness: r.readiness, sets, restSec: whole(r.restSec, 0, 300) ?? FINISHER_REST_SEC }
}

// ─── running it (the interval timer's part maths: lib/timers/intervalTimer positionAt) ───

/** Set, rest, set, rest, …, set: no rest after the last. `round` is the set's number (1-based). */
export function finisherParts(plan: FinisherPlan): IntervalPart[] {
  const parts: IntervalPart[] = []
  let at = 0
  plan.sets.forEach((s, i) => {
    parts.push({ ph: 'work', len: s.sec, round: i + 1, startSec: at })
    at += s.sec
    if (i < plan.sets.length - 1 && plan.restSec > 0) {
      parts.push({ ph: 'rest', len: plan.restSec, round: i + 1, startSec: at })
      at += plan.restSec
    }
  })
  return parts
}

/**
 * Before he starts (a planned row, the coach's picks): the finisher's seconds
 * for the dose's level with the default switches (kicks and the teep on, knees
 * off), as the start route will most likely size it.
 */
export function plannedFinisherSec(level: Level | null | undefined): number {
  const p = planFinisher({ mode: 'coach', readiness: finisherReadiness(level), groups: techniqueGroups(null) })
  return p ? finisherTotalSec(p) : 0
}

/** The whole finisher, seconds. */
export function finisherTotalSec(plan: FinisherPlan): number {
  const parts = finisherParts(plan)
  const last = parts[parts.length - 1]
  return last ? last.startSec + last.len : 0
}

/** "0:45 · GOAL 20": a set where the combo would sit. */
export function setLine(s: Pick<FinisherSet, 'sec' | 'goal'>): string {
  return `${mmss(s.sec)} · GOAL ${s.goal}`
}

/** The set a part belongs to (a rest shows the set coming). */
export function setOfPart(plan: FinisherPlan, part: Pick<IntervalPart, 'ph' | 'round'>): FinisherSet {
  const i = part.ph === 'rest' ? part.round : part.round - 1
  return plan.sets[Math.max(0, Math.min(plan.sets.length - 1, i))]
}

/** What follows the finisher (Josh, 2026-10-25: the ratings, in the words the bag uses for that step). */
export const FINISHER_NEXT_WORD = 'NEXT · COMBO RATINGS'

/** The NEXT line in a set: ["NEXT · REST 0:20", "SWITCH KICK"]; after the last set [FINISHER_NEXT_WORD]. */
export function nextAfterSet(plan: FinisherPlan, setIndex: number): string[] {
  const next = plan.sets[setIndex + 1]
  if (!next) return [FINISHER_NEXT_WORD]
  return plan.restSec > 0 ? [`NEXT · REST ${mmss(plan.restSec)}`, next.name] : [`NEXT · ${next.name}`]
}

/** The count on the top bar: "1 OF 3". */
export function setCount(plan: FinisherPlan, setNumber: number): string {
  return `${Math.max(1, Math.min(plan.sets.length, setNumber))} OF ${plan.sets.length}`
}

export const FINISHER_DONE_WORD = 'DONE · FINISHER'

/** The finisher's bells, from its start: each set's bell, its last 10 s and its end; each rest's last 5 s. */
export function finisherCues(parts: ReadonlyArray<IntervalPart>): Array<{ atSec: number; kind: 'set' | 'set_warn' | 'set_end' | 'rest_warn' }> {
  const out: Array<{ atSec: number; kind: 'set' | 'set_warn' | 'set_end' | 'rest_warn' }> = []
  for (const p of parts) {
    const end = p.startSec + p.len
    if (p.ph === 'work') {
      out.push({ atSec: p.startSec, kind: 'set' })
      if (p.len > 10) out.push({ atSec: end - 10, kind: 'set_warn' })
      out.push({ atSec: end, kind: 'set_end' })
    } else if (p.ph === 'rest' && p.len > 5) {
      out.push({ atSec: end - 5, kind: 'rest_warn' })
    }
  }
  return out
}

// ─── the log (kept with the session: context_json.finisherLog) ───

export type FinisherSetStatus = 'done' | 'skipped'

export interface FinisherLogSet {
  key: FinisherSetKey
  name: string
  goal: number
  sec: number
  /** Done: its time ran out. Skipped: swiped past, or never reached. Null: not yet. */
  status: FinisherSetStatus | null
}

export interface FinisherLog {
  readiness: FinisherReadiness
  /** Held through on the grass (or the session ended before its last set). */
  ended: boolean
  sets: FinisherLogSet[]
  /** The part it was last seen at (index into finisherParts; parts.length: the end), so parts that ran out with the app away count too. */
  at: number
}

/** A fresh log for a plan: nothing done yet. */
export function newFinisherLog(plan: FinisherPlan): FinisherLog {
  return { readiness: plan.readiness, ended: false, sets: plan.sets.map(s => ({ key: s.key, name: s.name, goal: s.goal, sec: s.sec, status: null })), at: 0 }
}

const withStatus = (log: FinisherLog, setIdx: number, status: FinisherSetStatus): FinisherLog =>
  setIdx < 0 || setIdx >= log.sets.length ? log : { ...log, sets: log.sets.map((s, i) => (i === setIdx ? { ...s, status } : s)) }

/** Time ran from part `log.at` on to part `toIdx` (parts.length: the end): every set it passed is done. */
export function logRanTo(log: FinisherLog, parts: ReadonlyArray<IntervalPart>, toIdx: number): FinisherLog {
  let out = log
  for (let i = Math.max(0, log.at); i < Math.min(toIdx, parts.length); i++) if (parts[i].ph === 'work') out = withStatus(out, parts[i].round - 1, 'done')
  return { ...out, at: Math.max(out.at, Math.min(toIdx, parts.length)) }
}

/** A jump (swipe up or down) from part `fromIdx` to `toIdx` (parts.length: past the end): a set swiped past is skipped. */
export function logJumped(log: FinisherLog, parts: ReadonlyArray<IntervalPart>, fromIdx: number, toIdx: number, skipped: boolean): FinisherLog {
  const p = parts[fromIdx]
  const out = skipped && p?.ph === 'work' ? withStatus(log, p.round - 1, 'skipped') : log
  return { ...out, at: Math.max(0, Math.min(toIdx, parts.length)) }
}

/** Held through at part `idx`: that set (or the one coming, in a rest) and every set after it are skipped. */
export function logEnded(log: FinisherLog, parts: ReadonlyArray<IntervalPart>, idx: number): FinisherLog {
  const p = parts[idx]
  const from = !p ? log.sets.length : p.ph === 'work' ? p.round - 1 : p.round
  return { ...log, ended: true, sets: log.sets.map((s, i) => (i >= from ? { ...s, status: 'skipped' as const } : s)) }
}

/** As it is sent: a set never reached is skipped, and then the finisher counts as ended. */
export function finalFinisherLog(log: FinisherLog): FinisherLog {
  const open = log.sets.some(s => s.status == null)
  return { ...log, ended: log.ended || open, sets: log.sets.map(s => ({ ...s, status: s.status ?? 'skipped' })) }
}

/** A stored log, or null when it isn't one. */
export function parseFinisherLog(raw: unknown): FinisherLog | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.readiness !== 'low' && r.readiness !== 'ok' && r.readiness !== 'high') return null
  if (!Array.isArray(r.sets) || r.sets.length === 0 || r.sets.length > 6) return null
  const sets: FinisherLogSet[] = []
  for (const s of r.sets) {
    if (!s || typeof s !== 'object') return null
    const x = s as Record<string, unknown>
    if (typeof x.key !== 'string' || !['body_kick', 'switch_kick', 'lead_teep', 'rear_knee'].includes(x.key)) return null
    if (typeof x.goal !== 'number' || !Number.isInteger(x.goal) || x.goal < 1 || x.goal > 200) return null
    if (typeof x.sec !== 'number' || !Number.isInteger(x.sec) || x.sec < 5 || x.sec > 600) return null
    const status = x.status === 'done' || x.status === 'skipped' ? x.status : null
    sets.push({ key: x.key as FinisherSetKey, name: typeof x.name === 'string' ? x.name.slice(0, 24) : x.key.toUpperCase(), goal: x.goal, sec: x.sec, status })
  }
  const at = typeof r.at === 'number' && Number.isInteger(r.at) && r.at >= 0 ? r.at : 0
  return { readiness: r.readiness, ended: r.ended === true, sets, at }
}

const RANK: Readonly<Record<FinisherReadiness, number>> = { low: 0, ok: 1, high: 2 }

/**
 * The coach reads the last finisher before sizing the next: one with a set
 * skipped, or ended early, never lets the size go up (today's readiness may
 * still bring it down). A full one changes nothing.
 */
export function readinessAfterLast(readiness: FinisherReadiness, last: FinisherLog | null | undefined): FinisherReadiness {
  if (!last) return readiness
  const short = last.ended || last.sets.some(s => s.status !== 'done')
  return short && RANK[readiness] > RANK[last.readiness] ? last.readiness : readiness
}

/** The phone's copy of the log until the session is finished. */
export function finisherLogKey(sessionId: string): string {
  return `waymark_finisher_log:${sessionId}`
}
