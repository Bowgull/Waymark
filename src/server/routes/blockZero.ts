// Block Zero entry assessment. Sonnet with extended thinking. Called when
// Block Zero starts, and again once the week-1 tests are in. Its starting
// maxes (capped by the tests) and MT cap are saved. Prompts live in
// lib/prompts/blockZero; outputs go through lib/blockZero/guardrails.
// The end-of-block check is gone (coach-brain §8, server/readiness.ts).

import { desc, eq } from 'drizzle-orm'
import { coachingOutputs, exercises, settings, trainingBlocks, trainingMaxes, userProfile } from '../../db/schema'
import { anthropicCall, getStructuredOutput, jsonFormatFor } from '../../lib/anthropic'
import { MODELS } from '../../lib/models'
import { buildSystemPrompt, type UserProfileContext } from '../../lib/prompts/system'
import { getLatestBodyweightKg } from '../../lib/bodyMetrics'
import {
  BLOCK_ZERO_TOOL,
  assessmentFromModel,
  buildAssessmentPrompt,
  type AssessmentTestData,
  type BlockZeroAssessmentModelOutput,
  type BlockZeroAssessmentOutput,
  type TransitionTestData,
} from '../../lib/prompts/blockZero'
import {
  clampsForStorage,
  fixedResults,
  guardCalibrationStarts,
  guardMtCap,
  houseVoice,
  logClamps,
  resolveLiftId,
  type Clamp,
} from '../../lib/blockZero'
import { loadBlockTestData, transitionTestSummary, type BlockTestData } from '../blockZeroData'
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
  const starts = guardCalibrationStarts(output.calibrationStarts ?? [], name => resolveLiftId(name, exerciseRows), tests.ceilings)
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
  const [settingsRow] = await db.select({ mtClassDays: settings.mtClassDays }).from(settings).limit(1)

  // Only maxes set inside this block: older ones are placeholders, not anything he lifted (Josh, 2026-10-23:
  // months off, every lift finds its weight from light).
  const [block] = await db.select({ startedAt: trainingBlocks.startedAt, createdAt: trainingBlocks.createdAt }).from(trainingBlocks).where(eq(trainingBlocks.id, blockId))
  const blockStartSec = block ? (block.startedAt ?? block.createdAt) : null
  const tmRows = (await db
    .select({ weightKg: trainingMaxes.weightKg, name: exercises.name, updatedAt: trainingMaxes.updatedAt })
    .from(trainingMaxes)
    .innerJoin(exercises, eq(trainingMaxes.exerciseId, exercises.id)))
    .filter(t => blockStartSec != null && t.updatedAt >= blockStartSec)

  const latestBodyweightKg = await getLatestBodyweightKg(db)

  const profile: UserProfileContext = {
    goals: profileRow?.goals ?? null,
    injuries: profileRow?.injuries ?? null,
    postureIssues: profileRow?.postureIssues ?? null,
    trainingHistory: profileRow?.trainingHistory ?? null,
    mtClassDays: settingsRow?.mtClassDays ?? null,
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

  // The model answers in lb; from here on it is the stored kg shape.
  const reply = getStructuredOutput<BlockZeroAssessmentModelOutput>(result)
  const raw = reply ? assessmentFromModel(reply) : null
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
// guarded: capped by week-1 tests, and only tested lifts; none before the tests),
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

// ─── The transition ────────────────────────────────────────────
// The end gate's check, its extensions and START FIGHTER BLOCK 1 are gone
// (coach-brain §8): the nightly pass sets the move when the four readiness
// parts are in (server/readiness.ts). The prompt helper stays for its tests.

/** Week 1 vs retest for the transition prompt. Null when no test data exists. */
export function transitionTestData(data: BlockTestData, retest: Map<string, number>, trend: TransitionTestData['backTrend']): TransitionTestData | null {
  const summary = transitionTestSummary(data, retest)
  if (summary.deltas.length === 0 && summary.ceilings.length === 0) return null
  return { ...summary, backTrend: trend }
}
