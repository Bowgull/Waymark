// Event-driven reactive replan. Listens for meaningful signals mid-week and
// produces one WeekAdjustment of type 'reactive'. Small auto, big ask: small
// changes (hold, reduce intensity, a run becomes a walk or bike) are applied to
// the target session with a short note; big ones (another session type,
// another day, an added session) are placement-checked and stored as a
// proposal the athlete accepts or rejects.
//
// Triggers:
//  - session_completed: HR drift or over-paced zone-2 on the just-finished run,
//    or an MT class completed when a different type was prescribed.
//  - session_skipped: the athlete skipped. Reshape the rest of the week.
//  - session_replaced: replacement just landed. Redistribute the cascade.
//  - wellness_logged: sleep/soreness crossed an overreach threshold.
//  - rollover: nightly pass. Fires when two or more recent days flipped to
//    missed, OR when ad-hoc bonus sessions created a conflict with the rest
//    of the week (MT cap breach, intensity stacked adjacent to a prescribed
//    hard day, or weekly training days exceeded the target).
//
// Cost safety:
//  - One reasoning-model call per trigger (MODELS.reasoning, Sonnet, effort low).
//  - Debounced per 2h window via coachingOutputs(kind='reactive_replan').
//  - Pre-filter gates: if no rule fires, we skip the AI call entirely.
//  - Fails closed: model offline -> no adjustment, the weekly plan still stands.

import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { coachingOutputs, dailyLogs, exercises, sessions, trainingMaxes, userProfile, weekAdjustments, weekPlans } from '../db/schema'
import { anthropicCall, getStructuredOutput, jsonFormatFor, jsonInstructionFor } from './anthropic'
import { MODELS } from './models'
import { buildSystemPrompt, type UserProfileContext } from './prompts/system'
import { getLatestBodyweightKg } from './bodyMetrics'
import { TOOL_REACTIVE_REPLAN, TOOL_REPLACE_SUGGESTIONS, type ReactiveReplanOutput, type ReplaceSuggestionsOutput } from './prompts/tools'
import { computeHrSnapshot, loadEasyHrCeiling, loadProfileMaxHrForHr, loadRecentRunsForHr, serializeHrForPrompt } from './hrAnalysis'
import { computeBlockAdherence, deriveGuidance, serializeAdherenceForPrompt } from './adherence'
import { computeStarterStatus, serializeStarterStatus } from './starterStatus'
import { checkInFromDailyLog, clampsForStorage, evaluateReadiness, guardReactiveReplan, guardReplaceSuggestions, logClamps, serializeBlockZeroContext } from './blockZero'
import { loadBlockZeroAiContext, loadBlockZeroGuardContext } from '../server/blockZeroData'
import { checkChange, loadInjuryFlag } from '../server/coachData'
import { classifyReplan, isLeadInContext, withCoachEase, type CoachEase, type InjuryFlag, type SessionChange } from './coach'
import { mondayOf } from './dates'
import type { createDB } from '../db/client'

type DB = ReturnType<typeof createDB>

const DEBOUNCE_SEC = 2 * 60 * 60
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HIGH_INTENSITY_TYPES = new Set(['mt_class', 'bag_work'])

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

interface AdHocConflict {
  adds: Array<{ type: string; scheduledDate: number; timeSlot: string | null; status: string }>
  mtOverCap: { cap: number; count: number } | null
  stackedIntensity: Array<{ addedDay: number; addedType: string; adjacentDay: number; adjacentType: string }>
  volumeSpike: { target: number; trainingDays: number } | null
}

export interface SignalBundle {
  trigger: ReactiveTrigger
  sessionId?: string
  todayEpochDay: number
  todayDow: number
  weekStart: number
  weekEnd: number
  justCompleted: { id: string; type: string; divergedFrom: string | null; hrDrift: string | null; z2: string | null; rpe: number | null; notes: string | null } | null
  recentMissed: Array<{ type: string; scheduledDate: number }>
  recentCompleted: Array<{ type: string; scheduledDate: number; rpe: number | null; notes: string | null }>
  wellnessToday: { sleepHours: number | null; soreness: number | null; alcoholScale: number | null } | null
  wellnessOverreach: boolean
  adHocConflict: AdHocConflict | null
  /** Skips in the last 7 days with their reason (injury, sick, tired...). */
  recentSkips: Array<{ type: string; scheduledDate: number; reason: string | null; detail: string | null }>
  /** Deterministic injury rule from injury skips (F16). */
  injury: InjuryFlag | null
}

// ─── Gates (cheap pre-filter before the model call) ─────────────

