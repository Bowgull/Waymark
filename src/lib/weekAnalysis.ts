// ─── Week Analysis Engine ────────────────────────────────────────
// Pure function that analyzes a completed week's data and produces
// recommendations for the next week. This is the brain of the
// training intelligence system.

import { getTrackableTargets, getTarget, type SessionTarget } from './trainingTargets'
import { WEEKLY_TEMPLATE } from './weeklyTemplate'

// ─── Types ──────────────────────────────────────────────────────

export interface WeekSessionRecord {
  type: string
  status: string       // planned | in_progress | completed | skipped | missed
  scheduledDate: number
  timeSlot: string
  rpe: number | null
  difficulty: number | null
  notes: string | null // for run category
}

export interface DailyLogRecord {
  logDate: number
  sleepHours: number | null
  soreness: number | null
  weedGrams: number | null
  alcoholScale: number | null
}

export interface PreviousWeekAnalysis {
  deficits: VolumeDeficit[]
  consistentSkips: string[]
  consistentAdds: string[]
}

export interface VolumeEntry {
  target: number
  completed: number
  skipped: number
  added: number  // ad-hoc additions beyond template
}

export interface VolumeDeficit {
  type: string
  missed: number
  carryForwardWeight: number
  reason: string
}

export interface WellnessTrends {
  avgSoreness: number | null
  avgSleep: number | null
  sorenessTrajectory: 'improving' | 'stable' | 'worsening'
  sleepTrajectory: 'improving' | 'stable' | 'worsening'
}

export interface PerformanceSignals {
  avgRpe: number | null
  avgDifficulty: number | null
  completionRate: number // 0-1
}

export interface WeekRecommendation {
  action: 'add' | 'swap' | 'reduce_intensity' | 'add_recovery' | 'maintain'
  sessionType: string
  reason: string
  timeSlot?: 'am' | 'pm'
  dayOfWeek?: number
  runCategory?: string
}

export interface WeekAnalysis {
  volumeByType: Record<string, VolumeEntry>
  deficits: VolumeDeficit[]
  wellness: WellnessTrends
  performance: PerformanceSignals
  consistentSkips: string[]   // types skipped 2+ weeks in a row
  consistentAdds: string[]    // types added ad-hoc 2+ weeks
  recommendations: WeekRecommendation[]
  summary: string             // one-line human-readable summary
}

// ─── Analysis ───────────────────────────────────────────────────

export function analyzeWeek(
  weekSessions: WeekSessionRecord[],
  dailyLogs: DailyLogRecord[],
  previousWeekDailyLogs: DailyLogRecord[],
  previous: PreviousWeekAnalysis | null,
): WeekAnalysis {
  const volumeByType = computeVolume(weekSessions)
  const deficits = computeDeficits(volumeByType)
  const wellness = computeWellnessTrends(dailyLogs, previousWeekDailyLogs)
  const performance = computePerformance(weekSessions)
  const consistentSkips = detectConsistentSkips(deficits, previous)
  const consistentAdds = detectConsistentAdds(volumeByType, previous)
  const recommendations = generateRecommendations(deficits, wellness, performance, consistentSkips, consistentAdds)
  const summary = buildSummary(deficits, wellness, performance)

  return {
    volumeByType,
    deficits,
    wellness,
    performance,
    consistentSkips,
    consistentAdds,
    recommendations,
    summary,
  }
}

// ─── Volume Accounting ──────────────────────────────────────────

function computeVolume(sessions: WeekSessionRecord[]): Record<string, VolumeEntry> {
  const targets = getTrackableTargets()
  const result: Record<string, VolumeEntry> = {}

  // Initialize from targets
  for (const t of targets) {
    const key = t.runCategory ? `${t.type}:${t.runCategory}` : t.type
    result[key] = { target: t.weeklyTarget, completed: 0, skipped: 0, added: 0 }
  }

  // Count template sessions (those that were expected from the weekly template)
  const templateSessionCount: Record<string, number> = {}
  for (const day of Object.values(WEEKLY_TEMPLATE)) {
    for (const s of day) {
      const key = s.runCategory ? `${s.type}:${s.runCategory}` : s.type
      templateSessionCount[key] = (templateSessionCount[key] ?? 0) + 1
    }
  }

  for (const session of sessions) {
    const runCat = session.type === 'running' ? (session.notes ?? undefined) : undefined
    const key = runCat ? `${session.type}:${runCat}` : session.type

    if (!result[key]) {
      const target = getTarget(session.type, runCat)
      result[key] = { target: target?.weeklyTarget ?? 0, completed: 0, skipped: 0, added: 0 }
    }

    if (session.status === 'completed') {
      result[key].completed++
    } else if (session.status === 'skipped' || session.status === 'missed') {
      // Both count as un-completed for volume deficits. 'missed' is the silent
      // rollover flip (day passed untouched); 'skipped' is the user's explicit
      // action. Adherence math treats them identically; the distinction lives
      // in coaching voice.
      result[key].skipped++
    }
  }

  // Count ad-hoc additions (completed sessions beyond template count)
  for (const [key, entry] of Object.entries(result)) {
    const templateCount = templateSessionCount[key] ?? 0
    const totalScheduled = sessions.filter(s => {
      const rCat = s.type === 'running' ? (s.notes ?? undefined) : undefined
      const sKey = rCat ? `${s.type}:${rCat}` : s.type
      return sKey === key
    }).length
    if (totalScheduled > templateCount) {
      entry.added = totalScheduled - templateCount
    }
  }

  return result
}

