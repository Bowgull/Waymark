// HR analysis. Reads recent run_sessions and derives signals the coach can
// reason about: HR drift (fatigue) and zone-2 compliance (pacing discipline).
//
// Sports-science framing:
// - HR drift at comparable pace/distance week-over-week = accumulated fatigue,
//   under-recovery, or heat/hydration stress. A 5-8 bpm rise at equal effort
//   is a yellow flag; 10+ bpm is red. (Coggan/Friel aerobic decoupling canon.)
// - Zone-2 compliance matters because most "easy" runs are run too hard. If
//   prescribed zone-2 but avg HR sits above the ceiling, the aerobic base
//   adaptation isn't happening — the run did conditioning work but not base
//   work. Over-pacing zone-2 is the single most common recreational-athlete
//   mistake the coach should flag.
// - Signals are derived from whatever the athlete actually logged (manual on
//   treadmill or Strava-pulled outdoor). Missing HR = no signal, not an error.

import { and, desc, eq, gte, isNotNull } from 'drizzle-orm'
import { runSessions, sessions } from '../db/schema'
import type { createDB } from '../db/client'

type DB = ReturnType<typeof createDB>

// Default zone-2 ceiling for the user. Hardcoded from their profile (trained
// MT athlete, ~30s). Can move to userProfile later if we start supporting
// multiple users. Zone-2 is "conversational, nasal-breathing sustainable."
const DEFAULT_Z2_CEILING_BPM = 145

// Types of runs where zone-2 compliance matters.
const EASY_RUN_TYPES = new Set(['zone2', 'easy', 'easy_strides'])

export interface RunHrLite {
  runType: string | null
  avgHr: number | null
  maxHr: number | null
  distanceKm: number | null
  durationSec: number | null
  paceSecKm: number | null
  completedAt: number | null     // epoch seconds, for ordering
  scheduledDate: number | null   // epoch day
}

export interface HrSnapshot {
  // Zone-2 compliance across last N easy runs
  z2RunsWithHr: number
  z2RunsAboveCeiling: number
  z2AvgHrLast4: number | null
  z2OverCeilingRate: number | null  // 0-1
  z2Compliance: 'on_target' | 'slightly_high' | 'over_paced' | 'insufficient_data'

  // HR drift across the most recent easy runs at comparable effort
  // Compares the last easy run's HR-adjusted-for-pace against the 3 before it.
  driftBpm: number | null
  driftAssessment: 'stable' | 'mild_fatigue' | 'clear_fatigue' | 'insufficient_data'

  // Latest recorded HR for context
  lastAvgHr: number | null
  lastMaxHr: number | null
  lastRunDaysAgo: number | null

  // How many of the window even had HR
  runsInWindow: number
  runsWithHr: number
}

// ─── Public API ─────────────────────────────────────────────────

export function computeHrSnapshot(runs: RunHrLite[], todayEpochDay: number): HrSnapshot {
  const runsInWindow = runs.length
  const withHr = runs.filter(r => r.avgHr != null && r.avgHr > 0)
  const runsWithHr = withHr.length

  // Easy runs only for zone-2 compliance
  const easyWithHr = withHr.filter(r => r.runType && EASY_RUN_TYPES.has(r.runType))
  const easyLast4 = easyWithHr.slice(0, 4)
  const z2RunsWithHr = easyLast4.length
  const z2RunsAboveCeiling = easyLast4.filter(r => (r.avgHr ?? 0) > DEFAULT_Z2_CEILING_BPM).length
  const z2AvgHrLast4 = easyLast4.length > 0
    ? Math.round(easyLast4.reduce((sum, r) => sum + (r.avgHr ?? 0), 0) / easyLast4.length)
    : null
  const z2OverCeilingRate = easyLast4.length > 0 ? z2RunsAboveCeiling / easyLast4.length : null

  let z2Compliance: HrSnapshot['z2Compliance'] = 'insufficient_data'
  if (easyLast4.length >= 2 && z2AvgHrLast4 != null) {
    if (z2AvgHrLast4 <= DEFAULT_Z2_CEILING_BPM) z2Compliance = 'on_target'
    else if (z2AvgHrLast4 <= DEFAULT_Z2_CEILING_BPM + 8) z2Compliance = 'slightly_high'
    else z2Compliance = 'over_paced'
  }

  // HR drift: compare latest easy run to the preceding 3 at similar pace.
  // "Similar pace" = within 15s/km of the latest one. If no comparable baseline
  // exists, drift is insufficient_data. This avoids false positives from a
  // tempo-flavored "easy" day vs a true recovery jog.
  let driftBpm: number | null = null
  let driftAssessment: HrSnapshot['driftAssessment'] = 'insufficient_data'
  if (easyWithHr.length >= 4) {
    const [latest, ...prior] = easyWithHr
    const latestPace = latest.paceSecKm
    if (latest.avgHr != null && latestPace != null) {
      const comparable = prior.filter(r => r.paceSecKm != null && Math.abs((r.paceSecKm) - latestPace) <= 15).slice(0, 3)
      if (comparable.length >= 2) {
        const baseline = comparable.reduce((sum, r) => sum + (r.avgHr ?? 0), 0) / comparable.length
        driftBpm = Math.round((latest.avgHr - baseline) * 10) / 10
        if (driftBpm <= 3) driftAssessment = 'stable'
        else if (driftBpm <= 8) driftAssessment = 'mild_fatigue'
        else driftAssessment = 'clear_fatigue'
      }
    }
  }

  const latest = runs[0]
  const lastAvgHr = latest?.avgHr ?? null
  const lastMaxHr = latest?.maxHr ?? null
  const lastRunDaysAgo = latest?.scheduledDate != null ? todayEpochDay - latest.scheduledDate : null

  return {
    z2RunsWithHr,
    z2RunsAboveCeiling,
    z2AvgHrLast4,
    z2OverCeilingRate,
    z2Compliance,
    driftBpm,
    driftAssessment,
    lastAvgHr,
    lastMaxHr,
    lastRunDaysAgo,
    runsInWindow,
    runsWithHr,
  }
}

