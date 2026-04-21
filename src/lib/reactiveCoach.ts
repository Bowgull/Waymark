// Event-driven reactive replan. Listens for meaningful signals mid-week and
// produces a WeekAdjustment of type 'reactive' silently. No decision prompts,
// no user-facing friction. The coach adjusts; the user sees a smarter plan.
//
// Triggers:
//  - session_completed: HR drift or over-paced zone-2 on the just-finished run,
//    or an MT class completed when a different type was prescribed.
//  - session_skipped: the athlete skipped. Reshape the rest of the week.
//  - session_replaced: replacement just landed. Redistribute the cascade.
//  - wellness_logged: sleep/soreness crossed an overreach threshold.
//  - rollover: two or more consecutive planned days flipped to missed.
//
// Cost safety:
//  - One Haiku call per trigger, never Sonnet.
//  - Debounced per 2h window via coachingOutputs(kind='reactive_replan').
//  - Pre-filter gates: if no rule fires, we skip the AI call entirely.
//  - Fails closed: Haiku offline -> no adjustment, the weekly plan still stands.

import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { coachingOutputs, dailyLogs, exercises, sessions, trainingMaxes, userProfile, weekAdjustments, weekPlans } from '../db/schema'
import { anthropicCall, getToolInput } from './anthropic'
import { buildSystemPrompt, type UserProfileContext } from './prompts/system'
import { getLatestBodyweightKg } from './bodyMetrics'
import { TOOL_REACTIVE_REPLAN, TOOL_REPLACE_SUGGESTIONS, type ReactiveReplanOutput, type ReplaceSuggestionsOutput } from './prompts/tools'
import { computeHrSnapshot, loadRecentRunsForHr, serializeHrForPrompt } from './hrAnalysis'
import { computeBlockAdherence, deriveGuidance, serializeAdherenceForPrompt } from './adherence'
import type { createDB } from '../db/client'

type DB = ReturnType<typeof createDB>

const DEBOUNCE_SEC = 2 * 60 * 60
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export type ReactiveTrigger =
  | 'session_completed'
  | 'session_skipped'
  | 'session_replaced'
  | 'wellness_logged'
  | 'rollover'

export interface ReactiveEvalCtx {
  trigger: ReactiveTrigger
  sessionId?: string
  todayEpochDay: number
}

const SESSION_LABEL: Record<string, string> = {
  foundation_run: 'foundation run',
  strength: 'strength',
  mt_class: 'MT class',
  bag_work: 'bag work',
  running: 'run',
  skip_rope: 'skip rope',
  active_recovery: 'active recovery',
  mobility: 'mobility',
}

interface TriggerGateResult {
  allow: boolean
  rationale: string
}

interface SignalBundle {
  trigger: ReactiveTrigger
  sessionId?: string
  todayEpochDay: number
  todayDow: number
  weekStart: number
  weekEnd: number
  justCompleted: { id: string; type: string; divergedFrom: string | null; hrDrift: string | null; z2: string | null } | null
  recentMissed: Array<{ type: string; scheduledDate: number }>
  wellnessToday: { sleepHours: number | null; soreness: number | null; alcoholScale: number | null } | null
  wellnessOverreach: boolean
}

// ─── Gates (cheap pre-filter before Haiku) ──────────────────────