// Ad-hoc bonus sessions carry sessions.source = 'ad_hoc' (POST /api/sessions/insert-ad-hoc).
// Template sessions carry 'template'; null is a row from before the marker and
// counts as planned work, never as a bonus. A conflict arises when bonus volume
// pushes the week past a real ceiling: MT cap, adjacent-day hard session
// stacking, or weekly day target.
async function detectAdHocConflicts(
  db: DB,
  weekStart: number,
  weekEnd: number,
  mtCap: number | null,
  weeklyDayTarget: number | null,
): Promise<AdHocConflict | null> {
  const weekRows = await db
    .select({
      type: sessions.type,
      scheduledDate: sessions.scheduledDate,
      timeSlot: sessions.timeSlot,
      status: sessions.status,
      source: sessions.source,
    })
    .from(sessions)
    .where(and(gte(sessions.scheduledDate, weekStart), lte(sessions.scheduledDate, weekEnd)))

  const active = weekRows.filter(s => s.status !== 'skipped' && s.scheduledDate != null)
  const adHoc = active
    .filter(s => s.source === 'ad_hoc')
    .map(s => ({ type: s.type, scheduledDate: s.scheduledDate as number, timeSlot: s.timeSlot, status: s.status }))
  if (adHoc.length === 0) return null

  let mtOverCap: AdHocConflict['mtOverCap'] = null
  if (mtCap != null) {
    const mtCount = active.filter(s => s.type === 'mt_class').length
    if (mtCount > mtCap) mtOverCap = { cap: mtCap, count: mtCount }
  }

  const prescribedHardByDay = new Map<number, string>()
  for (const s of active) {
    if (s.source !== 'ad_hoc' && HIGH_INTENSITY_TYPES.has(s.type)) {
      prescribedHardByDay.set(s.scheduledDate as number, s.type)
    }
  }
  const stackedIntensity: AdHocConflict['stackedIntensity'] = []
  for (const s of adHoc) {
    if (!HIGH_INTENSITY_TYPES.has(s.type)) continue
    const prev = prescribedHardByDay.get(s.scheduledDate - 1)
    const next = prescribedHardByDay.get(s.scheduledDate + 1)
    if (prev) stackedIntensity.push({ addedDay: s.scheduledDate, addedType: s.type, adjacentDay: s.scheduledDate - 1, adjacentType: prev })
    if (next) stackedIntensity.push({ addedDay: s.scheduledDate, addedType: s.type, adjacentDay: s.scheduledDate + 1, adjacentType: next })
  }

  let volumeSpike: AdHocConflict['volumeSpike'] = null
  if (weeklyDayTarget != null) {
    const days = new Set<number>()
    for (const s of active) days.add(s.scheduledDate as number)
    if (days.size > weeklyDayTarget + 1) volumeSpike = { target: weeklyDayTarget, trainingDays: days.size }
  }

  if (!mtOverCap && stackedIntensity.length === 0 && !volumeSpike) return null
  return { adds: adHoc, mtOverCap, stackedIntensity, volumeSpike }
}

