// Phase 2 of the Athlete-State pass (docs/ATHLETE_STATE_SPEC.md §3,§5).
// One Opus reasoning call over the assembled snapshot, producing a structured,
// persisted AthleteState. Persistence reuses coaching_outputs (kind='athlete_state'),
// and assembleAthleteContext reads the prior state back in — that round-trip is
// the memory the live coach never had.

import { eq } from 'drizzle-orm'
import { coachingOutputs, exercises, trainingMaxes, userProfile } from '../../db/schema'
import type { createDB } from '../../db/client'
import { anthropicCall, getToolInput } from '../anthropic'
import { buildSystemPrompt, type UserProfileContext } from '../prompts/system'
import { TOOL_ASSESS_ATHLETE, type AthleteAssessmentOutput } from '../prompts/tools'
import { getLatestBodyweightKg } from '../bodyMetrics'
import { assembleAthleteContext } from './assembleContext'
import { serializeAthleteContext } from './serialize'
import { clampLoadFactor } from './liftTrends'
import type { AthleteContext, AthleteState } from './types'

type DB = ReturnType<typeof createDB>

const MODEL = 'claude-opus-4-8'
export const MODEL_VERSION = 'athlete-state-v1'

// Voice canon: strip em/en dashes in case the model slips. Cheap insurance.
function sanitizeVoice(s: string): string {
  return s.replace(/[—–]/g, ',').replace(/\s{2,}/g, ' ').trim()
}

// Pure: merge the model's assessment with the assembled context into the
// persisted AthleteState. Clamps loadFactor to the deterministic floor and
// joins exercise names / trend direction back in. No DB, no network.
export function buildAthleteState(
  output: AthleteAssessmentOutput,
  ctx: AthleteContext,
  trigger: string,
  nowSec: number,
  modelVersion = MODEL_VERSION,
): AthleteState {
  const ctxById = new Map(ctx.lifts.map(l => [l.exerciseId, l]))
  const lifts = output.lifts.map(l => {
    const c = ctxById.get(l.exerciseId)
    return {
      exerciseId: l.exerciseId,
      exerciseName: c?.exerciseName ?? l.exerciseId,
      verdict: l.verdict,
      loadFactor: clampLoadFactor(l.loadFactor),
      rationale: sanitizeVoice(l.rationale),
      trendSummary: c ? `direction=${c.direction}, baseline=${c.verdict}` : 'no baseline trend',
    }
  })
  return {
    readiness: output.readiness,
    readinessRationale: sanitizeVoice(output.readinessRationale),
    lifts,
    weekShape: output.weekShape,
    weekShapeRationale: sanitizeVoice(output.weekShapeRationale),
    flags: (output.flags ?? []).map(f => ({ kind: f.kind, detail: sanitizeVoice(f.detail) })),
    note: sanitizeVoice(output.note),
    computedAtEpoch: nowSec,
    trigger,
    modelVersion,
  }
}

async function loadProfile(db: DB): Promise<UserProfileContext> {
  const [profileRow] = await db.select().from(userProfile).limit(1)
  const tmRows = await db
    .select({ weightKg: trainingMaxes.weightKg, name: exercises.name })
    .from(trainingMaxes)
    .innerJoin(exercises, eq(trainingMaxes.exerciseId, exercises.id))
  const latestBodyweightKg = await getLatestBodyweightKg(db)
  return {
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
}

export interface RunAthleteStateResult {
  state: AthleteState
}

export async function runAthleteState(
  db: DB,
  apiKey: string,
  trigger: string,
  todayEpochDay: number,
): Promise<RunAthleteStateResult | null> {
  const nowSec = Math.floor(Date.now() / 1000)

  const ctx = await assembleAthleteContext(db, todayEpochDay)
  // Nothing to reason about yet: no strength trends and no wellness/effort.
  if (ctx.lifts.length === 0 && ctx.effort.length === 0 && ctx.wellness.length === 0) {
    console.log('[athleteState] empty context; skipping')
    return null
  }

  const profile = await loadProfile(db)
  const system = buildSystemPrompt(profile, null, null)
  const prompt = serializeAthleteContext(ctx)

  const result = await anthropicCall(apiKey, {
    model: MODEL,
    max_tokens: 1024,
    system,
    messages: [{ role: 'user', content: prompt }],
    tools: [TOOL_ASSESS_ATHLETE],
    tool_choice: { type: 'tool', name: 'assessAthlete' },
  })

  if (result.offline) {
    console.warn('[athleteState] offline; no state written')
    return null
  }

  const output = getToolInput<AthleteAssessmentOutput>(result, 'assessAthlete')
  if (!output) {
    console.warn('[athleteState] no tool output; skipping')
    return null
  }

  const state = buildAthleteState(output, ctx, trigger, nowSec)

  await db.insert(coachingOutputs).values({
    id: crypto.randomUUID(),
    kind: 'athlete_state',
    model: MODEL,
    scopeWeekPlanId: null,
    scopeSessionId: null,
    inputHash: null,
    outputJson: JSON.stringify(state),
    tokensIn: result.usage.input_tokens,
    tokensOut: result.usage.output_tokens,
    cachedTokensIn: result.usage.cache_read_input_tokens ?? 0,
    createdAt: nowSec,
  })

  console.log(`[athleteState] written. trigger=${trigger} lifts=${state.lifts.length} readiness=${state.readiness} tokens=${result.usage.input_tokens}/${result.usage.output_tokens}`)
  return { state }
}
