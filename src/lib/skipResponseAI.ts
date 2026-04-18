// Skip-response Haiku call. Produces one-line coach reply + proposed action
// when the athlete skips a session. Falls back to null on AI offline so the
// caller can apply a deterministic reschedule.

import { and, eq, gte, lte } from 'drizzle-orm'
import { coachingOutputs, dailyLogs, exercises, sessions, trainingMaxes, userProfile } from '../db/schema'
import { anthropicCall, getToolInput } from './anthropic'
import { buildSystemPrompt, type UserProfileContext } from './prompts/system'
import { TOOL_SKIP_RESPONSE, type SkipResponseOutput } from './prompts/tools'
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

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function dayName(dow: number): string {
  return DAY_NAMES[dow] ?? `Day ${dow}`
}

interface SkipInput {
  sessionId: string
  sessionType: string
  scheduledDate: number | null
  timeSlot: 'am' | 'pm' | null
  skipReason: string
  todayEpochDay: number
  todayDow: number
}

function buildPrompt(
  input: SkipInput,
  wellness: { sleepHours: number | null; soreness: number | null; alcoholScale: number | null } | null,
  weekSessions: Array<{ type: string; scheduledDate: number | null; timeSlot: string | null; status: string }>,
): string {
  const label = SESSION_LABEL[input.sessionType] ?? input.sessionType
  const lines: string[] = [
    `Athlete skipped a ${label} session scheduled for ${input.timeSlot?.toUpperCase() ?? 'AM'} today (${dayName(input.todayDow)}).`,
    `Skip reason: ${input.skipReason}`,
  ]

  if (wellness) {
    const w: string[] = []
    if (wellness.sleepHours != null) w.push(`sleep ${wellness.sleepHours}h`)
    if (wellness.soreness != null) w.push(`soreness ${wellness.soreness}/5`)
    if (wellness.alcoholScale != null) w.push(`alcohol ${wellness.alcoholScale}/5`)
    if (w.length > 0) lines.push(`Wellness today: ${w.join(', ')}.`)
  }

  // Summarize rest-of-week
  const weekStart = input.todayEpochDay - input.todayDow
  const weekEnd = weekStart + 6
  const remaining = weekSessions.filter(
    s => s.scheduledDate != null && s.scheduledDate > input.todayEpochDay && s.scheduledDate <= weekEnd && s.status !== 'skipped',
  )
  const completed = weekSessions.filter(s => s.status === 'completed')

  lines.push('')
  lines.push(`Completed so far this week: ${completed.length > 0 ? completed.map(s => SESSION_LABEL[s.type] ?? s.type).join(', ') : 'none'}.`)
  if (remaining.length > 0) {
    lines.push('Remaining this week:')
    const byDay = new Map<number, string[]>()
    for (const s of remaining) {
      const dow = new Date((s.scheduledDate ?? 0) * 86400000).getUTCDay()
      const arr = byDay.get(dow) ?? []
      arr.push(`${(s.timeSlot ?? 'am').toUpperCase()} ${SESSION_LABEL[s.type] ?? s.type}`)
      byDay.set(dow, arr)
    }
    for (const [dow, labels] of [...byDay.entries()].sort(([a], [b]) => a - b)) {
      lines.push(`  ${dayName(dow)}: ${labels.join(', ')}`)
    }
  } else {
    lines.push('Nothing else scheduled this week.')
  }

  lines.push('')
  lines.push(
    `Decide one action using the skipResponse tool:
- hold: reason is load/recovery-driven (sore, sick, low sleep) and the session was optional or the week is already heavy. No redistribution.
- move: same session fits cleanly later this week. Set targetDayOfWeek (> ${input.todayDow}, <= 6) and targetTimeSlot.
- swap: a different session type is a better use of today's slot given reason (e.g. schedule conflict -> shorter session; low drive -> recovery). Set swapToType, swapToLabel, targetDayOfWeek=${input.todayDow}, targetTimeSlot.
- recover: body signal is the reason (illness, injury). Prescribe rest or active recovery. Optional swap fields.`,
  )
  lines.push('coachLine: one sentence, voice canon, acknowledging the reason before the call.')
  lines.push('weekImpact: one line if this cascades (e.g. "Now two strength days end of week"). Omit if neutral.')

  return lines.join('\n')
}

export async function runSkipResponse(
  db: DB,
  apiKey: string,
  input: SkipInput,
): Promise<SkipResponseOutput | null> {
  const weekStart = input.todayEpochDay - input.todayDow
  const weekEnd = weekStart + 6

  const [profileRow, tmRows, weekSessions, todayLog] = await Promise.all([
    db.select().from(userProfile).limit(1).then(rows => rows[0] ?? null),
    db
      .select({ weightKg: trainingMaxes.weightKg, name: exercises.name })
      .from(trainingMaxes)
      .innerJoin(exercises, eq(trainingMaxes.exerciseId, exercises.id)),
    db
      .select({ type: sessions.type, scheduledDate: sessions.scheduledDate, timeSlot: sessions.timeSlot, status: sessions.status })
      .from(sessions)
      .where(and(gte(sessions.scheduledDate, weekStart), lte(sessions.scheduledDate, weekEnd))),
    db.select().from(dailyLogs).where(eq(dailyLogs.logDate, input.todayEpochDay)).limit(1).then(rows => rows[0] ?? null),
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

  const systemBlocks = buildSystemPrompt(profile, null)
  const prompt = buildPrompt(
    input,
    todayLog ? { sleepHours: todayLog.sleepHours, soreness: todayLog.soreness, alcoholScale: todayLog.alcoholScale } : null,
    weekSessions,
  )

  const result = await anthropicCall(apiKey, {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: systemBlocks,
    messages: [{ role: 'user', content: prompt }],
    tools: [TOOL_SKIP_RESPONSE],
    tool_choice: { type: 'tool', name: 'skipResponse' },
  })

  if (result.offline) {
    console.warn('[skipResponse] offline')
    return null
  }

  const output = getToolInput<SkipResponseOutput>(result, 'skipResponse')
  if (!output) {
    console.warn('[skipResponse] no tool output')
    return null
  }

  await db.insert(coachingOutputs).values({
    id: crypto.randomUUID(),
    kind: 'skip_response',
    model: 'claude-haiku-4-5-20251001',
    scopeWeekPlanId: null,
    scopeSessionId: input.sessionId,
    inputHash: null,
    outputJson: JSON.stringify(output),
    tokensIn: result.usage.input_tokens,
    tokensOut: result.usage.output_tokens,
    cachedTokensIn: result.usage.cache_read_input_tokens ?? 0,
    createdAt: Math.floor(Date.now() / 1000),
  })

  return output
}
