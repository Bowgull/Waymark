// The weekly pass, rules side (plan §1, §8). Pure. The server loads what
// happened (server/weeklyPass) and the planner (AI, guarded, or the template)
// gives the week's sessions; these rules then decide the small automatic
// changes, each with one reason line, and the week's "why this week" line.
//
// Small changes only, automatic, with a note (classify.ts): at most two
// sessions ease. Nothing is ever added or moved here; missed work is never
// made up (F14). Pushes apply too, each with its rune and UNDO (the coach never asks).

import type { CoachEaseKind } from './classify'
import { checkSessionChange, type PlacementContext } from './placement'
import { RUN_TYPES, dowOf, mondayOf, sessionName, type BlockKind, type SessionLike } from './sessions'
import { getWeekPercentage } from '../strengthTemplates'
import { midName } from './changes'

const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
import type { EffortSummary } from './effort'

/** The pass runs the night the athlete's local day is Sunday; Monday catches up a missed run. */
export const WEEKLY_PASS_DOW = 0
export const MAX_WEEKLY_EASES = 2
export const SORENESS_EASE_AVG = 3.5
export const RPE_EASE_AVG = 8.5
export const LOW_COMPLETION = 0.5
const WHY_MAX = 160

export type AthleteWeekShape = 'as_planned' | 'pull_back' | 'add_recovery' | 'push_volume'

export interface WeekSignals {
  weekNumber: number
  totalWeeks: number
  blockType: BlockKind
  /** The week just finished: key sessions planned, done, missed, skipped, added. */
  lastWeek: { planned: number; completed: number; missed: number; skipped: number; added: number }
  completionRate: number | null
  /** sRPE load: the last 7 days against the 7 before. */
  load: { last7: number; prev7: number; changePct: number | null; flagged: boolean }
  readiness: { days: number; flaggedDays: number; easeDays: number; freshDays: number; oversleepFatigueDays: number }
  effort: EffortSummary
  avgSoreness: number | null
  avgSleep: number | null
  returnRamp: { active: boolean; gapDays: number; reason: string | null }
  retestLastWeek: boolean
  /** Fighter: the 6-week strength wave just ended (or the block did). */
  waveEnd: boolean
  athleteShape: AthleteWeekShape | null
}

export type WeekEaseCause = 'readiness' | 'load' | 'soreness' | 'effort' | 'completion' | 'athlete'

export interface WeekEase {
  /** Index into the planned list. */
  index: number
  kind: CoachEaseKind
  cause: WeekEaseCause
  /** One line, house voice. */
  reason: string
  /** What it was, for the "was X" detail. */
  was: string
  /** What it is now. */
  now: string
}

/** What an ease does to a session, in plain words. */
export function easeDetail(kind: CoachEaseKind, s: Pick<SessionLike, 'type' | 'label' | 'notes'>): { was: string; now: string } {
  if (kind === 'run_to_walk') return { was: sessionName(s), now: 'Easy walk or bike' }
  if (s.type === 'strength' && kind === 'one_set') return { was: 'Planned sets', now: 'One set less, same weights' }
  if (s.type === 'strength') return { was: 'Planned sets and load', now: 'One set less, load 10% lower' }
  if (RUN_TYPES.has(s.type)) return { was: 'Planned run time', now: 'About 80% of the time' }
  return { was: 'Planned length', now: 'Shorter and easier' }
}

function causes(s: WeekSignals): Array<{ cause: WeekEaseCause; why: string }> {
  const out: Array<{ cause: WeekEaseCause; why: string }> = []
  if (s.readiness.easeDays >= 2) out.push({ cause: 'readiness', why: `Check-ins were off your usual on ${s.readiness.easeDays} mornings.` })
  if (s.load.flagged) out.push({ cause: 'load', why: s.load.changePct != null ? `Last week ran ${s.load.changePct}% over the one before.` : 'Last week ran well over the one before.' })
  if (s.avgSoreness != null && s.avgSoreness >= SORENESS_EASE_AVG) out.push({ cause: 'soreness', why: `Soreness averaged ${s.avgSoreness.toFixed(1)} last week.` })
  if ((s.effort.avgRpe != null && s.effort.avgRpe >= RPE_EASE_AVG) || s.effort.wayHarder >= 2) out.push({ cause: 'effort', why: s.effort.avgRpe != null && s.effort.avgRpe >= RPE_EASE_AVG ? `Sessions felt like ${s.effort.avgRpe}s last week.` : `${s.effort.wayHarder} sessions felt much harder than planned.` })
  if (s.completionRate != null && s.lastWeek.planned >= 4 && s.completionRate < LOW_COMPLETION) out.push({ cause: 'completion', why: `${s.lastWeek.completed} of ${s.lastWeek.planned} sessions got done. Nothing is made up.` })
  if (s.athleteShape === 'pull_back') out.push({ cause: 'athlete', why: 'Your last two weeks read as tired.' })
  return out
}

// weekRuleEases (the weekly 15% load flag and its company) went with coach brain P2: load is never an ease on its own.

