// Adherence metrics. Consumed by coaching prompts and block transition logic
// so the AI can reason about what the athlete actually did, not what the
// calendar says they should have done.
//
// Sports-science framing:
// - Detraining begins ~7-14 days of inactivity (VO2max drops first, strength
//   later). Any gap >= 7 days warrants a deload on return.
// - Block Zero's purpose is base-building: connective tissue, aerobic base,
//   movement competency. Base requires exposure, not calendar time. Missing
//   half the sessions means the base isn't built, regardless of weeks elapsed.
// - Acute:Chronic Workload Ratio (ACWR): 7-day load / 28-day load. Sweet spot
//   0.8-1.3. Below 0.8 = undertrained (detraining). Above 1.5 = spike /
//   injury-risk zone. We approximate "load" with completed session counts.
//
// These metrics feed the coach silently. The user never sees a "missed" tag.
// The coach reads the signal and reshapes the plan.
import { eq, inArray } from 'drizzle-orm'
import { sessions, weekPlans } from '../db/schema'
import type { createDB } from '../db/client'

type DB = ReturnType<typeof createDB>

export type SessionStatus = 'planned' | 'in_progress' | 'completed' | 'skipped' | 'missed'

export interface AdherenceSnapshot {
  // Block-level
  blockCompletionRate: number | null      // 0-1. completed / (completed + missed + skipped) across the block
  blockPlannedSoFar: number                // planned sessions whose date has passed
  blockCompleted: number
  blockMissed: number
  blockSkipped: number

  // Short-window windows
  last7DaysCompletionRate: number | null  // 0-1
  last14DaysCompletionRate: number | null // 0-1
  last28DaysCompleted: number

  // Timing signals
  daysSinceLastCompleted: number | null    // null if no completed sessions ever
  longestGapDays: number                   // longest stretch of consecutive days with no completion within the lookback
  currentGapDays: number                   // days since last completion, same as daysSinceLastCompleted if >0

  // ACWR proxy: acute / chronic. 1.0 = holding steady. <0.8 detraining. >1.5 spike.
  acuteChronicRatio: number | null

  // Qualitative label the coach can read as shorthand
  label: AdherenceLabel
}

export type AdherenceLabel =
  | 'strong'           // >=85% recent, no gaps
  | 'steady'           // 70-85% recent, short gaps
  | 'inconsistent'     // 50-70% recent, gaps building
  | 'drifting'         // 30-50% recent, detraining risk
  | 'detached'         // <30% recent or >=14 day gap

export interface SessionLite {
  status: string
  scheduledDate: number | null
  completedAt: number | null
}

// ─── Public API ────────────────────────────────────────────────

export function computeAdherence(
  blockSessions: SessionLite[],
  todayEpochDay: number,
): AdherenceSnapshot {
  const withDate = blockSessions.filter(s => s.scheduledDate != null) as Array<SessionLite & { scheduledDate: number }>

  // Block-level counts
  const past = withDate.filter(s => s.scheduledDate <= todayEpochDay)
  const completed = past.filter(s => s.status === 'completed').length
  const missed = past.filter(s => s.status === 'missed').length
  const skipped = past.filter(s => s.status === 'skipped').length
  const accountable = completed + missed + skipped
  const blockCompletionRate = accountable > 0 ? completed / accountable : null

  // Last-N windows
  const last7 = windowRate(withDate, todayEpochDay - 6, todayEpochDay)
  const last14 = windowRate(withDate, todayEpochDay - 13, todayEpochDay)
  const last28Completed = windowCount(withDate, todayEpochDay - 27, todayEpochDay, 'completed')

  // Timing
  const lastCompletedDay = lastCompletedEpochDay(withDate)
  const daysSinceLastCompleted = lastCompletedDay != null ? todayEpochDay - lastCompletedDay : null
  const longestGapDays = computeLongestGap(withDate, todayEpochDay)
  const currentGapDays = daysSinceLastCompleted ?? longestGapDays

  // ACWR: acute 7-day completed count vs chronic avg (28-day / 4)
  const acute = windowCount(withDate, todayEpochDay - 6, todayEpochDay, 'completed')
  const chronicAvg = last28Completed / 4
  const acuteChronicRatio = chronicAvg > 0 ? acute / chronicAvg : null

  const label = deriveLabel({
    last7,
    last14,
    currentGapDays,
    blockCompletionRate,
  })

  return {
    blockCompletionRate,
    blockPlannedSoFar: past.length,
    blockCompleted: completed,
    blockMissed: missed,
    blockSkipped: skipped,
    last7DaysCompletionRate: last7,
    last14DaysCompletionRate: last14,
    last28DaysCompleted: last28Completed,
    daysSinceLastCompleted,
    longestGapDays,
    currentGapDays,
    acuteChronicRatio,
    label,
  }
}