function computeDeficits(volume: Record<string, VolumeEntry>): VolumeDeficit[] {
  const deficits: VolumeDeficit[] = []

  for (const [key, entry] of Object.entries(volume)) {
    if (entry.target === 0) continue
    const missed = entry.target - entry.completed
    if (missed <= 0) continue

    const [type, runCategory] = key.split(':')
    const target = getTarget(type, runCategory)
    if (!target) continue

    let reason = `${missed} of ${entry.target} ${target.label} sessions missed`
    if (entry.skipped > 0) reason += ` (${entry.skipped} skipped)`

    deficits.push({
      type: key,
      missed,
      carryForwardWeight: target.carryForwardWeight,
      reason,
    })
  }

  // Sort by carry-forward weight (highest priority deficits first)
  deficits.sort((a, b) => b.carryForwardWeight - a.carryForwardWeight)
  return deficits
}

// ─── Wellness Trends ────────────────────────────────────────────

function computeWellnessTrends(
  thisWeek: DailyLogRecord[],
  prevWeek: DailyLogRecord[],
): WellnessTrends {
  const thisAvgSoreness = avg(thisWeek.map(l => l.soreness).filter(nonNull))
  const thisAvgSleep = avg(thisWeek.map(l => l.sleepHours).filter(nonNull))
  const prevAvgSoreness = avg(prevWeek.map(l => l.soreness).filter(nonNull))
  const prevAvgSleep = avg(prevWeek.map(l => l.sleepHours).filter(nonNull))

  return {
    avgSoreness: thisAvgSoreness,
    avgSleep: thisAvgSleep,
    sorenessTrajectory: trajectory(prevAvgSoreness, thisAvgSoreness, 0.5, true),
    sleepTrajectory: trajectory(prevAvgSleep, thisAvgSleep, 0.5, false),
  }
}

function trajectory(
  prev: number | null,
  curr: number | null,
  threshold: number,
  higherIsWorse: boolean,
): 'improving' | 'stable' | 'worsening' {
  if (prev === null || curr === null) return 'stable'
  const diff = curr - prev
  if (Math.abs(diff) < threshold) return 'stable'
  if (higherIsWorse) return diff > 0 ? 'worsening' : 'improving'
  return diff > 0 ? 'improving' : 'worsening'
}

// ─── Performance Signals ────────────────────────────────────────

function computePerformance(sessions: WeekSessionRecord[]): PerformanceSignals {
  const completed = sessions.filter(s => s.status === 'completed')
  // Exclude future planned (haven't happened yet) and in_progress (still live).
  // Completed/skipped/missed all count toward "this session had a chance to happen".
  const total = sessions.filter(s =>
    s.status === 'completed' || s.status === 'skipped' || s.status === 'missed'
  )
  const rpeVals = completed.map(s => s.rpe).filter(nonNull)
  const diffVals = completed.map(s => s.difficulty).filter(nonNull)

  return {
    avgRpe: avg(rpeVals),
    avgDifficulty: avg(diffVals),
    completionRate: total.length > 0 ? completed.length / total.length : 1,
  }
}

// ─── Pattern Detection ──────────────────────────────────────────

function detectConsistentSkips(
  deficits: VolumeDeficit[],
  previous: PreviousWeekAnalysis | null,
): string[] {
  if (!previous) return []
  const prevDeficitTypes = new Set(previous.deficits.map(d => d.type))
  return deficits
    .filter(d => prevDeficitTypes.has(d.type))
    .map(d => d.type)
}