/** House voice for any line: no em dashes, no exclamation marks, one line. */
export function houseLine(s: string, max = WHY_MAX): string {
  const clean = s.replace(/\s*[—–]\s*/g, ', ').replace(/!+/g, '.').replace(/\s+/g, ' ').replace(/\.{2,}/g, '.').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const stop = cut.lastIndexOf('. ')
  return stop > 40 ? cut.slice(0, stop + 1) : `${cut.replace(/[\s,;:]+\S*$/, '')}.`
}

/** The week line is longer than other lines: what's new, then what's next. */
const WEEK_LINE_MAX = 260




/** Fighter: the main lifts' share of the training max that week. */
function fighterPct(week: number): number {
  return Math.round(getWeekPercentage(week, 'fighter') * 100)
}

/** A rules ease as the week line reads it. */
export interface WeekLineEase {
  cause: WeekEaseCause
  epochDay: number
  name: string
  type?: string
}

/** One stored athlete_estimates row, as stillStarting reads it. */
export interface EstimateLike {
  kind: string
  key: string
  state: string
  valueJson: string
}

/**
 * The block's lifts or run are still found, not read (audit 2026-10-23 #18):
 * the run is a guess or still from his history before the block, or half or
 * more of the lifts have no set in the block yet (a guess, or seeded from
 * history). Then the week line says it is finding his starting points.
 */
export function stillStarting(rows: ReadonlyArray<EstimateLike>): boolean {
  const parse = (r: EstimateLike): Record<string, unknown> => {
    try { return (JSON.parse(r.valueJson) ?? {}) as Record<string, unknown> } catch { return {} }
  }
  const run = rows.find(r => r.kind === 'run' && r.key === 'tolerance')
  if (run) {
    const v = parse(run)
    if (run.state === 'GUESS' || (v.rungSource != null && v.rungSource !== 'block')) return true
  }
  const lifts = rows.filter(r => r.kind === 'lift')
  if (lifts.length === 0) return run == null
  const unread = lifts.filter(r => {
    const v = parse(r)
    return r.state === 'GUESS' || v.seed != null || v.exposures === 0
  }).length
  return unread * 2 >= lifts.length
}

/**
 * The week's one line (page 56 item 16): in plain words, what's new against
 * last week and what's next, with the real numbers. No jargon. Shown only on
 * Program's week board, as plain text. When the coach eased a session, one
 * sentence says which and why.
 */
export function whyThisWeek(s: WeekSignals, eases: ReadonlyArray<WeekLineEase>, opts: { leadIn?: boolean; starting?: boolean } = {}): string {
  const parts: string[] = []
  if (s.blockType === 'block_zero' && (s.weekNumber <= 1 || opts.starting)) {
    // Audit 2026-10-23 #18: nothing to read reps or heart rate from yet, so don't claim it.
    parts.push(`Week ${s.weekNumber}. This week finds your starting weights and run length.`)
  } else if (s.blockType === 'block_zero') {
    // Coach brain P2: no week template drives the dose; each session is set the night before.
    parts.push(`Week ${s.weekNumber}. Each session is set the night before from your last ones: weights from the reps you had left, run pieces from your heart rate.`)
  } else {
    const pct = fighterPct(s.weekNumber)
    const prevPct = s.weekNumber > 1 ? fighterPct(s.weekNumber - 1) : null
    parts.push(prevPct == null || prevPct === pct ? `Main lifts at ${pct}% of your max this week.` : `New this week: main lifts at ${pct}% of your max, ${pct > prevPct ? 'up' : 'down'} from ${prevPct}%.`)
    parts.push(s.waveEnd ? 'New maxes go in after this week.' : `Next week: ${fighterPct(s.weekNumber + 1)}%.`)
  }
  const first = eases[0]
  if (first) {
    const why = causes(s).find(c => c.cause === first.cause)?.why
    const what = `${DAY_LONG[dowOf(first.epochDay)]}'s ${midName(first.name)} ${first.type == null || first.type === 'strength' ? 'drops a set' : 'eases'}${eases.length > 1 ? ', and one more session eases' : ''}.`
    parts.push(why ? `${why} ${what}` : what)
  }
  return houseLine(parts.join(' '), WEEK_LINE_MAX)
}

// ─── What the week stores (week_plans.analysis_json, version 2) ──

export interface WeekChange {
  sessionId: string | null
  epochDay: number
  type: string
  /** One reason line. */
  reason: string
  was: string | null
  now: string | null
  source: 'rules' | 'ai' | 'placement'
  /** A rules ease: why it eased (the week line reads it). */
  cause?: WeekEaseCause
}

