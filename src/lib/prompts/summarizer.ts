// Compresses weeks outside the rolling 4-week context window.
// Stored in coaching_outputs (kind='week_summary') for AI context reuse.

import { and, eq, gte, lte } from 'drizzle-orm'
import { coachingOutputs, dailyLogs, sessions, trainingBlocks, weekPlans } from '../../db/schema'
import { anthropicCall, cachedSystem, getToolInput } from '../anthropic'
import type { Tool } from '../anthropic'
import { createDB } from '../../db/client'

const RECENT_WEEKS = 4

type DB = ReturnType<typeof createDB>

export interface WeekSummaryOutput {
  weekNumber: number
  adherence: string
  wellnessTrend: string
  strengthNotes: string
  mtSessions: number
  narrative: string
}

const WEEK_SUMMARY_TOOL: Tool = {
  name: 'week_summary',
  description: 'Compact factual summary of a training week. Used as AI context in subsequent calls.',
  input_schema: {
    type: 'object',
    properties: {
      weekNumber: { type: 'integer' },
      adherence: {
        type: 'string',
        description: 'Sessions completed vs planned. e.g. "3 of 5 completed"',
      },
      wellnessTrend: {
        type: 'string',
        description: 'Sleep and soreness pattern in one sentence.',
      },
      strengthNotes: {
        type: 'string',
        description: 'Notable strength session results, or "none" if no sessions.',
      },
      mtSessions: {
        type: 'integer',
        description: 'Number of MT sessions completed.',
      },
      narrative: {
        type: 'string',
        description: 'Two sentences max. Observations only. No encouragement.',
      },
    },
    required: ['weekNumber', 'adherence', 'wellnessTrend', 'strengthNotes', 'mtSessions', 'narrative'],
  },
}

const SUMMARIZER_SYSTEM =
  'You summarize training weeks into compact factual records for AI context reuse. ' +
  'No encouragement. No filler. State numbers plainly. Fragments are fine. ' +
  'Two sentences max for narrative. If data is missing, say "no data" rather than speculating.'

function buildWeekPrompt(
  weekNumber: number,
  sessionRows: Array<{ type: string; status: string; durationSec: number | null; rpe: number | null; difficulty: number | null }>,
  logRows: Array<{ sleepHours: number | null; soreness: number | null }>,
  weekNotes: string | null,
): string {
  const sessionLines = sessionRows.length
    ? sessionRows
        .map(s => {
          const dur = s.durationSec ? `${Math.round(s.durationSec / 60)}min` : 'n/a'
          return `  ${s.type} | ${s.status} | ${dur} | rpe=${s.rpe ?? 'n/a'} | diff=${s.difficulty ?? 'n/a'}`
        })
        .join('\n')
    : '  (none)'

  const logLines = logRows.length
    ? logRows.map(l => `  sleep=${l.sleepHours ?? 'n/a'}h soreness=${l.soreness ?? 'n/a'}/5`).join('\n')
    : '  (none)'

  return `Summarize week ${weekNumber}.

Sessions:
${sessionLines}

Daily wellness:
${logLines}

Notes: ${weekNotes ?? 'none'}

Call week_summary.`
}

