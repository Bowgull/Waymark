// Athlete model additions (approved by Josh 2026-10-21, ideas 3, 4, 10, 11, 12).
//
// - Session load (idea 3, 4): effort x minutes for every done session. A class
//   is always 60 minutes (the coach never sees or sets what is taught); its
//   effort is the RPE he logged after class, else a default for the class type
//   he logged, else 7. Bag work and class take the larger of the HR-based and
//   RPE-based load, because a wrist or strap HR undercounts striking.
// - Two load pools (idea 10): endurance (runs, bag, class, rope) with a short
//   fatigue (7 days) and a long fitness (42 days); strength fatigue decays
//   slower (14 days) and counts toward fatigue only, never fitness.
// - Per-domain levels (idea 11): running, each lift pattern (squat, hinge,
//   press, pull) and MT conditioning, 1-10, moved only by completion and
//   effort (TrainerRoad style): an easy full session moves it up, a hard one
//   holds, one he couldn't finish (not for time) moves it down.
// - His own eases (idea 12): a weight he lowered, a set he dropped, a skip for
//   how he felt, a swap to something lighter. Each holds that domain's next
//   session: no push, no guilt, nothing made up later.
//
// Model internals and facts only: nothing here writes a dose by itself. Pure.

import { KEY_TYPES } from '../keyTypes'
import { ageFromDob, tanakaMaxHr } from '../blockZero/running'
import { isScheduleReason } from './types'
import type { DomainLevel, LevelDomain, LiftExposure, LoadEstimate, LoadPool, ModelEvents, OwnEase, RunObservation, SessionLoad } from './types'

export const CLASS_MIN = 60
const MIN_MINUTES = 5
const MAX_MINUTES = 240

/** Planning minutes when a session has no logged duration. */
const DEFAULT_MIN: Record<string, number> = { strength: 55, foundation_run: 25, running: 30, bag_work: 30, bag_conditioning: 30, skip_rope: 15 }
/** Effort when none was logged. */
const DEFAULT_RPE: Record<string, number> = { strength: 7, foundation_run: 4, running: 5, bag_work: 6, bag_conditioning: 6, skip_rope: 5, mt_class: 7 }

/** A class's default effort from the type he logged (never what the coach thinks should be taught). */
export function classDefaultRpe(classType: string | null | undefined): number {
  const t = (classType ?? '').toLowerCase()
  if (/spar|fight|clinch|conditioning|pad ?rounds?/.test(t)) return 8
  if (/technique|technical|fundamental|beginner|drill|basics/.test(t)) return 6
  return DEFAULT_RPE.mt_class
}

/** RPE-equivalent of an average HR as a share of max (60% ~ 2, 70% ~ 4, 80% ~ 6, 90% ~ 8). */
export function rpeFromHr(avgHr: number, maxHr: number): number {
  return Math.max(1, Math.min(10, Math.round(((avgHr / maxHr) - 0.5) * 20)))
}

export function poolOf(type: string): LoadPool | null {
  if (type === 'strength') return 'strength'
  if (type === 'foundation_run' || type === 'running' || type === 'bag_work' || type === 'bag_conditioning' || type === 'mt_class' || type === 'skip_rope') return 'endurance'
  return null
}

const COMBAT = new Set(['bag_work', 'mt_class'])

/** Every done key session's load, oldest first. */
export function sessionLoads(events: ModelEvents, today: number): SessionLoad[] {
  const maxHr = events.profile.maxHr ?? tanakaMaxHr(ageFromDob(events.profile.dob, today) ?? 35)
  const runHr = new Map(events.runs.map(r => [r.sessionId, r.avgHr]))
  const runSec = new Map(events.runs.map(r => [r.sessionId, r.durationSec]))
  const classType = new Map(events.classLogs.map(l => [l.sessionId, l.classType ?? null]))
  const out: SessionLoad[] = []
  for (const s of [...events.sessions].sort((a, b) => a.day - b.day || a.id.localeCompare(b.id))) {
    if (s.status !== 'completed' || s.day > today || !KEY_TYPES.has(s.type)) continue
    const pool = poolOf(s.type)
    if (!pool) continue
    const sec = s.durationSec ?? runSec.get(s.id) ?? null
    const logged = sec != null && sec / 60 >= MIN_MINUTES && sec / 60 <= MAX_MINUTES ? Math.round(sec / 60) : null
    // A class is a fixed hour, whatever was logged.
    const minutes = s.type === 'mt_class' ? CLASS_MIN : (logged ?? DEFAULT_MIN[s.type] ?? 30)
    const rpeSource: SessionLoad['rpeSource'] = s.rpe != null ? 'logged' : 'default'
    const rpe = s.rpe ?? (s.type === 'mt_class' ? classDefaultRpe(classType.get(s.id)) : DEFAULT_RPE[s.type] ?? 5)
    const rpeLoad = rpe * minutes
    const hr = s.avgHr ?? runHr.get(s.id) ?? null
    const hrLoad = hr != null && hr > 40 && maxHr > 0 ? rpeFromHr(hr, maxHr) * minutes : null
    let load = rpeLoad
    if (COMBAT.has(s.type)) load = Math.max(rpeLoad, hrLoad ?? 0)
    else if (s.type !== 'strength' && rpeSource === 'default' && hrLoad != null) load = hrLoad
    out.push({ sessionId: s.id, day: s.day, type: s.type, pool, minutes, rpe, rpeSource, rpeLoad, hrLoad, load })
  }
  return out
}

