// Phase 2 of the Athlete-State pass (docs/ATHLETE_STATE_SPEC.md §3,§5).
// One reasoning call (MODELS.reasoning, Sonnet 5.5, structured output: Sonnet
// rejects forced tool use) over the assembled snapshot, producing a structured,
// persisted AthleteState. Runs weekly inside the weekly pass and after a
// retest. It decides within the rules only (guard.ts): clamped loadFactor, no
// push on an ease day or after a gap, 10-day expiry, one-line verdict shown. Persistence reuses coaching_outputs (kind='athlete_state'),
// and assembleAthleteContext reads the prior state back in — that round-trip is
// the memory the live coach never had.

import { eq } from 'drizzle-orm'
import { coachingOutputs, exercises, trainingMaxes, userProfile } from '../../db/schema'
import type { createDB } from '../../db/client'
import { anthropicCall, getStructuredOutput, jsonFormatFor, jsonInstructionFor, type AnthropicRequest, type SystemBlock } from '../anthropic'
import { MODELS } from '../models'
import { guardAthleteState, type AthleteGuardContext } from './guard'
import { buildSystemPrompt, type UserProfileContext } from '../prompts/system'
import { TOOL_ASSESS_ATHLETE, type AthleteAssessmentOutput } from '../prompts/tools'
import { getLatestBodyweightKg } from '../bodyMetrics'
import { assembleAthleteContext } from './assembleContext'
import { serializeAthleteContext } from './serialize'
import { clampLoadFactor } from './liftTrends'
import type { AthleteContext, AthleteState } from './types'

type DB = ReturnType<typeof createDB>

const MODEL = MODELS.reasoning
export const MODEL_VERSION = 'athlete-state-v1'

// Voice canon: strip em/en dashes in case the model slips. Cheap insurance.
function sanitizeVoice(s: string): string {
  return s.replace(/\s*[—–]\s*/g, ', ').replace(/\s{2,}/g, ' ').trim()
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

/** The user message: the snapshot plus the structured-output instruction. Pure. */
export function buildAthleteStatePrompt(ctx: AthleteContext): string {
  return `${serializeAthleteContext(ctx)}

Decide within the rules: loadFactor 0.85 to 1.05, no push on an ease day or after a gap. The app applies small changes with a note and asks before big ones.
${jsonInstructionFor(TOOL_ASSESS_ATHLETE)}`
}

/** The request: Sonnet 5.5 with a JSON reply in the assessAthlete schema. */
export function athleteStateRequest(system: SystemBlock[], prompt: string): AnthropicRequest {
  return {
    model: MODEL,
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low', format: jsonFormatFor(TOOL_ASSESS_ATHLETE) },
    fallbacks: 'default',
    system,
    messages: [{ role: 'user', content: prompt }],
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
  guard: AthleteGuardContext = { noPush: false, easeActive: false },
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
  const prompt = buildAthleteStatePrompt(ctx)

  const result = await anthropicCall(apiKey, athleteStateRequest(system, prompt))

  if (result.offline) {
    console.warn('[athleteState] offline; no state written')
    return null
  }

  const output = getStructuredOutput<AthleteAssessmentOutput>(result)
  if (!output || !Array.isArray(output.lifts)) {
    console.warn('[athleteState] no structured output; skipping')
    return null
  }

  const guarded = guardAthleteState(buildAthleteState(output, ctx, trigger, nowSec), guard)
  if (guarded.clamps.length > 0) console.warn(`[athleteState] guard: ${guarded.clamps.join('; ')}`)
  const state = guarded.state

  await db.insert(coachingOutputs).values({
    id: crypto.randomUUID(),
    kind: 'athlete_state',
    model: result.model ?? MODEL,
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
