// Bag prescription Haiku call. Prescribes a structured heavy-bag session
// as a coach would, with typed rounds and per-round rationale. Falls back
// to null on AI offline so the caller applies a deterministic template.

import { eq } from 'drizzle-orm'
import { coachingOutputs, combos as combosTable, dailyLogs, exercises, mtClassLogs, settings, trainingMaxes, userProfile } from '../db/schema'
import { anthropicCall, getToolInput } from './anthropic'
import { buildSystemPrompt, type UserProfileContext } from './prompts/system'
import { getLatestBodyweightKg } from './bodyMetrics'
import { TOOL_BAG_PRESCRIPTION, type BagPrescriptionOutput } from './prompts/tools'
import type { createDB } from '../db/client'

type DB = ReturnType<typeof createDB>

interface BagPrescriptionInput {
  sessionId: string
  todayEpochDay: number
}

interface AvailableCombo {
  id: string
  text: string
  tier: string
  techniques: string
  masteryScore: number
  isFavourite: number
  formTips: string | null
}

function summarizeCombo(c: AvailableCombo): string {
  const tips = (c.formTips ?? '').slice(0, 180)
  const tags = c.techniques || '-'
  const fav = c.isFavourite ? ' fav' : ''
  return `  - ${c.id} [${c.tier}, ${tags}, mastery ${c.masteryScore}/10${fav}]: ${c.text}${tips ? ` — tips: ${tips}` : ''}`
}

function buildPrompt(
  available: AvailableCombo[],
  wellness: { sleepHours: number | null; soreness: number | null; weedGrams: number | null; alcoholScale: number | null } | null,
  recentMtNotes: string[],
): string {
  const lines: string[] = [
    'Prescribe today\'s heavy-bag session. You are this athlete\'s coach.',
    '',
    'Session structure rules:',
    '- Round 1 is always a warmup.',
    '- Finisher (last round) is conditioning or power based on today state.',
    '- 4 to 6 rounds total. Prefer 5 for a normal day, 4 when recovery-limited, 6 when fresh.',
    '- At least one drill_isolation round every session to reinforce fundamentals. Cite the Fagan or Sylvie protocol from the chosen combo form_tips in the rationale.',
    '- No freestyle type. The coach prescribes, the athlete does not choose in the round.',
    '- Kick-strong athlete (TKD background). Balance kick work with hand fundamentals. Do not skip the hands.',
    '',
    'Available combos (pick comboIds from this list only, by id):',
    ...available.map(summarizeCombo),
    '',
  ]

  if (wellness) {
    const w: string[] = []
    if (wellness.sleepHours != null) w.push(`sleep ${wellness.sleepHours}h`)
    if (wellness.soreness != null) w.push(`soreness ${wellness.soreness}/5`)
    if (wellness.weedGrams != null) w.push(`weed ${wellness.weedGrams}g`)
    if (wellness.alcoholScale != null) w.push(`alcohol ${wellness.alcoholScale}/5`)
    if (w.length > 0) lines.push(`Today wellness: ${w.join(', ')}.`)
  }

  if (recentMtNotes.length > 0) {
    lines.push('')
    lines.push('Recent MT class notes (what the coach saw this week):')
    for (const n of recentMtNotes) lines.push(`  - ${n}`)
  }

  lines.push('')
  lines.push('Output using the bagPrescription tool. sessionIntent is one line. Each round has roundType, one-sentence rationale (voice canon), and comboIds from the available list.')

  return lines.join('\n')
}

