// Post-session Haiku call. Produces one-line review + flag stored on the session record.
// Falls back to null on AI offline so the caller can skip the update.

import { desc, eq } from 'drizzle-orm'
import {
  coachingOutputs,
  exercises,
  runSessions,
  runSplits,
  sessions,
  strengthSessionExercises,
  strengthSets,
  trainingMaxes,
  userProfile,
} from '../db/schema'
import { anthropicCall, getToolInput } from './anthropic'
import { buildSystemPrompt, type UserProfileContext } from './prompts/system'
import { getLatestBodyweightKg } from './bodyMetrics'
import { TOOL_SESSION_REVIEW, type SessionReviewOutput } from './prompts/tools'
import { kgToLbsDisplay, paceToMinSec } from './chartTheme'
import { getSessionTargetHr } from './sessionIntent'
import type { createDB } from '../db/client'

type DB = ReturnType<typeof createDB>

const SESSION_LABEL: Record<string, string> = {
  foundation_run: 'foundation run',
  strength: 'strength',
  mt_class: 'MT class',
  bag_work: 'bag work',
  running: 'run',
  skip_rope: 'skip rope',
  active_recovery: 'active recovery',
  mobility: 'mobility',
}

interface RunReviewContext {
  runType: string | null
  targetHrLine: string | null
  distanceKm: number | null
  durationSec: number | null
  plannedDurationSec: number | null
  completionRatio: number | null
  completionStatus: string | null
  paceSecKm: number | null
  avgHr: number | null
  maxHr: number | null
  zoneSeconds: string | null
  elevationGainM: number | null
  source: string
  stravaActivityId: number | null
  splits: Array<{ kmIndex: number; durationSec: number; avgHr: number | null; elevationGainM: number | null }>
}

interface StrengthReviewContext {
  roadBootcamp: {
    timeAvailable?: string | null
    prescribedTime?: string | null
    equipment?: string | null
    adaptationLine?: string | null
  } | null
  exercises: Array<{
    name: string
    section: string | null
    workingSets: number
    warmupSets: number
    topWeightKg: number | null
    totalReps: number
    changedSets: number
    bandColors: string[]
  }>
}

interface SessionReviewContext {
  run: RunReviewContext | null
  strength: StrengthReviewContext | null
}

function parseRoadContext(value: string | null): StrengthReviewContext['roadBootcamp'] {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as {
      roadBootcamp?: StrengthReviewContext['roadBootcamp']
    }
    return parsed.roadBootcamp ?? null
  } catch {
    return null
  }
}

function formatRunContext(run: RunReviewContext): string[] {
  const duration = run.durationSec ? `${Math.round(run.durationSec / 60)} min` : 'duration not recorded'
  const distance = run.distanceKm != null ? `${run.distanceKm.toFixed(2)} km` : 'distance not recorded'
  const pace = run.paceSecKm != null ? `${paceToMinSec(run.paceSecKm)}/km` : 'pace not recorded'
  const hr = run.avgHr != null
    ? `avg HR ${run.avgHr} bpm${run.maxHr != null ? `, max ${run.maxHr}` : ''}`
    : 'HR not recorded'

  const lines = [
    '',
    'Run evidence:',
    `  Type: ${run.runType ?? 'not tagged'}. Source: ${run.source}${run.stravaActivityId ? ' (Strava)' : ''}.`,
    `  Output: ${distance}, ${duration}, ${pace}, ${hr}.`,
  ]

  if (run.targetHrLine) lines.push(`  Prescribed: ${run.targetHrLine}`)
  if (run.plannedDurationSec != null && run.completionRatio != null && run.completionStatus != null) {
    lines.push(`  Planned duration: ${Math.round(run.plannedDurationSec / 60)} min. Completion: ${run.completionStatus} (${Math.round(run.completionRatio * 100)}%).`)
  }
  if (run.elevationGainM != null) lines.push(`  Elevation: ${run.elevationGainM} m.`)
  if (run.zoneSeconds) lines.push(`  HR zones: ${run.zoneSeconds}.`)
  if (run.splits.length > 0) {
    const splits = run.splits
      .slice()
      .sort((a, b) => a.kmIndex - b.kmIndex)
      .slice(0, 6)
      .map(s => {
        const splitPace = paceToMinSec(s.durationSec)
        const splitHr = s.avgHr != null ? `, HR ${s.avgHr}` : ''
        return `km ${s.kmIndex}: ${splitPace}${splitHr}`
      })
      .join('; ')
    lines.push(`  Splits: ${splits}.`)
  }

  return lines
}

