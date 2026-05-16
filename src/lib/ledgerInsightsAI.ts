// Ledger insights via Haiku. Replaces the rule-based strings from insightEngine.ts.
// Returns ordered text[] by priority. Offline fallback returns null so caller can
// revert to the local rule-based generator.

import { eq } from 'drizzle-orm'
import { coachingOutputs, exercises, trainingMaxes, userProfile } from '../db/schema'
import { anthropicCall, getToolInputs } from './anthropic'
import { buildSystemPrompt, type UserProfileContext } from './prompts/system'
import { getLatestBodyweightKg } from './bodyMetrics'
import { TOOL_INSIGHT, type InsightOutput } from './prompts/tools'
import { kgToLbsDisplay, paceToMinSec } from './chartTheme'
import type { createDB } from '../db/client'
import type { RoadBootcampMetrics } from './roadBootcampMetrics'

type DB = ReturnType<typeof createDB>

export interface LedgerInsightData {
  dashboard: {
    currentStreak: number
    prsThisMonth: number
    completionRate: number
    topLift: { name: string; weightLbs: number } | null
    thisWeek: { volume: number; sessions: number; avgRpe: number | null; avgSleep: number | null }
    lastWeek: { volume: number; sessions: number; avgRpe: number | null; avgSleep: number | null }
  } | null
  consistency: {
    currentStreak: number
    longestStreak: number
    weeks: { sessionsCompleted: number; sessionsPlanned: number }[]
  } | null
  prs: { exerciseName: string; maxWeightKg: number; date: string; previousMaxKg: number | null }[]
  correlations: { sleepHours: number | null; avgRpe: number | null; sessionCount: number }[]
  runSummary: { totalRuns: number; totalDistanceKm: number; avgPaceSecKm: number | null; bestPaceSecKm: number | null } | null
  recentRunEvidence?: Array<{
    date: string
    runType: string | null
    source: string | null
    distanceKm: number | null
    paceSecKm: number | null
    avgHr: number | null
    maxHr: number | null
    elevationGainM: number | null
    zoneSeconds: string | null
    reviewFlag: string | null
  }> | null
  roadBootcampMetrics?: RoadBootcampMetrics | null
  categoryCompletion: Record<string, { completed: number; target: number }> | null
}

function formatDashboard(d: LedgerInsightData['dashboard']): string {
  if (!d) return 'Ledger summary: no data.'
  const tw = d.thisWeek
  const lw = d.lastWeek
  return [
    `Ledger summary: ${d.currentStreak}-day streak. Completion ${d.completionRate}%. PRs this month: ${d.prsThisMonth}.`,
    `This week: ${tw.sessions} sessions, volume ${Math.round(tw.volume)} lb, RPE ${tw.avgRpe ?? '?'}, sleep ${tw.avgSleep ?? '?'}h.`,
    `Last week: ${lw.sessions} sessions, volume ${Math.round(lw.volume)} lb, RPE ${lw.avgRpe ?? '?'}, sleep ${lw.avgSleep ?? '?'}h.`,
    d.topLift ? `Top lift: ${d.topLift.name} ${d.topLift.weightLbs} lb.` : 'Top lift: none recorded.',
  ].join('\n')
}

function formatConsistency(c: LedgerInsightData['consistency']): string {
  if (!c) return 'Consistency: no data.'
  const recent = c.weeks.slice(-6).map(w => `${w.sessionsCompleted}/${w.sessionsPlanned}`).join(', ')
  return `Consistency: current streak ${c.currentStreak}, longest ${c.longestStreak}. Recent weeks (completed/planned): ${recent || 'none'}.`
}

function formatPRs(prs: LedgerInsightData['prs']): string {
  if (prs.length === 0) return 'PRs: none recorded.'
  const recent = [...prs]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5)
  const lines = recent.map(p => {
    const lbs = kgToLbsDisplay(p.maxWeightKg)
    const prev = p.previousMaxKg ? ` (was ${kgToLbsDisplay(p.previousMaxKg)} lb)` : ''
    return `  ${p.exerciseName} ${lbs} lb on ${p.date}${prev}`
  })
  return `PRs:\n${lines.join('\n')}`
}

function formatCorrelations(corr: LedgerInsightData['correlations']): string {
  if (corr.length === 0) return 'Correlations: no data.'
  const withSleep = corr.filter(c => c.sleepHours != null && c.avgRpe != null)
  if (withSleep.length === 0) return `Correlations: ${corr.length} days logged, no sleep/RPE pairs.`
  const good = withSleep.filter(c => c.sleepHours! >= 7)
  const poor = withSleep.filter(c => c.sleepHours! < 6)
  const avg = (arr: typeof withSleep) => arr.length ? (arr.reduce((s, c) => s + c.avgRpe!, 0) / arr.length).toFixed(1) : '?'
  return `Correlations: ${withSleep.length} days with sleep+RPE. 7+h sleep avg RPE ${avg(good)} (${good.length} days). <6h sleep avg RPE ${avg(poor)} (${poor.length} days).`
}

function formatRunSummary(r: LedgerInsightData['runSummary']): string {
  if (!r || r.totalRuns === 0) return 'Running: no runs.'
  const avg = r.avgPaceSecKm ? paceToMinSec(r.avgPaceSecKm) : '?'
  const best = r.bestPaceSecKm ? paceToMinSec(r.bestPaceSecKm) : '?'
  return `Running: ${r.totalRuns} runs, ${r.totalDistanceKm.toFixed(1)} km total. Avg pace ${avg}/km, best ${best}/km.`
}