function detectConsistentAdds(
  volume: Record<string, VolumeEntry>,
  previous: PreviousWeekAnalysis | null,
): string[] {
  if (!previous) return []
  const prevAdds = new Set(previous.consistentAdds)
  const thisWeekAdds = Object.entries(volume)
    .filter(([, entry]) => entry.added > 0)
    .map(([key]) => key)
  // Types that were ad-hoc added both weeks
  return thisWeekAdds.filter(t => prevAdds.has(t))
}

// ─── Recommendation Engine ──────────────────────────────────────

function generateRecommendations(
  deficits: VolumeDeficit[],
  wellness: WellnessTrends,
  performance: PerformanceSignals,
  consistentSkips: string[],
  consistentAdds: string[],
): WeekRecommendation[] {
  const recs: WeekRecommendation[] = []
  const consistentSkipSet = new Set(consistentSkips)

  // ─── Deficit carry-forward ────────────────────────────────
  for (const deficit of deficits) {
    if (deficit.carryForwardWeight < 0.2) continue // not worth carrying forward

    const [type, runCategory] = deficit.type.split(':')
    const target = getTarget(type, runCategory)
    if (!target) continue

    // If consistently skipped 2+ weeks, suggest template adjustment instead
    if (consistentSkipSet.has(deficit.type)) {
      recs.push({
        action: 'swap',
        sessionType: type,
        runCategory,
        reason: `${target.label} missed 2+ weeks in a row. Consider swapping for something you'll do`,
      })
      continue
    }

    // Otherwise: suggest adding a makeup session
    const slot = findOpenSlot(type, target)
    recs.push({
      action: 'add',
      sessionType: type,
      runCategory,
      reason: `Make up ${deficit.missed} missed ${target.label} session${deficit.missed > 1 ? 's' : ''}`,
      timeSlot: slot?.timeSlot,
      dayOfWeek: slot?.dayOfWeek,
    })
  }

  // ─── Wellness-driven adjustments ──────────────────────────
  if (wellness.sorenessTrajectory === 'worsening') {
    recs.push({
      action: 'add_recovery',
      sessionType: 'active_recovery',
      reason: 'Soreness trending up. Adding recovery session',
      timeSlot: 'pm',
    })
  }

  if (wellness.avgSoreness !== null && wellness.avgSoreness >= 3.5) {
    recs.push({
      action: 'reduce_intensity',
      sessionType: 'strength',
      reason: `High avg soreness (${wellness.avgSoreness.toFixed(1)}/5). Consider reducing accessory volume`,
    })
  }

  if (wellness.sleepTrajectory === 'worsening' && wellness.avgSleep !== null && wellness.avgSleep < 6.5) {
    recs.push({
      action: 'reduce_intensity',
      sessionType: 'running',
      reason: `Sleep declining (avg ${wellness.avgSleep.toFixed(1)}h). Keep runs easy, skip progression work if needed`,
    })
  }

  // ─── Performance-driven ────────────────────────────────────
  if (performance.avgRpe !== null && performance.avgRpe >= 8.5) {
    recs.push({
      action: 'add_recovery',
      sessionType: 'active_recovery',
      reason: `Avg RPE very high (${performance.avgRpe.toFixed(1)}). Recovery session needed`,
      timeSlot: 'pm',
    })
  }

  if (performance.completionRate < 0.5) {
    recs.push({
      action: 'reduce_intensity',
      sessionType: 'strength',
      reason: `Low completion rate (${Math.round(performance.completionRate * 100)}%). Reduce volume to rebuild consistency`,
    })
  }

  // ─── Consistent adds → template suggestion ────────────────
  for (const addType of consistentAdds) {
    const [type, runCategory] = addType.split(':')
    const target = getTarget(type, runCategory)
    if (!target) continue

    recs.push({
      action: 'add',
      sessionType: type,
      runCategory,
      reason: `You've been adding ${target.label} ad-hoc consistently. Building it into the plan`,
    })
  }

  // ─── All good ──────────────────────────────────────────────
  if (recs.length === 0 && performance.completionRate >= 0.8) {
    recs.push({
      action: 'maintain',
      sessionType: 'all',
      reason: 'Strong week. Maintain current programming',
    })
  }

  return recs
}

