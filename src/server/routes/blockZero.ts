// Block Zero entry assessment and transition readiness check. Sonnet with extended thinking.
// Assessment: called once when Block Zero starts. Its starting maxes and MT cap are saved.
// Transition: called at the end of Block Zero. The rules gate (lib/blockZero/endGate)
// sets the limits; the AI decision only moves inside them. Proceed creates Fighter Block 1.

import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import { blockTests, coachingOutputs, dailyLogs, exercises, sessions, strengthSessionExercises, strengthSets, trainingBlocks, trainingMaxes, userProfile, weekPlans } from '../../db/schema'
import { anthropicCall, getStructuredOutput, jsonFormatFor, jsonInstructionFor, type Tool } from '../../lib/anthropic'
import { MODELS } from '../../lib/models'
import { buildSystemPrompt, type UserProfileContext } from '../../lib/prompts/system'
import { getLatestBodyweightKg } from '../../lib/bodyMetrics'
import { TOOL_BLOCK_TRANSITION, type BlockTransitionOutput } from '../../lib/prompts/tools'
import { computeBlockAdherence, deriveGuidance, serializeAdherenceForPrompt, type AdherenceSnapshot, type AdherenceGuidance } from '../../lib/adherence'
import { computeHrSnapshot, loadProfileMaxHrForHr, loadRecentRunsForHr, serializeHrForPrompt } from '../../lib/hrAnalysis'
import { rolloverStaleSessions } from '../../lib/sessionRollover'
import { getEpochDay } from '../../lib/dates'
import {
  backTrend,
  e1rmsFromTests,
  extensionsUsed,
  keySessionCompletionRate,
  longestGapInWindow,
  planTransition,
  resolveCalibrationStarts,
  retestE1rms,
  selectMainLifts,
  BLOCK_ZERO_BASE_WEEKS,
  KEY_SESSION_TYPES,
  type EndGateInput,
  type TransitionPlan,
} from '../../lib/blockZero'
import { createTrainingBlock, endActiveBlocks } from '../blocks'
import { loadBackScores } from '../blockZeroData'
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

export const BLOCK_ZERO_TOOL: Tool = {
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
          'Starting weight estimates for main compound lifts, saved as training maxes. Conservative. Block Zero suggests ~55% of these for sets of 8 in week 1, rising to ~65% by week 5, then autoregulates by RPE. Based on training history and current detraining state.',
        items: {
          type: 'object',
          properties: {
            exerciseName: { type: 'string' },
            startingWeightKg: {
              type: 'number',
              description:
                'Estimated training max. Block Zero week 1 suggests about 55% of this for a set of 8 at RPE 6-7. Must be realistic given current state.',
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
    'Block Zero structure (6 weeks, up to 2 extension weeks):',
    '  Week 1: test week. Each main lift works up to a set of 8 at RPE 6-7. Run-walk at talk-test pace.',
    '  Weeks 2-5: build. 2-3 sets of 8, RPE 6-7 then 7-8, never to failure. Week 3 adds a 3-5 rep check set.',
    '  Week 6: consolidate and retest. Volume down 30-50%, intensity held.',
    '  Weekly: Strength A/B/C, 3 run-walks, daily back-care mobility, durability twice a week, 1 rest day.',
    '  No MT classes are scheduled. The athlete adds them: technique and pads only for the first 2 weeks back, light clinch from week 3, no hard sparring.',
    '',
    'User profile is in the system prompt.',
    '',
    'For calibrationStarts: estimate training maxes for the main compound lifts. Use these exact exercise names: Front Squat, Romanian Deadlift, Block Pull, Conventional Deadlift, Bench Press, Overhead Press, Bent Over Row. Be conservative. If training history indicates a long gap or no strength training, use detrained intermediate baselines.',
    '',
    'For mtCapPerWeek: this is the cap for the entire block. Set based on injury risk and recovery needs. The user has access to MT most evenings and will overtrain without enforcement.',
    '',
    jsonInstructionFor(BLOCK_ZERO_TOOL),
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
    model: MODELS.reasoning,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: jsonFormatFor(BLOCK_ZERO_TOOL) },
    fallbacks: 'default',
    system: systemBlocks,
    messages: [{ role: 'user', content: buildAssessmentPrompt(profile) }],
  }, { timeoutMs: 150_000 })

  if (result.offline) {
    console.warn('[blockZero] offline during assessment')
    return null
  }

  const output = getStructuredOutput<BlockZeroAssessmentOutput>(result)
  if (!output) {
    console.warn('[blockZero] no structured output from assessment')
    return null
  }

  await db.insert(coachingOutputs).values({
    id: crypto.randomUUID(),
    kind: 'block_zero_assessment',
    model: result.model,
    scopeWeekPlanId: null,
    scopeSessionId: null,
    inputHash: blockId,
    outputJson: JSON.stringify(output),
    tokensIn: result.usage.input_tokens,
    tokensOut: result.usage.output_tokens,
    cachedTokensIn: result.usage.cache_read_input_tokens ?? 0,
    createdAt: Math.floor(Date.now() / 1000),
  })

  await persistAssessment(db, output)

  console.log(`[blockZero] assessment complete for block ${blockId}`)
  return output
}