function formatStrengthContext(strength: StrengthReviewContext): string[] {
  const lines = ['', 'Strength evidence:']
  if (strength.roadBootcamp) {
    const ctx = strength.roadBootcamp
    const time = ctx.prescribedTime ?? ctx.timeAvailable ?? 'not recorded'
    const equipment = ctx.equipment ?? 'not recorded'
    lines.push(`  Road Bootcamp context: time ${time}, equipment ${equipment}.`)
    if (ctx.adaptationLine) lines.push(`  Adaptation: ${ctx.adaptationLine}`)
  }

  if (strength.exercises.length === 0) {
    lines.push('  No strength sets recorded.')
    return lines
  }

  for (const ex of strength.exercises.slice(0, 8)) {
    const top = ex.topWeightKg != null ? `${kgToLbsDisplay(ex.topWeightKg)} lb` : 'bodyweight or unloaded'
    const section = ex.section ? ` (${ex.section})` : ''
    const workingSets = `${ex.workingSets} ${ex.workingSets === 1 ? 'working set' : 'working sets'}`
    const warmupSets = `${ex.warmupSets} ${ex.warmupSets === 1 ? 'warmup' : 'warmups'}`
    const changed = ex.changedSets > 0 ? ` ${ex.changedSets} changed set${ex.changedSets === 1 ? '' : 's'}.` : ''
    const bands = ex.bandColors.length > 0 ? ` Bands: ${ex.bandColors.join(', ')}.` : ''
    lines.push(`  ${ex.name}${section}: ${workingSets}, ${warmupSets}, ${ex.totalReps} reps, top ${top}.${changed}${bands}`)
  }

  return lines
}

function parseTargetHighBpm(targetHrLine: string | null): number | null {
  if (!targetHrLine) return null
  const match = targetHrLine.match(/to (\d+) bpm/)
  return match ? Number(match[1]) : null
}

function readableRoadEquipment(value: string | null | undefined): string {
  if (value === 'no_gym') return 'No gym'
  if (value === 'hotel_gym') return 'Hotel gym'
  if (value === 'full_gym') return 'Full gym'
  return 'Equipment not recorded'
}

export function buildLocalSessionReview(
  session: { type: string; rpe: number | null; durationSec: number | null },
  context: SessionReviewContext,
): SessionReviewOutput {
  if (context.run) {
    const high = parseTargetHighBpm(context.run.targetHrLine)
    if (context.run.targetHrLine?.startsWith('Zone 2.') && high != null && context.run.avgHr != null && context.run.avgHr > high) {
      return {
        line: 'Prescribed easy. Heart said hard. Easier next time.',
        flag: 'intensity_mismatch',
      }
    }

    if (context.run.completionStatus === 'shortened' || context.run.completionStatus === 'partial') {
      return {
        line: context.run.completionStatus === 'partial'
          ? 'Partial run logged. Keep the next one easy.'
          : 'Short run logged. Aerobic work still counts.',
        flag: 'form_note',
      }
    }

    if (context.run.distanceKm != null && context.run.paceSecKm != null) {
      const hr = context.run.avgHr != null ? ` Avg HR ${context.run.avgHr}.` : ''
      return {
        line: `${context.run.distanceKm.toFixed(2)} km at ${paceToMinSec(context.run.paceSecKm)}/km.${hr}`,
        flag: 'none',
      }
    }
  }

  if (context.strength) {
    const road = context.strength.roadBootcamp
    if (road) {
      const time = road.prescribedTime ?? road.timeAvailable ?? 'time not recorded'
      const timeLabel = time === '45_plus' ? '45+ minutes' : `${time} minutes`
      const movementCount = context.strength.exercises.length
      const movementLabel = movementCount === 1 ? 'movement' : 'movements'
      const changedSets = context.strength.exercises.reduce((sum, exercise) => sum + exercise.changedSets, 0)
      const adjustment = changedSets > 0 ? ' Load change noted.' : ''
      return {
        line: `${timeLabel}. ${readableRoadEquipment(road.equipment)}. ${movementCount} ${movementLabel} logged.${adjustment}`,
        flag: 'none',
      }
    }
  }

  const label = SESSION_LABEL[session.type] ?? 'Session'
  return {
    line: `${label[0].toUpperCase()}${label.slice(1)} logged. Effort ${session.rpe ?? 'not recorded'}/10.`,
    flag: 'none',
  }
}

