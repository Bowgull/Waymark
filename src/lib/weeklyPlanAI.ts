// Haiku-based weekly plan generation. Replaces the rule-based weekAnalysis engine.
// Falls back to null on AI offline so the route can use the template fallback.

import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { coachingOutputs, dailyLogs, exercises, journalEntries, mtClassLogs, sessions, trainingMaxes, userProfile } from '../db/schema'
import { anthropicCall, getToolInput } from './anthropic'
import { buildSystemPrompt, type UserProfileContext } from './prompts/system'
import { computeStarterStatus, serializeStarterStatus } from './starterStatus'
import { getLatestBodyweightKg } from './bodyMetrics'
import { TOOL_WEEK_PLAN, type BodyIssueDetection, type WeekPlanOutput } from './prompts/tools'
import { getWeekSummaries } from './prompts/summarizer'
import { computeBlockAdherence, deriveGuidance, serializeAdherenceForPrompt } from './adherence'
import { computeHrSnapshot, loadEasyHrCeiling, loadProfileMaxHrForHr, loadRecentRunsForHr, serializeHrForPrompt } from './hrAnalysis'
import { rolloverStaleSessions } from './sessionRollover'
import { getEpochDay, serverRolloverDay } from './dates'
import type { createDB } from '../db/client'
import { MODELS } from './models'
import { clampsForStorage, guardWeekPlan, logClamps, serializeBlockZeroContext } from './blockZero'
import { loadBlockZeroAiContext, loadRunHistory } from '../server/blockZeroData'

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

// Mirrors src/lib/blockZero/weekPlan.ts. blockWeek here is the training week
// (extension weeks arrive as 5). MT classes are never scheduled in Block Zero;
// the route drops any the model returns.
function blockZeroPhaseNote(blockWeek: number): string {
  const shape = 'Shape: Strength A/B/C Mon/Wed/Fri, run-walk (foundation_run) Tue/Thu/Sat, daily back-care mobility, Sunday no training. Never schedule mt_class.'
  if (blockWeek <= 1) return `Week 1 test week: strength works up to a set of 8 at RPE 6-7, run-walk at talk-test pace, a 20-min rope piece Monday. ${shape}`
  if (blockWeek >= 6) return `Week 6 consolidate and retest: volume down 30-50%, intensity held, retest sets of 3-5. ${shape}`
  return `Build week ${blockWeek}: strength RPE ${blockWeek <= 2 ? '6-7' : '7-8'}, never to failure. Run-walk grows under the 110% single-run and 30% weekly caps. ${shape}`
}

export interface MtLogRecord {
  classType: string | null
  focusSkill: string | null
  weakness: string | null
  concept: string | null
  actionItems: string | null
}

