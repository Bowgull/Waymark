// Post-session Haiku call. Produces one-line review + flag stored on the session record.
// Falls back to null on AI offline so the caller can skip the update.

import { desc, eq } from 'drizzle-orm'
import { coachingOutputs, exercises, sessions, trainingMaxes, userProfile } from '../db/schema'
import { anthropicCall, getToolInput } from './anthropic'
import { buildSystemPrompt, type UserProfileContext } from './prompts/system'
import { TOOL_SESSION_REVIEW, type SessionReviewOutput } from './prompts/tools'
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
  posture_corrective: 'posture corrective',
}

function buildPrompt(
  session: { type: string; rpe: number | null; difficulty: number | null; notes: string | null; durationSec: number | null },
  recent: Array<{ type: string; rpe: number | null; difficulty: number | null }>,
): string {
  const label = SESSION_LABEL[session.type] ?? session.type
  const dur = session.durationSec ? `${Math.round(session.durationSec / 60)} min` : 'duration not recorded'
  const lines: string[] = [
    `Session completed: ${label}.`,
    `Duration: ${dur}.`,
    `RPE: ${session.rpe ?? 'not recorded'}/10. Difficulty: ${session.difficulty ?? 'not recorded'}/5.`,
  ]
  if (session.notes) lines.push(`Athlete notes: ${session.notes}`)

  if (recent.length > 0) {
    lines.push('')
    lines.push('Recent sessions for context:')
    for (const s of recent) {
      const l = SESSION_LABEL[s.type] ?? s.type
      lines.push(`  ${l} - RPE ${s.rpe ?? '?'}, difficulty ${s.difficulty ?? '?'}`)
    }
  }

  lines.push('')
  lines.push(
    'Write a one-line session review using the sessionReview tool. Voice canon: acknowledge what happened, state numbers plainly, never congratulate. Set flag appropriately.',
  )

  return lines.join('\n')
}

export async function runSessionReview(
  db: DB,
  apiKey: string,
  session: { id: string; type: string; rpe: number | null; difficulty: number | null; notes: string | null; durationSec: number | null },
): Promise<SessionReviewOutput | null> {
  const [profileRow, recent, tmRows] = await Promise.all([
    db.select().from(userProfile).limit(1).then(rows => rows[0] ?? null),
    db
      .select({ id: sessions.id, type: sessions.type, rpe: sessions.rpe, difficulty: sessions.difficulty })
      .from(sessions)
      .where(eq(sessions.status, 'completed'))
      .orderBy(desc(sessions.completedAt))
      .limit(4),
    db
      .select({ weightKg: trainingMaxes.weightKg, name: exercises.name })
      .from(trainingMaxes)
      .innerJoin(exercises, eq(trainingMaxes.exerciseId, exercises.id)),
  ])

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
  }

  const recentOther = recent.filter(r => r.id !== session.id).slice(0, 3)

  const systemBlocks = buildSystemPrompt(profile, null)
  const prompt = buildPrompt(session, recentOther)

  const result = await anthropicCall(apiKey, {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: systemBlocks,
    messages: [{ role: 'user', content: prompt }],
    tools: [TOOL_SESSION_REVIEW],
    tool_choice: { type: 'tool', name: 'sessionReview' },
  })

  if (result.offline) {
    console.warn('[sessionReview] offline, skipping review')
    return null
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
