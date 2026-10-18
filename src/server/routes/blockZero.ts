// Block Zero entry assessment and transition readiness check. Sonnet with extended thinking.
// Assessment: called when Block Zero starts, and again once the week-1 tests are in.
// Its starting maxes (capped by the tests) and MT cap are saved.
// Transition: called at the end of Block Zero. The rules gate (lib/blockZero/endGate)
// sets the limits; the AI decision only moves inside them. Proceed creates Fighter Block 1.
// Prompts live in lib/prompts/blockZero; outputs go through lib/blockZero/guardrails.

import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import { blockTests, coachingOutputs, dailyLogs, exercises, sessions, strengthSessionExercises, strengthSets, trainingBlocks, trainingMaxes, userProfile, weekPlans } from '../../db/schema'
import { anthropicCall, getStructuredOutput, jsonFormatFor } from '../../lib/anthropic'
import { MODELS } from '../../lib/models'
import { buildSystemPrompt, type UserProfileContext } from '../../lib/prompts/system'
import { getLatestBodyweightKg } from '../../lib/bodyMetrics'
import { TOOL_BLOCK_TRANSITION, type BlockTransitionOutput } from '../../lib/prompts/tools'
import {
  BLOCK_ZERO_TOOL,
  buildAssessmentPrompt,
  buildTransitionPrompt,
  type AssessmentTestData,
  type BlockZeroAssessmentOutput,
  type TransitionPromptData,
  type TransitionTestData,
  type TransitionWeekSummary,
} from '../../lib/prompts/blockZero'
import { computeBlockAdherence, deriveGuidance } from '../../lib/adherence'
import { computeHrSnapshot, loadProfileMaxHrForHr, loadRecentRunsForHr, serializeHrForPrompt } from '../../lib/hrAnalysis'
import { rolloverStaleSessions } from '../../lib/sessionRollover'
import { getEpochDay } from '../../lib/dates'
import {
  backTrend,
  clampsForStorage,
  e1rmsFromTests,
  extensionsUsed,
  fixedResults,
  guardCalibrationStarts,
  guardCalibrationWrites,
  guardMtCap,
  houseVoice,
  keySessionCompletionRate,
  logClamps,
  longestGapInWindow,
  planTransition,
  resolveLiftId,
  retestCeilingKg,
  retestE1rms,
  selectMainLifts,
  type Clamp,
  BLOCK_ZERO_BASE_WEEKS,
  KEY_SESSION_TYPES,
  type EndGateInput,
  type TransitionPlan,
} from '../../lib/blockZero'
import { createTrainingBlock, endActiveBlocks } from '../blocks'
import { loadBackScores, loadBlockTestData, transitionTestSummary, type BlockTestData } from '../blockZeroData'
import type { createDB } from '../../db/client'

type DB = ReturnType<typeof createDB>

export type { BlockZeroAssessmentOutput, BlockZeroCalibrationStart, BlockZeroWeekTheme } from '../../lib/prompts/blockZero'
export { BLOCK_ZERO_TOOL }

/** Week-1 tests in the shape the assessment prompt reads. Null when none are logged. */
export function assessmentTestData(data: BlockTestData): AssessmentTestData | null {
  if (!data.testsExist) return null
  return {
    lifts: [...data.baselines.values()].map(b => ({
      exerciseId: b.exerciseId,
      name: data.names.get(b.exerciseId) ?? b.exerciseId,
      e1rmKg: b.e1rmKg,
      ceilingKg: data.ceilings.get(b.exerciseId) ?? b.e1rmKg,
      source: b.source,
      workup: b.workup,
    })),
    fixed: fixedResults(data.rows, w => w === 1),
  }
}

/**
 * Clamp an assessment to the rules: calibrationStarts at or under the week-1
 * ceilings (and, once tests exist, only tested lifts are written), MT cap 0-3,
 * text in the house voice. Pure.
 */
export function guardAssessment(
  output: BlockZeroAssessmentOutput,
  exerciseRows: Array<{ id: string; name: string }>,
  tests: Pick<BlockTestData, 'ceilings' | 'testsExist'>,
): { output: BlockZeroAssessmentOutput; clamps: Clamp[]; writes: Array<{ exerciseId: string; weightKg: number }>; mtCap: number | null } {
  const starts = guardCalibrationStarts(output.calibrationStarts ?? [], name => resolveLiftId(name, exerciseRows), tests.ceilings, tests.testsExist)
  const clamps = [...starts.clamps]
  const cap = guardMtCap(output.mtCapPerWeek)
  if (cap.clamp) clamps.push(cap.clamp)
  const guarded: BlockZeroAssessmentOutput = {
    ...output,
    narrative: houseVoice(output.narrative ?? ''),
    calibrationStarts: starts.output,
    mtCapPerWeek: cap.value ?? output.mtCapPerWeek,
    ...(output.coachNote != null ? { coachNote: houseVoice(output.coachNote) } : {}),
  }
  return { output: guarded, clamps, writes: starts.writes, mtCap: cap.value }
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
  // Week-1 tests, once logged, ground the estimates. Re-running after week 1 is expected.
  const testData = await loadBlockTestData(db, blockId)

  const result = await anthropicCall(apiKey, {
    model: MODELS.reasoning,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: jsonFormatFor(BLOCK_ZERO_TOOL) },
    fallbacks: 'default',
    system: systemBlocks,
    messages: [{ role: 'user', content: buildAssessmentPrompt(profile, assessmentTestData(testData)) }],
  }, { timeoutMs: 150_000 })

  if (result.offline) {
    console.warn('[blockZero] offline during assessment')
    return null
  }

  const raw = getStructuredOutput<BlockZeroAssessmentOutput>(result)
  if (!raw) {
    console.warn('[blockZero] no structured output from assessment')
    return null
  }

  const exerciseRows = await db.select({ id: exercises.id, name: exercises.name }).from(exercises)
  const guarded = guardAssessment(raw, exerciseRows, testData)
  logClamps('block_zero_assessment', guarded.clamps)
  const output = guarded.output
  const guardrails = { ...clampsForStorage(guarded.clamps), testBacked: testData.testsExist, ...(guarded.clamps.length > 0 ? { original: raw } : {}) }

  await db.insert(coachingOutputs).values({
    id: crypto.randomUUID(),
    kind: 'block_zero_assessment',
    model: result.model,
    scopeWeekPlanId: null,
    scopeSessionId: null,
    inputHash: blockId,
    outputJson: JSON.stringify({ ...output, guardrails }),
    tokensIn: result.usage.input_tokens,
    tokensOut: result.usage.output_tokens,
    cachedTokensIn: result.usage.cache_read_input_tokens ?? 0,
    createdAt: Math.floor(Date.now() / 1000),
  })

  await persistAssessment(db, guarded.writes, guarded.mtCap)

  console.log(`[blockZero] assessment complete for block ${blockId} (tests=${testData.testsExist}, clamps=${guarded.clamps.length})`)
  return output
}

