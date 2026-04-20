// Block Zero entry assessment and transition readiness check. Sonnet with extended thinking.
// Assessment: called once when Block Zero starts.
// Transition: called at end of Block Zero (week 4+) to decide proceed/hold/adjust.

import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import { coachingOutputs, dailyLogs, exercises, sessions, trainingBlocks, trainingMaxes, userProfile, weekPlans } from '../../db/schema'
import { anthropicCall, getToolInput, type Tool } from '../../lib/anthropic'
import { buildSystemPrompt, type UserProfileContext } from '../../lib/prompts/system'
import { getLatestBodyweightKg } from '../../lib/bodyMetrics'
import { TOOL_BLOCK_TRANSITION, type BlockTransitionOutput } from '../../lib/prompts/tools'
import { computeBlockAdherence, deriveGuidance, serializeAdherenceForPrompt, type AdherenceSnapshot, type AdherenceGuidance } from '../../lib/adherence'
import { rolloverStaleSessions } from '../../lib/sessionRollover'
import { getEpochDay } from '../../lib/dates'
import type { createDB } from '../../db/client'

type DB = ReturnType<typeof createDB>

export interface BlockZeroWeekTheme {
  weekNumber: number
  focus: string
}

export interface BlockZeroCalibrationStart {
  exerciseName: string
  startingWeightKg: number
  rationale: string
}

export interface BlockZeroAssessmentOutput {
  narrative: string
  weekThemes: BlockZeroWeekTheme[]
  calibrationStarts: BlockZeroCalibrationStart[]
  mtCapPerWeek: number
  coachNote?: string
}

const BLOCK_ZERO_TOOL: Tool = {
  name: 'blockZeroAssessment',
  description:
    'Block Zero entry assessment. Reads onboarding answers and produces a 6-week plan overview with starting weight estimates. Voice canon applies to all user-facing strings: short sentences, no exclamation marks, no congratulations, observation before instruction.',
  input_schema: {
    type: 'object',
    properties: {
      narrative: {
        type: 'string',
        description:
          'Two to three sentences. Voice canon: what this block is for and what the user should expect. No congratulations. No exclamation marks. No em dashes. Example tone: "Four weeks. Corrective work, light loading, habit building. Skip this block and the next one breaks you."',
      },
      weekThemes: {
        type: 'array',
        description: '6 items, one per Block Zero week.',
        items: {
          type: 'object',
          properties: {
            weekNumber: { type: 'integer', description: '1 through 6' },
            focus: {
              type: 'string',
              description: 'One short phrase. What this week emphasizes. No exclamation marks.',
            },
          },
          required: ['weekNumber', 'focus'],
        },
        minItems: 6,
        maxItems: 6,
      },
      calibrationStarts: {
        type: 'array',
        description:
          'Starting weight estimates for main compound lifts. Conservative. Block Zero loads at 40-55% of these numbers. Based on training history and current detraining state.',
        items: {
          type: 'object',
          properties: {
            exerciseName: { type: 'string' },
            startingWeightKg: {
              type: 'number',
              description:
                'Estimated training max. Block Zero week 1 will work at 40% of this. Must be realistic given current state.',
            },
            rationale: {
              type: 'string',
              description:
                'One sentence. Voice canon: plain, factual. State the data point behind the estimate. Example: "No recent strength data. Estimate from typical detrained intermediate baseline."',
            },
          },
          required: ['exerciseName', 'startingWeightKg', 'rationale'],
        },
      },
      mtCapPerWeek: {
        type: 'integer',
        description:
          'Recommended MT sessions cap for Block Zero. Must account for recovery needs during reintroduction phase. Typically 1-2 for weeks 1-2, up to 3 for weeks 5-6.',
      },
      coachNote: {
        type: 'string',
        description:
          'Optional. One sentence flagging a specific concern from onboarding (injury, posture issue, long training gap). Voice canon: state the fact plainly. Omit if nothing specific to flag.',
      },
    },
    required: ['narrative', 'weekThemes', 'calibrationStarts', 'mtCapPerWeek'],
  },
}

function buildAssessmentPrompt(profile: UserProfileContext): string {
  const lines: string[] = [
    'Block Zero is starting. Assess this user and produce a Block Zero plan overview.',
    '',
    'Block Zero structure:',
    '  Weeks 1-2: Foundation, daily mobility, light loading (40% weights). No MT class.',
    '  Weeks 3-4: MT class returns. Weights climb to 50-55%. Daily mobility continues.',
    '  Weeks 5-6: Full schedule. Weights at 55-60%. Daily mobility continues. Ready for Block 1.',
    '',
    'Daily mobility runs every morning across all phases. It is the habit Block Zero is designed to build. Do not skip scheduling it. Use session type "mobility" at timeSlot "am", estimatedMin 10.',
    '',
    'User profile is in the system prompt.',
    '',
    'For calibrationStarts: estimate training maxes for main compound lifts (squat, deadlift, bench press, overhead press, barbell row). Be conservative. If training history indicates a long gap or no strength training, use detrained intermediate baselines.',
    '',
    'For mtCapPerWeek: this is the cap for the entire block. Set based on injury risk and recovery needs. The user has access to MT most evenings and will overtrain without enforcement.',
    '',
    'Call blockZeroAssessment.',
  ]

  if (!profile.trainingHistory && !profile.goals) {
    lines.push('', 'No onboarding data available. Use defaults appropriate for a returning adult athlete.')
  }

  return lines.join('\n')
}