export const TAU = { enduranceFatigue: 7, enduranceFitness: 42, strengthFatigue: 14 } as const

/** Daily exponentially weighted pools up to `today`. */
export function buildLoad(loads: SessionLoad[], today: number): LoadEstimate {
  const first = loads.length ? loads[0].day : today
  const k = (tau: number) => 1 - Math.exp(-1 / tau)
  let ef = 0
  let ec = 0
  let sf = 0
  for (let d = first; d <= today; d++) {
    const e = loads.filter(l => l.day === d && l.pool === 'endurance').reduce((a, l) => a + l.load, 0)
    const s = loads.filter(l => l.day === d && l.pool === 'strength').reduce((a, l) => a + l.load, 0)
    ef += k(TAU.enduranceFatigue) * (e - ef)
    ec += k(TAU.enduranceFitness) * (e - ec)
    sf += k(TAU.strengthFatigue) * (s - sf)
  }
  const sum = (pool: LoadPool) => loads.filter(l => l.pool === pool && l.day > today - 7 && l.day <= today).reduce((a, l) => a + l.load, 0)
  const r = (v: number) => Math.round(v)
  return {
    strengthFatigue: r(sf), enduranceFatigue: r(ef), enduranceFitness: r(ec),
    fatigue: r(sf + ef), fitness: r(ec), form: r(ec - sf - ef),
    last7: { strength: sum('strength'), endurance: sum('endurance') },
    recent: loads.filter(l => l.day > today - 14 && l.day <= today),
  }
}

// ─── Levels ──────────────────────────────────────────────────

export const LEVEL_MIN = 1
export const LEVEL_MAX = 10
export const LEVEL_UP = 0.3
export const LEVEL_UP_EASY = 0.5
export const LEVEL_DOWN = 0.5

const PRESS = /bench|press|push-?up|dip/
const PULL = /row|pull|chin|lat-|face-pull/
const HINGE = /rdl|deadlift|block-pull|good-morning|glute-bridge|hip-thrust|kettlebell-swing/
const SQUAT = /squat|lunge|step-up|leg-press/

export function patternOf(exerciseId: string): 'squat' | 'hinge' | 'press' | 'pull' | null {
  if (HINGE.test(exerciseId)) return 'hinge'
  if (SQUAT.test(exerciseId)) return 'squat'
  if (/press|bench/.test(exerciseId) && !/leg-press/.test(exerciseId)) return 'press'
  if (PULL.test(exerciseId)) return 'pull'
  if (PRESS.test(exerciseId)) return 'press'
  return null
}

export interface LevelInputs {
  runs: RunObservation[]
  lifts: Array<{ exerciseId: string; exposure: LiftExposure; sessionRpe: number | null }>
  combat: Array<{ day: number; type: string; rpe: number | null; hardEnd: boolean }>
}

/** How one session moves a level: + for an easy full session, 0 for a hard one, - for one he couldn't finish. */
export function liftMove(e: LiftExposure, sessionRpe: number | null): number {
  if (e.lowered || (e.incomplete && !e.claimedShort) || (e.lastRir != null && e.lastRir <= 1)) return -LEVEL_DOWN
  if (e.incomplete) return 0
  if (e.lastRir != null) return e.lastRir >= 3 ? LEVEL_UP_EASY : e.lastRir >= 2 ? LEVEL_UP : 0
  if (sessionRpe != null) return sessionRpe <= 5 ? LEVEL_UP_EASY : sessionRpe <= 7 ? LEVEL_UP : 0
  return 0.1
}

export function runMove(o: RunObservation): number {
  if (o.scheduleCut) return 0
  if (o.struggled) return -LEVEL_DOWN
  if (o.handled) return o.tooSlow || (o.rpe != null && o.rpe <= 3) ? LEVEL_UP_EASY : LEVEL_UP
  return 0
}

export function combatMove(c: LevelInputs['combat'][number]): number {
  if (c.hardEnd) return -LEVEL_DOWN
  if (c.rpe == null) return 0.2
  if (c.rpe <= 6) return LEVEL_UP
  if (c.rpe <= 8) return 0.1
  return -0.3
}