async function collectSignals(db: DB, ctx: ReactiveEvalCtx): Promise<SignalBundle> {
  const todayDow = new Date(ctx.todayEpochDay * 86400000).getUTCDay()
  const weekStart = ctx.todayEpochDay - todayDow
  const weekEnd = weekStart + 6

  let justCompleted: SignalBundle['justCompleted'] = null
  if (ctx.sessionId && (ctx.trigger === 'session_completed' || ctx.trigger === 'session_replaced' || ctx.trigger === 'session_skipped')) {
    const [sess] = await db.select().from(sessions).where(eq(sessions.id, ctx.sessionId))
    if (sess) {
      // MT class diverging from prescribed type: if the session type was logged
      // as mt_class but the prescribed plan had something else here, note it.
      // We infer this from notes containing the replace/log markers, or the
      // session record alone. For MVP, divergence = the session type differs
      // from the sibling planned session for the same day/slot that was
      // originally generated. Cheap heuristic: if the session has an
      // adjustmentId, it was already swapped; skip.
      let divergedFrom: string | null = null
      if (sess.type === 'mt_class' && ctx.trigger === 'session_completed' && !sess.adjustmentId) {
        const sameDay = await db.select().from(sessions).where(and(
          eq(sessions.scheduledDate, sess.scheduledDate ?? ctx.todayEpochDay),
          eq(sessions.timeSlot, sess.timeSlot ?? 'pm'),
        ))
        const other = sameDay.find(s => s.id !== sess.id && s.status === 'missed' && s.type !== 'mt_class')
        if (other) divergedFrom = other.type
      }

      let hrDrift: string | null = null
      let z2: string | null = null
      if (ctx.trigger === 'session_completed') {
        const runs = await loadRecentRunsForHr(db, ctx.todayEpochDay)
        const snap = computeHrSnapshot(runs, ctx.todayEpochDay)
        if (snap.driftAssessment === 'clear_fatigue' || snap.driftAssessment === 'mild_fatigue') {
          hrDrift = snap.driftAssessment
        }
        if (snap.z2Compliance === 'over_paced' || snap.z2Compliance === 'slightly_high') {
          z2 = snap.z2Compliance
        }
      }

      justCompleted = { id: sess.id, type: sess.type, divergedFrom, hrDrift, z2 }
    }
  }

  // Recent missed: planned sessions flipped to missed in last 3 days.
  const recentMissedRows = await db
    .select({ type: sessions.type, scheduledDate: sessions.scheduledDate })
    .from(sessions)
    .where(and(
      eq(sessions.status, 'missed'),
      gte(sessions.scheduledDate, ctx.todayEpochDay - 3),
      lte(sessions.scheduledDate, ctx.todayEpochDay - 1),
    ))
  const recentMissed = recentMissedRows
    .filter(r => r.scheduledDate != null)
    .map(r => ({ type: r.type, scheduledDate: r.scheduledDate as number }))

  // Wellness today
  const [todayLog] = await db.select().from(dailyLogs).where(eq(dailyLogs.logDate, ctx.todayEpochDay))
  const wellnessToday = todayLog
    ? { sleepHours: todayLog.sleepHours, soreness: todayLog.soreness, alcoholScale: todayLog.alcoholScale }
    : null
  const wellnessOverreach = Boolean(
    wellnessToday &&
    ((wellnessToday.sleepHours != null && wellnessToday.sleepHours < 6) ||
      (wellnessToday.soreness != null && wellnessToday.soreness >= 4)),
  )

  return {
    trigger: ctx.trigger,
    sessionId: ctx.sessionId,
    todayEpochDay: ctx.todayEpochDay,
    todayDow,
    weekStart,
    weekEnd,
    justCompleted,
    recentMissed,
    wellnessToday,
    wellnessOverreach,
  }
}

function gate(bundle: SignalBundle): TriggerGateResult {
  switch (bundle.trigger) {
    case 'session_completed':
      if (bundle.justCompleted?.hrDrift === 'clear_fatigue' || bundle.justCompleted?.z2 === 'over_paced') {
        return { allow: true, rationale: 'HR signal off target on completed run.' }
      }
      if (bundle.justCompleted?.divergedFrom) {
        return { allow: true, rationale: `Completed ${bundle.justCompleted.type}; ${bundle.justCompleted.divergedFrom} was prescribed for this slot.` }
      }
      return { allow: false, rationale: 'No HR or type divergence after completion.' }

    case 'session_skipped':
    case 'session_replaced':
      return { allow: true, rationale: 'Athlete-initiated change; reshape the week.' }

    case 'wellness_logged':
      if (bundle.wellnessOverreach) {
        return { allow: true, rationale: 'Sleep or soreness crossed overreach threshold.' }
      }
      return { allow: false, rationale: 'Wellness within tolerance.' }

    case 'rollover':
      if (bundle.recentMissed.length >= 2) {
        return { allow: true, rationale: `${bundle.recentMissed.length} planned days missed in the last 3.` }
      }
      return { allow: false, rationale: 'Fewer than two recent missed days.' }
  }
}

async function debounced(db: DB, nowSec: number): Promise<boolean> {
  const [last] = await db
    .select({ createdAt: coachingOutputs.createdAt })
    .from(coachingOutputs)
    .where(eq(coachingOutputs.kind, 'reactive_replan'))
    .orderBy(desc(coachingOutputs.createdAt))
    .limit(1)
  if (!last) return false
  return nowSec - last.createdAt < DEBOUNCE_SEC
}

// ─── Prompt builder ─────────────────────────────────────────────