export async function runBlockZeroAssessment(
  db: DB,
  apiKey: string,
  blockId: string,
): Promise<BlockZeroAssessmentOutput | null> {
  const [profileRow] = await db.select().from(userProfile).where(eq(userProfile.id, 'default'))

  const tmRows = await db
    .select({ weightKg: trainingMaxes.weightKg, name: exercises.name })
    .from(trainingMaxes)
    .innerJoin(exercises, eq(trainingMaxes.exerciseId, exercises.id))

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

  const systemBlocks = buildSystemPrompt(profile, null)

  const result = await anthropicCall(apiKey, {
    model: 'claude-sonnet-4-6',
    max_tokens: 12000,
    thinking: { type: 'enabled', budget_tokens: 8000 },
    system: systemBlocks,
    messages: [{ role: 'user', content: buildAssessmentPrompt(profile) }],
    tools: [BLOCK_ZERO_TOOL],
    tool_choice: { type: 'tool', name: 'blockZeroAssessment' },
  })

  if (result.offline) {
    console.warn('[blockZero] offline during assessment')
    return null
  }

  const output = getToolInput<BlockZeroAssessmentOutput>(result, 'blockZeroAssessment')
  if (!output) {
    console.warn('[blockZero] no tool output from assessment')
    return null
  }

  await db.insert(coachingOutputs).values({
    id: crypto.randomUUID(),
    kind: 'block_zero_assessment',
    model: 'claude-sonnet-4-6',
    scopeWeekPlanId: null,
    scopeSessionId: null,
    inputHash: blockId,
    outputJson: JSON.stringify(output),
    tokensIn: result.usage.input_tokens,
    tokensOut: result.usage.output_tokens,
    cachedTokensIn: result.usage.cache_read_input_tokens ?? 0,
    createdAt: Math.floor(Date.now() / 1000),
  })

  console.log(`[blockZero] assessment complete for block ${blockId}`)
  return output
}

export async function getStoredBlockZeroAssessment(
  db: DB,
): Promise<BlockZeroAssessmentOutput | null> {
  const [row] = await db
    .select({ outputJson: coachingOutputs.outputJson })
    .from(coachingOutputs)
    .where(eq(coachingOutputs.kind, 'block_zero_assessment'))
    .orderBy(desc(coachingOutputs.createdAt))
    .limit(1)

  if (!row) return null

  try {
    return JSON.parse(row.outputJson) as BlockZeroAssessmentOutput
  } catch {
    console.warn('[blockZero] malformed stored assessment')
    return null
  }
}

// ─── Block Zero Transition ─────────────────────────────────────

const DIFFICULTY_LABELS = ['Too Easy', 'Easy', 'Just Right', 'Hard', 'Too Hard']

interface WeekSummary {
  weekNumber: number
  planned: number
  completed: number
  avgRpe: number | null
  avgDifficulty: number | null
  avgSleepHours: number | null
  avgSoreness: number | null
}