async function loadSessionReviewContext(
  db: DB,
  session: { id: string; type: string; notes: string | null; contextJson?: string | null },
  maxHr: number | null,
): Promise<SessionReviewContext> {
  let run: RunReviewContext | null = null
  let strength: StrengthReviewContext | null = null

  if (session.type === 'running' || session.type === 'foundation_run') {
    const [runRow] = await db.select().from(runSessions).where(eq(runSessions.sessionId, session.id))
    if (runRow) {
      const splits = await db.select().from(runSplits).where(eq(runSplits.runSessionId, runRow.id))
      const runCategory = session.notes === 'zone2' || session.notes === 'progression'
        ? session.notes
        : runRow.runType
      run = {
        runType: runRow.runType,
        targetHrLine: getSessionTargetHr(session.type, runCategory, maxHr),
        distanceKm: runRow.distanceKm,
        durationSec: runRow.durationSec,
        plannedDurationSec: runRow.plannedDurationSec,
        completionRatio: runRow.completionRatio,
        completionStatus: runRow.completionStatus,
        paceSecKm: runRow.paceSecKm,
        avgHr: runRow.avgHr,
        maxHr: runRow.maxHr,
        zoneSeconds: runRow.zoneSeconds,
        elevationGainM: runRow.elevationGainM,
        source: runRow.source,
        stravaActivityId: runRow.stravaActivityId,
        splits: splits.map(s => ({
          kmIndex: s.kmIndex,
          durationSec: s.durationSec,
          avgHr: s.avgHr,
          elevationGainM: s.elevationGainM,
        })),
      }
    }
  }

  if (session.type === 'strength') {
    const sessionExercises = await db
      .select({
        id: strengthSessionExercises.id,
        section: strengthSessionExercises.section,
        orderIndex: strengthSessionExercises.orderIndex,
        exerciseName: exercises.name,
      })
      .from(strengthSessionExercises)
      .innerJoin(exercises, eq(strengthSessionExercises.exerciseId, exercises.id))
      .where(eq(strengthSessionExercises.sessionId, session.id))

    const rows = []
    for (const ex of sessionExercises) {
      const sets = await db.select().from(strengthSets).where(eq(strengthSets.sessionExerciseId, ex.id))
      const workingSets = sets.filter(s => s.isWarmup === 0)
      rows.push({
        name: ex.exerciseName,
        section: ex.section,
        orderIndex: ex.orderIndex,
        workingSets: workingSets.length,
        warmupSets: sets.length - workingSets.length,
        topWeightKg: workingSets.reduce<number | null>((max, s) => {
          if (s.weightKg == null) return max
          return max == null ? s.weightKg : Math.max(max, s.weightKg)
        }, null),
        totalReps: workingSets.reduce((sum, s) => sum + s.reps, 0),
        changedSets: workingSets.filter(s => s.inferredStatus != null && s.inferredStatus !== 'normal').length,
        bandColors: Array.from(new Set(workingSets.map(s => s.bandColor).filter((v): v is string => !!v))),
      })
    }

    strength = {
      roadBootcamp: parseRoadContext(session.contextJson ?? null),
      exercises: rows.sort((a, b) => a.orderIndex - b.orderIndex).map(row => ({
        name: row.name,
        section: row.section,
        workingSets: row.workingSets,
        warmupSets: row.warmupSets,
        topWeightKg: row.topWeightKg,
        totalReps: row.totalReps,
        changedSets: row.changedSets,
        bandColors: row.bandColors,
      })),
    }
  }

  return { run, strength }
}

