// ─── Week Analysis Engine ────────────────────────────────────────
// Pure function that analyzes a completed week's data: volume against
// targets, wellness and effort trends, and patterns (types skipped or added
// two weeks running). The weekly pass (server/weeklyPass) uses it as the
// rules-only read of last week. Missed work is never made up (F14): deficits
// are reported, not carried forward. Added sessions become an ask elsewhere
// (coach/makeRegular), never an automatic add.

import { getTrackableTargets, getTarget } from './trainingTargets'
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
  /** Types added the previous week (stored as addedTypes; older rows as consistentAdds). */
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
  addedTypes: string[]        // types added ad-hoc this week (next week's "previous")
  recommendations: WeekRecommendation[]
  summary: string             // one-line human-readable summary
}

// ─── Analysis ───────────────────────────────────────────────────

/**
 * Read a stored week analysis back as the previous week's patterns. Week
 * plans store several shapes (this analysis, the weekly pass's intelligence,
 * an old AI week plan); anything without the arrays reads as no history
 * instead of crashing.
 */
export function previousAnalysisFrom(raw: unknown): PreviousWeekAnalysis | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const deficits = Array.isArray(o.deficits)
    ? o.deficits.filter((d): d is VolumeDeficit => !!d && typeof d === 'object' && typeof (d as VolumeDeficit).type === 'string')
    : null
  const added = o.addedTypes ?? o.consistentAdds
  if (!deficits && !Array.isArray(added) && !Array.isArray(o.consistentSkips)) return null
  return { deficits: deficits ?? [], consistentSkips: strings(o.consistentSkips), consistentAdds: strings(added) }
}

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
    addedTypes: Object.entries(volumeByType).filter(([, v]) => v.added > 0).map(([k]) => k),
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
  const prevDeficitTypes = new Set((Array.isArray(previous.deficits) ? previous.deficits : []).map(d => d.type))
  return deficits
    .filter(d => prevDeficitTypes.has(d.type))
    .map(d => d.type)
}

function detectConsistentAdds(
  volume: Record<string, VolumeEntry>,
  previous: PreviousWeekAnalysis | null,
): string[] {
  if (!previous) return []
  const prevAdds = new Set(Array.isArray(previous.consistentAdds) ? previous.consistentAdds : [])
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

  // ─── Deficits: never made up (F14) ─────────────────────────
  // A type missed two weeks running is worth a look; once is just life.
  for (const deficit of deficits) {
    if (!consistentSkipSet.has(deficit.type)) continue
    const [type, runCategory] = deficit.type.split(':')
    const target = getTarget(type, runCategory)
    if (!target) continue
    recs.push({
      action: 'swap',
      sessionType: type,
      runCategory,
      reason: `${target.label} missed 2+ weeks in a row. Worth swapping for something that fits.`,
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

  // Consistent adds are asked about by the weekly pass (coach/makeRegular).
  void consistentAdds

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