// Save what the assessment decided: starting training maxes (already
// guarded: capped by week-1 tests, and once tests exist only tested lifts),
// and the block's MT cap on the profile. training_maxes has no "set by hand"
// marker, so a plain upsert is the honest option.
async function persistAssessment(db: DB, writes: Array<{ exerciseId: string; weightKg: number }>, mtCap: number | null): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000)
  await upsertTrainingMaxes(db, writes, nowSec)

  if (mtCap != null) {
    const [profile] = await db.select({ id: userProfile.id }).from(userProfile).where(eq(userProfile.id, 'default'))
    if (profile) {
      await db.update(userProfile).set({ mtCapPerWeek: mtCap, updatedAt: nowSec }).where(eq(userProfile.id, 'default'))
    } else {
      await db.insert(userProfile).values({ id: 'default', mtCapPerWeek: mtCap, createdAt: nowSec, updatedAt: nowSec })
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

async function gatherTransitionData(db: DB, blockId: string): Promise<TransitionPromptData & {
  block: { startedAt: number | null; totalWeeks: number }
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

  const weeks: TransitionWeekSummary[] = []

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
  /** Clamps the rules applied to the AI's targets, for audit. */
  guardrails?: { applied: boolean; clamps: Clamp[] }
}

/** Week 1 vs retest for the transition prompt. Null when no test data exists. */
export function transitionTestData(data: BlockTestData, retest: Map<string, number>, trend: TransitionTestData['backTrend']): TransitionTestData | null {
  const summary = transitionTestSummary(data, retest)
  if (summary.deltas.length === 0 && summary.ceilings.length === 0) return null
  return { ...summary, backTrend: trend }
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
  // Gate inputs first: the retest e1RMs set the ceilings the prompt states.
  const todayEpochDay = getEpochDay(new Date())
  const gateData = await gatherGateData(db, blockId, todayEpochDay)
  const tests = transitionTestData(await loadBlockTestData(db, blockId), gateData.e1rms, gateData.gate.backTrend)
  const userPrompt = buildTransitionPrompt(transitionData, tests)

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

  const planned = planTransition({
    gate: gateData.gate,
    aiDecision: output?.decision ?? null,
    aiTargets: output?.calibrationTargets ?? [],
    retestE1rms: gateData.e1rms,
    totalWeeks: gateData.totalWeeks,
    atEndBoundary: gateData.atEndBoundary,
  })
  // AI targets never above the retest rule (90% of e1RM, 85% on adjust).
  const calibration = guardCalibrationWrites(planned.calibration, gateData.e1rms, planned.decision, retestCeilingKg)
  logClamps('block_zero_transition', calibration.clamps)
  const plan: TransitionPlan = { ...planned, calibration: calibration.output }
  const aiWeight = new Map(plan.calibration.filter(c => c.source === 'ai').map(c => [c.exerciseId, c.weightKg]))

  const nowSec = Math.floor(Date.now() / 1000)
  const nextBlockId = await applyTransitionPlan(db, blockId, plan, nowSec)

  const combined: BlockZeroTransitionResult = {
    decision: plan.reportedDecision,
    rationale: output?.rationale ? houseVoice(output.rationale) : plan.reasons.join(' '),
    calibrationTargets: (output?.calibrationTargets ?? []).map(t => ({ ...t, estimatedMaxKg: aiWeight.get(t.exerciseId) ?? t.estimatedMaxKg })),
    ...(output?.nextBlockNotes ? { nextBlockNotes: houseVoice(output.nextBlockNotes) } : {}),
    rules: {
      decision: plan.decision,
      aiDecision: output?.decision ?? null,
      reasons: plan.reasons,
      extendWeeks: plan.extendWeeks,
      totalWeeks: plan.newTotalWeeks,
    },
    nextBlockId,
    ...(calibration.clamps.length > 0 ? { guardrails: clampsForStorage(calibration.clamps) } : {}),
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
