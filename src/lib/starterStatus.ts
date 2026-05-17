// Deconditioned-starter status. Tells the coach whether the athlete is still
// inside the return-to-training ramp (the first 8 weeks back after a long
// layoff) so the system prompt can keep applying starter modifiers: softer HR,
// talk-test instead of ceilings, conservative load, don't misread early MT
// fatigue as overreach.
//
// Exit criteria (either triggers graduation):
//   (a) 8+ weeks of training have elapsed since the first completed session
//   (b) 3 consecutive zone-2 runs average under 150 bpm at conversational pace
//
// Until one fires, we stay active. Status feeds into buildSystemPrompt as an
// extra cached block so every downstream coach call reads the same signal.

import { and, desc, eq, gte } from 'drizzle-orm'
import { runSessions, sessions } from '../db/schema'
import type { createDB } from '../db/client'

type DB = ReturnType<typeof createDB>

const STARTER_WINDOW_DAYS = 8 * 7
const HR_GRAD_STREAK = 3
const HR_GRAD_CEILING = 150

export interface StarterStatus {
  active: boolean
  daysIntoProgram: number | null
  reason: string
}

const SEDENTARY_KEYWORDS = /sedentary|long layoff|returning|smoker|cooked lungs|years off|off training|deconditioned/i
const ZONE_2_RUN_TYPES = new Set(['zone2', 'easy', 'foundation', 'foundation_run'])

interface StarterRunEvidence {
  scheduledDate: number | null
  type: string
  runType: string | null
  avgHr: number | null
}

export function profileIndicatesStarter(trainingHistory: string | null, constraints: string | null): boolean {
  const blob = `${trainingHistory ?? ''}\n${constraints ?? ''}`
  return SEDENTARY_KEYWORDS.test(blob)
}

function isZone2StarterRun(run: StarterRunEvidence): boolean {
  if (run.type === 'foundation_run') return true
  return run.runType != null && ZONE_2_RUN_TYPES.has(run.runType)
}

export function hasStarterHrGraduation(runs: StarterRunEvidence[]): boolean {
  const recentZone2 = runs
    .filter(run => run.avgHr != null && isZone2StarterRun(run))
    .sort((a, b) => (b.scheduledDate ?? 0) - (a.scheduledDate ?? 0))
    .slice(0, HR_GRAD_STREAK)

  return recentZone2.length >= HR_GRAD_STREAK && recentZone2.every(run => run.avgHr! < HR_GRAD_CEILING)
}

export async function computeStarterStatus(
  db: DB,
  todayEpochDay: number,
  trainingHistory: string | null,
  constraints: string | null,
): Promise<StarterStatus> {
  if (!profileIndicatesStarter(trainingHistory, constraints)) {
    return { active: false, daysIntoProgram: null, reason: 'profile does not indicate deconditioned start' }
  }

  const completed = await db
    .select({ scheduledDate: sessions.scheduledDate, type: sessions.type, startedAt: sessions.startedAt })
    .from(sessions)
    .where(eq(sessions.status, 'completed'))
    .orderBy(desc(sessions.scheduledDate))

  if (completed.length === 0) {
    return { active: true, daysIntoProgram: 0, reason: 'no completed sessions yet; reintroduction week' }
  }

  const firstDay = completed
    .map(s => s.scheduledDate)
    .filter((d): d is number => d != null)
    .sort((a, b) => a - b)[0]
  const daysIn = firstDay != null ? todayEpochDay - firstDay : null

  if (daysIn != null && daysIn >= STARTER_WINDOW_DAYS) {
    return { active: false, daysIntoProgram: daysIn, reason: `graduated: ${daysIn} days since first completed session` }
  }

  const recentRuns = await db
    .select({
      scheduledDate: sessions.scheduledDate,
      type: sessions.type,
      runType: runSessions.runType,
      avgHr: runSessions.avgHr,
    })
    .from(sessions)
    .innerJoin(runSessions, eq(runSessions.sessionId, sessions.id))
    .where(and(
      eq(sessions.status, 'completed'),
      gte(sessions.scheduledDate, todayEpochDay - 42),
    ))

  if (hasStarterHrGraduation(recentRuns)) {
    return {
      active: false,
      daysIntoProgram: daysIn,
      reason: `graduated: ${HR_GRAD_STREAK} recent zone-2 runs averaged under ${HR_GRAD_CEILING} bpm`,
    }
  }

  return {
    active: true,
    daysIntoProgram: daysIn,
    reason: daysIn != null ? `${daysIn}/${STARTER_WINDOW_DAYS} days into starter window` : 'starter window active',
  }
}

export function serializeStarterStatus(status: StarterStatus): string {
  if (!status.active) return ''
  const lines = ['# Starter status (deconditioned return window is ACTIVE)']
  lines.push(`Reason: ${status.reason}.`)
  if (status.daysIntoProgram != null) {
    lines.push(`Days since first completed session: ${status.daysIntoProgram}.`)
  }
  lines.push('Apply the starter-context modifiers from the system rules above: talk test in place of HR ceilings, one session lighter than default, no power finishers, do not read early MT fatigue as overreach.')
  return lines.join('\n')
}