// ─── Coaching guidance derived from the snapshot ────────────────

export interface AdherenceGuidance {
  returnDeload: 'none' | 'light' | 'significant' | 'reset_to_base'
  blockProgression: 'proceed' | 'hold' | 'extend_sessions' | 'repeat_week'
  rationale: string
}

/**
 * Translate the snapshot into concrete guidance the coach can use. This is
 * the deterministic floor — the AI is still free to override based on
 * wellness/RPE/goals, but these are the defaults grounded in sports science.
 */
export function deriveGuidance(s: AdherenceSnapshot): AdherenceGuidance {
  // Return-from-gap deload (ACSM / NSCA detraining curves)
  let returnDeload: AdherenceGuidance['returnDeload'] = 'none'
  if (s.currentGapDays >= 21) returnDeload = 'reset_to_base'
  else if (s.currentGapDays >= 14) returnDeload = 'significant'  // ~70% volume, all intensity down one zone
  else if (s.currentGapDays >= 7) returnDeload = 'light'         // ~85% volume, skip progression work

  // Block progression
  let blockProgression: AdherenceGuidance['blockProgression'] = 'proceed'
  const rate = s.blockCompletionRate ?? 1
  if (rate < 0.5) blockProgression = 'repeat_week'
  else if (rate < 0.7) blockProgression = 'hold'
  else if (rate < 0.85) blockProgression = 'extend_sessions'

  // Strongest signal wins when they conflict
  if (s.label === 'detached') {
    returnDeload = returnDeload === 'none' ? 'significant' : returnDeload
    blockProgression = 'repeat_week'
  }

  const rationale = buildRationale(s, returnDeload, blockProgression)
  return { returnDeload, blockProgression, rationale }
}

// ─── Prompt serialization for the AI ───────────────────────────

/**
 * Render the snapshot as a block of prompt text the coach can read. Terse,
 * numeric, no adjectives the model has to second-guess.
 */
export function serializeAdherenceForPrompt(s: AdherenceSnapshot, g: AdherenceGuidance): string {
  const lines: string[] = ['# Adherence signal']
  if (s.blockCompletionRate != null) {
    lines.push(`Block completion: ${s.blockCompleted}/${s.blockPlannedSoFar} (${Math.round(s.blockCompletionRate * 100)}%). Missed ${s.blockMissed}. Skipped ${s.blockSkipped}.`)
  } else {
    lines.push('Block completion: no completed sessions yet.')
  }
  if (s.last7DaysCompletionRate != null) {
    lines.push(`Last 7 days: ${Math.round(s.last7DaysCompletionRate * 100)}% completion.`)
  }
  if (s.last14DaysCompletionRate != null) {
    lines.push(`Last 14 days: ${Math.round(s.last14DaysCompletionRate * 100)}% completion.`)
  }
  if (s.daysSinceLastCompleted != null) {
    lines.push(`Days since last completed session: ${s.daysSinceLastCompleted}.`)
  }
  if (s.longestGapDays > 0) {
    lines.push(`Longest recent gap: ${s.longestGapDays} days.`)
  }
  if (s.acuteChronicRatio != null) {
    lines.push(`Acute:Chronic workload ratio: ${s.acuteChronicRatio.toFixed(2)} (target 0.8-1.3; <0.8 detraining, >1.5 spike).`)
  }
  lines.push(`Adherence label: ${s.label}.`)
  lines.push('')
  lines.push('# Adherence-derived guidance (defaults, override only with clear reason)')
  lines.push(`Return deload: ${g.returnDeload}.`)
  lines.push(`Block progression: ${g.blockProgression}.`)
  lines.push(g.rationale)
  return lines.join('\n')
}

// ─── Internals ─────────────────────────────────────────────────

