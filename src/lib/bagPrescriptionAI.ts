// Bag prescription Haiku call. Prescribes a structured heavy-bag session
// as a coach would, with typed rounds and per-round rationale. Falls back
// to null on AI offline so the caller applies a deterministic template.

import { desc, eq } from 'drizzle-orm'
import { coachingOutputs, combos as combosTable, dailyLogs, exercises, mtClassLogs, sessions, settings, trainingMaxes, userProfile } from '../db/schema'
import { anthropicCall, getToolInput } from './anthropic'
import { buildSystemPrompt, type UserProfileContext } from './prompts/system'
import { getLatestBodyweightKg } from './bodyMetrics'
import { TOOL_BAG_PRESCRIPTION, type BagPrescriptionOutput } from './prompts/tools'
import type { createDB } from '../db/client'
import { MODELS } from './models'
import { governBagRounds, type BagRules } from './coach/bag'
import { poolTag } from './coach/bagArc'

type DB = ReturnType<typeof createDB>

interface BagPrescriptionInput {
  sessionId: string
  todayEpochDay: number
  /** Ease, gap and block rules (lib/coach/bag). The output is held to them too. */
  rules?: BagRules
}

export interface AvailableCombo {
  id: string
  text: string
  tier: string
  techniques: string
  masteryScore: number
  isFavourite: number
  formTips: string | null
  /** Page 80: one he added in the last two weeks (typed or from class): its technique round comes first. */
  isNew?: boolean
}

/** Mastery is the sum of the last five ratings (1-3 each), so it tops out at 15. */
export const MASTERY_MAX = 15

export function summarizeCombo(c: AvailableCombo): string {
  const tips = (c.formTips ?? '').slice(0, 180)
  const tags = c.techniques || '-'
  const fav = c.isFavourite ? ' fav' : ''
  const isNew = c.isNew ? ' NEW' : ''
  return `  - ${c.id} [${c.tier}, ${tags}, mastery ${c.masteryScore}/${MASTERY_MAX}${fav}${isNew}]: ${c.text}${tips ? ` — tips: ${tips}` : ''}`
}

/** Page 80: no two rounds hold the same combos (the first of each kept, renumbered). */
export function distinctRounds<T extends { roundNumber: number; comboIds: string[] }>(rounds: T[]): T[] {
  const seen = new Set<string>()
  return rounds
    .filter(r => {
      const key = [...r.comboIds].sort().join('|')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((r, i) => ({ ...r, roundNumber: i + 1 }))
}

interface MtNoteRow {
  focusSkill: string | null
  weakness: string | null
  concept: string | null
  actionItems: string | null
}

/** One line per class, newest first (rows arrive newest first), at most five with content. */
export function recentMtNoteLines(rows: MtNoteRow[]): string[] {
  return rows
    .map(l => {
      const parts: string[] = []
      if (l.focusSkill) parts.push(`focus: ${l.focusSkill}`)
      if (l.weakness) parts.push(`weakness: ${l.weakness}`)
      if (l.concept) parts.push(`concept: ${l.concept}`)
      if (l.actionItems) parts.push(`action: ${l.actionItems}`)
      return parts.join(' | ').slice(0, 240)
    })
    .filter(s => s.length > 0)
    .slice(0, 5)
}

function buildPrompt(
  available: AvailableCombo[],
  wellness: { sleepHours: number | null; soreness: number | null; herbScale: number | null; alcoholScale: number | null } | null,
  recentMtNotes: string[],
  rules?: BagRules,
): string {
  const lines: string[] = [
    'Prescribe today\'s heavy-bag session. You are this athlete\'s coach.',
    '',
    'Session structure rules (a kru\'s arc for a heavy-bag session):',
    '- Round 1 is always a warmup: basics, the easiest combos he knows best.',
    '- Technique rounds next, while he is fresh (technical_flow or drill_isolation). A combo marked NEW goes here first, alone and slow; the next round pairs it with one more combo he is still learning.',
    '- Pressure rounds after (combo_practice or power): his hardest and longest combos at pace, then elbows and knees.',
    '- Finisher (last round) is conditioning or power based on today state: kicks and knees, the last 30 s all out.',
    '- No two rounds hold the same combos. Pick only from the list below; never make up a combo.',
    '- 4 to 6 rounds total. Prefer 5 for a normal day, 4 when recovery-limited, 6 when fresh.',
    '- At least one drill_isolation round every session to reinforce fundamentals. Cite the Fagan or Sylvie protocol from the chosen combo form_tips in the rationale.',
    '- No freestyle type. The coach prescribes, the athlete does not choose in the round.',
    '- Kick-strong athlete (TKD background). Balance kick work with hand fundamentals. Do not skip the hands.',
    ...(rules ? ['', 'Today the rules set these limits. They override the structure rules above:', ...rules.promptLines] : []),
    '',
    'Available combos (pick comboIds from this list only, by id):',
    ...available.map(summarizeCombo),
    '',
  ]

  if (wellness) {
    const w: string[] = []
    if (wellness.sleepHours != null) w.push(`sleep ${wellness.sleepHours}h`)
    if (wellness.soreness != null) w.push(`soreness ${wellness.soreness}/5`)
    // Herb on the 0-9 check-in scale (0 none, 9 most).
    if (wellness.herbScale != null) w.push(`herb ${wellness.herbScale}/9`)
    if (wellness.alcoholScale != null) w.push(`alcohol ${wellness.alcoholScale}/10`)
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
    })
      .from(mtClassLogs)
      .innerJoin(sessions, eq(mtClassLogs.sessionId, sessions.id))
      // Newest class first: the notes have no date of their own, so the
      // session's day (then its finish time) orders them.
      .orderBy(desc(sessions.scheduledDate), desc(sessions.completedAt))
      .limit(10),
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
      isNew: poolTag(c, Math.floor(Date.now() / 1000)) === 'new',
    }))

  if (available.length === 0) return null

  const recentMtNotes = recentMtNoteLines(mtLogs)

  const latestBodyweightKg = await getLatestBodyweightKg(db)

  const profile: UserProfileContext = {
    goals: profileRow?.goals ?? null,
    injuries: profileRow?.injuries ?? null,
    postureIssues: profileRow?.postureIssues ?? null,
    trainingHistory: profileRow?.trainingHistory ?? null,
    mtClassDays: userSettings?.mtClassDays ?? null,
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
        herbScale: todayLog.herbScale,
        alcoholScale: todayLog.alcoholScale,
      }
    : null
  const prompt = buildPrompt(available, wellness, recentMtNotes, input.rules)

  const result = await anthropicCall(apiKey, {
    model: MODELS.fast,
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
  const rounds = distinctRounds(output.rounds.map((r, idx) => ({
    roundNumber: idx + 1,
    roundType: r.roundType,
    rationale: r.rationale,
    comboIds: r.comboIds.filter(id => availableIds.has(id)),
  })).filter(r => r.comboIds.length > 0))
  const sanitized: BagPrescriptionOutput = {
    sessionIntent: output.sessionIntent,
    // The rules win over the model: finishers out, round count capped.
    rounds: input.rules ? governBagRounds(rounds, input.rules) as typeof rounds : rounds,
  }

  if (sanitized.rounds.length < 3) {
    console.warn('[bagPrescription] too few valid rounds after sanitize')
    return null
  }

  await db.insert(coachingOutputs).values({
    id: crypto.randomUUID(),
    kind: 'bag_prescription',
    model: MODELS.fast,
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