// Summarizes any weeks with weekNumber <= (currentWeekNumber - RECENT_WEEKS)
// that do not already have a week_summary in coaching_outputs.
// Returns the number of weeks summarized.
export async function summarizeOldWeeks(
  db: DB,
  apiKey: string,
  blockId: string,
  currentWeekNumber: number,
): Promise<number> {
  const cutoff = currentWeekNumber - RECENT_WEEKS
  if (cutoff <= 0) return 0

  const [block] = await db.select().from(trainingBlocks).where(eq(trainingBlocks.id, blockId))
  if (!block?.startedAt) return 0

  // startedAt is epoch seconds; logDate/scheduledDate are epoch days
  const blockStartDay = Math.floor(block.startedAt / 86400)

  const weeks = await db
    .select()
    .from(weekPlans)
    .where(and(eq(weekPlans.blockId, blockId), lte(weekPlans.weekNumber, cutoff)))

  if (weeks.length === 0) return 0

  const existing = await db
    .select({ scopeWeekPlanId: coachingOutputs.scopeWeekPlanId })
    .from(coachingOutputs)
    .where(eq(coachingOutputs.kind, 'week_summary'))

  const summarizedIds = new Set(
    existing.map(e => e.scopeWeekPlanId).filter((id): id is string => id !== null),
  )

  const toSummarize = weeks.filter(w => !summarizedIds.has(w.id))
  if (toSummarize.length === 0) return 0

  let count = 0

  for (const week of toSummarize) {
    const weekStartDay = blockStartDay + (week.weekNumber - 1) * 7
    const weekEndDay = weekStartDay + 6

    const [sessionRows, logRows] = await Promise.all([
      db
        .select({
          type: sessions.type,
          status: sessions.status,
          durationSec: sessions.durationSec,
          rpe: sessions.rpe,
          difficulty: sessions.difficulty,
        })
        .from(sessions)
        .where(eq(sessions.weekPlanId, week.id)),
      db
        .select({ sleepHours: dailyLogs.sleepHours, soreness: dailyLogs.soreness })
        .from(dailyLogs)
        .where(and(gte(dailyLogs.logDate, weekStartDay), lte(dailyLogs.logDate, weekEndDay))),
    ])

    const prompt = buildWeekPrompt(week.weekNumber, sessionRows, logRows, week.notes)

    const result = await anthropicCall(apiKey, {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: [cachedSystem(SUMMARIZER_SYSTEM)],
      messages: [{ role: 'user', content: prompt }],
      tools: [WEEK_SUMMARY_TOOL],
      tool_choice: { type: 'tool', name: 'week_summary' },
    })

    if (result.offline) {
      console.warn(`[summarizer] offline, skipping week ${week.weekNumber}`)
      continue
    }

    const output = getToolInput<WeekSummaryOutput>(result, 'week_summary')
    if (!output) {
      console.warn(`[summarizer] no tool output for week ${week.weekNumber}`)
      continue
    }

    await db.insert(coachingOutputs).values({
      id: crypto.randomUUID(),
      kind: 'week_summary',
      model: 'claude-haiku-4-5-20251001',
      scopeWeekPlanId: week.id,
      inputHash: null,
      outputJson: JSON.stringify(output),
      tokensIn: result.usage.input_tokens,
      tokensOut: result.usage.output_tokens,
      cachedTokensIn: result.usage.cache_read_input_tokens ?? 0,
      createdAt: Math.floor(Date.now() / 1000),
    })

    count++
    console.log(`[summarizer] week ${week.weekNumber} done`)
  }

  return count
}

// Returns stored summaries for weeks up to maxWeekNumber. Used when building AI context.
export async function getWeekSummaries(
  db: DB,
  blockId: string,
  maxWeekNumber: number,
): Promise<WeekSummaryOutput[]> {
  const weeks = await db
    .select({ id: weekPlans.id, weekNumber: weekPlans.weekNumber })
    .from(weekPlans)
    .where(and(eq(weekPlans.blockId, blockId), lte(weekPlans.weekNumber, maxWeekNumber)))

  if (weeks.length === 0) return []

  const results: WeekSummaryOutput[] = []

  for (const week of weeks) {
    const [row] = await db
      .select({ outputJson: coachingOutputs.outputJson })
      .from(coachingOutputs)
      .where(and(eq(coachingOutputs.kind, 'week_summary'), eq(coachingOutputs.scopeWeekPlanId, week.id)))

    if (row) {
      try {
        results.push(JSON.parse(row.outputJson) as WeekSummaryOutput)
      } catch {
        console.warn(`[summarizer] malformed summary for week ${week.weekNumber}`)
      }
    }
  }

  return results
}