// ─── Prompt serialization ───────────────────────────────────────

export function serializeHrForPrompt(s: HrSnapshot): string | null {
  if (s.runsWithHr === 0) return null

  const lines: string[] = ['# HR signal']
  if (s.lastAvgHr != null) {
    lines.push(`Last run avg HR: ${s.lastAvgHr} bpm${s.lastMaxHr ? ` (max ${s.lastMaxHr})` : ''}.`)
  }

  if (s.z2Compliance === 'insufficient_data') {
    lines.push(`Zone-2 compliance: not enough easy runs with HR yet (have ${s.z2RunsWithHr}).`)
  } else {
    lines.push(`Zone-2 compliance (last ${s.z2RunsWithHr} easy runs): avg ${s.z2AvgHrLast4} bpm, target ≤${DEFAULT_Z2_CEILING_BPM}. ${s.z2RunsAboveCeiling} of ${s.z2RunsWithHr} ran over the ceiling. Status: ${s.z2Compliance}.`)
    if (s.z2Compliance === 'over_paced') {
      lines.push(`Over-paced easy runs are doing conditioning work, not aerobic base work. Prescribe a hard ceiling (walk if HR climbs above ${DEFAULT_Z2_CEILING_BPM}) on the next easy run.`)
    } else if (s.z2Compliance === 'slightly_high') {
      lines.push(`Easy pace is drifting above zone-2. Remind the athlete to run by HR, not feel, on the next zone-2 session.`)
    }
  }

  if (s.driftAssessment === 'insufficient_data') {
    // omit — no signal worth stating
  } else {
    lines.push(`HR drift (latest easy run vs prior ${s.driftAssessment === 'stable' ? '' : ''}comparable runs at same pace): ${s.driftBpm != null && s.driftBpm >= 0 ? '+' : ''}${s.driftBpm} bpm. Status: ${s.driftAssessment}.`)
    if (s.driftAssessment === 'clear_fatigue') {
      lines.push(`HR up 8+ bpm at same pace signals accumulated fatigue or under-recovery. Drop intensity a zone this week; keep volume.`)
    } else if (s.driftAssessment === 'mild_fatigue') {
      lines.push(`HR up 3-8 bpm at same pace: watch sleep/soreness; avoid stacking hard sessions.`)
    }
  }

  return lines.join('\n')
}

// ─── DB helpers ─────────────────────────────────────────────────

/**
 * Load the last ~28 days of completed runs with their HR, ordered most-recent
 * first. Filters to completed runs (joined with sessions table). Limits to a
 * small window so the prompt stays bounded.
 */
export async function loadRecentRunsForHr(
  db: DB,
  todayEpochDay: number,
  windowDays = 28,
): Promise<RunHrLite[]> {
  const cutoffEpochDay = todayEpochDay - windowDays
  const rows = await db
    .select({
      runType: runSessions.runType,
      avgHr: runSessions.avgHr,
      maxHr: runSessions.maxHr,
      distanceKm: runSessions.distanceKm,
      durationSec: runSessions.durationSec,
      paceSecKm: runSessions.paceSecKm,
      completedAt: sessions.completedAt,
      scheduledDate: sessions.scheduledDate,
      status: sessions.status,
    })
    .from(runSessions)
    .innerJoin(sessions, eq(runSessions.sessionId, sessions.id))
    .where(and(
      eq(sessions.status, 'completed'),
      gte(sessions.scheduledDate, cutoffEpochDay),
      isNotNull(sessions.scheduledDate),
    ))
    .orderBy(desc(sessions.scheduledDate))
    .limit(20)

  return rows.map(r => ({
    runType: r.runType,
    avgHr: r.avgHr,
    maxHr: r.maxHr,
    distanceKm: r.distanceKm,
    durationSec: r.durationSec,
    paceSecKm: r.paceSecKm,
    completedAt: r.completedAt,
    scheduledDate: r.scheduledDate,
  }))
}