export interface WeekIntelligence {
  version: 2
  source: 'ai' | 'rules'
  /** The "why this week" line. */
  why: string
  changes: WeekChange[]
  /** AI sessions the placement rules refused (dropped), with why. */
  dropped: Array<{ type: string; epochDay: number; reason: string }>
  signals: WeekSignals
  athleteVerdict: string | null
  /** Full reasoning, stored only (AI narrative and notes, guardrail clamps). */
  reasoning: { narrative?: string | null; adjustmentNotes?: string | null; rulesWhy?: string; guardrails?: unknown }
  // Last week's patterns for the next pass (weekAnalysis.previousAnalysisFrom).
  deficits: Array<{ type: string; missed: number; carryForwardWeight: number; reason: string }>
  consistentSkips: string[]
  addedTypes: string[]
  /** Kept so the old card's pills still render. */
  volumeByType?: Record<string, { target: number; completed: number; skipped: number; added: number }>
  wellness?: { avgSoreness: number | null; avgSleep: number | null; sorenessTrajectory: string; sleepTrajectory: string }
  /** Kept for readers of the old shape. */
  summary: string
}

/** Pass key: one pass per block and calendar week (its Monday). */
export function weeklyPassKey(blockId: string, monday: number): string {
  return `${blockId}:${monday}`
}

/**
 * The Monday the nightly pass prepares on `todayDay`: next week on Sunday,
 * this week on Monday (a catch-up when Sunday's run never happened). Null on
 * other days.
 */
export function weeklyPassTarget(todayDay: number): number | null {
  const dow = dowOf(todayDay)
  if (dow === WEEKLY_PASS_DOW) return mondayOf(todayDay) + 7
  if (dow === 1) return mondayOf(todayDay)
  return null
}

/** A claimed pass older than this is taken over (the run that claimed it died). */
export const STALE_CLAIM_SEC = 15 * 60

/**
 * Idempotency per block and week: insert a claim when none exists, skip a
 * finished pass or a fresh claim, take over a stale claim.
 */
export function claimDecision(existing: { status: string | null; createdAt: number } | null, nowSec: number): 'insert' | 'skip' | 'takeover' {
  if (!existing) return 'insert'
  if (existing.status === 'done') return 'skip'
  return nowSec - existing.createdAt < STALE_CLAIM_SEC ? 'skip' : 'takeover'
}

// ─── E1 placement for a planned week (Fighter) ─────────────────

export interface PlannedEntry {
  type: string
  label: string | null
  notes: string | null
  epochDay: number
  timeSlot: 'am' | 'pm'
  estimatedMin: number | null
}

/**
 * Place a planner's week with the E1 rules. Sessions the template has on the
 * same day (same type, same run category) are the rules' own week and are
 * kept as they are; everything else (an added or moved session) must pass
 * checkSessionChange against the kept week, or it is dropped with the
 * refusal's reason. Days before `checkFromDay` are kept (they have passed).
 */
export function placePlannedWeek<T extends PlannedEntry>(planned: T[], template: PlannedEntry[], ctx: PlacementContext, checkFromDay: number): { accepted: T[]; dropped: Array<{ entry: T; code: string; reason: string }> } {
  const pool = template.map(t => ({ t, used: false }))
  const matched: T[] = []
  const rest: T[] = []
  for (const p of planned) {
    const m = pool.find(x => !x.used && x.t.type === p.type && x.t.epochDay === p.epochDay && (p.type !== 'running' || (x.t.notes ?? null) === (p.notes ?? null)))
    if (m || p.epochDay < checkFromDay) {
      if (m) m.used = true
      matched.push(p)
    } else {
      rest.push(p)
    }
  }
  const accepted: T[] = [...matched]
  const dropped: Array<{ entry: T; code: string; reason: string }> = []
  const neighbours = ctx.sessions.filter(s => s.epochDay < mondayOf(checkFromDay) || s.epochDay > mondayOf(checkFromDay) + 6)
  for (const p of [...rest].sort((a, b) => a.epochDay - b.epochDay || (a.timeSlot === 'am' ? -1 : 1))) {
    const sessions: SessionLike[] = [...neighbours, ...accepted.map((a, i) => ({ id: `planned-${i}`, type: a.type, label: a.label, notes: a.notes, epochDay: a.epochDay, timeSlot: a.timeSlot, status: 'planned', estimatedMin: RUN_TYPES.has(a.type) ? a.estimatedMin : null }))]
    const r = checkSessionChange({ kind: 'add', type: p.type, label: p.label, notes: p.notes, epochDay: p.epochDay, timeSlot: p.timeSlot, estimatedMin: RUN_TYPES.has(p.type) ? p.estimatedMin : null }, { ...ctx, sessions }, { alternatives: false })
    if (r.ok) accepted.push({ ...p, timeSlot: r.change.timeSlot, estimatedMin: r.change.estimatedMin ?? p.estimatedMin })
    else dropped.push({ entry: p, code: r.code, reason: r.reason })
  }
  return { accepted, dropped }
}


/** A session still carries a coach ease (an undo leaves `"coachEase":null`). */
export function hasCoachEase(contextJson: string | null | undefined): boolean {
  if (!contextJson) return false
  try {
    const ease = (JSON.parse(contextJson) as { coachEase?: unknown }).coachEase
    return ease != null && typeof ease === 'object'
  } catch { return false }
}
