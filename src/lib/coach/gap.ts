// Return after a gap (F12, F13). Pure: callers pass the days a key session was
// completed (strength, run, rope, bag, muay thai) and the day being planned.
//
// F12: <= 7-10 days off -> ~90% load, ~80% volume for a week.
// F13: 2-3 wk gap -> 1-2 weeks at 80-85% load, 60-70% volume. >= 4 wk -> a mini
//      Block Zero with a 2-3 wk ramp. Weak evidence (extrapolated detraining
//      curves), so the numbers sit at the conservative end.
// Gap = full days with no completed key session between two that were done.
// While a gap is still open, the day being planned is the first day back.

export type ReturnTier = 'none' | 'short' | 'medium' | 'long' | 'restart'

export interface ReturnStep {
  /** Days from the first day back this step covers, [from, to). */
  fromDay: number
  toDay: number
  loadFactor: number
  volumeFactor: number
}

export interface ReturnPlan {
  gapDays: number
  tier: ReturnTier
  /** First-week factors. Steps taper back to 1 over durationDays. */
  loadFactor: number
  volumeFactor: number
  durationDays: number
  durationWeeks: number
  /** >= 4 weeks: mini Block Zero (Fighter offers one, Block Zero restarts at week 1). */
  restart: boolean
  steps: ReturnStep[]
  reason: string | null
}

export const GAP_PAUSE_DAYS = 7
export const RESTART_GAP_DAYS = 28

const SHORT: ReturnStep = { fromDay: 0, toDay: 7, loadFactor: 0.9, volumeFactor: 0.8 }

function pct(f: number): number {
  return Math.round(f * 100)
}

function offText(gapDays: number): string {
  if (gapDays >= 14) return `${Math.floor(gapDays / 7)} weeks off`
  return `${gapDays} days off`
}

/** The return table for a gap length in days. */
export function returnPlan(gapDays: number): ReturnPlan {
  const g = Number.isFinite(gapDays) ? Math.max(0, Math.floor(gapDays)) : 0
  let tier: ReturnTier
  let steps: ReturnStep[]
  if (g < GAP_PAUSE_DAYS) {
    tier = 'none'
    steps = []
  } else if (g < 14) {
    tier = 'short'
    steps = [SHORT]
  } else if (g < 21) {
    tier = 'medium'
    steps = [{ fromDay: 0, toDay: 7, loadFactor: 0.85, volumeFactor: 0.7 }]
  } else if (g < RESTART_GAP_DAYS) {
    tier = 'long'
    steps = [{ fromDay: 0, toDay: 7, loadFactor: 0.8, volumeFactor: 0.65 }, { ...SHORT, fromDay: 7, toDay: 14 }]
  } else {
    tier = 'restart'
    steps = [
      { fromDay: 0, toDay: 7, loadFactor: 0.75, volumeFactor: 0.6 },
      { fromDay: 7, toDay: 14, loadFactor: 0.85, volumeFactor: 0.7 },
      { ...SHORT, fromDay: 14, toDay: 21 },
    ]
  }
  const first = steps[0]
  const durationDays = steps.length > 0 ? steps[steps.length - 1].toDay : 0
  const restart = tier === 'restart'
  const reason = first
    ? restart
      ? `${offText(g)}. Back to week-1 levels and a ${durationDays / 7}-week ramp.`
      : `${offText(g)}. Loads at ${pct(first.loadFactor)}% and volume at ${pct(first.volumeFactor)}% for ${durationDays / 7 === 1 ? 'a week' : `${durationDays / 7} weeks`}.`
    : null
  return {
    gapDays: g,
    tier,
    loadFactor: first?.loadFactor ?? 1,
    volumeFactor: first?.volumeFactor ?? 1,
    durationDays,
    durationWeeks: durationDays / 7,
    restart,
    steps,
    reason,
  }
}

export interface ReturnContext {
  /** True while the return ramp applies to the day. */
  active: boolean
  plan: ReturnPlan
  /** First completed key session after the gap. Null while the gap is open. */
  returnDay: number | null
  daysSinceReturn: number
  /** Factors for this day (tapered). 1 when inactive. */
  loadFactor: number
  volumeFactor: number
  /** No power or conditioning finishers (gap of 7+ days, ramp active). */
  noFinishers: boolean
  /** Trend or AI load factors may not push above 1. */
  noPush: boolean
  /** One line for the note fields. Null when inactive. */
  reason: string | null
}

const NONE: ReturnContext = {
  active: false,
  plan: returnPlan(0),
  returnDay: null,
  daysSinceReturn: 0,
  loadFactor: 1,
  volumeFactor: 1,
  noFinishers: false,
  noPush: false,
  reason: null,
}

function stepFor(plan: ReturnPlan, daysSinceReturn: number): ReturnStep | null {
  return plan.steps.find(s => daysSinceReturn >= s.fromDay && daysSinceReturn < s.toDay) ?? null
}

/**
 * The return ramp that applies on `day`. `completedKeyDays` are the epoch days
 * of completed key sessions (duplicates fine, any order). Days after `day` are
 * ignored, so a plan made today reads the same before and after the session.
 */
export function returnContext(completedKeyDays: number[], day: number): ReturnContext {
  const before = [...new Set(completedKeyDays)].filter(d => d < day).sort((a, b) => a - b)
  if (before.length === 0) return NONE

  // Open gap: nothing since the last session, and the day is the first back.
  const last = before[before.length - 1]
  const openGap = day - last - 1
  if (openGap >= GAP_PAUSE_DAYS) {
    const plan = returnPlan(openGap)
    return build(plan, null, 0)
  }

  // Most recent closed gap: the athlete is back, the ramp tapers from that day.
  for (let i = before.length - 1; i > 0; i--) {
    const gap = before[i] - before[i - 1] - 1
    if (gap < GAP_PAUSE_DAYS) continue
    const plan = returnPlan(gap)
    const since = day - before[i]
    if (since >= plan.durationDays) return NONE
    return build(plan, before[i], since)
  }
  return NONE
}

function build(plan: ReturnPlan, returnDay: number | null, since: number): ReturnContext {
  const step = stepFor(plan, since)
  if (!step) return NONE
  const tapered = step !== plan.steps[0]
  const reason = tapered
    ? `Coming back from ${offText(plan.gapDays)}. Loads at ${pct(step.loadFactor)}% and volume at ${pct(step.volumeFactor)}% this week.`
    : plan.reason
  return {
    active: true,
    plan,
    returnDay,
    daysSinceReturn: since,
    loadFactor: step.loadFactor,
    volumeFactor: step.volumeFactor,
    noFinishers: true,
    noPush: true,
    reason,
  }
}

/** Working sets after the volume factor. Never below one. */
export function scaleSets(sets: number, volumeFactor: number): number {
  if (!(sets > 0)) return sets
  return Math.max(1, Math.round(sets * volumeFactor))
}

/** Load after the return factor, rounded to 0.5 kg. */
export function scaleLoadKg(kg: number, loadFactor: number): number {
  return Math.round((kg * loadFactor) * 2) / 2
}
