// Haiku-based weekly plan generation. Replaces the rule-based weekAnalysis engine.
// Falls back to null on AI offline so the route can use the template fallback.

import { and, eq, gte, lte } from 'drizzle-orm'
import { coachingOutputs, dailyLogs, exercises, sessions, trainingMaxes, userProfile } from '../db/schema'
import { anthropicCall, getToolInput } from './anthropic'
import { buildSystemPrompt, type UserProfileContext } from './prompts/system'
import { TOOL_WEEK_PLAN, type WeekPlanOutput } from './prompts/tools'
import { getWeekSummaries } from './prompts/summarizer'
import type { createDB } from '../db/client'

type DB = ReturnType<typeof createDB>

const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export interface WeekPlanParams {
  blockId: string
  weekId: string
  weekNumber: number
  blockWeek: number
  isBlockZero: boolean
  mtClassDays: Set<number>
  prevWeekStart: number
  prevWeekEnd: number
}

function blockZeroPhaseNote(blockWeek: number): string {
  if (blockWeek <= 2) return 'Phase 1 (weeks 1-2): no MT class. Foundation run, strength, bag work only.'
  if (blockWeek <= 4) return 'Phase 2 (weeks 3-4): MT class returns Mon/Wed/Fri PM. Strength climbing to 50-55%.'
  return 'Phase 3 (weeks 5-6): full schedule. Weights at 55-60%. Transition readiness building.'
}

function buildPrompt(
  params: WeekPlanParams,
  prevSessions: Array<{ type: string; status: string; rpe: number | null; difficulty: number | null; notes: string | null }>,
  prevLogs: Array<{ sleepHours: number | null; soreness: number | null }>,
  compressedNote: string,
): string {
  const lines: string[] = [
    `Generate week plan for week ${params.weekNumber} (block week ${params.blockWeek}).`,
    '',
  ]

  if (params.isBlockZero) {
    lines.push(`Block type: Block Zero. ${blockZeroPhaseNote(params.blockWeek)}`)
  } else {
    lines.push('Block type: Fighter block (full training load).')
  }

  lines.push('')
  const mtDayNames = [...params.mtClassDays].sort().map(d => DOW_NAMES[d]).filter(Boolean)
  lines.push(`MT class available this week: ${mtDayNames.length > 0 ? mtDayNames.join(', ') : 'none'}.`)

  if (compressedNote) {
    lines.push('', compressedNote)
  }

  lines.push('', 'Previous week sessions:')
  if (prevSessions.length > 0) {
    for (const s of prevSessions) {
      const parts = [`  ${s.type} | ${s.status}`]
      if (s.rpe != null) parts.push(`RPE ${s.rpe}`)
      if (s.difficulty != null) parts.push(`difficulty ${s.difficulty}/5`)
      if (s.notes && s.notes !== s.type) parts.push(s.notes)
      lines.push(parts.join(' | '))
    }
  } else {
    lines.push('  none')
  }

  lines.push('', 'Previous week wellness:')
  if (prevLogs.length > 0) {
    for (const l of prevLogs) {
      const parts: string[] = []
      if (l.sleepHours != null) parts.push(`sleep ${l.sleepHours}h`)
      if (l.soreness != null) parts.push(`soreness ${l.soreness}/5`)
      lines.push(`  ${parts.join(', ') || 'no data'}`)
    }
  } else {
    lines.push('  none logged')
  }

  lines.push('', 'Call weekPlan.')
  return lines.join('\n')
}

export async function generateWeekPlan(
  db: DB,
  apiKey: string,
  params: WeekPlanParams,
): Promise<WeekPlanOutput | null> {
  const [profileRow] = await db.select().from(userProfile).where(eq(userProfile.id, 'default'))

  const tmRows = await db
    .select({ weightKg: trainingMaxes.weightKg, name: exercises.name })
    .from(trainingMaxes)
    .innerJoin(exercises, eq(trainingMaxes.exerciseId, exercises.id))

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

  const summaries = await getWeekSummaries(db, params.blockId, params.weekNumber - 1)
  const compressedNote = summaries.length > 0
    ? 'Older weeks (compressed):\n' +
      summaries.map(s => `  Week ${s.weekNumber}: ${s.narrative} ${s.adherence}. ${s.wellnessTrend}`).join('\n')
    : ''

  const [prevSessions, prevLogs] = await Promise.all([
    db
      .select({ type: sessions.type, status: sessions.status, rpe: sessions.rpe, difficulty: sessions.difficulty, notes: sessions.notes })
      .from(sessions)
      .where(and(gte(sessions.scheduledDate, params.prevWeekStart), lte(sessions.scheduledDate, params.prevWeekEnd))),
    db
      .select({ sleepHours: dailyLogs.sleepHours, soreness: dailyLogs.soreness })
      .from(dailyLogs)
      .where(and(gte(dailyLogs.logDate, params.prevWeekStart), lte(dailyLogs.logDate, params.prevWeekEnd))),
  ])

  const systemBlocks = buildSystemPrompt(profile, null)
  const prompt = buildPrompt(params, prevSessions, prevLogs, compressedNote)

  const result = await anthropicCall(apiKey, {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    system: systemBlocks,
    messages: [{ role: 'user', content: prompt }],
    tools: [TOOL_WEEK_PLAN],
    tool_choice: { type: 'tool', name: 'weekPlan' },
  })

  if (result.offline) {
    console.warn('[weeklyPlan] offline, falling back to rule engine')
    return null
  }

  const output = getToolInput<WeekPlanOutput>(result, 'weekPlan')
  if (!output) {
    console.warn('[weeklyPlan] no tool output, falling back to rule engine')
    return null
  }

  await db.insert(coachingOutputs).values({
    id: crypto.randomUUID(),
    kind: 'week_plan',
    model: 'claude-haiku-4-5-20251001',
    scopeWeekPlanId: params.weekId,
    scopeSessionId: null,
    inputHash: null,
    outputJson: JSON.stringify(output),
    tokensIn: result.usage.input_tokens,
    tokensOut: result.usage.output_tokens,
    cachedTokensIn: result.usage.cache_read_input_tokens ?? 0,
    createdAt: Math.floor(Date.now() / 1000),
  })

  console.log(`[weeklyPlan] week ${params.weekNumber} generated (mt=${output.mtSessionsThisWeek})`)
  return output
}