export async function runBagPrescription(
  db: DB,
  apiKey: string,
  input: BagPrescriptionInput,
): Promise<BagPrescriptionOutput | null> {
  const [profileRow, tmRows, userSettings, todayLog, mtLogs, allUnlocked] = await Promise.all([
    db.select().from(userProfile).limit(1).then(rows => rows[0] ?? null),
    db
      .select({ weightKg: trainingMaxes.weightKg, name: exercises.name })
      .from(trainingMaxes)
      .innerJoin(exercises, eq(trainingMaxes.exerciseId, exercises.id)),
    db.select().from(settings).limit(1).then(rows => rows[0] ?? null),
    db.select().from(dailyLogs).where(eq(dailyLogs.logDate, input.todayEpochDay)).limit(1).then(rows => rows[0] ?? null),
    db.select({
      focusSkill: mtClassLogs.focusSkill,
      weakness: mtClassLogs.weakness,
      concept: mtClassLogs.concept,
      actionItems: mtClassLogs.actionItems,
    }).from(mtClassLogs).limit(10),
    db.select().from(combosTable).where(eq(combosTable.unlocked, 1)),
  ])

  const enabledTechniques = new Set((userSettings?.enabledTechniques ?? 'boxing,kicks,defensive').split(',').filter(Boolean))
  const available: AvailableCombo[] = allUnlocked
    .filter(c => {
      const techs = (c.techniques ?? '').split(',').filter(Boolean)
      return techs.length === 0 || techs.every(t => enabledTechniques.has(t))
    })
    .map(c => ({
      id: c.id,
      text: c.text,
      tier: c.tier,
      techniques: c.techniques,
      masteryScore: c.masteryScore,
      isFavourite: c.isFavourite,
      formTips: c.formTips,
    }))

  if (available.length === 0) return null

  const recentMtNotes: string[] = mtLogs
    .slice(-5)
    .map(l => {
      const parts: string[] = []
      if (l.focusSkill) parts.push(`focus: ${l.focusSkill}`)
      if (l.weakness) parts.push(`weakness: ${l.weakness}`)
      if (l.concept) parts.push(`concept: ${l.concept}`)
      if (l.actionItems) parts.push(`action: ${l.actionItems}`)
      return parts.join(' | ').slice(0, 240)
    })
    .filter(s => s.length > 0)

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
  const wellness = todayLog
    ? {
        sleepHours: todayLog.sleepHours,
        soreness: todayLog.soreness,
        weedGrams: todayLog.weedGrams,
        alcoholScale: todayLog.alcoholScale,
      }
    : null
  const prompt = buildPrompt(available, wellness, recentMtNotes)

  const result = await anthropicCall(apiKey, {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: systemBlocks,
    messages: [{ role: 'user', content: prompt }],
    tools: [TOOL_BAG_PRESCRIPTION],
    tool_choice: { type: 'tool', name: 'bagPrescription' },
  })

  if (result.offline) {
    console.warn('[bagPrescription] offline')
    return null
  }

  const output = getToolInput<BagPrescriptionOutput>(result, 'bagPrescription')
  if (!output) {
    console.warn('[bagPrescription] no tool output')
    return null
  }

  const availableIds = new Set(available.map(c => c.id))
  const sanitized: BagPrescriptionOutput = {
    sessionIntent: output.sessionIntent,
    rounds: output.rounds.map((r, idx) => ({
      roundNumber: idx + 1,
      roundType: r.roundType,
      rationale: r.rationale,
      comboIds: r.comboIds.filter(id => availableIds.has(id)),
    })).filter(r => r.comboIds.length > 0),
  }

  if (sanitized.rounds.length < 3) {
    console.warn('[bagPrescription] too few valid rounds after sanitize')
    return null
  }

  await db.insert(coachingOutputs).values({
    id: crypto.randomUUID(),
    kind: 'bag_prescription',
    model: 'claude-haiku-4-5-20251001',
    scopeWeekPlanId: null,
    scopeSessionId: input.sessionId,
    inputHash: null,
    outputJson: JSON.stringify(sanitized),
    tokensIn: result.usage.input_tokens,
    tokensOut: result.usage.output_tokens,
    cachedTokensIn: result.usage.cache_read_input_tokens ?? 0,
    createdAt: Math.floor(Date.now() / 1000),
  })

  return sanitized
}