export function buildLevels(inp: LevelInputs): Record<LevelDomain, DomainLevel> {
  const out = {} as Record<LevelDomain, DomainLevel>
  for (const d of ['run', 'squat', 'hinge', 'press', 'pull', 'mtConditioning'] as const) out[d] = { level: LEVEL_MIN, sessions: 0, lastDay: null, lastChange: 0 }
  const apply = (d: LevelDomain, day: number, move: number) => {
    const l = out[d]
    const next = Math.round(Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, l.level + move)) * 10) / 10
    out[d] = { level: next, sessions: l.sessions + 1, lastDay: day, lastChange: Math.round((next - l.level) * 10) / 10 }
  }
  const events: Array<{ day: number; order: number; run: () => void }> = []
  inp.runs.forEach((o, i) => events.push({ day: o.day, order: i, run: () => apply('run', o.day, runMove(o)) }))
  // One move per pattern per session day: the lift that moved most decides (a session is one exposure).
  const byPatternDay = new Map<string, { day: number; pattern: 'squat' | 'hinge' | 'press' | 'pull'; moves: number[] }>()
  for (const l of inp.lifts) {
    const p = patternOf(l.exerciseId)
    if (!p) continue
    const key = `${p}|${l.exposure.day}`
    const cur = byPatternDay.get(key) ?? { day: l.exposure.day, pattern: p, moves: [] }
    cur.moves.push(liftMove(l.exposure, l.sessionRpe))
    byPatternDay.set(key, cur)
  }
  for (const v of byPatternDay.values()) events.push({ day: v.day, order: 1000, run: () => apply(v.pattern, v.day, Math.min(...v.moves)) })
  inp.combat.forEach((c, i) => events.push({ day: c.day, order: 2000 + i, run: () => apply('mtConditioning', c.day, combatMove(c)) }))
  events.sort((a, b) => a.day - b.day || a.order - b.order).forEach(e => e.run())
  return out
}

// ─── His own eases ───────────────────────────────────────────

/** Skip or swap reasons that say "how I feel", not "no time". */
export const FEEL_REASONS: ReadonlySet<string> = new Set(['rough_day', 'low_sleep', 'tired', 'sick', 'illness', 'too_sore', 'sore', 'pain', 'injury', 'rough'])
const HEAVINESS: Record<string, number> = { strength: 3, bag_work: 3, bag_conditioning: 3, mt_class: 3, running: 2, foundation_run: 1, skip_rope: 1, mobility: 0, active_recovery: 0 }
export const OWN_EASE_DAYS = 7

export function domainOf(type: string): OwnEase['domain'] | null {
  if (type === 'strength') return 'strength'
  if (type === 'foundation_run' || type === 'running') return 'run'
  if (type === 'bag_work') return 'bag'
  return null
}

/** His own eases in the last 7 days, oldest first. */
export function buildOwnEases(events: ModelEvents, lifts: Array<{ exposure: LiftExposure }>, today: number): OwnEase[] {
  const out: OwnEase[] = []
  const from = today - OWN_EASE_DAYS
  const seen = new Set<number>()
  for (const { exposure: e } of lifts) {
    if (e.day <= from || e.day > today || seen.has(e.day)) continue
    if (e.lowered) { out.push({ day: e.day, domain: 'strength', kind: 'lowered', reason: null }); seen.add(e.day) } else if (e.incomplete && !e.claimedShort && (e.workSets ?? 0) > 0 && e.allReps !== false) { out.push({ day: e.day, domain: 'strength', kind: 'dropped_sets', reason: null }); seen.add(e.day) }
  }
  for (const s of events.sessions) {
    if (s.day <= from || s.day > today) continue
    const dom = domainOf(s.type)
    // A skip for how he felt (a schedule skip says nothing about him: Josh, 2026-10-20).
    if (dom && s.status === 'skipped' && s.skipReason && FEEL_REASONS.has(s.skipReason) && !isScheduleReason(s.skipReason)) out.push({ day: s.day, domain: dom, kind: 'skipped', reason: s.skipReason })
    // A swap to something lighter than what it replaced.
    const was = s.replacedFrom ? domainOf(s.replacedFrom) : null
    if (was && s.replacedFrom && (HEAVINESS[s.type] ?? 1) < (HEAVINESS[s.replacedFrom] ?? 1)) out.push({ day: s.day, domain: was, kind: 'swapped', reason: null })
  }
  return out.sort((a, b) => a.day - b.day)
}

/**
 * The own ease that holds a domain today: his latest one there, unless a full
 * session in that domain was done after it (then he's moved on).
 */
export function ownEaseFor(model: { ownEases: OwnEase[] }, domain: OwnEase['domain'], doneDays: readonly number[]): OwnEase | null {
  const last = [...model.ownEases].reverse().find(e => e.domain === domain)
  if (!last) return null
  return doneDays.some(d => d > last.day) ? null : last
}
