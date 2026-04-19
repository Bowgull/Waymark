// Haiku-based weekly plan generation. Replaces the rule-based weekAnalysis engine.
// Falls back to null on AI offline so the route can use the template fallback.

import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { coachingOutputs, dailyLogs, exercises, journalEntries, mtClassLogs, sessions, trainingMaxes, userProfile } from '../db/schema'
import { anthropicCall, getToolInput } from './anthropic'
import { buildSystemPrompt, type UserProfileContext } from './prompts/system'
import { getLatestBodyweightKg } from './bodyMetrics'
import { TOOL_WEEK_PLAN, type BodyIssueDetection, type WeekPlanOutput } from './prompts/tools'
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
  if (blockWeek <= 2) return 'Phase 1 (weeks 1-2): no MT class. Foundation run, strength, bag work only. Daily mobility every AM.'
  if (blockWeek <= 4) return 'Phase 2 (weeks 3-4): MT class returns Mon/Wed/Fri PM. Strength climbing to 50-55%. Daily mobility every AM.'
  return 'Phase 3 (weeks 5-6): full schedule. Weights at 55-60%. Transition readiness building. Daily mobility every AM.'
}

interface MtLogRecord {
  classType: string | null
  focusSkill: string | null
  weakness: string | null
  concept: string | null
  actionItems: string | null
}

interface TrackedIssue {
  region: string
  lastSeenWeek: number
  mentionsLast4Weeks: number
}

interface StoredBodyIssuesEntry {
  weekNumber: number
  detections: BodyIssueDetection[]
}

function rollupTrackedIssues(
  rows: Array<{ outputJson: string; createdAt: number }>,
  currentWeekNumber: number,
): TrackedIssue[] {
  const counts = new Map<string, { mentions: number; lastSeenWeek: number }>()
  for (const row of rows) {
    let parsed: StoredBodyIssuesEntry | null = null
    try {
      parsed = JSON.parse(row.outputJson) as StoredBodyIssuesEntry
    } catch {
      continue
    }
    if (!parsed || !Array.isArray(parsed.detections)) continue
    for (const d of parsed.detections) {
      const region = d.region?.trim().toLowerCase()
      if (!region) continue
      const existing = counts.get(region)
      if (existing) {
        existing.mentions += 1
        existing.lastSeenWeek = Math.max(existing.lastSeenWeek, parsed.weekNumber)
      } else {
        counts.set(region, { mentions: 1, lastSeenWeek: parsed.weekNumber })
      }
    }
  }

  const tracked: TrackedIssue[] = []
  for (const [region, info] of counts) {
    const weeksSilent = currentWeekNumber - 1 - info.lastSeenWeek
    if (weeksSilent >= 3) continue
    tracked.push({
      region,
      lastSeenWeek: info.lastSeenWeek,
      mentionsLast4Weeks: info.mentions,
    })
  }
  tracked.sort((a, b) => b.mentionsLast4Weeks - a.mentionsLast4Weeks)
  return tracked
}

function mergeActiveInjuries(
  tracked: TrackedIssue[],
  newDetections: BodyIssueDetection[],
  currentWeekNumber: number,
): { injuriesText: string | null; promoted: string[] } {
  const counts = new Map<string, { mentions: number; lastSeenWeek: number; severity: BodyIssueDetection['severity'] }>()

  for (const t of tracked) {
    counts.set(t.region, {
      mentions: t.mentionsLast4Weeks,
      lastSeenWeek: t.lastSeenWeek,
      severity: 'mild',
    })
  }

  for (const d of newDetections) {
    const region = d.region?.trim().toLowerCase()
    if (!region) continue
    const existing = counts.get(region)
    if (existing) {
      existing.mentions += 1
      existing.lastSeenWeek = currentWeekNumber
      if (rankSeverity(d.severity) > rankSeverity(existing.severity)) existing.severity = d.severity
    } else {
      counts.set(region, { mentions: 1, lastSeenWeek: currentWeekNumber, severity: d.severity })
    }
  }

  const promoted: string[] = []
  for (const [region, info] of counts) {
    const weeksSilent = currentWeekNumber - info.lastSeenWeek
    if (weeksSilent >= 3) continue
    if (info.mentions >= 2 || info.severity === 'severe') {
      promoted.push(`${region} (${info.severity})`)
    }
  }
  promoted.sort()
  return {
    injuriesText: promoted.length > 0 ? promoted.join(', ') : null,
    promoted,
  }
}

function rankSeverity(s: BodyIssueDetection['severity']): number {
  if (s === 'severe') return 3
  if (s === 'moderate') return 2
  return 1
}