function buildPrompt(bundle: SignalBundle, rationale: string, adherenceBlock: string, hrBlock: string | null, weekSessions: Array<{ type: string; scheduledDate: number | null; timeSlot: string | null; status: string }>): string {
  const lines: string[] = [
    `Reactive trigger: ${bundle.trigger}. Rationale: ${rationale}`,
    `Today: ${DAY_NAMES[bundle.todayDow]} (dow=${bundle.todayDow}). Week runs Sun (dow 0) to Sat (dow 6).`,
  ]

  if (bundle.justCompleted) {
    const parts: string[] = [`Just ${bundle.trigger === 'session_completed' ? 'completed' : bundle.trigger.replace('session_', '')}: ${SESSION_LABEL[bundle.justCompleted.type] ?? bundle.justCompleted.type}.`]
    if (bundle.justCompleted.hrDrift) parts.push(`HR drift: ${bundle.justCompleted.hrDrift}.`)
    if (bundle.justCompleted.z2) parts.push(`Zone-2 compliance: ${bundle.justCompleted.z2}.`)
    if (bundle.justCompleted.divergedFrom) parts.push(`Prescribed slot was ${SESSION_LABEL[bundle.justCompleted.divergedFrom] ?? bundle.justCompleted.divergedFrom}.`)
    lines.push(parts.join(' '))
  }

  if (bundle.recentMissed.length > 0) {
    lines.push(`Recently missed: ${bundle.recentMissed.map(m => SESSION_LABEL[m.type] ?? m.type).join(', ')}.`)
  }

  if (bundle.wellnessToday) {
    const w: string[] = []
    if (bundle.wellnessToday.sleepHours != null) w.push(`sleep ${bundle.wellnessToday.sleepHours}h`)
    if (bundle.wellnessToday.soreness != null) w.push(`soreness ${bundle.wellnessToday.soreness}/5`)
    if (bundle.wellnessToday.alcoholScale != null) w.push(`alcohol ${bundle.wellnessToday.alcoholScale}/5`)
    if (w.length > 0) lines.push(`Wellness today: ${w.join(', ')}.`)
  }

  const remaining = weekSessions.filter(s => s.scheduledDate != null && s.scheduledDate >= bundle.todayEpochDay && s.status !== 'skipped' && s.status !== 'completed')
  if (remaining.length > 0) {
    lines.push('Remaining this week:')
    for (const s of remaining) {
      const dow = new Date((s.scheduledDate ?? 0) * 86400000).getUTCDay()
      lines.push(`  ${DAY_NAMES[dow]} ${(s.timeSlot ?? 'am').toUpperCase()}: ${SESSION_LABEL[s.type] ?? s.type}`)
    }
  } else {
    lines.push('Nothing else planned this week.')
  }

  if (adherenceBlock) {
    lines.push('', adherenceBlock)
  }
  if (hrBlock) {
    lines.push('', hrBlock)
  }

  lines.push('')
  lines.push('Decide one adjustment using the reactiveReplan tool.')
  lines.push('Stay silent: no "missed" labels, no scolding, no second person. Pick the smallest shift that honors the signal.')
  lines.push(`Valid targetDay values: ${bundle.todayDow}..6 (today through end of week).`)

  return lines.join('\n')
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

async function currentWeekPlanId(db: DB, weekStart: number, weekEnd: number): Promise<string | null> {
  const weekSessions = await db.select({ weekPlanId: sessions.weekPlanId }).from(sessions).where(and(
    gte(sessions.scheduledDate, weekStart),
    lte(sessions.scheduledDate, weekEnd),
  ))
  const found = weekSessions.find(s => s.weekPlanId)
  if (found?.weekPlanId) return found.weekPlanId
  // Fallback: most recent week plan
  const [wp] = await db.select({ id: weekPlans.id }).from(weekPlans).orderBy(desc(weekPlans.createdAt)).limit(1)
  return wp?.id ?? null
}

// ─── Public API ─────────────────────────────────────────────────

export interface ReactiveResult {
  adjustmentId: string
  note: string
}

export async function runReactiveReplan(
  db: DB,
  apiKey: string,
  ctx: ReactiveEvalCtx,
): Promise<ReactiveResult | null> {
  const nowSec = Math.floor(Date.now() / 1000)

  if (await debounced(db, nowSec)) {
    console.log(`[reactiveCoach] debounced (<${DEBOUNCE_SEC}s since last)`)
    return null
  }

  const bundle = await collectSignals(db, ctx)
  const g = gate(bundle)
  if (!g.allow) {
    console.log(`[reactiveCoach] gate blocked: ${g.rationale}`)
    return null
  }

  // Build adherence + HR context. Adherence is block-scoped; we cheat by
  // deriving the block id from the current week plan row.
  const weekPlanId = await currentWeekPlanId(db, bundle.weekStart, bundle.weekEnd)
  let adherenceBlock = ''
  if (weekPlanId) {
    const [wp] = await db.select({ blockId: weekPlans.blockId }).from(weekPlans).where(eq(weekPlans.id, weekPlanId))
    if (wp) {
      const adherence = await computeBlockAdherence(db, wp.blockId, ctx.todayEpochDay)
      const guidance = deriveGuidance(adherence)
      adherenceBlock = serializeAdherenceForPrompt(adherence, guidance)
    }
  }

  const recentRuns = await loadRecentRunsForHr(db, ctx.todayEpochDay)
  const hrBlock = serializeHrForPrompt(computeHrSnapshot(recentRuns, ctx.todayEpochDay))

  const weekSessions = await db
    .select({ type: sessions.type, scheduledDate: sessions.scheduledDate, timeSlot: sessions.timeSlot, status: sessions.status })
    .from(sessions)
    .where(and(gte(sessions.scheduledDate, bundle.weekStart), lte(sessions.scheduledDate, bundle.weekEnd)))

  const profile = await loadProfile(db)
  const systemBlocks = buildSystemPrompt(profile, null)
  const prompt = buildPrompt(bundle, g.rationale, adherenceBlock, hrBlock, weekSessions)

  const result = await anthropicCall(apiKey, {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: systemBlocks,
    messages: [{ role: 'user', content: prompt }],
    tools: [TOOL_REACTIVE_REPLAN],
    tool_choice: { type: 'tool', name: 'reactiveReplan' },
  })

  if (result.offline) {
    console.warn('[reactiveCoach] offline; no replan written')
    return null
  }

  const output = getToolInput<ReactiveReplanOutput>(result, 'reactiveReplan')
  if (!output) {
    console.warn('[reactiveCoach] no tool output; skipping')
    return null
  }

  const cleanNote = sanitizeVoice(output.note)
  const cleanReason = sanitizeVoice(output.shiftReason)

  await db.insert(coachingOutputs).values({
    id: crypto.randomUUID(),
    kind: 'reactive_replan',
    model: 'claude-haiku-4-5-20251001',
    scopeWeekPlanId: weekPlanId,
    scopeSessionId: ctx.sessionId ?? null,
    inputHash: null,
    outputJson: JSON.stringify({ ...output, note: cleanNote, shiftReason: cleanReason, trigger: ctx.trigger, gate: g.rationale }),
    tokensIn: result.usage.input_tokens,
    tokensOut: result.usage.output_tokens,
    cachedTokensIn: result.usage.cache_read_input_tokens ?? 0,
    createdAt: nowSec,
  })

  const adjustmentId = crypto.randomUUID()
  await db.insert(weekAdjustments).values({
    id: adjustmentId,
    weekPlanId: weekPlanId ?? '',
    adjustmentType: 'reactive',
    sessionType: output.targetSessionType,
    action: output.shiftAction === 'move' ? 'move_timeslot' : output.shiftAction === 'swap' ? 'swap' : 'add',
    reason: cleanReason,
    targetDay: output.targetDay,
    targetTimeSlot: output.targetTimeSlot,
    sourceData: JSON.stringify({
      trigger: ctx.trigger,
      gate: g.rationale,
      note: cleanNote,
      originalSessionId: output.originalSessionId ?? ctx.sessionId ?? null,
      targetLabel: output.targetLabel,
      hrDrift: bundle.justCompleted?.hrDrift ?? null,
      z2: bundle.justCompleted?.z2 ?? null,
      recentMissed: bundle.recentMissed.length,
      wellness: bundle.wellnessToday,
    }),
    status: 'accepted',
    createdAt: nowSec,
  })

  console.log(`[reactiveCoach] replan written. trigger=${ctx.trigger} tokens=${result.usage.input_tokens}/${result.usage.output_tokens}`)
  return { adjustmentId, note: cleanNote }
}

// ─── Replace-suggestions blocking call ──────────────────────────

export async function runReplaceSuggestions(
  db: DB,
  apiKey: string,
  sessionId: string,
  todayEpochDay: number,
  reason: string | null,
): Promise<ReplaceSuggestionsOutput | null> {
  const [sess] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!sess) return null

  const todayDow = new Date(todayEpochDay * 86400000).getUTCDay()
  const weekStart = todayEpochDay - todayDow
  const weekEnd = weekStart + 6

  const [todayLog] = await db.select().from(dailyLogs).where(eq(dailyLogs.logDate, todayEpochDay))
  const weekSessions = await db
    .select({ type: sessions.type, scheduledDate: sessions.scheduledDate, timeSlot: sessions.timeSlot, status: sessions.status })
    .from(sessions)
    .where(and(gte(sessions.scheduledDate, weekStart), lte(sessions.scheduledDate, weekEnd)))

  const recentRuns = await loadRecentRunsForHr(db, todayEpochDay)
  const hrBlock = serializeHrForPrompt(computeHrSnapshot(recentRuns, todayEpochDay))

  const weekPlanId = await currentWeekPlanId(db, weekStart, weekEnd)
  let adherenceBlock = ''
  if (weekPlanId) {
    const [wp] = await db.select({ blockId: weekPlans.blockId }).from(weekPlans).where(eq(weekPlans.id, weekPlanId))
    if (wp) {
      const adherence = await computeBlockAdherence(db, wp.blockId, todayEpochDay)
      const guidance = deriveGuidance(adherence)
      adherenceBlock = serializeAdherenceForPrompt(adherence, guidance)
    }
  }

  const lines: string[] = [
    `Replacing: ${SESSION_LABEL[sess.type] ?? sess.type} (${(sess.timeSlot ?? 'am').toUpperCase()}) today (${DAY_NAMES[todayDow]}).`,
    reason ? `Athlete reason: ${reason}.` : 'No reason given.',
    'Rank three alternatives for right now. Best pick first. Respect MT cap and posture constraints from the profile.',
  ]
  if (todayLog) {
    const w: string[] = []
    if (todayLog.sleepHours != null) w.push(`sleep ${todayLog.sleepHours}h`)
    if (todayLog.soreness != null) w.push(`soreness ${todayLog.soreness}/5`)
    if (todayLog.alcoholScale != null) w.push(`alcohol ${todayLog.alcoholScale}/5`)
    if (w.length > 0) lines.push(`Wellness today: ${w.join(', ')}.`)
  }
  const completed = weekSessions.filter(s => s.status === 'completed')
  lines.push(`Completed so far this week: ${completed.length > 0 ? completed.map(s => SESSION_LABEL[s.type] ?? s.type).join(', ') : 'none'}.`)
  const remaining = weekSessions.filter(s => s.scheduledDate != null && s.scheduledDate > todayEpochDay && s.status !== 'skipped')
  if (remaining.length > 0) {
    lines.push('Remaining this week:')
    for (const s of remaining) {
      const dow = new Date((s.scheduledDate ?? 0) * 86400000).getUTCDay()
      lines.push(`  ${DAY_NAMES[dow]} ${(s.timeSlot ?? 'am').toUpperCase()}: ${SESSION_LABEL[s.type] ?? s.type}`)
    }
  }
  if (adherenceBlock) lines.push('', adherenceBlock)
  if (hrBlock) lines.push('', hrBlock)
  lines.push('', 'Call replaceSuggestions with exactly three options ranked best to worst. coachLine explains only the top pick. Voice canon.')

  const profile = await loadProfile(db)
  const systemBlocks = buildSystemPrompt(profile, null)

  const result = await anthropicCall(apiKey, {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: systemBlocks,
    messages: [{ role: 'user', content: lines.join('\n') }],
    tools: [TOOL_REPLACE_SUGGESTIONS],
    tool_choice: { type: 'tool', name: 'replaceSuggestions' },
  })

  if (result.offline) {
    console.warn('[replaceSuggestions] offline')
    return null
  }

  const output = getToolInput<ReplaceSuggestionsOutput>(result, 'replaceSuggestions')
  if (!output) {
    console.warn('[replaceSuggestions] no tool output')
    return null
  }

  await db.insert(coachingOutputs).values({
    id: crypto.randomUUID(),
    kind: 'replace_suggestions',
    model: 'claude-haiku-4-5-20251001',
    scopeWeekPlanId: weekPlanId,
    scopeSessionId: sessionId,
    inputHash: null,
    outputJson: JSON.stringify(output),
    tokensIn: result.usage.input_tokens,
    tokensOut: result.usage.output_tokens,
    cachedTokensIn: result.usage.cache_read_input_tokens ?? 0,
    createdAt: Math.floor(Date.now() / 1000),
  })

  return { ...output, coachLine: sanitizeVoice(output.coachLine) }
}

// Voice canon: strip em dashes in case Haiku slips. Cheap insurance.
function sanitizeVoice(s: string): string {
  return s.replace(/[\u2014\u2013]/g, ',').replace(/\s{2,}/g, ' ').trim()
}