function windowRate(
  all: Array<SessionLite & { scheduledDate: number }>,
  startDay: number,
  endDay: number,
): number | null {
  const inWindow = all.filter(s => s.scheduledDate >= startDay && s.scheduledDate <= endDay)
  const accountable = inWindow.filter(s => s.status === 'completed' || s.status === 'missed' || s.status === 'skipped')
  if (accountable.length === 0) return null
  const completed = accountable.filter(s => s.status === 'completed').length
  return completed / accountable.length
}

function windowCount(
  all: Array<SessionLite & { scheduledDate: number }>,
  startDay: number,
  endDay: number,
  status: string,
): number {
  return all.filter(s => s.scheduledDate >= startDay && s.scheduledDate <= endDay && s.status === status).length
}

function lastCompletedEpochDay(
  all: Array<SessionLite & { scheduledDate: number }>,
): number | null {
  const completed = all.filter(s => s.status === 'completed')
  if (completed.length === 0) return null
  return Math.max(...completed.map(s => s.scheduledDate))
}

function computeLongestGap(
  all: Array<SessionLite & { scheduledDate: number }>,
  todayEpochDay: number,
): number {
  const completedDays = all
    .filter(s => s.status === 'completed' && s.scheduledDate <= todayEpochDay)
    .map(s => s.scheduledDate)
    .sort((a, b) => a - b)

  if (completedDays.length === 0) return 0

  let maxGap = 0
  for (let i = 1; i < completedDays.length; i++) {
    const gap = completedDays[i] - completedDays[i - 1]
    if (gap > maxGap) maxGap = gap
  }
  // Also include gap from last completion to today
  const tailGap = todayEpochDay - completedDays[completedDays.length - 1]
  if (tailGap > maxGap) maxGap = tailGap
  return maxGap
}

function deriveLabel(input: {
  last7: number | null
  last14: number | null
  currentGapDays: number
  blockCompletionRate: number | null
}): AdherenceLabel {
  if (input.currentGapDays >= 14) return 'detached'
  const recent = input.last7 ?? input.last14 ?? input.blockCompletionRate
  if (recent == null) return 'steady'
  if (recent >= 0.85 && input.currentGapDays <= 2) return 'strong'
  if (recent >= 0.7) return 'steady'
  if (recent >= 0.5) return 'inconsistent'
  if (recent >= 0.3) return 'drifting'
  return 'detached'
}

function buildRationale(
  s: AdherenceSnapshot,
  deload: AdherenceGuidance['returnDeload'],
  progression: AdherenceGuidance['blockProgression'],
): string {
  const parts: string[] = []
  if (deload === 'reset_to_base') parts.push(`${s.currentGapDays}-day gap means treat first week back like Block Zero week 1.`)
  else if (deload === 'significant') parts.push(`${s.currentGapDays}-day gap: drop volume to ~70% and intensity down one zone this week.`)
  else if (deload === 'light') parts.push(`${s.currentGapDays}-day gap: trim volume to ~85%, no progression work this week.`)

  if (progression === 'repeat_week') parts.push(`Completion below 50%: the base isn't built yet. Repeat this week, do not advance.`)
  else if (progression === 'hold') parts.push(`Completion below 70%: hold the current block week, extend block by up to one week if needed.`)
  else if (progression === 'extend_sessions') parts.push(`Completion 70-85%: add makeup sessions for missed work before advancing.`)

  if (parts.length === 0) parts.push('Adherence is within tolerance. Progress the plan normally.')
  return parts.join(' ')
}

// ─── DB helpers ────────────────────────────────────────────────

/**
 * Load sessions for an active block and compute the adherence snapshot.
 * The caller has already ensured rollover has run for `todayEpochDay`.
 */
export async function computeBlockAdherence(
  db: DB,
  blockId: string,
  todayEpochDay: number,
): Promise<AdherenceSnapshot> {
  const blockWeeks = await db.select({ id: weekPlans.id }).from(weekPlans).where(eq(weekPlans.blockId, blockId))
  const weekIds = blockWeeks.map(w => w.id)
  const blockSessions = weekIds.length > 0
    ? await db
        .select({
          status: sessions.status,
          scheduledDate: sessions.scheduledDate,
          completedAt: sessions.completedAt,
        })
        .from(sessions)
        .where(inArray(sessions.weekPlanId, weekIds))
    : []
  return computeAdherence(blockSessions, todayEpochDay)
}