async function gatherTransitionData(db: DB, blockId: string): Promise<{
  block: { startedAt: number | null; totalWeeks: number }
  weeks: WeekSummary[]
  mainLifts: Array<{ id: string; name: string; currentMaxKg: number | null }>
  adherence: AdherenceSnapshot
  guidance: AdherenceGuidance
}> {
  const [block] = await db.select().from(trainingBlocks).where(eq(trainingBlocks.id, blockId))
  const blockStartSec = block?.startedAt ?? 0

  const blockWeeks = await db
    .select()
    .from(weekPlans)
    .where(eq(weekPlans.blockId, blockId))

  const weekPlanIds = blockWeeks.map(w => w.id)

  const allSessions = weekPlanIds.length > 0
    ? await db.select().from(sessions).where(inArray(sessions.weekPlanId, weekPlanIds))
    : []

  const weeks: WeekSummary[] = []

  for (const wk of blockWeeks.sort((a, b) => a.weekNumber - b.weekNumber)) {
    const wkSessions = allSessions.filter(s => s.weekPlanId === wk.id)
    const planned = wkSessions.length
    const completedSessions = wkSessions.filter(s => s.status === 'completed')
    const completed = completedSessions.length

    const rpeValues = completedSessions.filter(s => s.rpe != null).map(s => s.rpe!)
    const diffValues = completedSessions.filter(s => s.difficulty != null).map(s => s.difficulty!)
    const avgRpe = rpeValues.length > 0 ? rpeValues.reduce((a, b) => a + b, 0) / rpeValues.length : null
    const avgDifficulty = diffValues.length > 0 ? diffValues.reduce((a, b) => a + b, 0) / diffValues.length : null

    // Daily logs during this week (epoch days)
    const weekStartDay = Math.floor((blockStartSec + (wk.weekNumber - 1) * 7 * 86400) / 86400)
    const weekEndDay = weekStartDay + 6
    const wellnessRows = await db
      .select({ sleepHours: dailyLogs.sleepHours, soreness: dailyLogs.soreness })
      .from(dailyLogs)
      .where(and(gte(dailyLogs.logDate, weekStartDay), lte(dailyLogs.logDate, weekEndDay)))

    const sleepVals = wellnessRows.filter(r => r.sleepHours != null).map(r => r.sleepHours!)
    const sorenessVals = wellnessRows.filter(r => r.soreness != null).map(r => r.soreness!)
    const avgSleepHours = sleepVals.length > 0 ? sleepVals.reduce((a, b) => a + b, 0) / sleepVals.length : null
    const avgSoreness = sorenessVals.length > 0 ? sorenessVals.reduce((a, b) => a + b, 0) / sorenessVals.length : null

    weeks.push({ weekNumber: wk.weekNumber, planned, completed, avgRpe, avgDifficulty, avgSleepHours, avgSoreness })
  }

  // Main compound lifts with current training maxes
  const tmRows = await db
    .select({ weightKg: trainingMaxes.weightKg, exerciseId: trainingMaxes.exerciseId })
    .from(trainingMaxes)
  const tmMap = new Map(tmRows.map(t => [t.exerciseId, t.weightKg]))

  const allExercises = await db.select({ id: exercises.id, name: exercises.name }).from(exercises)
  const MAIN_LIFT_NAMES = ['Squat', 'Deadlift', 'Bench Press', 'Overhead Press', 'Barbell Row']
  const mainLifts = allExercises
    .filter(e => MAIN_LIFT_NAMES.includes(e.name))
    .map(e => ({ id: e.id, name: e.name, currentMaxKg: tmMap.get(e.id) ?? null }))

  // Adherence snapshot — feeds silent progression decisions. Roll stale
  // planned sessions to 'missed' first so the math reflects reality.
  const todayEpochDay = getEpochDay(new Date())
  await rolloverStaleSessions(db, todayEpochDay)
  const adherence = await computeBlockAdherence(db, blockId, todayEpochDay)
  const guidance = deriveGuidance(adherence)

  return {
    block: { startedAt: block?.startedAt ?? null, totalWeeks: block?.totalWeeks ?? 6 },
    weeks,
    mainLifts,
    adherence,
    guidance,
  }
}

function buildTransitionPrompt(
  data: Awaited<ReturnType<typeof gatherTransitionData>>,
): string {
  const lines: string[] = [
    `Block Zero transition readiness check. ${data.weeks.length} weeks of data available.`,
    '',
    'Week summary:',
  ]

  for (const w of data.weeks) {
    const rpeStr = w.avgRpe != null ? `RPE ${w.avgRpe.toFixed(1)}` : 'no RPE data'
    const diffStr = w.avgDifficulty != null
      ? `difficulty ${DIFFICULTY_LABELS[Math.round(w.avgDifficulty)] ?? w.avgDifficulty.toFixed(1)}`
      : 'no difficulty data'
    const sleepStr = w.avgSleepHours != null ? `sleep ${w.avgSleepHours.toFixed(1)}h` : 'no sleep data'
    const sorenessStr = w.avgSoreness != null ? `soreness ${w.avgSoreness.toFixed(1)}/5` : 'no soreness data'
    lines.push(
      `  Week ${w.weekNumber}: ${w.completed}/${w.planned} sessions completed. ${rpeStr}. ${diffStr}. ${sleepStr}. ${sorenessStr}.`,
    )
  }

  lines.push('')
  lines.push('Main lifts (with database IDs for calibrationTargets):')
  for (const lift of data.mainLifts) {
    const maxStr = lift.currentMaxKg != null ? `current max ${lift.currentMaxKg}kg` : 'no max set'
    lines.push(`  ${lift.name} (id: ${lift.id}): ${maxStr}`)
  }

  lines.push('')
  lines.push(serializeAdherenceForPrompt(data.adherence, data.guidance))

  lines.push('')
  lines.push('Decide: proceed (advance to Fighter Block 1), hold (extend Block Zero by one week), or adjust (advance with modified starting loads).')
  lines.push('Adherence floor: if block completion is below 70% or there is a recent gap of 7+ days, lean toward hold or adjust. Block Zero builds base through exposure, not calendar time. A block where half the sessions never happened has not built the base, no matter how many weeks passed.')
  lines.push('The athlete never sees this decision. They will just experience the next week. Do not ask for input. Do not soften with praise. State the decision and move.')
  lines.push('Set calibrationTargets with updated training max estimates based on observed Block Zero performance. Use the exact exercise IDs from above. If adherence was poor, keep estimates conservative (low confidence).')
  lines.push('Voice canon applies to rationale and nextBlockNotes: short sentences, no exclamation marks, no congratulations.')
  lines.push('')
  lines.push('Call blockTransition.')

  return lines.join('\n')
}

