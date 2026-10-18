// Ramp up (plan §2): the coach ASKS before pushing. Pure.
//
// When check-ins sit above the athlete's own 7-day baseline for 2+ days (R10,
// read the other way) and recent sessions felt easier than target (session RPE
// below target, reps in reserve above target, or a lift-trend push), the coach
// asks one question with safe options:
//   +1 SET       one more working set on the next strength day's main lifts,
//   MORE WEIGHT  about 5% more on it (Fighter; never past +5% a session),
//   EXTRA RUN    an easy run, placement-checked (stacking, run caps F11),
//   EXTRA CLASS  a class, placement-checked (MT ramp and cap R12),
// with a load allowance of 10% over the plan for any add. NOT THIS WEEK
// (reject) changes nothing. Yes applies the option with a reason.
// At most one ask a week. Never on an ease day, never right after a gap or
// with an injury flag (gap rules' noPush), never past the rules' caps.
// Option ids and titles follow the approved coach screens ("The coach speaks").

import { checkSessionChange, type PlacementContext } from './placement'
import { DAY_NAMES, dowOf, estimatedMinutes, isoOf, mondayOf, sessionName, type BlockKind, type SessionLike, type TimeSlot } from './sessions'
import { consistentlyEasier, type EffortSummary } from './feltHard'
import type { ReadinessDay } from '../blockZero/readiness'

export const RAMP_FRESH_DAYS = 2
/** Added sessions may take the week this far over its planned load. */
export const RAMP_LOAD_ALLOWANCE = 1.1
/** MORE WEIGHT: never more than +5% on a session (spec §6). */
export const RAMP_LOAD_STEP = 1.05
export const MAX_RAMP_OPTIONS = 3

export type RampUpOptionId = 'extra_set' | 'more_weight' | 'extra_run' | 'extra_class'

/** A main lift's working load before and after MORE WEIGHT. */
export interface RampLift {
  exerciseId: string
  name: string
  fromKg: number
  toKg: number
}

interface RampOptionBase {
  id: RampUpOptionId
  /** Flap label: plain words that say what happens. */
  title: string
  /** The sub-line: where and what. */
  detail: string
  /** Title and detail as one plain line (the current card). */
  label: string
  epochDay: number
  date: string
}

export type RampUpOption =
  | (RampOptionBase & { kind: 'extra_set'; sessionId: string })
  | (RampOptionBase & { kind: 'load_step'; sessionId: string; factor: number; lifts: RampLift[] })
  | (RampOptionBase & { kind: 'add'; type: string; sessionLabel: string; notes?: string | null; timeSlot: TimeSlot })

/** The decline button. Rejecting the ask changes nothing. */
export const RAMP_DECLINE = { id: 'not_this_week', title: 'NOT THIS WEEK' } as const

/**
 * One proof tile: a short label and a short value, shown together on one teal
 * flap ("FRESH 3 DAYS", "EASY 3 OF 3"; page 36). Both stay short and upper case.
 */
export interface ProofTile {
  label: string
  value: string
}

/** "Squat and RDL", "Squat, Bench and Row". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

const lb = (kg: number) => Math.round(kg * 2.20462)

/** "Squat 140 · RDL 120, +5 lb" (lb, as the athlete reads loads). */
export function moreWeightDetail(lifts: RampLift[]): string {
  if (lifts.length === 0) return 'main lifts up about 5%'
  const names = lifts.map(l => `${l.name} ${lb(l.toKg)}`).join(' · ')
  const steps = [...new Set(lifts.map(l => lb(l.toKg) - lb(l.fromKg)))]
  return steps.length === 1 ? `${names}, +${steps[0]} lb` : `${names} lb`
}

export interface RampUpSignals {
  todayEpochDay: number
  readiness: ReadinessDay[]
  effort: EffortSummary
  /** A main lift's trend says push (two "over" sessions in the last three). */
  liftPush: boolean
  /** Today is an ease day (readiness ease, load flag, or a coach ease). */
  easeToday: boolean
  /** Return ramp after a gap, or an injury flag: no pushing. */
  noPush: boolean
  /** A ramp-up ask already exists this calendar week (any status). */
  askedThisWeek: boolean
}

export interface RampUpEligibility {
  eligible: boolean
  /** One line: why the coach is asking. */
  why: string | null
  /** The facts behind it, as short tiles. */
  proof: ProofTile[]
  /** Why not, for the stored reasoning. */
  blockers: string[]
}