export function buildSessionReviewPrompt(
  session: { type: string; rpe: number | null; notes: string | null; durationSec: number | null },
  recent: Array<{ type: string; rpe: number | null }>,
  context: SessionReviewContext,
): string {
  const label = SESSION_LABEL[session.type] ?? session.type
  const dur = session.durationSec ? `${Math.round(session.durationSec / 60)} min` : 'duration not recorded'
  const lines: string[] = [
    `Session completed: ${label}.`,
    `Duration: ${dur}.`,
    `Effort: ${session.rpe ?? 'not recorded'}/10.`,
  ]
  if (session.notes) lines.push(`Athlete notes: ${session.notes}`)
  if (context.run) lines.push(...formatRunContext(context.run))
  if (context.strength) lines.push(...formatStrengthContext(context.strength))

  if (recent.length > 0) {
    lines.push('')
    lines.push('Recent sessions for context:')
    for (const s of recent) {
      const l = SESSION_LABEL[s.type] ?? s.type
      lines.push(`  ${l} - Effort ${s.rpe ?? '?'}/10`)
    }
  }

  lines.push('')
  lines.push(
    'Write a one-line session review using the sessionReview tool. Voice canon: acknowledge what happened, state numbers plainly, never congratulate. Use the evidence above before generic training advice. If prescribed easy but HR ran high, say that plainly and set intensity_mismatch.',
  )

  return lines.join('\n')
}

export async function runSessionReview(
  db: DB,
  apiKey: string,
  session: { id: string; type: string; rpe: number | null; notes: string | null; durationSec: number | null },
): Promise<SessionReviewOutput | null> {
  const [profileRow, recent, tmRows] = await Promise.all([
    db.select().from(userProfile).limit(1).then(rows => rows[0] ?? null),
    db
      .select({ id: sessions.id, type: sessions.type, rpe: sessions.rpe })
      .from(sessions)
      .where(eq(sessions.status, 'completed'))
      .orderBy(desc(sessions.completedAt))
      .limit(4),
    db
      .select({ weightKg: trainingMaxes.weightKg, name: exercises.name })
      .from(trainingMaxes)
      .innerJoin(exercises, eq(trainingMaxes.exerciseId, exercises.id)),
  ])

  const latestBodyweightKg = await getLatestBodyweightKg(db)

  const profile: UserProfileContext = {
    goals: profileRow?.goals ?? null,
    injuries: profileRow?.injuries ?? null,
    postureIssues: profileRow?.postureIssues ?? null,
    trainingHistory: profileRow?.trainingHistory ?? null,
    mtGymAccessDays: profileRow?.mtGymAccessDays ?? null,
    mtCapPerWeek: profileRow?.mtCapPerWeek ?? null,
    weeklyDayTarget: profileRow?.weeklyDayTarget ?? null,
    constraints: profileRow?.constraints ?? null,
    trainingMaxes: tmRows.map(t => ({ exerciseName: t.name, weightKg: t.weightKg })),
    latestBodyweightKg,
  }

  const recentOther = recent.filter(r => r.id !== session.id).slice(0, 3)
  const [sessionRow] = await db.select().from(sessions).where(eq(sessions.id, session.id))
  const reviewContext = await loadSessionReviewContext(db, {
    id: session.id,
    type: session.type,
    notes: sessionRow?.notes ?? session.notes,
    contextJson: sessionRow?.contextJson ?? null,
  }, profileRow?.maxHr ?? null)

  const systemBlocks = buildSystemPrompt(profile, null)
  const prompt = buildSessionReviewPrompt(session, recentOther, reviewContext)

  const result = await anthropicCall(apiKey, {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: systemBlocks,
    messages: [{ role: 'user', content: prompt }],
    tools: [TOOL_SESSION_REVIEW],
    tool_choice: { type: 'tool', name: 'sessionReview' },
  })

  if (result.offline) {
    console.info('[sessionReview] offline. Using local fallback.')
    return buildLocalSessionReview(session, reviewContext)
  }

  const output = getToolInput<SessionReviewOutput>(result, 'sessionReview')
  if (!output) {
    console.warn('[sessionReview] no tool output')
    return null
  }

  await db.insert(coachingOutputs).values({
    id: crypto.randomUUID(),
    kind: 'session_review',
    model: 'claude-haiku-4-5-20251001',
    scopeWeekPlanId: null,
    scopeSessionId: session.id,
    inputHash: null,
    outputJson: JSON.stringify(output),
    tokensIn: result.usage.input_tokens,
    tokensOut: result.usage.output_tokens,
    cachedTokensIn: result.usage.cache_read_input_tokens ?? 0,
    createdAt: Math.floor(Date.now() / 1000),
  })

  return output
}