async function collectSignals(db: DB, ctx: ReactiveEvalCtx): Promise<SignalBundle> {
  const todayDow = new Date(ctx.todayEpochDay * 86400000).getUTCDay()
  // Plans run Monday-Sunday; so does the coach's "this week".
  const weekStart = mondayOf(ctx.todayEpochDay)
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
        const maxHr = await loadProfileMaxHrForHr(db)
        const snap = computeHrSnapshot(runs, ctx.todayEpochDay, { maxHr, ceilingBpm: (await loadEasyHrCeiling(db, ctx.todayEpochDay)).bpm })
        if (snap.driftAssessment === 'clear_fatigue' || snap.driftAssessment === 'mild_fatigue') {
          hrDrift = snap.driftAssessment
        }
        if (snap.z2Compliance === 'over_paced' || snap.z2Compliance === 'slightly_high') {
          z2 = snap.z2Compliance
        }
      }

      justCompleted = { id: sess.id, type: sess.type, divergedFrom, hrDrift, z2, rpe: sess.rpe ?? null, notes: sess.notes ?? null }
    }
  }

  // Recent missed: planned sessions flipped to missed in last 3 days.
  const recentMissedRows = await db
    .select({ type: sessions.type, scheduledDate: sessions.scheduledDate, contextJson: sessions.contextJson })
    .from(sessions)
    .where(and(
      eq(sessions.status, 'missed'),
      gte(sessions.scheduledDate, ctx.todayEpochDay - 3),
      lte(sessions.scheduledDate, ctx.todayEpochDay - 1),
    ))
  // Lead-in sessions are optional (Block Zero Part B): a missed one is not a signal.
  const recentMissed = recentMissedRows
    .filter(r => r.scheduledDate != null && !isLeadInContext(r.contextJson))
    .map(r => ({ type: r.type, scheduledDate: r.scheduledDate as number }))

  // Recent completed with quality signal: Effort (rpe) and notes are the
  // single biggest underused signal the mid-week coach used to ignore.
  const recentCompletedRows = await db
    .select({ type: sessions.type, scheduledDate: sessions.scheduledDate, rpe: sessions.rpe, notes: sessions.notes })
    .from(sessions)
    .where(and(
      eq(sessions.status, 'completed'),
      gte(sessions.scheduledDate, ctx.todayEpochDay - 7),
      lte(sessions.scheduledDate, ctx.todayEpochDay),
    ))
  const recentCompleted = recentCompletedRows
    .filter(r => r.scheduledDate != null)
    .map(r => ({ type: r.type, scheduledDate: r.scheduledDate as number, rpe: r.rpe ?? null, notes: r.notes ?? null }))

  // Wellness today
  const [todayLog] = await db.select().from(dailyLogs).where(eq(dailyLogs.logDate, ctx.todayEpochDay))
  const wellnessToday = todayLog
    ? { sleepHours: todayLog.sleepHours, soreness: todayLog.soreness, alcoholScale: todayLog.alcoholScale }
    : null
  // Oversleep (soft rule): 1.5 h+ over the 7-day sleep mean with low energy or
  // high soreness reads like poor sleep. Long sleep with good energy is neutral.
  const recentLogs = todayLog
    ? await db.select().from(dailyLogs).where(and(gte(dailyLogs.logDate, ctx.todayEpochDay - 7), lte(dailyLogs.logDate, ctx.todayEpochDay)))
    : []
  const longSleepTired = evaluateReadiness(recentLogs.map(checkInFromDailyLog)).find(d => d.epochDay === ctx.todayEpochDay)?.oversleep === 'fatigue'
  const wellnessOverreach = Boolean(
    wellnessToday &&
    ((wellnessToday.sleepHours != null && wellnessToday.sleepHours < 6) ||
      (wellnessToday.soreness != null && wellnessToday.soreness >= 4) ||
      longSleepTired),
  )

  // Skip reasons are a signal (map #10): injury, sick, sore, tired.
  const skipRows = await db
    .select({ type: sessions.type, scheduledDate: sessions.scheduledDate, reason: sessions.skipReason, detail: sessions.skipReasonDetail })
    .from(sessions)
    .where(and(eq(sessions.status, 'skipped'), gte(sessions.scheduledDate, ctx.todayEpochDay - 7), lte(sessions.scheduledDate, ctx.todayEpochDay)))
  const recentSkips = skipRows
    .filter(r => r.scheduledDate != null)
    .map(r => ({ type: r.type, scheduledDate: r.scheduledDate as number, reason: r.reason ?? null, detail: r.detail ?? null }))
  const injury = await loadInjuryFlag(db, ctx.todayEpochDay)

  // Ad-hoc conflict detection only matters for the nightly rollover sweep.
  // Other triggers already have their own specific signal and don't need
  // the extra query cost.
  let adHocConflict: AdHocConflict | null = null
  if (ctx.trigger === 'rollover') {
    const [profileRow] = await db
      .select({ mtCapPerWeek: userProfile.mtCapPerWeek, weeklyDayTarget: userProfile.weeklyDayTarget })
      .from(userProfile)
      .limit(1)
    adHocConflict = await detectAdHocConflicts(
      db,
      weekStart,
      weekEnd,
      profileRow?.mtCapPerWeek ?? null,
      profileRow?.weeklyDayTarget ?? null,
    )
  }

  return {
    trigger: ctx.trigger,
    sessionId: ctx.sessionId,
    todayEpochDay: ctx.todayEpochDay,
    todayDow,
    weekStart,
    weekEnd,
    justCompleted,
    recentMissed,
    recentCompleted,
    wellnessToday,
    wellnessOverreach,
    adHocConflict,
    recentSkips,
    injury,
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

    case 'rollover': {
      if (bundle.recentMissed.length >= 2) {
        return { allow: true, rationale: `${bundle.recentMissed.length} planned days missed in the last 3.` }
      }
      const conflict = bundle.adHocConflict
      if (conflict) {
        const reasons: string[] = []
        if (conflict.mtOverCap) reasons.push(`MT count ${conflict.mtOverCap.count} over cap ${conflict.mtOverCap.cap}`)
        if (conflict.stackedIntensity.length > 0) reasons.push(`bonus hard session stacked with prescribed hard day`)
        if (conflict.volumeSpike) reasons.push(`week at ${conflict.volumeSpike.trainingDays} days vs target ${conflict.volumeSpike.target}`)
        if (reasons.length > 0) return { allow: true, rationale: `Ad-hoc adds created a conflict: ${reasons.join('; ')}.` }
      }
      return { allow: false, rationale: 'Fewer than two recent missed days and no ad-hoc conflict.' }
    }
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

export function buildReactivePrompt(bundle: SignalBundle, rationale: string, adherenceBlock: string, hrBlock: string | null, weekSessions: Array<{ type: string; scheduledDate: number | null; timeSlot: string | null; status: string }>, blockZeroContext: string | null = null): string {
  const lines: string[] = [
    `Reactive trigger: ${bundle.trigger}. Rationale: ${rationale}`,
    `Today: ${DAY_NAMES[bundle.todayDow]} (dow=${bundle.todayDow}). The plan week runs Monday to Sunday. Day numbers: 0=Sun, 1=Mon .. 6=Sat.`,
  ]

  if (bundle.justCompleted) {
    const parts: string[] = [`Just ${bundle.trigger === 'session_completed' ? 'completed' : bundle.trigger.replace('session_', '')}: ${SESSION_LABEL[bundle.justCompleted.type] ?? bundle.justCompleted.type}.`]
    if (bundle.justCompleted.rpe != null) parts.push(`Effort ${bundle.justCompleted.rpe}/10.`)
    if (bundle.justCompleted.hrDrift) parts.push(`HR drift: ${bundle.justCompleted.hrDrift}.`)
    if (bundle.justCompleted.z2) parts.push(`Zone-2 compliance: ${bundle.justCompleted.z2}.`)
    if (bundle.justCompleted.divergedFrom) parts.push(`Prescribed slot was ${SESSION_LABEL[bundle.justCompleted.divergedFrom] ?? bundle.justCompleted.divergedFrom}.`)
    lines.push(parts.join(' '))
    if (bundle.justCompleted.notes) {
      lines.push(`Athlete note on that session: "${bundle.justCompleted.notes}"`)
    }
  }

  if (bundle.recentMissed.length > 0) {
    lines.push(`Recently missed: ${bundle.recentMissed.map(m => SESSION_LABEL[m.type] ?? m.type).join(', ')}. The athlete is asked about each one. Do not make it up elsewhere.`)
  }

  if (bundle.recentSkips.length > 0) {
    const skips = bundle.recentSkips.map(s => {
      const dow = DAY_NAMES[new Date(s.scheduledDate * 86400000).getUTCDay()]
      return `${dow} ${SESSION_LABEL[s.type] ?? s.type}${s.reason ? ` (${s.reason}${s.detail ? `: ${s.detail}` : ''})` : ''}`
    })
    lines.push(`Skipped this week: ${skips.join(', ')}.`)
  }
  if (bundle.injury) {
    lines.push(`Rules flag: ${bundle.injury.reason} Sessions on that region are eased or swapped by the rules. Do not load it.`)
  }

  if (bundle.recentCompleted.length > 0) {
    const qualitySignal = bundle.recentCompleted
      .filter(s => s.rpe != null || (s.notes && s.notes.trim().length > 0))
      .map(s => {
        const dow = DAY_NAMES[new Date(s.scheduledDate * 86400000).getUTCDay()]
        const bits: string[] = [`${dow} ${SESSION_LABEL[s.type] ?? s.type}`]
        if (s.rpe != null) bits.push(`Effort ${s.rpe}/10`)
        if (s.notes && s.notes.trim().length > 0) bits.push(`note: "${s.notes.trim()}"`)
        return bits.join(' · ')
      })
    if (qualitySignal.length > 0) {
      lines.push('Recent completed sessions (quality signal):')
      for (const q of qualitySignal) lines.push(`  ${q}`)
      lines.push('Weight the Effort scores heavily. High effort (8-10) on what should have been moderate sessions means under-recovered. Low effort (3-5) on hard sessions means either cruising (push harder) or avoiding (dig into notes). Scan notes for pain, soreness, stiffness, hip/shoulder/back mentions, or mood.')
    }
  }

  if (bundle.adHocConflict) {
    const c = bundle.adHocConflict
    const addLabels = c.adds.map(a => {
      const dow = DAY_NAMES[new Date(a.scheduledDate * 86400000).getUTCDay()]
      return `${dow} ${(a.timeSlot ?? 'am').toUpperCase()} ${SESSION_LABEL[a.type] ?? a.type}`
    })
    lines.push(`Ad-hoc bonus sessions this week: ${addLabels.join(', ')}.`)
    if (c.mtOverCap) lines.push(`MT count ${c.mtOverCap.count} exceeds cap ${c.mtOverCap.cap}.`)
    if (c.stackedIntensity.length > 0) {
      const stacks = c.stackedIntensity.map(s => {
        const addDow = DAY_NAMES[new Date(s.addedDay * 86400000).getUTCDay()]
        const adjDow = DAY_NAMES[new Date(s.adjacentDay * 86400000).getUTCDay()]
        return `${addDow} ${SESSION_LABEL[s.addedType] ?? s.addedType} next to ${adjDow} ${SESSION_LABEL[s.adjacentType] ?? s.adjacentType}`
      })
      lines.push(`Intensity stacked: ${stacks.join('; ')}.`)
    }
    if (c.volumeSpike) lines.push(`Training days this week: ${c.volumeSpike.trainingDays} (target ${c.volumeSpike.target}).`)
  }

  if (bundle.wellnessToday) {
    const w: string[] = []
    if (bundle.wellnessToday.sleepHours != null) w.push(`sleep ${bundle.wellnessToday.sleepHours}h`)
    if (bundle.wellnessToday.soreness != null) w.push(`soreness ${bundle.wellnessToday.soreness}/5`)
    if (bundle.wellnessToday.alcoholScale != null) w.push(`alcohol ${bundle.wellnessToday.alcoholScale}/10`)
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

  if (blockZeroContext) {
    lines.push('', blockZeroContext)
    lines.push('shiftReason is the one-line why. On an overreach signal prefer reduce_intensity or add_recovery over a swap.')
  }

  lines.push('')
  lines.push('Decide one adjustment.', jsonInstructionFor(TOOL_REACTIVE_REPLAN))
  lines.push('Stay silent: no "missed" labels, no scolding, no second person. Pick the smallest shift that honors the signal.')
  const left = Array.from({ length: (mondayOf(bundle.todayEpochDay) + 6) - bundle.todayEpochDay + 1 }, (_, i) => new Date((bundle.todayEpochDay + i) * 86400000).getUTCDay())
  lines.push(`Valid targetDay values: ${left.join(', ')} (today through Sunday).`)
  lines.push('Small changes (hold, reduce_intensity, a run to a walk or bike) apply at once. A swap to another type, a move or an added session is asked first and must pass the placement rules.')

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
  const maxHr = await loadProfileMaxHrForHr(db)
  const hrBlock = serializeHrForPrompt(computeHrSnapshot(recentRuns, ctx.todayEpochDay, { maxHr, ceilingBpm: (await loadEasyHrCeiling(db, ctx.todayEpochDay)).bpm }))

  const weekSessions = await db
    .select({ type: sessions.type, scheduledDate: sessions.scheduledDate, timeSlot: sessions.timeSlot, status: sessions.status })
    .from(sessions)
    .where(and(gte(sessions.scheduledDate, bundle.weekStart), lte(sessions.scheduledDate, bundle.weekEnd)))

  const profile = await loadProfile(db)
  const starter = await computeStarterStatus(db, ctx.todayEpochDay, profile.trainingHistory, profile.constraints)
  const starterBlock = serializeStarterStatus(starter)
  const systemBlocks = buildSystemPrompt(profile, null, starterBlock || null)
  // Block Zero: rules context in the user message, guardrails on the output.
  const bzGuard = await loadBlockZeroGuardContext(db, ctx.todayEpochDay)
  const bzInput = bzGuard ? await loadBlockZeroAiContext(db, ctx.todayEpochDay) : null
  const prompt = buildReactivePrompt(bundle, g.rationale, adherenceBlock, hrBlock, weekSessions, bzInput ? serializeBlockZeroContext(bzInput) : null)

  const result = await anthropicCall(apiKey, {
    model: MODELS.reasoning,
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low', format: jsonFormatFor(TOOL_REACTIVE_REPLAN) },
    fallbacks: 'default',
    system: systemBlocks,
    messages: [{ role: 'user', content: prompt }],
  })

  if (result.offline) {
    console.warn('[reactiveCoach] offline; no replan written')
    return null
  }

  const raw = getStructuredOutput<ReactiveReplanOutput>(result)
  if (!raw) {
    console.warn('[reactiveCoach] no structured output; skipping')
    return null
  }

  let output = raw
  let guardrails: ReturnType<typeof clampsForStorage> & { original?: ReactiveReplanOutput } | null = null
  if (bzGuard) {
    const guarded = guardReactiveReplan(raw, bzGuard)
    logClamps('reactive_replan', guarded.clamps)
    output = guarded.output
    guardrails = { ...clampsForStorage(guarded.clamps), ...(guarded.clamps.length > 0 ? { original: raw } : {}) }
  }

  const cleanNote = sanitizeVoice(output.note)
  const cleanReason = sanitizeVoice(output.shiftReason)

  // Small auto, big ask: sort the decision, then apply it or store the question.
  const applied = await applyReplanDecision(db, output, cleanNote, cleanReason, ctx.todayEpochDay, nowSec)

  await db.insert(coachingOutputs).values({
    id: crypto.randomUUID(),
    kind: 'reactive_replan',
    model: result.model,
    scopeWeekPlanId: weekPlanId,
    scopeSessionId: ctx.sessionId ?? null,
    inputHash: null,
    outputJson: JSON.stringify({ ...output, note: cleanNote, shiftReason: cleanReason, trigger: ctx.trigger, gate: g.rationale, decision: applied.summary, ...(guardrails ? { guardrails } : {}) }),
    tokensIn: result.usage.input_tokens,
    tokensOut: result.usage.output_tokens,
    cachedTokensIn: result.usage.cache_read_input_tokens ?? 0,
    createdAt: nowSec,
  })

  const planId = applied.weekPlanId ?? weekPlanId
  if (!planId) {
    console.warn('[reactiveCoach] no week plan for the adjustment row; decision kept in coaching_outputs only')
    return null
  }
  const adjustmentId = crypto.randomUUID()
  await db.insert(weekAdjustments).values({
    id: adjustmentId,
    weekPlanId: planId,
    adjustmentType: 'reactive',
    sessionType: applied.sessionType,
    action: applied.action,
    reason: applied.reason,
    targetDay: applied.targetEpochDay != null ? new Date(applied.targetEpochDay * 86400000).getUTCDay() : output.targetDay,
    targetTimeSlot: applied.timeSlot,
    sourceData: JSON.stringify({
      trigger: ctx.trigger,
      gate: g.rationale,
      note: applied.note,
      size: applied.summary.size,
      applied: applied.summary.applied,
      originalSessionId: applied.targetSessionId,
      targetEpochDay: applied.targetEpochDay,
      targetLabel: applied.label,
      runCategory: applied.runCategory,
      hrDrift: bundle.justCompleted?.hrDrift ?? null,
      z2: bundle.justCompleted?.z2 ?? null,
      recentMissed: bundle.recentMissed.length,
      recentSkips: bundle.recentSkips.length,
      injury: bundle.injury ? { region: bundle.injury.region } : null,
      wellness: bundle.wellnessToday,
      ...(guardrails?.applied ? { guardrails: guardrails.clamps.map(c => c.code) } : {}),
      ...(applied.summary.refusal ? { refusal: applied.summary.refusal } : {}),
    }),
    // Small changes are already applied (Today shows the note). Big ones wait for the athlete.
    status: applied.summary.size === 'big' ? 'proposed' : 'accepted',
    // An applied small change is an automatic change with a note (morning summary).
    auto: applied.summary.size === 'small' && applied.summary.applied ? 1 : 0,
    targetSessionId: applied.targetSessionId,
    expiresAt: applied.summary.size === 'big' ? (mondayOf(ctx.todayEpochDay) + 7) * 86400 + 12 * 3600 : null,
    createdAt: nowSec,
  })

  console.log(`[reactiveCoach] replan written. trigger=${ctx.trigger} tokens=${result.usage.input_tokens}/${result.usage.output_tokens}`)
  return { adjustmentId, note: cleanNote }
}

// ─── Applying a decision (small auto, big ask) ──────────────────

interface AppliedDecision {
  summary: { size: 'small' | 'big'; applied: boolean; action: string; refusal?: { code: string; reason: string } }
  note: string
  reason: string
  /** week_adjustments.action */
  action: string
  sessionType: string
  timeSlot: 'am' | 'pm'
  targetEpochDay: number | null
  targetSessionId: string | null
  label: string | null
  runCategory: string | null
  weekPlanId: string | null
}

/** A 0=Sun..6=Sat day from the model, as an epoch day from today to this Sunday. */
function dayThisWeek(todayEpochDay: number, dow: number): number | null {
  if (!Number.isInteger(dow) || dow < 0 || dow > 6) return null
  const todayDow = new Date(todayEpochDay * 86400000).getUTCDay()
  const day = todayEpochDay + ((dow - todayDow + 7) % 7)
  return day <= mondayOf(todayEpochDay) + 6 ? day : null
}

/**
 * Sort the guarded decision and act on it. SMALL (hold, reduce intensity, a run
 * to a walk or bike) is applied to the target session at once: the ease goes
 * into its context_json, which start-strength and the run prescription read.
 * BIG (another type, another day, an added session) is placement-checked and
 * stored as a proposal the athlete accepts or rejects; a refused one becomes
 * a note only. Big changes are never applied here.
 */
async function applyReplanDecision(db: DB, output: ReactiveReplanOutput, note: string, reason: string, todayEpochDay: number, nowSec: number): Promise<AppliedDecision> {
  const sunday = mondayOf(todayEpochDay) + 6
  const upcoming = await db.select().from(sessions)
    .where(and(eq(sessions.status, 'planned'), gte(sessions.scheduledDate, todayEpochDay), lte(sessions.scheduledDate, sunday)))
  const wantedDay = dayThisWeek(todayEpochDay, output.targetDay)
  const byId = output.originalSessionId ? upcoming.find(s => s.id === output.originalSessionId) : undefined
  const target = byId ?? upcoming
    .filter(s => s.type === output.targetSessionType)
    .sort((a, b) => Math.abs((a.scheduledDate ?? 0) - (wantedDay ?? todayEpochDay)) - Math.abs((b.scheduledDate ?? 0) - (wantedDay ?? todayEpochDay)))[0]
  const cls = classifyReplan(output, target ?? null)
  const slot: 'am' | 'pm' = output.targetTimeSlot === 'pm' ? 'pm' : 'am'
  const base = {
    note,
    reason,
    sessionType: target?.type ?? output.targetSessionType,
    timeSlot: (target?.timeSlot === 'pm' ? 'pm' : 'am') as 'am' | 'pm',
    targetEpochDay: target?.scheduledDate ?? wantedDay,
    targetSessionId: target?.id ?? null,
    label: target?.label ?? output.targetLabel ?? null,
    runCategory: target?.type === 'running' ? target.notes : null,
    weekPlanId: target?.weekPlanId ?? null,
  }

  if (cls.size === 'small') {
    if (cls.action === 'ease' && target) {
      const ease: CoachEase = { kind: cls.kind, reason, source: 'reactive', at: nowSec }
      await db.update(sessions).set({ contextJson: withCoachEase(target.contextJson, ease) }).where(eq(sessions.id, target.id))
      return { ...base, action: 'ease', summary: { size: 'small', applied: true, action: `ease:${cls.kind}` } }
    }
    return { ...base, action: 'hold', summary: { size: 'small', applied: false, action: 'note' } }
  }

  const refuse = (code: string, why: string): AppliedDecision => ({
    ...base,
    note: why,
    reason: why,
    action: 'hold',
    summary: { size: 'small', applied: false, action: 'note', refusal: { code, reason: why } },
  })
  if (wantedDay == null) return refuse('bad_day', 'That day is outside this week. Nothing changes.')
  let change: SessionChange
  if (cls.action === 'move') {
    if (!target) return refuse('no_target', 'Nothing planned to move. The week holds.')
    change = { kind: 'move', type: target.type, label: target.label, notes: target.notes, epochDay: wantedDay, timeSlot: slot, sessionId: target.id, fromEpochDay: target.scheduledDate }
  } else if (cls.action === 'swap' && target) {
    change = { kind: 'replace', type: output.targetSessionType, label: output.targetLabel, notes: null, epochDay: target.scheduledDate ?? wantedDay, timeSlot: target.timeSlot === 'pm' ? 'pm' : 'am', sessionId: target.id }
  } else {
    change = { kind: 'add', type: output.targetSessionType, label: output.targetLabel, notes: null, epochDay: wantedDay, timeSlot: slot }
  }
  const check = await checkChange(db, change, todayEpochDay)
  if (!check.ok) return refuse(check.code, check.reason)
  return {
    ...base,
    sessionType: change.kind === 'move' ? change.type : output.targetSessionType,
    label: change.label ?? null,
    timeSlot: check.change.timeSlot,
    targetEpochDay: check.change.epochDay,
    action: change.kind === 'move' ? 'move_timeslot' : change.kind === 'replace' ? 'swap' : 'add',
    summary: { size: 'big', applied: false, action: change.kind },
  }
}

// ─── Replace-suggestions blocking call ──────────────────────────

export interface ReplacePromptInput {
  session: { type: string; timeSlot: string | null }
  todayEpochDay: number
  reason: string | null
  wellness: { sleepHours: number | null; soreness: number | null; alcoholScale: number | null } | null
  weekSessions: Array<{ type: string; scheduledDate: number | null; timeSlot: string | null; status: string }>
  adherenceBlock: string
  hrBlock: string | null
  /** Block Zero rules context (lib/blockZero/aiContext). Null outside Block Zero. */
  blockZeroContext: string | null
}

/** The replace-suggestions user message. Pure. */
export function buildReplacePrompt(input: ReplacePromptInput): string {
  const todayDow = new Date(input.todayEpochDay * 86400000).getUTCDay()
  const lines: string[] = [
    `Replacing: ${SESSION_LABEL[input.session.type] ?? input.session.type} (${(input.session.timeSlot ?? 'am').toUpperCase()}) today (${DAY_NAMES[todayDow]}).`,
    input.reason ? `Athlete reason: ${input.reason}.` : 'No reason given.',
    'Rank three alternatives for right now. Best pick first. Respect MT cap and posture constraints from the profile.',
  ]
  if (input.wellness) {
    const w: string[] = []
    if (input.wellness.sleepHours != null) w.push(`sleep ${input.wellness.sleepHours}h`)
    if (input.wellness.soreness != null) w.push(`soreness ${input.wellness.soreness}/5`)
    if (input.wellness.alcoholScale != null) w.push(`alcohol ${input.wellness.alcoholScale}/10`)
    if (w.length > 0) lines.push(`Wellness today: ${w.join(', ')}.`)
  }
  const completed = input.weekSessions.filter(s => s.status === 'completed')
  lines.push(`Completed so far this week: ${completed.length > 0 ? completed.map(s => SESSION_LABEL[s.type] ?? s.type).join(', ') : 'none'}.`)
  const remaining = input.weekSessions.filter(s => s.scheduledDate != null && s.scheduledDate > input.todayEpochDay && s.status !== 'skipped')
  if (remaining.length > 0) {
    lines.push('Remaining this week:')
    for (const s of remaining) {
      const dow = new Date((s.scheduledDate ?? 0) * 86400000).getUTCDay()
      lines.push(`  ${DAY_NAMES[dow]} ${(s.timeSlot ?? 'am').toUpperCase()}: ${SESSION_LABEL[s.type] ?? s.type}`)
    }
  }
  if (input.adherenceBlock) lines.push('', input.adherenceBlock)
  if (input.hrBlock) lines.push('', input.hrBlock)
  if (input.blockZeroContext) {
    lines.push('', input.blockZeroContext)
    lines.push('Only offer options inside these limits. coachLine is the one-line why for the top pick.')
  }
  lines.push('', 'Give exactly three options ranked best to worst. coachLine explains only the top pick. Voice canon.', jsonInstructionFor(TOOL_REPLACE_SUGGESTIONS))
  return lines.join('\n')
}

export async function runReplaceSuggestions(
  db: DB,
  apiKey: string,
  sessionId: string,
  todayEpochDay: number,
  reason: string | null,
): Promise<ReplaceSuggestionsOutput | null> {
  const [sess] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!sess) return null

  const weekStart = mondayOf(todayEpochDay)
  const weekEnd = weekStart + 6

  const [todayLog] = await db.select().from(dailyLogs).where(eq(dailyLogs.logDate, todayEpochDay))
  const weekSessions = await db
    .select({ type: sessions.type, scheduledDate: sessions.scheduledDate, timeSlot: sessions.timeSlot, status: sessions.status })
    .from(sessions)
    .where(and(gte(sessions.scheduledDate, weekStart), lte(sessions.scheduledDate, weekEnd)))

  const recentRuns = await loadRecentRunsForHr(db, todayEpochDay)
  const maxHr = await loadProfileMaxHrForHr(db)
  const hrBlock = serializeHrForPrompt(computeHrSnapshot(recentRuns, todayEpochDay, { maxHr, ceilingBpm: (await loadEasyHrCeiling(db, todayEpochDay)).bpm }))

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

  // Block Zero: rules context in the user message, guardrails on the output.
  const bzGuard = await loadBlockZeroGuardContext(db, todayEpochDay)
  const bzInput = bzGuard ? await loadBlockZeroAiContext(db, todayEpochDay) : null
  const prompt = buildReplacePrompt({
    session: { type: sess.type, timeSlot: sess.timeSlot },
    todayEpochDay,
    reason,
    wellness: todayLog ? { sleepHours: todayLog.sleepHours, soreness: todayLog.soreness, alcoholScale: todayLog.alcoholScale } : null,
    weekSessions,
    adherenceBlock,
    hrBlock,
    blockZeroContext: bzInput ? serializeBlockZeroContext(bzInput) : null,
  })

  const profile = await loadProfile(db)
  const starter = await computeStarterStatus(db, todayEpochDay, profile.trainingHistory, profile.constraints)
  const starterBlock = serializeStarterStatus(starter)
  const systemBlocks = buildSystemPrompt(profile, null, starterBlock || null)

  const result = await anthropicCall(apiKey, {
    model: MODELS.reasoning,
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low', format: jsonFormatFor(TOOL_REPLACE_SUGGESTIONS) },
    fallbacks: 'default',
    system: systemBlocks,
    messages: [{ role: 'user', content: prompt }],
  })

  if (result.offline) {
    console.warn('[replaceSuggestions] offline')
    return null
  }

  const output = getStructuredOutput<ReplaceSuggestionsOutput>(result)
  // The JSON format can't enforce "exactly three", so check it here.
  if (!output || !Array.isArray(output.suggestions) || output.suggestions.length === 0) {
    console.warn('[replaceSuggestions] no usable structured output')
    return null
  }
  output.suggestions = output.suggestions.slice(0, 3)

  let final = output
  let guardrails: ReturnType<typeof clampsForStorage> & { original?: ReplaceSuggestionsOutput } | null = null
  if (bzGuard) {
    const replaced = { id: sess.id, type: sess.type, epochDay: sess.scheduledDate ?? todayEpochDay, timeSlot: sess.timeSlot === 'pm' ? 'pm' as const : 'am' as const }
    const guarded = guardReplaceSuggestions(output, replaced, bzGuard)
    logClamps('replace_suggestions', guarded.clamps)
    final = guarded.output
    guardrails = { ...clampsForStorage(guarded.clamps), ...(guarded.clamps.length > 0 ? { original: output } : {}) }
  }

  await db.insert(coachingOutputs).values({
    id: crypto.randomUUID(),
    kind: 'replace_suggestions',
    model: result.model,
    scopeWeekPlanId: weekPlanId,
    scopeSessionId: sessionId,
    inputHash: null,
    outputJson: JSON.stringify(guardrails ? { ...final, guardrails } : final),
    tokensIn: result.usage.input_tokens,
    tokensOut: result.usage.output_tokens,
    cachedTokensIn: result.usage.cache_read_input_tokens ?? 0,
    createdAt: Math.floor(Date.now() / 1000),
  })

  return { ...final, coachLine: sanitizeVoice(final.coachLine) }
}

// Voice canon: strip em dashes in case the model slips. Cheap insurance.
function sanitizeVoice(s: string): string {
  return s.replace(/[\u2014\u2013]/g, ',').replace(/\s{2,}/g, ' ').trim()
}