export interface TrackedIssue {
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

export function buildWeekPlanPrompt(
  params: WeekPlanParams,
  prevSessions: Array<{ type: string; status: string; rpe: number | null; notes: string | null }>,
  prevLogs: Array<{ sleepHours: number | null; soreness: number | null; notes: string | null }>,
  compressedNote: string,
  prevMtLogs: MtLogRecord[],
  prevJournal: string[],
  trackedIssues: TrackedIssue[],
  adherenceBlock: string,
  hrBlock: string | null,
  blockZeroContext: string | null = null,
): string {
  const lines: string[] = [
    `Generate week plan for week ${params.weekNumber} (block week ${params.blockWeek}).`,
    '',
  ]

  if (params.isBlockZero) {
    lines.push(`Block type: Block Zero. ${blockZeroPhaseNote(params.blockWeek)}`)
    if (blockZeroContext) {
      lines.push('', blockZeroContext)
      lines.push('For each session that differs from the rules\' week, put its one-line why in that session\'s notes. Put the week\'s why in adjustmentNotes.')
    }
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
      if (s.rpe != null) parts.push(`Effort ${s.rpe}/10`)
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

  if (adherenceBlock) {
    lines.push('', adherenceBlock)
    lines.push('Shape this week around the adherence signal above. If a deload is called for, reflect it in session counts, intensities, and the narrative. Never mention missed sessions or adherence directly to the user.')
  }

  if (hrBlock) {
    lines.push('', hrBlock)
    lines.push('Factor the HR signal into run prescriptions. Over-paced easy runs mean the next easy prescription needs a firm HR ceiling. HR drift at same pace means reduce intensity this week, not volume.')
  }

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
      .select({ type: sessions.type, status: sessions.status, rpe: sessions.rpe, notes: sessions.notes })
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

  // Adherence: roll stale sessions, then read block-wide signal so the coach
  // can deload-on-return, extend base work, or rescale volume silently.
  const todayEpochDay = getEpochDay(new Date())
  // No local date here: roll over only days that have ended everywhere.
  await rolloverStaleSessions(db, serverRolloverDay())
  const adherence = await computeBlockAdherence(db, params.blockId, todayEpochDay)
  const guidance = deriveGuidance(adherence)
  const adherenceBlock = serializeAdherenceForPrompt(adherence, guidance)

  // HR signal (zone-2 compliance + drift). Silent omission if no HR recorded.
  const recentRuns = await loadRecentRunsForHr(db, todayEpochDay)
  const maxHr = await loadProfileMaxHrForHr(db)
  const hrSnapshot = computeHrSnapshot(recentRuns, todayEpochDay, { maxHr, ceilingBpm: (await loadEasyHrCeiling(db, todayEpochDay)).bpm })
  const hrBlock = serializeHrForPrompt(hrSnapshot)

  const starter = await computeStarterStatus(db, todayEpochDay, profile.trainingHistory, profile.constraints)
  const starterBlock = serializeStarterStatus(starter)
  const systemBlocks = buildSystemPrompt(profile, null, starterBlock || null)
  // Block Zero: the rules' limits and the athlete's trends go in the user
  // message (after the cached system blocks), and the output is guarded.
  const mondayEpochDay = params.prevWeekEnd + 1
  const bzInput = params.isBlockZero ? await loadBlockZeroAiContext(db, todayEpochDay, params.weekNumber) : null
  const bzContext = bzInput ? serializeBlockZeroContext(bzInput) : null
  const prompt = buildWeekPlanPrompt(params, prevSessions, prevLogs, compressedNote, prevMtLogs, prevJournal, trackedIssues, adherenceBlock, hrBlock, bzContext)

  const result = await anthropicCall(apiKey, {
    model: MODELS.fast,
    max_tokens: 4096,
    system: systemBlocks,
    messages: [{ role: 'user', content: prompt }],
    tools: [TOOL_WEEK_PLAN],
    tool_choice: { type: 'tool', name: 'weekPlan' },
  })

  if (result.offline) {
    console.warn('[weeklyPlan] offline, falling back to rule engine')
    return null
  }

  const raw = getToolInput<WeekPlanOutput>(result, 'weekPlan')
  if (!raw) {
    console.warn('[weeklyPlan] no tool output, falling back to rule engine')
    return null
  }

  let output = raw
  let guardrails: ReturnType<typeof clampsForStorage> & { original?: WeekPlanOutput } | null = null
  if (params.isBlockZero) {
    const guarded = guardWeekPlan(raw, { weekNumber: params.weekNumber, run: await loadRunHistory(db, mondayEpochDay) })
    logClamps('week_plan', guarded.clamps)
    output = guarded.output
    guardrails = { ...clampsForStorage(guarded.clamps), ...(guarded.clamps.length > 0 ? { original: raw } : {}) }
  }

  const nowSec = Math.floor(Date.now() / 1000)

  await db.insert(coachingOutputs).values({
    id: crypto.randomUUID(),
    kind: 'week_plan',
    model: MODELS.fast,
    scopeWeekPlanId: params.weekId,
    scopeSessionId: null,
    inputHash: null,
    outputJson: JSON.stringify(guardrails ? { ...output, guardrails } : output),
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
      model: MODELS.fast,
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