function buildPrompt(
  params: WeekPlanParams,
  prevSessions: Array<{ type: string; status: string; rpe: number | null; difficulty: number | null; notes: string | null }>,
  prevLogs: Array<{ sleepHours: number | null; soreness: number | null; notes: string | null }>,
  compressedNote: string,
  prevMtLogs: MtLogRecord[],
  prevJournal: string[],
  trackedIssues: TrackedIssue[],
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
      const row = parts.join(', ') || 'no data'
      lines.push(`  ${row}${l.notes ? `. ${l.notes}` : ''}`)
    }
  } else {
    lines.push('  none logged')
  }

  if (prevJournal.length > 0) {
    lines.push('', 'Previous week journal entries:')
    for (const entry of prevJournal) {
      lines.push(`  ${entry}`)
    }
  }

  if (trackedIssues.length > 0) {
    lines.push('', 'Body regions already on file (from prior weeks):')
    for (const t of trackedIssues) {
      lines.push(`  ${t.region} (${t.mentionsLast4Weeks} mention(s) in last 4 weeks, last seen week ${t.lastSeenWeek})`)
    }
    lines.push('When filling bodyIssuesDetected, reuse the same region strings so roll-up counts stay consistent.')
  }

  lines.push(
    '',
    'Scan the notes above for mentions of pain, soreness beyond normal training, stiffness, tweaks, or movement limitations.',
    'Only populate bodyIssuesDetected when an athlete explicitly surfaces a body signal. Do not invent or infer.',
    'If nothing relevant surfaced, omit bodyIssuesDetected entirely.',
  )

  if (prevMtLogs.length > 0) {
    lines.push('', 'MT class logs (recent sessions):')
    for (const log of prevMtLogs) {
      const parts: string[] = []
      if (log.classType) parts.push(log.classType)
      if (log.focusSkill) parts.push(`focus: ${log.focusSkill}`)
      if (log.weakness) parts.push(`weakness: ${log.weakness}`)
      lines.push(`  ${parts.join(' | ')}`)
      if (log.concept) lines.push(`    concept: ${log.concept}`)
      if (log.actionItems) lines.push(`    action items: ${log.actionItems}`)
    }
    lines.push('Use these to tailor MT session focus notes for next week.')
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

  const summaries = await getWeekSummaries(db, params.blockId, params.weekNumber - 1)
  const compressedNote = summaries.length > 0
    ? 'Older weeks (compressed):\n' +
      summaries.map(s => `  Week ${s.weekNumber}: ${s.narrative} ${s.adherence}. ${s.wellnessTrend}`).join('\n')
    : ''

  const fourWeeksAgo = params.prevWeekStart - 28 * 86400

  const [prevSessions, prevLogs, prevMtLogs, prevJournalRows, priorBodyIssueRows] = await Promise.all([
    db
      .select({ type: sessions.type, status: sessions.status, rpe: sessions.rpe, difficulty: sessions.difficulty, notes: sessions.notes })
      .from(sessions)
      .where(and(gte(sessions.scheduledDate, params.prevWeekStart), lte(sessions.scheduledDate, params.prevWeekEnd))),
    db
      .select({ sleepHours: dailyLogs.sleepHours, soreness: dailyLogs.soreness, notes: dailyLogs.notes })
      .from(dailyLogs)
      .where(and(gte(dailyLogs.logDate, params.prevWeekStart), lte(dailyLogs.logDate, params.prevWeekEnd))),
    db
      .select({
        classType: mtClassLogs.classType,
        focusSkill: mtClassLogs.focusSkill,
        weakness: mtClassLogs.weakness,
        concept: mtClassLogs.concept,
        actionItems: mtClassLogs.actionItems,
      })
      .from(mtClassLogs)
      .innerJoin(sessions, eq(mtClassLogs.sessionId, sessions.id))
      .where(and(gte(sessions.scheduledDate, params.prevWeekStart), lte(sessions.scheduledDate, params.prevWeekEnd))),
    db
      .select({ content: journalEntries.content, type: journalEntries.type })
      .from(journalEntries)
      .where(and(gte(journalEntries.date, params.prevWeekStart), lte(journalEntries.date, params.prevWeekEnd))),
    db
      .select({ outputJson: coachingOutputs.outputJson, createdAt: coachingOutputs.createdAt })
      .from(coachingOutputs)
      .where(and(eq(coachingOutputs.kind, 'body_issues'), gte(coachingOutputs.createdAt, fourWeeksAgo)))
      .orderBy(desc(coachingOutputs.createdAt)),
  ])

  const prevJournal: string[] = prevJournalRows
    .map(r => r.content?.trim())
    .filter((c): c is string => !!c && c.length > 0)

  const trackedIssues = rollupTrackedIssues(priorBodyIssueRows, params.weekNumber)

  const systemBlocks = buildSystemPrompt(profile, null)
  const prompt = buildPrompt(params, prevSessions, prevLogs, compressedNote, prevMtLogs, prevJournal, trackedIssues)

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

  const nowSec = Math.floor(Date.now() / 1000)

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
    createdAt: nowSec,
  })

  const detections = output.bodyIssuesDetected ?? []
  if (detections.length > 0) {
    await db.insert(coachingOutputs).values({
      id: crypto.randomUUID(),
      kind: 'body_issues',
      model: 'claude-haiku-4-5-20251001',
      scopeWeekPlanId: params.weekId,
      scopeSessionId: null,
      inputHash: null,
      outputJson: JSON.stringify({ weekNumber: params.weekNumber, detections } satisfies StoredBodyIssuesEntry),
      tokensIn: 0,
      tokensOut: 0,
      cachedTokensIn: 0,
      createdAt: nowSec,
    })
  }

  const { promoted } = mergeActiveInjuries(trackedIssues, detections, params.weekNumber)

  console.log(`[weeklyPlan] week ${params.weekNumber} generated (mt=${output.mtSessionsThisWeek}, bodyIssues=${detections.length}, active=${promoted.length})`)
  return output
}