/** Consecutive fresh check-in days ending today (or yesterday when today has none). */
export function freshStreak(days: ReadinessDay[], todayEpochDay: number): number {
  const byDay = new Map(days.map(d => [d.epochDay, d]))
  let day = byDay.has(todayEpochDay) ? todayEpochDay : todayEpochDay - 1
  let n = 0
  while (byDay.get(day)?.fresh) { n++; day-- }
  return n
}

export function rampUpEligibility(s: RampUpSignals): RampUpEligibility {
  const blockers: string[] = []
  if (s.askedThisWeek) blockers.push('already asked this week')
  if (s.easeToday) blockers.push('ease day')
  if (s.noPush) blockers.push('return ramp or injury flag')
  const latest = [...s.readiness].sort((a, b) => b.epochDay - a.epochDay)[0]
  if (latest && (latest.flagged || latest.ease) && latest.epochDay >= s.todayEpochDay - 1) blockers.push('check-ins off trend')
  const streak = freshStreak(s.readiness, s.todayEpochDay)
  if (streak < RAMP_FRESH_DAYS) blockers.push(`fresh ${streak} day(s), needs ${RAMP_FRESH_DAYS}`)
  const easier = consistentlyEasier(s.effort)
  if (!easier && !s.liftPush) blockers.push('sessions not easier than target')
  if (s.effort.harder + s.effort.wayHarder > 0) blockers.push('a recent session ran harder than target')
  // Short tiles, as page 36 shows them: FRESH 3 DAYS · EASY 3 OF 3 (· LIFTS UP 2 OF 3).
  const proof: ProofTile[] = [{ label: 'FRESH', value: `${streak} ${streak === 1 ? 'DAY' : 'DAYS'}` }]
  if (s.effort.sessions > 0 && s.effort.easier > 0) proof.push({ label: 'EASY', value: `${s.effort.easier} OF ${s.effort.sessions}` })
  if (s.liftPush) proof.push({ label: 'LIFTS', value: 'UP 2 OF 3' })
  if (blockers.length > 0) return { eligible: false, why: null, proof, blockers }
  const felt = easier ? 'sessions felt easy' : 'your lifts beat the plan'
  return { eligible: true, why: `You've been fresh and ${felt}.`, proof, blockers: [] }
}

export interface RampUpOptionInput {
  ctx: PlacementContext
  /** Planned sessions this week. */
  upcoming: Array<SessionLike & { id: string }>
  blockType: BlockKind
  weekNumber: number
  liftPush: boolean
  /** Weekdays (0-6) the gym runs classes. */
  classDays: ReadonlySet<number>
  /** The next strength day's main lifts and their working loads, for MORE WEIGHT. */
  mainLifts?: Array<{ exerciseId: string; name: string; workingKg: number }>
  /** The next strength day's main lifts and planned working sets, for +1 SET ("Squat and RDL, 3×8"). */
  nextStrength?: { names: string[]; sets: number; reps: number } | null
}