/** Find an open slot in the weekly template for a given session type */
function findOpenSlot(type: string, target: SessionTarget): { dayOfWeek: number; timeSlot: 'am' | 'pm' } | null {
  // Prefer Saturday for makeup sessions (most flexible day)
  // Then try other days that don't already have this type
  const preferredDays = [6, 0, 4, 2, 1, 3, 5] // Sat, Sun, Thu, Tue, Mon, Wed, Fri
  const timeSlot = target.flexibleTimeSlot ? 'am' : target.defaultTimeSlot

  for (const day of preferredDays) {
    const daySessions = WEEKLY_TEMPLATE[day] ?? []
    const hasType = daySessions.some(s => s.type === type)
    if (!hasType) {
      return { dayOfWeek: day, timeSlot }
    }
  }
  return null
}

// ─── Summary Builder ────────────────────────────────────────────

function buildSummary(
  deficits: VolumeDeficit[],
  wellness: WellnessTrends,
  performance: PerformanceSignals,
): string {
  const parts: string[] = []

  if (deficits.length === 0 && performance.completionRate >= 0.8) {
    parts.push('Solid week')
  } else if (performance.completionRate < 0.5) {
    parts.push('Rough week, low completion')
  } else if (deficits.length > 0) {
    const missed = deficits.reduce((sum, d) => sum + d.missed, 0)
    parts.push(`${missed} session${missed > 1 ? 's' : ''} behind target`)
  }

  if (wellness.sorenessTrajectory === 'worsening') {
    parts.push('soreness trending up')
  } else if (wellness.avgSoreness !== null && wellness.avgSoreness <= 2) {
    parts.push('recovering well')
  }

  if (wellness.sleepTrajectory === 'worsening') {
    parts.push('sleep declining')
  }

  if (performance.avgRpe !== null && performance.avgRpe >= 8) {
    parts.push('high perceived effort')
  }

  return parts.length > 0 ? parts.join('. ') : 'On track'
}

// ─── Helpers ────────────────────────────────────────────────────

function nonNull<T>(val: T | null | undefined): val is T {
  return val != null
}

function avg(vals: number[]): number | null {
  if (vals.length === 0) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

// ─── Same-week reschedule logic ─────────────────────────────────

export interface RescheduleProposal {
  sessionType: string
  originalDay: number
  suggestedDay: number
  suggestedTimeSlot: 'am' | 'pm'
  reason: string
  runCategory?: string
}

/**
 * When a session is skipped, propose rescheduling it later in the same week.
 * Returns null if no open slot or session type is low priority.
 */
export function proposeReschedule(
  skippedSession: { type: string; scheduledDate: number; timeSlot: string; notes: string | null },
  remainingWeekSessions: { type: string; scheduledDate: number; timeSlot: string; status: string }[],
  todayEpochDay: number,
): RescheduleProposal | null {
  const runCategory = skippedSession.type === 'running' ? (skippedSession.notes ?? undefined) : undefined
  const target = getTarget(skippedSession.type, runCategory)
  if (!target || target.priority === 'low') return null

  const skippedDow = new Date(skippedSession.scheduledDate * 86400000).getUTCDay()

  // Find remaining days this week with open slots
  const weekStart = todayEpochDay - new Date(todayEpochDay * 86400000).getUTCDay()
  const remainingDays: number[] = []
  for (let d = todayEpochDay + 1; d <= weekStart + 6; d++) {
    remainingDays.push(d)
  }

  // Check which days already have this session type
  const daysWithType = new Set(
    remainingWeekSessions
      .filter(s => s.type === skippedSession.type && s.status !== 'skipped')
      .map(s => s.scheduledDate)
  )

  // Find the first open day
  for (const day of remainingDays) {
    if (daysWithType.has(day)) continue

    const dow = new Date(day * 86400000).getUTCDay()
    const daySessions = remainingWeekSessions.filter(s => s.scheduledDate === day && s.status !== 'skipped')

    // Don't overload a day, max 3 sessions
    if (daySessions.length >= 3) continue

    // Check time slot availability
    const timeSlot = target.flexibleTimeSlot
      ? (daySessions.some(s => s.timeSlot === target.defaultTimeSlot)
        ? (target.defaultTimeSlot === 'am' ? 'pm' : 'am')
        : target.defaultTimeSlot)
      : target.defaultTimeSlot

    const slotTaken = daySessions.some(s => s.timeSlot === timeSlot)
    if (slotTaken && !target.flexibleTimeSlot) continue

    return {
      sessionType: skippedSession.type,
      originalDay: skippedDow,
      suggestedDay: dow,
      suggestedTimeSlot: timeSlot as 'am' | 'pm',
      reason: `Reschedule ${target.label} from ${dayName(skippedDow)} to ${dayName(dow)}`,
      runCategory,
    }
  }

  return null
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
function dayName(dow: number): string {
  return DAY_NAMES[dow] ?? `Day ${dow}`
}