function formatRecentRunEvidence(runs: LedgerInsightData['recentRunEvidence']): string {
  if (!runs || runs.length === 0) return 'Recent run evidence: none.'
  const lines = runs.slice(0, 5).map(run => {
    const source = run.source === 'strava' ? 'Strava' : run.source ?? 'manual'
    const distance = run.distanceKm != null ? `${run.distanceKm.toFixed(2)} km` : 'distance not recorded'
    const pace = run.paceSecKm != null ? `${paceToMinSec(run.paceSecKm)}/km` : 'pace not recorded'
    const avgHr = run.avgHr != null ? `avg HR ${run.avgHr}` : 'avg HR not recorded'
    const maxHr = run.maxHr != null ? `max ${run.maxHr}` : 'max not recorded'
    const elevation = run.elevationGainM != null ? `elevation ${run.elevationGainM} m` : 'elevation not recorded'
    const zones = run.zoneSeconds ? `zones ${run.zoneSeconds}` : 'zones not recorded'
    const flag = run.reviewFlag ? `flag ${run.reviewFlag}` : 'flag none'
    return `  ${run.date} ${run.runType ?? 'run'} from ${source}: ${distance}, ${pace}, ${avgHr}, ${maxHr}, ${elevation}, ${zones}, ${flag}.`
  })
  return `Recent run evidence:\n${lines.join('\n')}`
}

function formatDistribution(values: Record<string, number>): string {
  const entries = Object.entries(values)
  if (entries.length === 0) return 'none'
  return entries.map(([key, count]) => `${key}: ${count}`).join(', ')
}

function formatRoadBootcamp(r: LedgerInsightData['roadBootcampMetrics']): string {
  if (!r) return 'Road Bootcamp: no active road data.'
  return [
    `Road Bootcamp: completion ${r.completionRate}%.`,
    `Running minutes: ${r.runMinutes}. Easy ${r.easyRunMinutes}. Quality ${r.qualityRunMinutes}.`,
    `Strength sessions: ${r.strengthCompleted}. Time choices: ${formatDistribution(r.strengthTimeDistribution)}. Equipment: ${formatDistribution(r.equipmentDistribution)}.`,
    `Rope sessions: ${r.ropeCompleted}. Sleep ${r.avgSleep ?? '?'}h. Soreness ${r.avgSoreness ?? '?'}.`,
  ].join('\n')
}

function formatCategoryCompletion(cc: LedgerInsightData['categoryCompletion']): string {
  if (!cc) return 'Category rings: no data.'
  const entries = Object.entries(cc).map(([k, v]) => `${k}: ${v.completed}/${v.target}`)
  return `Category rings: ${entries.join(', ')}.`
}

export function buildLedgerInsightPrompt(data: LedgerInsightData): string {
  const lines: string[] = [
    formatDashboard(data.dashboard),
    formatConsistency(data.consistency),
    formatPRs(data.prs),
    formatCorrelations(data.correlations),
    formatRunSummary(data.runSummary),
    formatRecentRunEvidence(data.recentRunEvidence),
    formatRoadBootcamp(data.roadBootcampMetrics),
    formatCategoryCompletion(data.categoryCompletion),
    '',
    'Write 2 to 4 ledger insights using the insight tool. One tool call per insight.',
    'Voice canon: observation before instruction, numbers stated plainly, never congratulate, no exclamation marks, no emoji.',
    'Only surface what the data supports. If nothing is notable, return one insight noting that.',
    'Use recent run evidence only for bounded patterns. Do not overfit one run.',
    'Priority 1 = surface first. Keep each text short, one sentence, no em dashes.',
  ]
  return lines.join('\n')
}

export async function runLedgerInsights(
  db: DB,
  apiKey: string,
  data: LedgerInsightData,
): Promise<string[] | null> {
  const [profileRow, tmRows] = await Promise.all([
    db.select().from(userProfile).limit(1).then(rows => rows[0] ?? null),
    db
      .select({ weightKg: trainingMaxes.weightKg, name: exercises.name })
      .from(trainingMaxes)
      .innerJoin(exercises, eq(trainingMaxes.exerciseId, exercises.id)),
  ])

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
  const prompt = buildLedgerInsightPrompt(data)

  const result = await anthropicCall(apiKey, {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: systemBlocks,
    messages: [{ role: 'user', content: prompt }],
    tools: [TOOL_INSIGHT],
    tool_choice: { type: 'any' },
  })

  if (result.offline) {
    console.info('[ledgerInsights] offline. Using local fallback.')
    return null
  }

  const outputs = getToolInputs<InsightOutput>(result, 'insight')
  if (outputs.length === 0) {
    console.warn('[ledgerInsights] no tool outputs')
    return null
  }

  await db.insert(coachingOutputs).values({
    id: crypto.randomUUID(),
    kind: 'ledger_insights',
    model: 'claude-haiku-4-5-20251001',
    scopeWeekPlanId: null,
    scopeSessionId: null,
    inputHash: null,
    outputJson: JSON.stringify(outputs),
    tokensIn: result.usage.input_tokens,
    tokensOut: result.usage.output_tokens,
    cachedTokensIn: result.usage.cache_read_input_tokens ?? 0,
    createdAt: Math.floor(Date.now() / 1000),
  })

  return outputs
    .slice()
    .sort((a, b) => a.priority - b.priority)
    .map(o => o.text)
}