// Save what the assessment decided: starting training maxes for lifts that
// exist in the library, and the block's MT cap on the profile. training_maxes
// has no "set by hand" marker, so a plain upsert is the honest option.
async function persistAssessment(db: DB, output: BlockZeroAssessmentOutput): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000)
  const exerciseRows = await db.select({ id: exercises.id, name: exercises.name }).from(exercises)
  const writes = resolveCalibrationStarts(output.calibrationStarts ?? [], exerciseRows)
  await upsertTrainingMaxes(db, writes, nowSec)

  if (Number.isInteger(output.mtCapPerWeek) && output.mtCapPerWeek >= 0) {
    const [profile] = await db.select({ id: userProfile.id }).from(userProfile).where(eq(userProfile.id, 'default'))
    if (profile) {
      await db.update(userProfile).set({ mtCapPerWeek: output.mtCapPerWeek, updatedAt: nowSec }).where(eq(userProfile.id, 'default'))
    } else {
      await db.insert(userProfile).values({ id: 'default', mtCapPerWeek: output.mtCapPerWeek, createdAt: nowSec, updatedAt: nowSec })
    }
  }
}

async function upsertTrainingMaxes(db: DB, writes: Array<{ exerciseId: string; weightKg: number }>, nowSec: number): Promise<void> {
  if (writes.length === 0) return
  const known = new Set((await db.select({ id: exercises.id }).from(exercises)).map(e => e.id))
  for (const w of writes) {
    if (!known.has(w.exerciseId) || !(w.weightKg > 0)) continue
    const existing = await db.select({ id: trainingMaxes.id }).from(trainingMaxes).where(eq(trainingMaxes.exerciseId, w.exerciseId))
    if (existing.length > 0) {
      await db.update(trainingMaxes).set({ weightKg: w.weightKg, updatedAt: nowSec }).where(eq(trainingMaxes.exerciseId, w.exerciseId))
    } else {
      await db.insert(trainingMaxes).values({ id: crypto.randomUUID(), exerciseId: w.exerciseId, weightKg: w.weightKg, updatedAt: nowSec })
    }
  }
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
  hrBlock: string | null
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

  // Match by id. Seed names are 'Front Squat', 'Conventional Deadlift',
  // 'Bent Over Row', so a name list only ever found 2 of the 5 lifts.
  const allExercises = await db.select({ id: exercises.id, name: exercises.name }).from(exercises)
  const mainLifts = selectMainLifts(allExercises)
    .map(e => ({ id: e.id, name: e.name, currentMaxKg: tmMap.get(e.id) ?? null }))

  // Adherence snapshot — feeds silent progression decisions. Roll stale
  // planned sessions to 'missed' first so the math reflects reality.
  const todayEpochDay = getEpochDay(new Date())
  await rolloverStaleSessions(db, todayEpochDay)
  const adherence = await computeBlockAdherence(db, blockId, todayEpochDay)
  const guidance = deriveGuidance(adherence)

  const recentRuns = await loadRecentRunsForHr(db, todayEpochDay)
  const maxHr = await loadProfileMaxHrForHr(db)
  const hrSnapshot = computeHrSnapshot(recentRuns, todayEpochDay, { maxHr })
  const hrBlock = serializeHrForPrompt(hrSnapshot)

  return {
    block: { startedAt: block?.startedAt ?? null, totalWeeks: block?.totalWeeks ?? 6 },
    weeks,
    mainLifts,
    adherence,
    guidance,
    hrBlock,
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

  if (data.hrBlock) {
    lines.push('')
    lines.push(data.hrBlock)
    lines.push('HR signal is a tiebreaker. Over-paced zone-2 runs across Block Zero means the aerobic base work got skipped in favor of conditioning — lean toward hold and prescribe stricter HR ceilings next block.')
  }

  lines.push('')
  lines.push('Decide: proceed (advance to Fighter Block 1), hold (extend Block Zero by one week), or adjust (advance with modified starting loads).')
  lines.push('Adherence floor: if block completion is below 70% or there is a recent gap of 7+ days, lean toward hold or adjust. Block Zero builds base through exposure, not calendar time. A block where half the sessions never happened has not built the base, no matter how many weeks passed.')
  lines.push('The athlete never sees this decision. They will just experience the next week. Do not ask for input. Do not soften with praise. State the decision and move.')
  lines.push('Set calibrationTargets with updated training max estimates based on observed Block Zero performance. Use the exact exercise IDs from above. If adherence was poor, keep estimates conservative (low confidence).')
  lines.push('Voice canon applies to rationale and nextBlockNotes: short sentences, no exclamation marks, no congratulations.')
  lines.push('')
  lines.push(jsonInstructionFor(TOOL_BLOCK_TRANSITION))

  return lines.join('\n')
}

// Gate inputs from the block's own sessions, the daily "back today" score
// (first week vs last week; 'unknown' with under 3 scores each) and block_tests.
async function gatherGateData(db: DB, blockId: string, todayEpochDay: number) {
  const [block] = await db.select().from(trainingBlocks).where(eq(trainingBlocks.id, blockId))
  const weeks = await db.select({ id: weekPlans.id }).from(weekPlans).where(eq(weekPlans.blockId, blockId))
  const weekIds = weeks.map(w => w.id)
  const blockSessions = weekIds.length > 0
    ? await db.select().from(sessions).where(inArray(sessions.weekPlanId, weekIds))
    : []

  const startEpochDay = Math.floor((block?.startedAt ?? 0) / 86400)
  const completedDays = blockSessions
    .filter(s => s.status === 'completed' && KEY_SESSION_TYPES.has(s.type) && s.scheduledDate != null)
    .map(s => s.scheduledDate as number)

  // Retest = main-lift working sets from completed week-6 strength sessions.
  const retestSessionIds = blockSessions
    .filter(s => s.type === 'strength' && s.status === 'completed' && s.blockWeek === BLOCK_ZERO_BASE_WEEKS)
    .map(s => s.id)
  const retestExercises = retestSessionIds.length > 0
    ? await db.select().from(strengthSessionExercises).where(inArray(strengthSessionExercises.sessionId, retestSessionIds))
    : []
  const mainSse = retestExercises.filter(e => e.section === 'main')
  const retestSetRows = mainSse.length > 0
    ? await db.select().from(strengthSets).where(inArray(strengthSets.sessionExerciseId, mainSse.map(e => e.id)))
    : []
  const exerciseBySse = new Map(mainSse.map(e => [e.id, e.exerciseId]))
  const setE1rms = retestE1rms(retestSetRows
    .filter(r => r.isWarmup === 0 && (r.completedAt != null || r.weightKg != null))
    .map(r => ({ exerciseId: exerciseBySse.get(r.sessionExerciseId) ?? '', weightKg: r.weightKg, reps: r.reps })))
  // Retest rows (week 6 and extension weeks) win per lift: they come from the
  // RIR-adjusted check set or the athlete's own entry. Sets fill the rest.
  const testRows = await db.select().from(blockTests).where(eq(blockTests.blockId, blockId))
  const e1rms = new Map([...setE1rms, ...e1rmsFromTests(testRows, w => w >= BLOCK_ZERO_BASE_WEEKS)])

  const totalWeeks = block?.totalWeeks ?? BLOCK_ZERO_BASE_WEEKS
  const weeksSinceStart = Math.floor((todayEpochDay - startEpochDay) / 7)
  const currentWeekNumber = Math.min(Math.max(weeksSinceStart + 1, 1), totalWeeks)

  const gate: EndGateInput = {
    completionRate: keySessionCompletionRate(blockSessions, todayEpochDay),
    longestRecentGapDays: longestGapInWindow(completedDays, todayEpochDay, startEpochDay),
    backTrend: backTrend(await loadBackScores(db, startEpochDay, todayEpochDay), startEpochDay, todayEpochDay),
    retestDone: e1rms.size > 0,
    extensionsUsed: extensionsUsed(totalWeeks),
  }
  return { gate, e1rms, totalWeeks, atEndBoundary: currentWeekNumber >= totalWeeks }
}

export interface BlockZeroTransitionResult extends BlockTransitionOutput {
  /** What the rules decided and why; the decision field above is the final one. */
  rules: {
    decision: TransitionPlan['decision']
    aiDecision: BlockTransitionOutput['decision'] | null
    reasons: string[]
    extendWeeks: number
    totalWeeks: number
  }
  nextBlockId: string | null
}

export async function runBlockZeroTransition(
  db: DB,
  apiKey: string,
  blockId: string,
): Promise<BlockZeroTransitionResult | null> {
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
    model: MODELS.reasoning,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: jsonFormatFor(TOOL_BLOCK_TRANSITION) },
    fallbacks: 'default',
    system: systemBlocks,
    messages: [{ role: 'user', content: userPrompt }],
  }, { timeoutMs: 150_000 })

  // Offline or unparseable: the rules still decide. The AI is a second opinion.
  let output: BlockTransitionOutput | null = null
  if (result.offline) {
    console.warn('[blockZero] offline during transition check, rules decide alone')
  } else {
    output = getStructuredOutput<BlockTransitionOutput>(result)
    if (!output) console.warn('[blockZero] no structured output from transition check, rules decide alone')
  }

  const todayEpochDay = getEpochDay(new Date())
  const gateData = await gatherGateData(db, blockId, todayEpochDay)
  const plan = planTransition({
    gate: gateData.gate,
    aiDecision: output?.decision ?? null,
    aiTargets: output?.calibrationTargets ?? [],
    retestE1rms: gateData.e1rms,
    totalWeeks: gateData.totalWeeks,
    atEndBoundary: gateData.atEndBoundary,
  })

  const nowSec = Math.floor(Date.now() / 1000)
  const nextBlockId = await applyTransitionPlan(db, blockId, plan, nowSec)

  const combined: BlockZeroTransitionResult = {
    decision: plan.reportedDecision,
    rationale: output?.rationale ?? plan.reasons.join(' '),
    calibrationTargets: output?.calibrationTargets ?? [],
    ...(output?.nextBlockNotes ? { nextBlockNotes: output.nextBlockNotes } : {}),
    rules: {
      decision: plan.decision,
      aiDecision: output?.decision ?? null,
      reasons: plan.reasons,
      extendWeeks: plan.extendWeeks,
      totalWeeks: plan.newTotalWeeks,
    },
    nextBlockId,
  }
  // When the rules overrode the AI, the athlete-facing line is the rules' reason.
  if (output && output.decision !== plan.reportedDecision) combined.rationale = plan.reasons.join(' ')

  const usage = result.offline ? null : result.usage
  await db.insert(coachingOutputs).values({
    id: crypto.randomUUID(),
    kind: 'block_zero_transition',
    model: !result.offline && output ? result.model : 'rules',
    scopeWeekPlanId: null,
    scopeSessionId: null,
    inputHash: blockId,
    outputJson: JSON.stringify(combined),
    tokensIn: usage?.input_tokens ?? 0,
    tokensOut: usage?.output_tokens ?? 0,
    cachedTokensIn: usage?.cache_read_input_tokens ?? 0,
    createdAt: nowSec,
  })

  console.log(`[blockZero] transition for block ${blockId}: rules=${plan.decision} ai=${output?.decision ?? 'none'}`)
  return combined
}