export async function runBlockZeroTransition(
  db: DB,
  apiKey: string,
  blockId: string,
): Promise<BlockTransitionOutput | null> {
  const [profileRow] = await db.select().from(userProfile).where(eq(userProfile.id, 'default'))

  const tmRows = await db
    .select({ weightKg: trainingMaxes.weightKg, name: exercises.name })
    .from(trainingMaxes)
    .innerJoin(exercises, eq(trainingMaxes.exerciseId, exercises.id))

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

  const systemBlocks = buildSystemPrompt(profile, null)
  const transitionData = await gatherTransitionData(db, blockId)
  const userPrompt = buildTransitionPrompt(transitionData)

  const result = await anthropicCall(apiKey, {
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    thinking: { type: 'enabled', budget_tokens: 5000 },
    system: systemBlocks,
    messages: [{ role: 'user', content: userPrompt }],
    tools: [TOOL_BLOCK_TRANSITION],
    tool_choice: { type: 'tool', name: 'blockTransition' },
  })

  if (result.offline) {
    console.warn('[blockZero] offline during transition check')
    return null
  }

  const output = getToolInput<BlockTransitionOutput>(result, 'blockTransition')
  if (!output) {
    console.warn('[blockZero] no tool output from transition check')
    return null
  }

  // Store result
  await db.insert(coachingOutputs).values({
    id: crypto.randomUUID(),
    kind: 'block_zero_transition',
    model: 'claude-sonnet-4-6',
    scopeWeekPlanId: null,
    scopeSessionId: null,
    inputHash: blockId,
    outputJson: JSON.stringify(output),
    tokensIn: result.usage.input_tokens,
    tokensOut: result.usage.output_tokens,
    cachedTokensIn: result.usage.cache_read_input_tokens ?? 0,
    createdAt: Math.floor(Date.now() / 1000),
  })

  // Silent block extension: if the coach held, bump totalWeeks so the
  // calendar-driven week advancement doesn't outrun the decision. The athlete
  // never sees this happen — next week's plan just looks like another base
  // week, and the transition check will fire again at the new end boundary.
  if (output.decision === 'hold') {
    const [currentBlock] = await db.select().from(trainingBlocks).where(eq(trainingBlocks.id, blockId))
    if (currentBlock) {
      await db
        .update(trainingBlocks)
        .set({ totalWeeks: currentBlock.totalWeeks + 1 })
        .where(eq(trainingBlocks.id, blockId))
      console.log(`[blockZero] hold: extended block ${blockId} to ${currentBlock.totalWeeks + 1} weeks`)
    }
  }

  // Apply calibration targets to training maxes regardless of decision
  for (const target of output.calibrationTargets) {
    if (!target.exerciseId || target.estimatedMaxKg <= 0) continue
    const nowSec = Math.floor(Date.now() / 1000)
    const existing = await db
      .select({ id: trainingMaxes.id })
      .from(trainingMaxes)
      .where(eq(trainingMaxes.exerciseId, target.exerciseId))

    if (existing.length > 0) {
      await db
        .update(trainingMaxes)
        .set({ weightKg: target.estimatedMaxKg, updatedAt: nowSec })
        .where(eq(trainingMaxes.exerciseId, target.exerciseId))
    } else {
      await db.insert(trainingMaxes).values({
        id: crypto.randomUUID(),
        exerciseId: target.exerciseId,
        weightKg: target.estimatedMaxKg,
        updatedAt: nowSec,
      })
    }
  }

  console.log(`[blockZero] transition check complete for block ${blockId}: ${output.decision}`)
  return output
}

export async function getStoredBlockZeroTransition(
  db: DB,
): Promise<BlockTransitionOutput | null> {
  const [row] = await db
    .select({ outputJson: coachingOutputs.outputJson })
    .from(coachingOutputs)
    .where(eq(coachingOutputs.kind, 'block_zero_transition'))
    .orderBy(desc(coachingOutputs.createdAt))
    .limit(1)

  if (!row) return null

  try {
    return JSON.parse(row.outputJson) as BlockTransitionOutput
  } catch {
    console.warn('[blockZero] malformed stored transition')
    return null
  }
}