/** The safe options, best first. Every add passes placement with the ramp allowance. */
export function rampUpOptions(input: RampUpOptionInput): RampUpOption[] {
  const { ctx } = input
  const today = ctx.todayEpochDay
  const sunday = mondayOf(today) + 6
  const easeDays = new Set(ctx.easeDays ?? [])
  if (ctx.readinessEase || ctx.loadFlag) easeDays.add(today)
  const out: RampUpOption[] = []

  const nextStrength = input.upcoming
    .filter(s => s.type === 'strength' && s.status === 'planned' && s.epochDay >= today && s.epochDay <= sunday && !easeDays.has(s.epochDay))
    .sort((a, b) => a.epochDay - b.epochDay)[0]
  // Block Zero test week (1) and consolidation week (6+) keep their set counts.
  const bzFixedWeek = input.blockType === 'block_zero' && (input.weekNumber <= 1 || input.weekNumber >= 6)
  if (nextStrength && !bzFixedWeek) {
    const where = `${DAY_NAMES[dowOf(nextStrength.epochDay)]} ${sessionName(nextStrength).toLowerCase()}`
    const base = { epochDay: nextStrength.epochDay, date: isoOf(nextStrength.epochDay), sessionId: nextStrength.id }
    // The sub-lines read as page 36: what changes, not where ("Squat and RDL, 3×8").
    const plan = input.nextStrength
    const setDetail = plan && plan.names.length > 0 && plan.sets > 0 && plan.reps > 0
      ? `${joinNames(plan.names)}, ${plan.sets + 1}×${plan.reps}`
      : `${where}, main lifts`
    out.push({ ...base, kind: 'extra_set', id: 'extra_set', title: '+1 SET', detail: setDetail, label: `One more set: ${where}, ${setDetail}` })
    if (input.blockType === 'fighter' && !input.liftPush) {
      const lifts: RampLift[] = (input.mainLifts ?? []).map(l => ({ exerciseId: l.exerciseId, name: l.name, fromKg: l.workingKg, toKg: Math.round(l.workingKg * RAMP_LOAD_STEP * 100) / 100 }))
      const detail = moreWeightDetail(lifts)
      out.push({ ...base, kind: 'load_step', id: 'more_weight', title: 'MORE WEIGHT', detail, label: `More weight: ${where}: ${detail}`, factor: RAMP_LOAD_STEP, lifts })
    }
  }

  // The plan tolerance is 1.05; scale so adds may reach RAMP_LOAD_ALLOWANCE.
  const rampCtx: PlacementContext = { ...ctx, planWeekLoad: ctx.planWeekLoad != null ? ctx.planWeekLoad * RAMP_LOAD_ALLOWANCE / 1.05 : null }
  const adds: Array<{ id: 'extra_run' | 'extra_class'; title: string; type: string; sessionLabel: string; days?: ReadonlySet<number>; slots: TimeSlot[]; what: string }> = [
    { id: 'extra_run', title: 'EXTRA RUN', type: 'foundation_run', sessionLabel: input.blockType === 'block_zero' ? 'Run-Walk' : 'Zone 2', slots: ['am', 'pm'], what: 'Easy run' },
    { id: 'extra_class', title: 'EXTRA CLASS', type: 'mt_class', sessionLabel: input.blockType === 'block_zero' ? 'MT Technique' : 'MT Class', days: input.classDays, slots: ['pm'], what: 'Class' },
  ]
  for (const a of adds) {
    let placed: RampUpOption | null = null
    for (let d = today + 1; d <= sunday && !placed; d++) {
      if (easeDays.has(d)) continue
      if (a.days && !a.days.has(dowOf(d))) continue
      for (const slot of a.slots) {
        const r = checkSessionChange({ kind: 'add', type: a.type, label: a.sessionLabel, notes: null, epochDay: d, timeSlot: slot }, rampCtx, { alternatives: false })
        if (!r.ok) continue
        const when = `${DAY_NAMES[dowOf(d)]} ${r.change.timeSlot.toUpperCase()}`
        // EXTRA RUN reads "Zone 2, 30 min" (page 36; the AM/PM flap sits beside it); a class says its day.
        const detail = a.id === 'extra_run'
          ? `${a.sessionLabel}, ${estimatedMinutes({ type: a.type, notes: null, estimatedMin: null }, input.blockType, input.weekNumber)} min`
          : `${a.sessionLabel}, ${when}`
        placed = { kind: 'add', id: a.id, title: a.title, detail, label: `Add: ${a.what}, ${when}`, type: a.type, sessionLabel: a.sessionLabel, notes: null, epochDay: d, date: isoOf(d), timeSlot: r.change.timeSlot }
        break
      }
    }
    if (placed) out.push(placed)
  }
  return out.slice(0, MAX_RAMP_OPTIONS)
}

export interface RampUpAsk {
  /** The question for the card. Names what a plain Accept does. */
  question: string
  options: RampUpOption[]
  defaultOption: RampUpOption
  /** The ask lapses at the start of this epoch day (the Monday after). */
  expiresOnDay: number
  why: string
  proof: ProofTile[]
  decline: typeof RAMP_DECLINE
}

/** One ask, or null when not eligible or no safe option exists. */
export function rampUpAsk(signals: RampUpSignals, optionInput: RampUpOptionInput): RampUpAsk | null {
  const e = rampUpEligibility(signals)
  if (!e.eligible || !e.why) return null
  const options = rampUpOptions(optionInput)
  if (options.length === 0) return null
  const first = options[0]
  return {
    question: `${e.why} Push a little this week? Accept: ${first.label.charAt(0).toLowerCase()}${first.label.slice(1)}.`,
    options,
    defaultOption: first,
    expiresOnDay: mondayOf(signals.todayEpochDay) + 7,
    why: e.why,
    proof: e.proof,
    decline: RAMP_DECLINE,
  }
}