/**
 * Apply a transition plan. Calibration first, so the next block starts on the
 * new maxes. Extend lengthens the block (the week after repeats week 5).
 * Proceed/adjust ends Block Zero and creates the Fighter block through the
 * same path as POST /api/blocks. Returns the new block id, if any.
 */
export async function applyTransitionPlan(db: DB, blockId: string, plan: TransitionPlan, nowSec: number): Promise<string | null> {
  await upsertTrainingMaxes(db, plan.calibration, nowSec)

  if (plan.decision === 'extend' && plan.extendWeeks > 0) {
    await db.update(trainingBlocks).set({ totalWeeks: plan.newTotalWeeks }).where(eq(trainingBlocks.id, blockId))
    console.log(`[blockZero] extend: block ${blockId} now ${plan.newTotalWeeks} weeks`)
    return null
  }

  if (plan.nextBlock) {
    await endActiveBlocks(db, nowSec)
    const next = await createTrainingBlock(db, { ...plan.nextBlock, nowSec })
    console.log(`[blockZero] ${plan.decision}: ended ${blockId}, created ${next?.id}`)
    return next?.id ?? null
  }
  return null
}

export async function getStoredBlockZeroTransition(
  db: DB,
): Promise<BlockTransitionOutput | BlockZeroTransitionResult | null> {
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
