import { and, desc, eq, gt, gte, inArray, lte } from 'drizzle-orm'
import { summarizeOldWeeks } from '../lib/prompts/summarizer'
import { applyStoredBlockZeroTransition, getStoredBlockZeroAssessment, getStoredBlockZeroTransition, runBlockZeroAssessment, runBlockZeroTransition } from './routes/blockZero'
import { rebalanceForClassTonight } from './classTonight'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { cors } from 'hono/cors'

import { createDB } from '../db/client'
import { activeRecoverySessions, bagWorkRoundCombos, bagWorkRounds, blockTests, bodyMetrics, coachingOutputs, comboPerformance, combos, dailyLogs, exercises, journalEntries, mtClassLogs, postureSessionExercises, runSessions, sessions, settings, skipRopeSessions, strengthSessionExercises, strengthSets, trainingBlocks, trainingMaxes, userProfile, weekAdjustments, weekPlans, weeklyJournals } from '../db/schema'
import { isoToEpochDay, mondayOf } from '../lib/dates'
import { loggedAtSec } from '../lib/units'
import { adHocSessionSchema, blockTestsBodySchema, completeSessionSchema, dailyLogSchema, mtClassLogPatchSchema, strengthSetPatchSchema, userProfilePatchSchema } from '../lib/validators/schemas'
import { DAILY_MOBILITY_TEMPLATE, FR_WARMUP_TEMPLATE, legacyMobilityTemplates, type MobilityExerciseTemplate } from '../lib/mobilityTemplate'
import { FOUNDATION_LABEL, LEGACY_FOUNDATION_LABELS, estimateRoutineSec, foundationTemplate, strengthKindFromLabel, type FoundationInput } from '../lib/foundation'
import { SKIP_ROPE_REST_SEC } from '../lib/sessionResume'
import { validateNarutoPatch } from '../lib/naruto'
import { isLoggedWorkSet } from '../lib/loggedSets'
import { notesOnComplete } from '../lib/sessionNotes'
import { parseRoundSecs, plannedRoundMinutes, plannedStrengthMinutes } from '../lib/plannedLength'
import { RAMP_REST_SEC, accessoryLoadKg, accessoryProgression, loadEquipment, snapForChangeKg, snapIncreaseKg, snapLoadKg, warmupRamp, type LoadEquipment } from '../lib/strengthLoads'
import { idempotent } from './idempotency'
import { RUNNING_PLAN_TEMPLATE, ZONE2_PRESCRIPTION } from '../lib/runningPlanTemplate'
import { getStrengthTemplate, getWeekPercentage } from '../lib/strengthTemplates'
import { BLOCK_ZERO_BASE_WEEKS, allowedClassTypes, blockZeroTrainingWeek, getRunWalkWeek, mtRampWeek, strengthDayFor, prescribeRunWalk, runWalkTotalSec, validateTestResult } from '../lib/blockZero'
import { answerBody, applyBodyPlan, applyPendingBodyPlans, bodyWatchPayload, gotBodyNote, lowerLegOnWatch, markAgainstFlag, ravenLineFor, seenBodyNote } from './bodyWatch'
import { KEY_TYPES, KNOWN_SESSION_TYPES, LEAD_IN_CONTEXT, STRESS_REASONS, applyContext, bagRules, checkSessionChange, finishLine, isLeadInContext, estimatedMinutes, kneeSafeOnly, fallbackRoundTypes, governBagRounds, mergeContext, morningLine, pickDayOption, slotStart, strengthLetterFor, withMergedLifts, RAMP_LOAD_STEP, runAllowanceBaseSec } from '../lib/coach'
import { FIGHTER_DEFAULT_NAME, FIGHTER_DEFAULT_TOTAL_WEEKS, createTrainingBlock, dropEndedBlockPlans, endActiveBlocks } from './blocks'
import { computeAerobicFitness, computeWeeklyZones } from '../lib/historyHrMetrics'
import { CHART_WEEKS, CONSISTENCY_WEEKS, aerobicWeekly, buildRings, consistencyWeeks, currentStreak as ledgerStreak, pondReaction, sessionRings, sleepWeek, strengthWeekly, weightWeekly, type LedgerRange } from '../lib/ledger'
import { allBoardRows, boardSuggestions, computeSuggestions } from '../lib/sessionSuggestions'
import { prepareWeek, weekForClient, weekLineFor } from './weeklyPass'
import { applyFeltHard, applyTmUpdate, coachPushFrom, maybeRampUp } from './coachAsks'
import { addedWhy, applyPendingMerges, emptyState, lineChanges, markSeen, pmStart, rebalanceAfter, reasonWords, recordChanges, rolloverAndFix, snap, undoChange, weekChangeViews } from './changes'
import { runAthleteState } from '../lib/athleteState/runAthleteState'
import { loadEasyHrCeiling } from '../lib/hrAnalysis'
import { isZone2Run, stravaPlanLine } from '../lib/stravaMatch'
import { runSessionReview } from '../lib/sessionReviewAI'
import { assessRunCompletion, assessStrengthSet } from '../lib/trainingReality'
import { loadLiftTrends } from '../lib/athleteState/liftTrends'
import { loadLatestAthleteState, resolveEffectiveLift } from '../lib/athleteState/store'
import { runBagPrescription } from '../lib/bagPrescriptionAI'
import { runLedgerInsights, type LedgerInsightData } from '../lib/ledgerInsightsAI'
import { waybookEntries } from '../lib/waybook'
import { runReactiveReplan } from '../lib/reactiveCoach'
import { strava } from './routes/strava'
import { clearCollectedTrainingData } from './trainingReset'
import { checkMtClassForBlockZero, easeForReadiness, getActiveBlock, loadMtRamp, listBlockTests, planBlockZeroStrength, planSetWeightKg, readinessFor, recordCheckSetE1rm, todayEpochDayUtc, upsertBlockTest, type BlockZeroStrengthPlan } from './blockZeroData'
import { logs } from './routes/logs'
import { classCombos } from './routes/classCombos'
import {
  blockDayPlan,
  bodyPlanMark,
  currentBlockWeek,
  loadInjuryFlag,
  loadPlacementContext,
  isBlockLeadInDay,
  loadTemplateExtras,
  mtClassDays,
  startedAtForLocalDay,
  generateDaySessions,
  latestWeekPlan,
  loadSessionCoachState,
  resolveWeekPlan,
  returnContextFor,
  trainingWeekFor,
  weekStamps,
  type SessionCoachState,
} from './coachData'
import { EASED_RUN_FACTOR, adjustFighterRun, adjustFighterStrength, applyCoachPush, liftTrendReason } from './coachPrescribe'

type Bindings = {
  DB: D1Database
  ANTHROPIC_API_KEY: string
  STRAVA_CLIENT_ID: string
  STRAVA_CLIENT_SECRET: string
  STRAVA_WEBHOOK_VERIFY_TOKEN: string
  WAYMARK_API_KEY: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/*', cors({
  origin: ['https://waymark.bocas-joshua.workers.dev', 'capacitor://localhost', 'http://localhost:5173', 'http://localhost:8787'],
}))

// Auth: all /api/* routes require Bearer token except health check and Strava webhook
app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname.replace(/\/+$/, '')
  if (PUBLIC_API_PATHS.has(path)) {
    return next()
  }
  const key = c.env.WAYMARK_API_KEY
  const auth = c.req.header('Authorization')
  if (!key || !auth || !timingSafeEqualStr(auth, `Bearer ${key}`)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  return next()
})

// Strava calls the webhook; the OAuth pages are opened in a browser, which can't send the key.
// /authorize and /callback check a signed `state` instead (see routes/strava.ts).
const PUBLIC_API_PATHS = new Set([
  '/api/health',
  '/api/strava/webhook',
  '/api/strava/authorize',
  '/api/strava/callback',
  '/api/strava/success',
  '/api/strava/error',
])

// Constant-time string compare so the key can't be recovered byte by byte from response timing.
function timingSafeEqualStr(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  let diff = ea.length ^ eb.length
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  return diff === 0
}

app.route('/api/strava', strava)
app.route('/api/logs', logs)

// Writes the client retries carry an Idempotency-Key: a replay returns the
// first response and writes nothing (lib/idempotency). Must sit before the routes.
for (const path of [
  '/api/strength-sets/:id',
  '/api/sessions/:id/complete',
  '/api/sessions/:id/rate-combos',
  '/api/sessions/insert-ad-hoc',
  '/api/body-metrics',
  '/api/daily-logs',
  '/api/journal',
  '/api/class-combos/add',
  '/api/class-combos/decline',
]) {
  app.use(path, idempotent())
}

app.route('/api/class-combos', classCombos)

app.onError((err, c) => {
  console.error('[Waymark API Error]', err.message, err.stack)
  const status = 'status' in err && typeof err.status === 'number' ? err.status : 500
  return c.json(
    { error: status === 500 ? 'Internal server error' : err.message, code: status },
    status as ContentfulStatusCode,
  )
})

type DrizzleDB = ReturnType<typeof createDB>

function sessionCompletedOrCreatedAt(session: { completedAt: number | null; createdAt: number }): number {
  return session.completedAt ?? session.createdAt
}

// Shared strength-weight math. One source of truth for start-strength,
// buildWorkoutResponse, and strength-preview so prescription never drifts
// between what's previewed on Today and what's written at session start.
function computeWorkingWeightKg(
  trainingMaxKg: number | null,
  section: string | null,
  wavePct: number,
): number | null {
  if (trainingMaxKg == null) return null
  if (section === 'main') {
    return Math.round(trainingMaxKg * wavePct * 100) / 100
  }
  // Accessories ~60% of TM, core and durability no load: never 100% of a max.
  return accessoryLoadKg(trainingMaxKg, section)
}

/** Loading kind per exercise id, for plate snapping. */
function equipmentMap(rows: Array<{ id: string; equipment: string | null }>): Map<string, LoadEquipment> {
  return new Map(rows.map(r => [r.id, loadEquipment(r.equipment)]))
}

function computeWarmupWeightKg(trainingMaxKg: number | null): number | null {
  if (trainingMaxKg == null) return null
  return Math.round(trainingMaxKg * 0.5 * 100) / 100
}

// What today's Block Zero rules did to a strength session, for the response
// and sessions.context_json: auto-ease, back swaps, RIR-based loads.
function blockZeroPlanSummary(plan: BlockZeroStrengthPlan) {
  return {
    autoEase: plan.autoEase,
    backToday: plan.backToday,
    swaps: plan.swaps,
    loads: [...plan.loads.entries()].map(([exerciseId, l]) => ({ exerciseId, weightKg: l.weightKg, change: l.change, reason: l.reason })),
  }
}

async function buildWorkoutResponse(db: DrizzleDB, sessionId: string) {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  const sexes = await db.select().from(strengthSessionExercises)
    .where(eq(strengthSessionExercises.sessionId, sessionId))

  const exRows = await db.select().from(exercises)
  const exMap = new Map(exRows.map(e => [e.id, e]))

  // Fetch training maxes for prescription data
  const maxRows = await db.select().from(trainingMaxes)
  const tmMap = new Map(maxRows.map(m => [m.exerciseId, m.weightKg]))
  const blockWeek = session?.blockWeek ?? 1
  const blockType = (session?.blockType === 'block_zero' ? 'block_zero' : 'fighter') as 'fighter' | 'block_zero'
  const wavePct = getWeekPercentage(blockWeek, blockType)

  const result = []
  for (const se of sexes.sort((a, b) => a.orderIndex - b.orderIndex)) {
    const sets = await db.select().from(strengthSets)
      .where(eq(strengthSets.sessionExerciseId, se.id))
    sets.sort((a, b) => a.setNumber - b.setNumber)

    const exercise = exMap.get(se.exerciseId)
    const tmKg = tmMap.get(se.exerciseId) ?? null

    // Build prescription metadata
    const workingSets = sets.filter(s => s.isWarmup === 0)
    const setsCount = workingSets.length
    const targetReps = workingSets[0]?.reps ?? 0
    // Loads were written per set at start (RIR rules or TM x %, snapped to
    // plates); the last working set is the working load (a check set may lead).
    const written = workingSets.length > 0 ? workingSets[workingSets.length - 1].plannedWeightKg : null
    const fallback = computeWorkingWeightKg(tmKg, se.section, wavePct)
    const prescribedWeightKg = written ?? (fallback != null ? snapLoadKg(fallback, loadEquipment(exercise?.equipment)) : null)

    result.push({
      id: se.id,
      exerciseId: se.exerciseId,
      orderIndex: se.orderIndex,
      section: se.section,
      notes: se.notes,
      exercise: exercise ? { name: exercise.name, formCues: exercise.formCues, equipment: exercise.equipment, formVideoUrl: exercise.formVideoUrl } : null,
      sets,
      prescription: {
        trainingMaxKg: tmKg,
        wavePercentage: se.section === 'main' ? wavePct : null,
        prescribedWeightKg,
        setsReps: targetReps > 0 ? `${setsCount}×${targetReps}` : `${setsCount} sets`,
      },
    })
  }

  // The planned length from the session's own sets and rests (the done summary's "+N min").
  const plannedMin = plannedStrengthMinutes(result.flatMap(r => r.sets.map(st => ({ isWarmup: st.isWarmup, restSec: st.restSec }))))
  return { session, exercises: result, plannedMin }
}

/** A Block Zero strength session in the lead-in: the intro session (Part B). */
async function isLeadInStrength(db: DrizzleDB, session: { blockType: string | null; scheduledDate: number | null }): Promise<boolean> {
  if (session.blockType !== 'block_zero' || session.scheduledDate == null) return false
  return isBlockLeadInDay(await getActiveBlock(db), session.scheduledDate)
}

async function buildStrengthPreview(db: DrizzleDB, sessionId: string) {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!session) return null

  // Same template lookup logic as start-strength — keep in sync
  const epochDay = session.scheduledDate ?? 0
  const dateMs = epochDay * 86400 * 1000
  const dayOfWeek = new Date(dateMs).getUTCDay()
  const blockWeek = session.blockWeek ?? 1
  const blockType = (session.blockType === 'block_zero' ? 'block_zero' : 'fighter') as 'fighter' | 'block_zero'
  let template = getStrengthTemplate(dayOfWeek, blockWeek, blockType, session.label, { leadIn: await isLeadInStrength(db, session) })
  // A missed session's main lifts, when the coach moved them here (page 56 §5).
  template = withMergedLifts(template, session.contextJson, blockWeek, blockType)
  const wavePct = getWeekPercentage(blockWeek, blockType)
  // Same coach and Block Zero adjustments start-strength applies.
  const state = await loadSessionCoachState(db, session, Math.floor(Date.now() / 86400000))
  const push = applyCoachPush(template, coachPushFrom(session.contextJson), state)
  template = push.template
  const bzPlan = blockType === 'block_zero' ? await planBlockZeroStrength(db, session, template, coachStrengthInputs(state)) : null
  if (bzPlan) template = bzPlan.template
  const fighter = blockType === 'fighter' ? adjustFighterStrength(template, state) : null
  if (fighter) template = fighter.template

  const exRows = await db.select().from(exercises)
  const exMap = new Map(exRows.map(e => [e.id, e]))
  const maxRows = await db.select().from(trainingMaxes)
  const tmMap = new Map(maxRows.map(m => [m.exerciseId, m.weightKg]))

  const previewExercises = template.exercises.map((tex, orderIndex) => {
    const ex = exMap.get(tex.exerciseId)
    const tmKg = tmMap.get(tex.exerciseId) ?? null
    const workingSets = tex.sets.filter(s => !s.isWarmup)
    const setsCount = workingSets.length
    const targetReps = workingSets[0]?.targetReps ?? 0
    const bzLoad = tex.section === 'main' ? bzPlan?.loads.get(tex.exerciseId) : undefined
    const base = computeWorkingWeightKg(tmKg, tex.section, wavePct)
    const raw = bzLoad ? bzLoad.weightKg : base != null && fighter && tex.section === 'main' ? Math.round(base * fighter.loadMultiplier * Math.min(push.loadFactor, RAMP_LOAD_STEP) * 100) / 100 : base
    // Same plate snapping as start-strength, so the preview matches the bar.
    const prescribedWeightKg = raw != null ? snapForChangeKg(raw, loadEquipment(ex?.equipment), bzLoad?.change, bzLoad?.fromKg) : null

    return {
      exerciseId: tex.exerciseId,
      name: ex?.name ?? tex.label,
      label: tex.label,
      section: tex.section,
      orderIndex,
      prescription: {
        trainingMaxKg: tmKg,
        wavePercentage: tex.section === 'main' ? wavePct : null,
        prescribedWeightKg,
        setsReps: targetReps > 0 ? `${setsCount}×${targetReps}` : `${setsCount} sets`,
      },
    }
  })

  return {
    session,
    templateLabel: template.label,
    exercises: previewExercises,
    // The planned length from the template's sets and rests (the done summary's "+N min").
    plannedMin: plannedStrengthMinutes(template.exercises.flatMap(tex => tex.sets.map(st => ({ isWarmup: st.isWarmup, restSec: st.restSec })))),
    ...(bzPlan ? { blockZero: blockZeroPlanSummary(bzPlan) } : {}),
    coach: coachSummary(state, fighter),
  }
}

/** What the coach rules hand Block Zero strength planning. */
function coachStrengthInputs(state: SessionCoachState) {
  return { returnCtx: state.returnCtx, coachEase: state.coachEase, injury: state.injuryAction }
}

/** The coach's reasons for today's loads, for the response and context_json. */
function coachSummary(state: SessionCoachState, fighter: { loadMultiplier: number; noPush: boolean; notes: string[] } | null) {
  return {
    returnRamp: state.returnCtx.active ? { gapDays: state.returnCtx.plan.gapDays, tier: state.returnCtx.plan.tier, loadFactor: state.returnCtx.loadFactor, volumeFactor: state.returnCtx.volumeFactor, reason: state.returnCtx.reason } : null,
    coachEase: state.coachEase,
    injury: state.injury ? { region: state.injury.region, note: state.injuryAction.note } : null,
    ...(fighter ? { loadMultiplier: fighter.loadMultiplier, noPush: fighter.noPush, notes: fighter.notes } : {}),
  }
}

/** Mobility rows with their own prescription (reps, sides, notes, section). */
async function insertMobilityRows(db: DrizzleDB, sessionId: string, rows: MobilityExerciseTemplate[]) {
  for (let i = 0; i < rows.length; i++) {
    const t = rows[i]
    await db.insert(postureSessionExercises).values({
      id: crypto.randomUUID(),
      sessionId,
      exerciseId: t.exerciseId,
      orderIndex: i,
      holdSec: t.holdSec ?? null,
      sets: t.sets,
      completed: 0,
      reps: t.reps ?? null,
      perSide: t.perSide ? 1 : 0,
      notes: t.notes ?? null,
      section: t.section,
    })
  }
}

/** Block week for a session without a strength week: its week plan, else the active block's training week. */
async function blockWeekForSession(db: DrizzleDB, session: { weekPlanId: string | null }, epochDay: number): Promise<number> {
  if (session.weekPlanId) {
    const [wp] = await db.select({ weekNumber: weekPlans.weekNumber }).from(weekPlans).where(eq(weekPlans.id, session.weekPlanId))
    if (wp) return wp.weekNumber
  }
  const block = await getActiveBlock(db)
  return block ? (await trainingWeekFor(db, block, epochDay, epochDay)).week : 1
}

async function buildMobilityWorkoutResponse(db: DrizzleDB, sessionId: string) {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  const pExercises = await db.select().from(postureSessionExercises)
    .where(eq(postureSessionExercises.sessionId, sessionId))

  const exRows = await db.select().from(exercises)
  const exMap = new Map(exRows.map(e => [e.id, e]))

  // Rows written from 0028 carry their own reps, sides, notes and section.
  // Older rows fall back to the template the session type used (first match
  // wins), so a shared exercise (dead bugs, pigeon) shows its own cues.
  const templateMap = new Map<string, MobilityExerciseTemplate>()
  for (const t of legacyMobilityTemplates(session?.type)) if (!templateMap.has(t.exerciseId)) templateMap.set(t.exerciseId, t)

  const result = pExercises
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map(pe => {
      const exercise = exMap.get(pe.exerciseId)
      const stored = pe.notes != null || pe.reps != null || pe.section != null
      const tmpl = stored ? null : templateMap.get(pe.exerciseId)
      return {
        ...pe,
        section: stored ? pe.section : tmpl?.section ?? null,
        reps: stored ? pe.reps : tmpl?.reps ?? null,
        perSide: stored ? pe.perSide === 1 : tmpl?.perSide === true,
        exercise: exercise ? { name: exercise.name, formCues: exercise.formCues, equipment: exercise.equipment, formVideoUrl: exercise.formVideoUrl } : null,
        notes: stored ? pe.notes : tmpl?.notes ?? null,
      }
    })

  // The routine's planned length (Foundation, about 12 min): the done summary's "+N min".
  const routine = result.map(r => ({ exerciseId: r.exerciseId, label: r.exercise?.name ?? '', section: (r.section ?? 'dynamic') as MobilityExerciseTemplate['section'], sets: r.sets ?? 1, holdSec: r.holdSec ?? null, reps: r.reps ?? null, perSide: r.perSide }))
  const plannedMin = routine.length > 0 ? Math.max(1, Math.round(estimateRoutineSec(routine) / 60)) : null
  return { session, exercises: result, plannedMin }
}

async function missingExerciseIds(db: DrizzleDB, exerciseIds: string[]) {
  const rows = await db.select().from(exercises)
  const known = new Set(rows.map(row => row.id))
  return exerciseIds.filter(id => !known.has(id))
}

async function buildBagWorkResponse(db: DrizzleDB, sessionId: string) {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  const rounds = await db.select().from(bagWorkRounds).where(eq(bagWorkRounds.sessionId, sessionId))
  rounds.sort((a, b) => a.roundNumber - b.roundNumber)

  const allCombos = await db.select().from(combos)
  const comboMap = new Map(allCombos.map(c => [c.id, c]))

  const result = []
  for (const round of rounds) {
    const roundCombos = await db.select().from(bagWorkRoundCombos).where(eq(bagWorkRoundCombos.roundId, round.id))
    roundCombos.sort((a, b) => a.orderIndex - b.orderIndex)

    result.push({
      ...round,
      combos: roundCombos.map(rc => ({
        id: rc.id,
        orderIndex: rc.orderIndex,
        combo: comboMap.get(rc.comboId) ?? null,
      })),
    })
  }

  // What was planned and, once done, each round as it went (seconds per round, from the finish).
  const plannedMin = plannedRoundMinutes(rounds)
  const roundSecs = parseRoundSecs(JSON.stringify(parseJson<{ roundSecs?: unknown }>(session?.contextJson ?? null, {}).roundSecs ?? null))
  return { session, rounds: result, plannedMin, roundSecs }
}

const RUN_SESSION_TYPES = ['foundation_run', 'running']

// Run history the Block Zero guards need (R7 110% single run, R8 30% weekly),
// relative to the session's date. The session itself is left out so the
// prescription reads the same before and after it is logged.
async function loadRunGuardInputs(db: DrizzleDB, sessionId: string | null, weekPlanId: string | null, epochDay: number) {
  const dow = new Date(epochDay * 86400000).getUTCDay()
  const monday = epochDay - ((dow + 6) % 7)
  const historyStart = Math.min(epochDay - 30, monday - 14)

  const done = await db
    .select({ sessionId: sessions.id, scheduledDate: sessions.scheduledDate, durationSec: runSessions.durationSec })
    .from(runSessions)
    .innerJoin(sessions, eq(runSessions.sessionId, sessions.id))
    .where(and(eq(sessions.status, 'completed'), gte(sessions.scheduledDate, historyStart), lte(sessions.scheduledDate, monday + 6)))
  const others = done.filter(r => r.sessionId !== sessionId && r.scheduledDate != null)

  const longestLast30Sec = others
    .filter(r => r.scheduledDate! >= epochDay - 30 && r.scheduledDate! <= epochDay)
    .reduce((m, r) => Math.max(m, r.durationSec ?? 0), 0)
  const weekSec = (from: number) => others
    .filter(r => r.scheduledDate! >= from && r.scheduledDate! < from + 7)
    .reduce((sum, r) => sum + (r.durationSec ?? 0), 0)
  // R3 (page 56): the larger of the last two weeks, so one swap never shrinks next week's runs.
  const lastWeekRunSec = runAllowanceBaseSec(weekSec(monday - 7), weekSec(monday - 14))
  const thisWeekSoFarSec = others
    .filter(r => r.scheduledDate! >= monday && r.scheduledDate! <= monday + 6)
    .reduce((sum, r) => sum + (r.durationSec ?? 0), 0)

  const upcoming = await db.select({ id: sessions.id, type: sessions.type, status: sessions.status, weekPlanId: sessions.weekPlanId })
    .from(sessions)
    .where(and(gte(sessions.scheduledDate, epochDay), lte(sessions.scheduledDate, monday + 6)))
  // Only this week's plan counts, so planned runs left over from an ended block don't split the budget.
  const laterRuns = upcoming.filter(s => s.id !== sessionId && (weekPlanId == null || s.weekPlanId === weekPlanId) && RUN_SESSION_TYPES.includes(s.type) && (s.status === 'planned' || s.status === 'in_progress'))

  return {
    longestLast30Sec,
    weekly: { lastWeekRunSec, thisWeekSoFarSec, sessionsLeftThisWeek: laterRuns.length + 1 },
  }
}

// Block Zero run-walk: week shape from the rules module, capped by the run
// guards and the return ramp, under the shared easy-run HR ceiling. runType
// stays 'zone2' so the run screen keeps its easy-run framing and HR ceiling.
async function getBlockZeroRunPrescription(db: DrizzleDB, session: RunSessionInput, weekNumber: number, state: SessionCoachState) {
  const todayEpochDay = Math.floor(Date.now() / 86400000)
  const epochDay = session.scheduledDate ?? todayEpochDay
  const guards = await loadRunGuardInputs(db, session.id ?? null, session.weekPlanId, epochDay)
  // R9: talk test, else HRmax, else age. Compliance scoring reads the same ceiling.
  const ceiling = await loadEasyHrCeiling(db, epochDay)
  // F12/F13: the return ramp trims run time like the caps do.
  const ramp = state.returnCtx.active ? state.returnCtx : null
  // A raven's plan: the run comes back at an earlier week's shape (2:00 / 1:00 × 7, then 3:30 × 5).
  const shapeWeek = bodyPlanMark(session.contextJson ?? null)?.shapeWeek
  const runWeek = shapeWeek != null && shapeWeek < weekNumber ? shapeWeek : weekNumber
  const plannedSec = runWalkTotalSec(getRunWalkWeek(runWeek))
  // A coach ease: about 80% of the time, or the rebalance's rounds or minutes (page 56).
  const ease = state.coachEase
  const easeCap = ease?.kind === 'rounds' && ease.rounds != null
    ? { capSec: runWalkTotalSec({ ...getRunWalkWeek(runWeek), rounds: ease.rounds }), reason: ease.reason }
    : ease?.kind === 'reduce' ? { capSec: ease.capMin != null ? ease.capMin * 60 : Math.round(plannedSec * EASED_RUN_FACTOR), reason: ease.reason } : null
  const rampCap = ramp ? { capSec: Math.round(plannedSec * ramp.volumeFactor), reason: ramp.reason ?? 'Back from a break. Shorter today.' } : null
  const extraCap = rampCap && easeCap ? (easeCap.capSec < rampCap.capSec ? easeCap : rampCap) : rampCap ?? easeCap
  const p = prescribeRunWalk({ week: runWeek, ...guards, hrCeilingBpm: ceiling.bpm, extraCap })
  const base = {
    weekNumber: blockZeroTrainingWeek(weekNumber),
    runType: 'zone2',
    targetDesc: p.reasons.length > 0 ? `${p.targetDesc} ${p.reasons.join(' ')}` : p.targetDesc,
    targetDurSec: p.totalSec,
    targetDistKm: null,
    z2CeilingBpm: ceiling.bpm,
    runWalk: { runSec: p.runSec, walkSec: p.walkSec, rounds: p.rounds, warmupSec: p.warmupSec, capped: p.capped },
  }

  // Auto-ease: readiness or load says run down, an applied coach ease, or an
  // injury flag on the legs or back. The run becomes an easy walk or bike.
  const report = await readinessFor(db, epochDay)
  const eased = easeForReadiness(report, { type: 'foundation_run', label: 'Run-Walk', timeSlot: 'am', estimatedMin: Math.round(p.totalSec / 60) })
  const coachWhy = state.injuryAction.action === 'walk_or_bike' ? state.injuryAction.note : state.coachEase?.kind === 'run_to_walk' ? state.coachEase.reason : null
  if (!eased.eased && !coachWhy) return { ...base, autoEase: { eased: false, reason: null } }
  const min = eased.eased ? eased.session.estimatedMin : Math.min(30, Math.max(15, Math.round(p.totalSec / 60)))
  const reason = (eased.eased ? eased.reason : coachWhy) ?? 'Easy day.'
  return {
    ...base,
    targetDesc: `Easy walk or bike, ${min} min. Keep HR at or below ${ceiling.bpm} bpm. ${reason}`,
    targetDurSec: min * 60,
    runWalk: { runSec: 0, walkSec: 0, rounds: 0, warmupSec: min * 60, capped: p.capped },
    autoEase: { eased: true, reason },
  }
}

interface RunSessionInput {
  id?: string
  type?: string
  scheduledDate?: number | null
  weekPlanId: string | null
  blockWeek: number | null
  notes?: string | null
  blockType?: string | null
  contextJson?: string | null
}

// Helper: get running prescription for a session based on its training week and run category
async function getRunPrescription(db: DrizzleDB, session: RunSessionInput) {
  let weekNumber: number | null = null
  const todayEpochDay = Math.floor(Date.now() / 86400000)
  const epochDay = session.scheduledDate ?? todayEpochDay

  if (session.weekPlanId) {
    const [wp] = await db.select().from(weekPlans).where(eq(weekPlans.id, session.weekPlanId))
    if (wp) weekNumber = wp.weekNumber
  }

  if (weekNumber == null) {
    // Fallback: the active block's training week (paused through gaps)
    const block = await getActiveBlock(db)
    if (block) weekNumber = (await trainingWeekFor(db, block, epochDay, epochDay)).week
  }

  if (weekNumber == null) return null

  const state = await loadSessionCoachState(db, { type: session.type ?? 'running', scheduledDate: session.scheduledDate ?? null, contextJson: session.contextJson ?? null }, todayEpochDay)

  if (session.blockType === 'block_zero') {
    return getBlockZeroRunPrescription(db, session, weekNumber, state)
  }

  const { longestLast30Sec } = await loadRunGuardInputs(db, session.id ?? null, session.weekPlanId, epochDay)

  // Check if this is a Zone 2 run (tagged during generation)
  if (session.notes === 'zone2') {
    const ceiling = await loadEasyHrCeiling(db, epochDay)
    return adjustFighterRun({
      weekNumber: ZONE2_PRESCRIPTION.weekNumber,
      runType: ZONE2_PRESCRIPTION.runType,
      targetDesc: `${ZONE2_PRESCRIPTION.targetDesc} Keep HR at or below ${ceiling.bpm} bpm.`,
      targetDurSec: ZONE2_PRESCRIPTION.targetDurSec,
      targetDistKm: ZONE2_PRESCRIPTION.targetDistKm,
      z2CeilingBpm: ceiling.bpm,
    }, state, longestLast30Sec)
  }

  // Progression run: the training week picks the plan week
  const plan = RUNNING_PLAN_TEMPLATE.find(r => r.weekNumber === weekNumber)
  if (!plan) return null

  return adjustFighterRun({
    weekNumber: plan.weekNumber,
    runType: plan.runType,
    targetDesc: plan.targetDesc,
    targetDurSec: plan.targetDurSec,
    targetDistKm: plan.targetDistKm,
  }, state, longestLast30Sec)
}

/** The athlete's local today: `today` (YYYY-MM-DD) when sent, else the target day capped at UTC today, so tonight never reads as past. */
function localToday(today: unknown, targetDay?: number): number {
  if (typeof today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(today)) return isoToEpochDay(today)
  const utc = Math.floor(Date.now() / 86400000)
  return targetDay != null ? Math.min(targetDay, utc) : utc
}

app.get('/', (c) => {
  return c.text('Waymark Worker')
})

app.get('/api/health', (c) => {
  return c.json({ status: 'Waymark API running' })
})

// ─── Sessions ──────────────────────────────────────────────────

app.get('/api/sessions', async (c) => {
  const db = createDB(c.env)
  const rows = await db.select().from(sessions)
  return c.json(rows)
})

app.get('/api/sessions/today', async (c) => {
  const date = c.req.query('date')
  if (!date) return c.json({ error: 'date query param required' }, 400)

  const epochDay = isoToEpochDay(date)
  const db = createDB(c.env)
  // Silent rollover: any planned session dated before today becomes 'missed'.
  // Runs before the read so the client sees the rolled-over state.
  await rolloverAndFix(db, epochDay)
  // m16: an ended block's sessions still planned are not today's (done ones stay as history).
  const rows = await dropEndedBlockPlans(db, await db.select().from(sessions).where(eq(sessions.scheduledDate, epochDay)))

  // Attach run_sessions (Strava ingestion results) per session so Today can
  // render the confirm / orphan variants inline.
  const runs = rows.length > 0
    ? await db.select().from(runSessions)
    : []
  const runBySession = new Map(runs.map(r => [r.sessionId, r]))

  // Page 40: a run waiting for CONFIRM shows its plan line and the Zone 2 cap
  // (the clay band and "+N over cap" chip). Read only when one is waiting.
  const waiting = rows.some(s => runBySession.get(s.id)?.attachmentStatus === 'auto_pending')
  const easyCap = waiting ? (await loadEasyHrCeiling(db, epochDay)).bpm : null
  const [hrProfile] = waiting ? await db.select({ maxHr: userProfile.maxHr }).from(userProfile).where(eq(userProfile.id, 'default')) : []

  const enriched = rows.map(s => {
    const r = runBySession.get(s.id)
    if (!r) return s
    const pending = r.attachmentStatus === 'auto_pending'
    const zone2Cap = pending && isZone2Run(s) ? easyCap : null
    return {
      ...s,
      runSession: {
        id: r.id,
        stravaActivityId: r.stravaActivityId,
        attachmentStatus: r.attachmentStatus,
        source: r.source,
        distanceKm: r.distanceKm,
        durationSec: r.durationSec,
        paceSecKm: r.paceSecKm,
        avgHr: r.avgHr,
        maxHr: r.maxHr,
        elevationGainM: r.elevationGainM,
        zone2CapBpm: zone2Cap,
        planLine: pending ? stravaPlanLine(s, hrProfile?.maxHr ?? null, zone2Cap) : null,
      },
    }
  })

  enriched.sort((a, b) => (a.timeSlot === 'am' ? -1 : 1) - (b.timeSlot === 'am' ? -1 : 1))
  return c.json(enriched)
})

// Running sessions for the Mon-Sun week containing `date`. Used by the Strava
// reassign sheet so the user can move an auto-matched activity to another run.
app.get('/api/sessions/week-runs', async (c) => {
  const date = c.req.query('date')
  if (!date) return c.json({ error: 'date query param required' }, 400)

  const epochDay = isoToEpochDay(date)
  const d = new Date(`${date}T00:00:00Z`)
  const dow = d.getUTCDay() // 0=Sun..6=Sat
  const daysFromMon = (dow + 6) % 7
  const mondayEpoch = epochDay - daysFromMon
  const sundayEpoch = mondayEpoch + 6

  const db = createDB(c.env)
  await rolloverAndFix(db, epochDay)
  const rows = await db.select().from(sessions)
    .where(and(
      // Block Zero's runs are foundation_run; ingestion matches both, so the board offers both.
      inArray(sessions.type, ['running', 'foundation_run']),
      gte(sessions.scheduledDate, mondayEpoch),
      lte(sessions.scheduledDate, sundayEpoch),
    ))
  rows.sort((a, b) =>
    (a.scheduledDate ?? 0) - (b.scheduledDate ?? 0)
    || ((a.timeSlot === 'am' ? 0 : 1) - (b.timeSlot === 'am' ? 0 : 1))
  )
  return c.json(rows)
})

app.post('/api/sessions/generate-today', async (c) => {
  const body = await c.req.json<{ date: string }>()
  if (!body.date) return c.json({ error: 'date required' }, 400)

  const epochDay = isoToEpochDay(body.date)
  const nowSec = Math.floor(Date.now() / 1000)
  const db = createDB(c.env)

  // Idempotent: return the day if its template sessions exist. Ad-hoc adds
  // alone don't count, so an early add can't stop the template filling.
  const existing = await db.select().from(sessions).where(eq(sessions.scheduledDate, epochDay))
  const sortDay = <T extends { timeSlot: string | null }>(rows: T[]) => rows.sort((a, b) => (a.timeSlot === 'am' ? -1 : 1) - (b.timeSlot === 'am' ? -1 : 1))
  if (existing.some(s => s.source == null || s.source === 'template')) return c.json(sortDay(existing))

  // Template for the day's training week (paused through gaps), stamped
  // source 'template', in the week plan for this calendar week.
  const created = await generateDaySessions(db, epochDay, epochDay, nowSec)
  await applyPendingMerges(db, created.map(r => r.id))
  await applyPendingBodyPlans(db, created.map(r => r.id))
  const fresh = created.length > 0 ? await db.select().from(sessions).where(inArray(sessions.id, created.map(r => r.id))) : []
  return c.json(sortDay([...existing, ...fresh]))
})

// ─── Smart session suggestions ──────────────────────────────

app.get('/api/sessions/suggestions', async (c) => {
  const date = c.req.query('date')
  if (!date) return c.json({ error: 'date query param required' }, 400)

  const targetEpochDay = isoToEpochDay(date)
  const todayDay = localToday(c.req.query('today'), targetEpochDay)
  // The Replace board picks a swap, not an add: it keeps the wellness-only rows.
  const forReplace = c.req.query('mode') === 'replace'
  const db = createDB(c.env)
  await rolloverAndFix(db, todayDay)

  // Today's wellness
  const [todayLog] = await db.select().from(dailyLogs).where(eq(dailyLogs.logDate, targetEpochDay))
  const todayWellness = todayLog ? {
    sleepHours: todayLog.sleepHours,
    soreness: todayLog.soreness,
    herbScale: todayLog.herbScale,
    alcoholScale: todayLog.alcoholScale,
  } : null

  // Recent 7-day wellness averages
  const recentLogs = await db.select().from(dailyLogs).where(
    and(gte(dailyLogs.logDate, targetEpochDay - 7), lte(dailyLogs.logDate, targetEpochDay))
  )
  let recentWellness = null
  if (recentLogs.length > 0) {
    const sleepVals = recentLogs.filter(l => l.sleepHours != null).map(l => l.sleepHours!)
    const sorenessVals = recentLogs.filter(l => l.soreness != null).map(l => l.soreness!)
    recentWellness = {
      avgSleep: sleepVals.length > 0 ? sleepVals.reduce((a, b) => a + b, 0) / sleepVals.length : null,
      avgSoreness: sorenessVals.length > 0 ? sorenessVals.reduce((a, b) => a + b, 0) / sorenessVals.length : null,
    }
  }

  // Active block context: the training week, paused through gaps
  let blockWeek: number | null = null
  let blockType: string | null = null
  const block = await getActiveBlock(db)
  if (block) {
    blockType = block.blockType
    blockWeek = weekStamps(block, await trainingWeekFor(db, block, targetEpochDay, targetEpochDay)).strengthWeek
  }

  // This week's sessions (the Monday-Sunday plan week)
  const weekStart = mondayOf(targetEpochDay)
  const weekEnd = weekStart + 6
  const weekSessions = await db.select().from(sessions).where(
    and(gte(sessions.scheduledDate, weekStart), lte(sessions.scheduledDate, weekEnd))
  )

  // Existing sessions on the target date
  const existingOnDate = weekSessions
    .filter(s => s.scheduledDate === targetEpochDay)
    .map(s => ({ type: s.type, timeSlot: s.timeSlot ?? '' }))

  const result = computeSuggestions({
    todayWellness,
    recentWellness,
    weekSessions: weekSessions
      .filter(s => s.scheduledDate != null)
      .map(s => ({
        type: s.type,
        status: s.status,
        scheduledDate: s.scheduledDate as number,
        timeSlot: s.timeSlot ?? '',
    })),
    blockWeek,
    blockType,
    targetDate: targetEpochDay,
    existingSessionsOnDate: existingOnDate,
  })
  // The board (page 56 1B, 4A): every session, the coach's picks first, then
  // the rest with what is already on that day last. Nothing refused or greyed.
  const dayTypes = existingOnDate.map(s => s.type)
  if (forReplace) {
    const replacing = c.req.query('replacing') ?? null
    // A knee, ankle or shin flag, or one on watch (page 58): the knee-safe pick, not rope.
    const kneeSafe = kneeSafeOnly(await loadInjuryFlag(db, targetEpochDay)) || await lowerLegOnWatch(db)
    return c.json({ ...result, suggestions: boardSuggestions(allBoardRows(), { mode: 'replace', replacing, dayTypes, kneeSafe }) })
  }
  const board = boardSuggestions(allBoardRows(), { mode: 'add', dayTypes })
  if (!block) return c.json({ ...result, suggestions: board })

  // "+ Add session always adds" (page 56 item 4): every row can be picked and
  // carries no preview line. Strength on a day with no lifting pulls the week's
  // lightest remaining strength session here (R10).
  const ctx = await loadPlacementContext(db, targetEpochDay, todayDay)
  const rows = board.map(s => {
    const a = pickDayOption({ type: s.type, label: null, notes: s.type === 'running' ? s.runCategory ?? null : null, timeSlot: s.timeSlot }, targetEpochDay, ctx).action
    return {
      ...s,
      ...(a.label && s.type === 'strength' ? { label: a.label } : {}),
      flexibleTimeSlot: a.kind === 'add' ? s.flexibleTimeSlot : false,
      action: a,
    }
  })
  return c.json({ ...result, suggestions: rows })
})

// ─── Ad-hoc session insertion ────────────────────────────────

// "+ Add session always adds" (page 56 item 4): nothing is refused. The
// placement rules only shape it (strength first on a shared day puts a run in
// the PM); then the coach rebalances the rest of the week and records what it
// did. MT Class tonight runs the class-tonight rebalance (page 56 item 15).
app.post('/api/sessions/insert-ad-hoc', async (c) => {
  const raw = await c.req.json()
  const parsed = adHocSessionSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, 400)
  const body = parsed.data
  if (!KNOWN_SESSION_TYPES.has(body.type)) return c.json({ error: 'Unknown session type.' }, 400)

  const epochDay = isoToEpochDay(body.date)
  const nowSec = Math.floor(Date.now() / 1000)
  const db = createDB(c.env)
  const todayDay = localToday(body.today, epochDay)
  if (epochDay < todayDay) return c.json({ error: 'That day has passed.' }, 400)
  // m16: with no block running there is no week to add to (Today says to start one).
  if (!(await getActiveBlock(db))) return c.json({ error: 'No block running. Start Block Zero first.', code: 'no_block' }, 409)
  const runTag = body.type === 'running' ? (body.runCategory ?? null) : null

  const ctx = await loadPlacementContext(db, epochDay, todayDay)
  // Block Zero strength carries its letter (D8, R10): C after a heavy-leg day, else the one not yet in the week.
  const label = body.type === 'strength' && ctx.blockType === 'block_zero' && !/Strength [ABC]\b/.test(body.label ?? '')
    ? `Strength ${strengthLetterFor(epochDay, ctx.sessions.filter(s => s.epochDay >= mondayOf(epochDay) && s.epochDay <= mondayOf(epochDay) + 6), ctx.leadIn === true)}`
    : body.type === 'mt_class' && ctx.blockType === 'block_zero' ? 'MT Technique' : body.label ?? null
  const check = checkSessionChange({ kind: 'add', type: body.type, label, notes: runTag, epochDay, timeSlot: body.timeSlot }, ctx, { alternatives: false })
  const timeSlot = check.ok ? check.change.timeSlot : body.timeSlot

  let weekPlanId: string | null = null
  let blockWeek: number | null = null
  let blockType = 'fighter'
  const block = await getActiveBlock(db)
  if (block) {
    const stamps = weekStamps(block, await trainingWeekFor(db, block, epochDay, todayDay))
    weekPlanId = await resolveWeekPlan(db, block.id, stamps.weekNumber, mondayOf(epochDay), nowSec)
    blockWeek = body.type === 'strength' ? stamps.strengthWeek : null
    blockType = block.blockType
  }

  const id = crypto.randomUUID()
  const notes = check.ok ? check.notes : []
  const addCtx = {
    ...(notes.length > 0 ? { placement: { notes, estimatedMin: check.ok ? check.change.estimatedMin ?? null : null } } : {}),
    ...(ctx.leadIn ? LEAD_IN_CONTEXT : {}),
  }
  await db.insert(sessions).values({
    id,
    type: body.type,
    label,
    weekPlanId,
    scheduledDate: epochDay,
    timeSlot,
    blockWeek,
    blockType,
    status: 'planned',
    notes: runTag,
    source: 'ad_hoc',
    ...(Object.keys(addCtx).length > 0 ? { contextJson: JSON.stringify(addCtx) } : {}),
    createdAt: nowSec,
  })

  const setId = crypto.randomUUID()
  const showName = (label ?? body.label ?? TYPE_WORDS[body.type] ?? body.type).toUpperCase()
  const addIds = await recordChanges(db, [{
    setId, actor: 'you', kind: 'add', targetSessionId: id, sessionType: body.type, weekPlanId,
    before: emptyState(epochDay),
    after: { ...emptyState(epochDay, `+ ${showName}`), created: [id] },
    why: addedWhy(epochDay, timeSlot, todayDay),
    undoUntil: slotStart(epochDay, timeSlot, await pmStart(db)),
  }], nowSec)
  // Page 58 / 57 T4: a pick of what the coach leaves out for a place on watch is noted quietly. Never refused.
  await markAgainstFlag(db, addIds, body.type, runTag, epochDay)
  if (body.type === 'mt_class' && epochDay === todayDay) await rebalanceForClassTonight(db, id, setId, todayDay, nowSec)
  else await rebalanceAfter(db, { kind: 'add', sessionId: id, reason: null }, setId, todayDay, nowSec)

  const [row] = await db.select().from(sessions).where(eq(sessions.id, id))
  return c.json(notes.length > 0 ? { ...row, coach: { notes } } : row)
})

// "Strength today" on a day with no lifting (R10): the week's remaining
// strength session lightest on the legs comes to this day and what was planned
// here takes its old day. His pick: never refused. The coach then rebalances.
app.post('/api/sessions/:id/pull-forward', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ date?: string; timeSlot?: string; today?: string }>().catch(() => ({} as { date?: string; timeSlot?: string; today?: string }))
  if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return c.json({ error: 'date (YYYY-MM-DD) required' }, 400)
  const slot: 'am' | 'pm' = body.timeSlot === 'pm' ? 'pm' : 'am'
  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)
  const [session] = await db.select().from(sessions).where(eq(sessions.id, id))
  if (!session || session.scheduledDate == null) return c.json({ error: 'session not found' }, 404)
  if (session.status !== 'planned' || session.type !== 'strength') return c.json({ error: 'Only a planned strength session can come forward.' }, 400)
  const epochDay = isoToEpochDay(body.date)
  const todayDay = localToday(body.today, epochDay)
  const from = session.scheduledDate
  const displacedRows = (await db.select().from(sessions).where(eq(sessions.scheduledDate, epochDay)))
    .filter(s => s.status === 'planned' && KEY_TYPES.has(s.type))
  const strengthAfter = applyContext(session.contextJson, { movedFrom: { epochDay: from, timeSlot: session.timeSlot }, pulledForward: true })
  const writes = [
    db.update(sessions).set({ scheduledDate: epochDay, timeSlot: slot, contextJson: strengthAfter }).where(eq(sessions.id, id)),
    ...displacedRows.map(d => db.update(sessions).set({
      scheduledDate: from,
      contextJson: applyContext(d.contextJson, { movedFrom: { epochDay, timeSlot: d.timeSlot } }),
    }).where(eq(sessions.id, d.id))),
  ]
  await db.batch(writes as unknown as Parameters<typeof db.batch>[0])
  const setId = crypto.randomUUID()
  const dayWord = (d: number) => ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][new Date(d * 86400000).getUTCDay()]
  await recordChanges(db, [{
    setId, actor: 'you', kind: 'pull_forward', targetSessionId: id, sessionType: 'strength', weekPlanId: session.weekPlanId,
    before: { show: dayWord(from), day: epochDay, sessions: [snap(session, ['scheduledDate', 'timeSlot'], ['movedFrom', 'pulledForward']), ...displacedRows.map(d => snap(d, ['scheduledDate'], ['movedFrom']))] },
    after: {
      show: dayWord(epochDay), day: epochDay,
      sessions: [snap({ ...session, scheduledDate: epochDay, timeSlot: slot, contextJson: strengthAfter }, ['scheduledDate', 'timeSlot'], ['movedFrom', 'pulledForward']),
        ...displacedRows.map(d => snap({ ...d, scheduledDate: from, contextJson: applyContext(d.contextJson, { movedFrom: { epochDay, timeSlot: d.timeSlot } }) }, ['scheduledDate'], ['movedFrom']))],
    },
    why: `${session.label ?? 'Strength'} came forward from ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(from * 86400000).getUTCDay()]}.`,
    undoUntil: slotStart(epochDay, slot, await pmStart(db)),
  }], nowSec)
  await rebalanceAfter(db, { kind: 'pull_forward', sessionId: id, reason: null }, setId, todayDay, nowSec)
  const [moved] = await db.select().from(sessions).where(eq(sessions.id, id))
  const others = displacedRows.length > 0 ? await db.select().from(sessions).where(inArray(sessions.id, displacedRows.map(d => d.id))) : []
  return c.json({ session: moved, displaced: others })
})

// ─── Replace a session with a different one ──────────────────

// REPLACE = pick + done (page 56 item 1): the reason is optional, the swap is
// instant and never refused. The coach then rebalances (no AI in the loop).
app.post('/api/sessions/:id/replace', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{
    reason?: string | null
    type: string
    label?: string
    timeSlot: 'am' | 'pm'
    runCategory?: string
    today?: string
  }>()

  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)

  const [original] = await db.select().from(sessions).where(eq(sessions.id, id))
  if (!original) return c.json({ error: 'session not found' }, 404)
  if (original.status !== 'planned') return c.json({ error: 'session is not replaceable' }, 400)
  if (!KNOWN_SESSION_TYPES.has(body.type)) return c.json({ error: 'Unknown session type.' }, 400)
  if (body.timeSlot !== 'am' && body.timeSlot !== 'pm') return c.json({ error: 'timeSlot must be am or pm' }, 400)

  const scheduledDate = original.scheduledDate ?? isoToEpochDay(new Date().toISOString().split('T')[0])
  const todayDay = localToday(body.today, scheduledDate)
  const reasonCode = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null
  const words = reasonWords(reasonCode)
  const skipLine = words ? `Replaced: ${words.toLowerCase()}` : 'Replaced'
  const priorNotes = (original.notes ?? '').trim()
  const updatedNotes = priorNotes ? `${skipLine}\n${priorNotes}` : skipLine
  const runTag = body.type === 'running' ? (body.runCategory ?? null) : null
  const label = body.type === 'strength' && original.blockType === 'block_zero' && !/Strength [ABC]\b/.test(body.label ?? '')
    ? `Strength ${strengthLetterFor(scheduledDate, (await loadPlacementContext(db, scheduledDate, todayDay)).sessions.filter(s => s.epochDay >= mondayOf(scheduledDate) && s.epochDay <= mondayOf(scheduledDate) + 6), false)}`
    : body.label ?? null

  const weekPlanId = original.weekPlanId ?? (await stampsForDay(db, scheduledDate, todayDay, nowSec)).weekPlanId
  const swapSource = { userSkipReason: reasonCode, originalSessionId: id, targetEpochDay: scheduledDate, originalType: original.type, swapToLabel: label }
  const newId = crypto.randomUUID()
  await db.batch([
    db.update(sessions).set({ status: 'skipped', notes: updatedNotes, skipReason: reasonCode }).where(eq(sessions.id, id)),
    db.insert(sessions).values({
      id: newId,
      type: body.type,
      label,
      weekPlanId,
      scheduledDate,
      timeSlot: body.timeSlot,
      blockWeek: body.type === 'strength' ? original.blockWeek : null,
      blockType: original.blockType,
      status: 'planned',
      notes: runTag,
      source: 'replace',
      // A swap in the lead-in stays optional like what it replaced (Part B).
      contextJson: JSON.stringify({ replaced: swapSource, ...(isLeadInContext(original.contextJson) ? LEAD_IN_CONTEXT : {}) }),
      createdAt: nowSec,
    }),
  ] as unknown as Parameters<typeof db.batch>[0])

  const setId = crypto.randomUUID()
  const nameOf = (s: { type: string; label: string | null; notes: string | null }) => (s.label ?? TYPE_WORDS[s.type] ?? s.type).toUpperCase()
  const swapIds = await recordChanges(db, [{
    setId, actor: 'you', kind: 'swap', targetSessionId: id, sessionType: body.type, weekPlanId,
    before: { show: nameOf(original), day: scheduledDate, sessions: [snap(original, ['status', 'notes', 'skipReason'])] },
    after: { show: nameOf({ type: body.type, label, notes: runTag }), day: scheduledDate, sessions: [{ id, f: { status: 'skipped', notes: updatedNotes, skipReason: reasonCode } }], created: [newId] },
    why: words ? `${words}.` : 'Your call.',
    undoUntil: slotStart(scheduledDate, body.timeSlot, await pmStart(db)),
    extraSource: { reason: reasonCode },
  }], nowSec)
  await markAgainstFlag(db, swapIds, body.type, runTag, scheduledDate)
  await rebalanceAfter(db, { kind: 'swap', sessionId: newId, replacedId: id, reason: reasonCode }, setId, todayDay, nowSec)

  const [replaced] = await db.select().from(sessions).where(eq(sessions.id, id))
  const [created] = await db.select().from(sessions).where(eq(sessions.id, newId))
  return c.json({ original: replaced, replacement: created })
})

/** Plain names for a session type, for the change flaps ("BAG WORK"). */
const TYPE_WORDS: Record<string, string> = {
  strength: 'Strength', foundation_run: 'Run-Walk', running: 'Run', bag_work: 'Bag Work', skip_rope: 'Skip Rope',
  mt_class: 'MT Class', mobility: 'Foundation', active_recovery: 'Reset',
}

const SESSION_STATUSES = new Set(['planned', 'in_progress', 'completed', 'skipped', 'missed'])

app.patch('/api/sessions/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{
    status?: string
    startedAt?: number
    completedAt?: number
    durationSec?: number
    rpe?: number
    difficulty?: number
    notes?: string
    skipReason?: string
    skipReasonDetail?: string | null
    today?: string
  }>()

  if (body.status !== undefined && !SESSION_STATUSES.has(body.status)) return c.json({ error: 'Unknown status.' }, 400)
  const db = createDB(c.env)
  const [before] = await db.select().from(sessions).where(eq(sessions.id, id))
  const updates: Record<string, unknown> = {}

  if (body.status !== undefined) updates.status = body.status
  if (body.startedAt !== undefined) updates.startedAt = body.startedAt
  if (body.completedAt !== undefined) updates.completedAt = body.completedAt
  if (body.durationSec !== undefined) updates.durationSec = body.durationSec
  if (body.rpe !== undefined) updates.rpe = body.rpe
  if (body.difficulty !== undefined) updates.difficulty = body.difficulty
  if (body.notes !== undefined) updates.notes = body.notes

  if (body.status === 'skipped') {
    if (body.skipReason !== undefined) updates.skipReason = body.skipReason || null
    if (body.skipReasonDetail !== undefined) updates.skipReasonDetail = body.skipReasonDetail || null
  }

  await db.update(sessions).set(updates).where(eq(sessions.id, id))

  const [row] = await db.select().from(sessions).where(eq(sessions.id, id))

  // SKIP is instant (page 56 item 3): recorded as his change, then the coach rebalances.
  if (body.status === 'skipped' && row && before && before.status === 'planned' && row.scheduledDate != null) {
    const nowSec = Math.floor(Date.now() / 1000)
    const todayDay = localToday(body.today, row.scheduledDate)
    const setId = crypto.randomUUID()
    const words = reasonWords(row.skipReason)
    const [changeId] = await recordChanges(db, [{
      setId, actor: 'you', kind: 'skip', targetSessionId: id, sessionType: row.type, weekPlanId: row.weekPlanId,
      before: { show: (row.label ?? TYPE_WORDS[row.type] ?? row.type).toUpperCase(), day: row.scheduledDate, sessions: [snap(before, ['status', 'skipReason', 'skipReasonDetail'])] },
      after: { show: 'SKIPPED', day: row.scheduledDate, sessions: [snap(row, ['status', 'skipReason', 'skipReasonDetail'])] },
      why: words ? `Skipped. ${words}.` : 'Skipped.',
      undoUntil: slotStart(row.scheduledDate, row.timeSlot, await pmStart(db)),
    }], nowSec)
    await rebalanceAfter(db, { kind: 'skip', sessionId: id, reason: row.skipReason }, setId, todayDay, nowSec)
    return c.json({ session: row, changeId: changeId ?? null })
  }

  return c.json(row)
})

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

/** Session stamps (plan, block, strength week) for a session landing on a day. */
async function stampsForDay(db: DrizzleDB, epochDay: number, todayDay: number, nowSec: number) {
  const block = await getActiveBlock(db)
  if (!block) return { weekPlanId: null as string | null, blockType: 'fighter', strengthWeek: null as number | null }
  const stamps = weekStamps(block, await trainingWeekFor(db, block, epochDay, todayDay))
  return {
    weekPlanId: await resolveWeekPlan(db, block.id, stamps.weekNumber, mondayOf(epochDay), nowSec),
    blockType: block.blockType,
    strengthWeek: stamps.strengthWeek,
  }
}

// ─── Changes: the day's back, the week log, UNDO ──────────────

// Every change this week, his and the coach's (page 56 items 5-11), with the
// rune per day. ?today=YYYY-MM-DD is the athlete's local day.
app.get('/api/weeks/:monday/changes', async (c) => {
  const monday = c.req.param('monday')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(monday)) return c.json({ error: 'monday must be YYYY-MM-DD' }, 400)
  const db = createDB(c.env)
  const day = isoToEpochDay(monday)
  return c.json(await weekChangeViews(db, mondayOf(day), localToday(c.req.query('today'), day)))
})

// The day's back opened: its changes are seen (the rune dims).
app.post('/api/changes/seen', async (c) => {
  const body = await c.req.json<{ ids?: unknown }>().catch(() => ({} as { ids?: unknown }))
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string').slice(0, 100) : []
  const n = await markSeen(createDB(c.env), ids, Math.floor(Date.now() / 1000))
  return c.json({ seen: n })
})

// UNDO until the session starts (page 56 items 8-10). A coach change undone
// is held: the coach leaves that session alone this week.
app.post('/api/changes/:id/undo', async (c) => {
  const body = await c.req.json<{ today?: string }>().catch(() => ({} as { today?: string }))
  const db = createDB(c.env)
  const out = await undoChange(db, c.req.param('id'), localToday(body.today), Math.floor(Date.now() / 1000))
  if (!out.ok) return c.json({ error: out.error, lock: out.lock ?? null }, out.status)
  return c.json(out)
})

// A reason tile on an instant SKIP (page 56 item 3): the reason goes onto his
// change and the session; a stress reason (ROUGH DAY) lets the coach ease the
// next hard day (R8).
app.patch('/api/changes/:id/reason', async (c) => {
  const body = await c.req.json<{ reason?: string | null; detail?: string | null; today?: string }>().catch(() => ({} as { reason?: string | null; detail?: string | null; today?: string }))
  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)
  const [row] = await db.select().from(weekAdjustments).where(eq(weekAdjustments.id, c.req.param('id')))
  if (!row || row.kind !== 'skip' || row.actor !== 'you' || !row.targetSessionId) return c.json({ error: 'change not found' }, 404)
  const reason = typeof body.reason === 'string' && body.reason ? body.reason : null
  const detail = typeof body.detail === 'string' && body.detail ? body.detail.slice(0, 200) : null
  const [session] = await db.select().from(sessions).where(eq(sessions.id, row.targetSessionId))
  if (!session || session.status !== 'skipped') return c.json({ error: 'session is not skipped' }, 409)
  await db.update(sessions).set({ skipReason: reason, skipReasonDetail: detail }).where(eq(sessions.id, session.id))
  const words = reasonWords(reason)
  const after = parseJson<Record<string, unknown>>(row.afterJson, {})
  const snaps = (after.sessions as Array<{ id: string; f: Record<string, unknown> }> | undefined) ?? []
  const fixed = snaps.map(s => (s.id === session.id ? { ...s, f: { ...s.f, skipReason: reason, skipReasonDetail: detail } } : s))
  const why = words ? `Skipped. ${words}${detail ? `: ${detail}` : ''}.` : 'Skipped.'
  await db.update(weekAdjustments).set({ why, reason: why, afterJson: JSON.stringify({ ...after, sessions: fixed }) }).where(eq(weekAdjustments.id, row.id))
  const added = reason && STRESS_REASONS.has(reason) && row.changeSetId && session.scheduledDate != null
    ? await rebalanceAfter(db, { kind: 'skip', sessionId: session.id, reason }, row.changeSetId, localToday(body.today, session.scheduledDate), nowSec)
    : []
  return c.json({ ok: true, coachChanges: added.length })
})

// One quiet line (page 56 item 12): the morning alarm (?for=morning&day=the
// alarm's day) and the Live Activity finish card (?for=finish&day=today).
app.get('/api/coach/line', async (c) => {
  const db = createDB(c.env)
  const today = localToday(c.req.query('today'))
  const dayQ = c.req.query('day')
  const day = dayQ && /^\d{4}-\d{2}-\d{2}$/.test(dayQ) ? isoToEpochDay(dayQ) : today
  const changes = await lineChanges(db, day, today)
  // The morning alarm carries the raven (page 58 item 14): once if its note is unread, and on each return morning.
  const raven = c.req.query('for') === 'finish' ? null : await ravenLineFor(db, day, today, Math.floor(Date.now() / 1000)).catch(() => null)
  const line = c.req.query('for') === 'finish' ? finishLine(changes, day) : morningLine(changes, day, raven)
  return c.json({ line })
})

// ─── Injury weather and the raven (page 58) ──────────────────

// The morning pass, then the raven, its boards and the weather for Today,
// Program, the Ledger and the Library (and the check-in's "<Place> today").
app.get('/api/body/watch', async (c) => {
  const db = createDB(c.env)
  const today = localToday(c.req.query('today'))
  return c.json(await bodyWatchPayload(db, today, Math.floor(Date.now() / 1000)))
})

// DO IT: the plan goes on the week as coach changes (Dagaz, UNDO).
app.post('/api/body/watch/:id/apply', async (c) => {
  const db = createDB(c.env)
  const body = await c.req.json<{ today?: string }>().catch(() => ({} as { today?: string }))
  const out = await applyBodyPlan(db, c.req.param('id'), localToday(body.today), Math.floor(Date.now() / 1000))
  return out.ok ? c.json(out) : c.json({ error: out.error }, out.status)
})

// GOT IT: read; nothing changes on the week.
app.post('/api/body/watch/:id/got', async (c) => {
  const db = createDB(c.env)
  const out = await gotBodyNote(db, c.req.param('id'), Math.floor(Date.now() / 1000))
  return out.ok ? c.json(out) : c.json({ error: out.error }, out.status)
})

// The raven's note was opened: it stops looking round.
app.post('/api/body/watch/:id/seen', async (c) => {
  const db = createDB(c.env)
  const out = await seenBodyNote(db, c.req.param('id'), Math.floor(Date.now() / 1000))
  return out.ok ? c.json(out) : c.json({ error: out.error }, out.status)
})

// The raven's question: better | sore | not_now (Not now waits a day).
app.post('/api/body/watch/:id/answer', async (c) => {
  const db = createDB(c.env)
  const body = await c.req.json<{ answer?: string; today?: string }>().catch(() => ({} as { answer?: string; today?: string }))
  const answer = body.answer === 'better' || body.answer === 'sore' || body.answer === 'not_now' ? body.answer : null
  if (!answer) return c.json({ error: 'answer must be better, sore or not_now' }, 400)
  const out = await answerBody(db, c.req.param('id'), answer, localToday(body.today), Math.floor(Date.now() / 1000))
  return out.ok ? c.json(out) : c.json({ error: out.error }, out.status)
})

// ─── Strength Workout ──────────────────────────────────────────

app.post('/api/sessions/:id/start-strength', async (c) => {
  const sessionId = c.req.param('id')
  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!session) return c.json({ error: 'session not found' }, 404)
  if (session.type !== 'strength') return c.json({ error: 'not a strength session' }, 400)

  // If already started, return existing workout
  const existingExercises = await db.select().from(strengthSessionExercises)
    .where(eq(strengthSessionExercises.sessionId, sessionId))
  if (existingExercises.length > 0) {
    return c.json(await buildWorkoutResponse(db, sessionId))
  }

  // Determine template from scheduled date + block week
  const epochDay = session.scheduledDate ?? 0
  const dateMs = epochDay * 86400 * 1000
  const dayOfWeek = new Date(dateMs).getUTCDay()
  const blockWeek = session.blockWeek ?? 1
  const blockType = (session.blockType === 'block_zero' ? 'block_zero' : 'fighter') as 'fighter' | 'block_zero'

  let template = getStrengthTemplate(dayOfWeek, blockWeek, blockType, session.label, { leadIn: await isLeadInStrength(db, session) })
  // A missed session's main lifts, when the coach moved them here (page 56 §5).
  template = withMergedLifts(template, session.contextJson, blockWeek, blockType)
  const weekPct = getWeekPercentage(blockWeek, blockType)

  // Coach state: return ramp after a gap (F12/F13), an applied coach ease, injury flags (F16).
  const state = await loadSessionCoachState(db, session, Math.floor(Date.now() / 86400000))

  // Block Zero: back swaps, auto-ease, the return ramp and RIR-based loads for today.
  // An accepted push (ramp-up ask), skipped on a day the rules ease.
  const push = applyCoachPush(template, coachPushFrom(session.contextJson), state)
  template = push.template
  const loadReasons: string[] = push.note ? [push.note] : []
  let bzPlan: BlockZeroStrengthPlan | null = null
  if (blockType === 'block_zero') {
    bzPlan = await planBlockZeroStrength(db, session, template, coachStrengthInputs(state))
    template = bzPlan.template
  }
  // Fighter: the same inputs trim sets and scale TM x wave.
  const fighter = blockType === 'fighter' ? adjustFighterStrength(template, state) : null
  if (fighter) template = fighter.template

  // Block Zero templates use exercises from migrations 0022 and 0026; fail clearly if
  // the library is behind instead of tripping a foreign key mid-insert.
  const missingIds = await missingExerciseIds(db, [...new Set(template.exercises.map(e => e.exerciseId))])
  if (missingIds.length > 0) {
    return c.json({ error: 'strength exercises missing', missingExerciseIds: missingIds }, 409)
  }

  // Get training maxes for weight suggestions
  const maxes = await db.select().from(trainingMaxes)
  const maxMap = new Map(maxes.map(m => [m.exerciseId, m.weightKg]))
  const equipmentById = equipmentMap(await db.select({ id: exercises.id, equipment: exercises.equipment }).from(exercises))
  const liftTrends = await loadLiftTrends(db, Math.floor(Date.now() / 86400000))
  // Phase 3: the AI verdict from the latest AthleteState wins per-lift; fall back
  // to the deterministic trend when no state has assessed that lift.
  const latestState = await loadLatestAthleteState(db)
  const stateLiftById = new Map((latestState?.lifts ?? []).map(l => [l.exerciseId, l]))

  // Create exercises and sets
  for (let exIdx = 0; exIdx < template.exercises.length; exIdx++) {
    const tex = template.exercises[exIdx]
    const exId = crypto.randomUUID()

    await db.insert(strengthSessionExercises).values({
      id: exId,
      sessionId,
      exerciseId: tex.exerciseId,
      orderIndex: exIdx,
      section: tex.section,
      notes: tex.notes ?? null,
    })

    const trainingMax = maxMap.get(tex.exerciseId) ?? null
    const equipment = equipmentById.get(tex.exerciseId) ?? 'none'
    const trend = liftTrends.get(tex.exerciseId)
    const effective = resolveEffectiveLift(trend, stateLiftById.get(tex.exerciseId))
    // Right after a gap, or on an eased day, the trend / AI factor may not push.
    const trendFactor = fighter?.noPush ? Math.min(1, effective.loadFactor) : effective.loadFactor
    // MORE WEIGHT on top of a trend push never goes past +5% a session.
    const pushFactor = fighter && tex.section === 'main' && push.loadFactor > 1 ? Math.min(push.loadFactor, RAMP_LOAD_STEP / Math.max(1, trendFactor)) : 1
    const coachFactor = fighter && tex.section === 'main' ? fighter.loadMultiplier * pushFactor : 1
    if (fighter && tex.section === 'main' && trendFactor !== 1) {
      const why = liftTrendReason(tex.label, trendFactor)
      if (why) loadReasons.push(why)
    }
    const baseWorking = computeWorkingWeightKg(trainingMax, tex.section, weekPct)
    // Block Zero: the last RIR-logged top set sets the load; TM x % only until one exists.
    const bzLoad = tex.section === 'main' ? bzPlan?.loads.get(tex.exerciseId) : undefined
    if (bzLoad && bzLoad.change !== 'hold' && bzLoad.reason) loadReasons.push(`${tex.label}: ${bzLoad.reason}`)

    const planned = tex.sets.map(ts => {
      const templateWeight = ts.suggestedWeightKg ?? null
      // Check sets (Block Zero weeks 3 and 6) run ~10% above the working load.
      const adjustedWorking = baseWorking == null
        ? null
        : Math.round(baseWorking * trendFactor * coachFactor * (ts.loadMultiplier ?? 1) * 100) / 100
      const raw = templateWeight ?? (ts.isWarmup
        ? computeWarmupWeightKg(trainingMax)
        : bzLoad ? planSetWeightKg(bzLoad, ts) : adjustedWorking)
      // Snap to what the bar or rack can load. An increase takes the next
      // loadable step, so a small upper-body step still moves the bar.
      const weightKg = raw == null || templateWeight != null || ts.isWarmup
        ? raw
        : snapForChangeKg(raw, equipment, ts.loadMultiplier == null ? bzLoad?.change : 'hold', bzLoad?.fromKg)
      return { isWarmup: ts.isWarmup, reps: ts.targetReps, restSec: ts.restSec, weightKg }
    })

    // Main lifts: a warm-up ramp up to the first heavy set (check set or work set).
    const firstHeavy = planned.find(p => !p.isWarmup)
    const ramp = tex.section === 'main' && !planned.some(p => p.isWarmup)
      ? warmupRamp(firstHeavy?.weightKg ?? null, equipment).map(r => ({ isWarmup: true, reps: r.reps, restSec: RAMP_REST_SEC, weightKg: r.weightKg as number | null }))
      : []

    const rows = [...ramp, ...planned]
    for (let setIdx = 0; setIdx < rows.length; setIdx++) {
      const r = rows[setIdx]
      await db.insert(strengthSets).values({
        id: crypto.randomUUID(),
        sessionExerciseId: exId,
        setNumber: setIdx + 1,
        weightKg: r.weightKg,
        reps: r.reps,
        plannedWeightKg: r.weightKg,
        plannedReps: r.reps,
        inferredStatus: 'normal',
        isWarmup: r.isWarmup ? 1 : 0,
        restSec: r.restSec,
        createdAt: nowSec,
      })
    }
  }

  // Mark session as in_progress. Keep what today's rules did on the session
  // (merged, so an applied coach ease stays readable).
  const blockZero = bzPlan ? blockZeroPlanSummary(bzPlan) : null
  // Every automatic load change carries its reason (lift trend, RIR step, an accepted push).
  const coach = { ...coachSummary(state, fighter), loadReasons }
  await db.update(sessions).set({
    status: 'in_progress',
    startedAt: nowSec,
    contextJson: mergeContext(session.contextJson, { ...(blockZero ? { blockZero } : {}), coach }),
  }).where(eq(sessions.id, sessionId))

  const workout = await buildWorkoutResponse(db, sessionId)
  return c.json({ ...workout, ...(blockZero ? { blockZero } : {}), coach })
})

app.get('/api/sessions/:id/workout', async (c) => {
  const sessionId = c.req.param('id')
  const db = createDB(c.env)

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!session) return c.json({ error: 'session not found' }, 404)

  return c.json(await buildWorkoutResponse(db, sessionId))
})

// Strength preview for the Today page. Computes prescription from the
// template without writing rows, so a planned session's top lifts can be
// surfaced before the user taps Enter. Uses the same helpers as
// start-strength — preview and actual workout stay in lockstep.
app.get('/api/sessions/:id/strength-preview', async (c) => {
  const sessionId = c.req.param('id')
  const db = createDB(c.env)

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!session) return c.json({ error: 'session not found' }, 404)
  if (session.type !== 'strength') return c.json({ error: 'not a strength session' }, 400)

  // If the session has already been started, read from the DB so any manual
  // set-weight edits are reflected.
  const existing = await db.select().from(strengthSessionExercises)
    .where(eq(strengthSessionExercises.sessionId, sessionId))
  if (existing.length > 0) {
    return c.json(await buildWorkoutResponse(db, sessionId))
  }

  const preview = await buildStrengthPreview(db, sessionId)
  if (!preview) return c.json({ error: 'session not found' }, 404)
  return c.json(preview)
})

app.patch('/api/strength-sets/:id', async (c) => {
  const setId = c.req.param('id')
  const parsed = strengthSetPatchSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, 400)
  const body = parsed.data

  const db = createDB(c.env)
  const [current] = await db.select().from(strengthSets).where(eq(strengthSets.id, setId))
  if (!current) return c.json({ error: 'set not found' }, 404)

  const updates: Record<string, unknown> = {}

  if (body.weightKg !== undefined) updates.weightKg = body.weightKg
  if (body.reps !== undefined) updates.reps = body.reps
  if (body.completedAt !== undefined) updates.completedAt = body.completedAt
  if (body.loadFeedback !== undefined) updates.loadFeedback = body.loadFeedback
  if (body.rir !== undefined) updates.rir = body.rir

  const actualWeightKg = body.weightKg !== undefined ? body.weightKg : current.weightKg
  const actualReps = body.reps !== undefined ? body.reps : current.reps
  updates.inferredStatus = assessStrengthSet({
    plannedWeightKg: current.plannedWeightKg ?? current.weightKg,
    plannedReps: current.plannedReps ?? current.reps,
    actualWeightKg,
    actualReps,
  })

  await db.update(strengthSets).set(updates).where(eq(strengthSets.id, setId))

  const [row] = await db.select().from(strengthSets).where(eq(strengthSets.id, setId))
  // Block Zero week-3/6 check set with weight, reps and RIR → e1RM test row (R4).
  const e1rmTest = await recordCheckSetE1rm(db, setId)
  return c.json(e1rmTest ? { ...row, e1rmTest } : row)
})

app.post('/api/sessions/:id/complete', async (c) => {
  const sessionId = c.req.param('id')
  const raw = await c.req.json()
  const parsed = completeSessionSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, 400)
  const body = parsed.data

  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!session) return c.json({ error: 'session not found' }, 404)

  // Idempotent per session: a second finish (retry, double tap, an outbox
  // replay with a new key) returns the first result. No second review, no
  // second replan, completion time untouched.
  const prior = parseJson<{ completeResult?: { reviewSource?: string } }>(session.contextJson, {})
  if (session.status === 'completed' && prior.completeResult) {
    return c.json({ ...session, reviewSource: prior.completeResult.reviewSource ?? 'none', replayed: true })
  }

  // The phone's finish time when it sent one (an outbox replay can arrive
  // hours later), kept between the start and now.
  const floorSec = session.startedAt ?? 0
  const completedAt = body.completedAt != null && body.completedAt >= floorSec && body.completedAt <= nowSec + 300
    ? Math.min(body.completedAt, nowSec)
    : nowSec
  let durationSec = session.startedAt ? completedAt - session.startedAt : null
  // MT class: the class length the athlete entered beats the logging-screen wall clock.
  if (session.type === 'mt_class') {
    const [mt] = await db.select({ durationMin: mtClassLogs.durationMin }).from(mtClassLogs).where(eq(mtClassLogs.sessionId, sessionId))
    if (mt?.durationMin != null && mt.durationMin > 0) durationSec = mt.durationMin * 60
  }

  // Bag work and rope keep the seconds of each round with the session (the done summary reads them).
  const roundSecs = (session.type === 'bag_work' || session.type === 'skip_rope') && body.roundSecs && body.roundSecs.length > 0 ? body.roundSecs : null
  // Notes (D12): finishing never wipes them. The athlete's words also go to
  // context_json.userNotes (the injury rule reads them); a run's category tag
  // in the notes column stays put.
  const kept = notesOnComplete(session.notes, body.notes)
  const ctxPatch: Record<string, unknown> = { ...(roundSecs ? { roundSecs } : {}), ...(kept.userNotes ? { userNotes: kept.userNotes } : {}) }
  await db.update(sessions).set({
    status: 'completed',
    completedAt,
    durationSec,
    rpe: body.rpe ?? null,
    difficulty: body.difficulty ?? null,
    notes: kept.notes,
    ...(Object.keys(ctxPatch).length > 0 ? { contextJson: mergeContext(session.contextJson, ctxPatch) } : {}),
  }).where(eq(sessions.id, sessionId))

  // TM progression is handled by POST /api/blocks/:id/progress-tm after 6-week blocks.
  // We track exercise-level weight history via the last-session endpoint instead of auto-updating TMs.

  const reviewRowsBefore = await db
    .select({ id: coachingOutputs.id })
    .from(coachingOutputs)
    .where(and(eq(coachingOutputs.kind, 'session_review'), eq(coachingOutputs.scopeSessionId, sessionId)))

  const reviewOutput = await runSessionReview(db, c.env.ANTHROPIC_API_KEY, {
    id: sessionId,
    type: session.type,
    rpe: body.rpe ?? null,
    notes: body.notes ?? null,
    durationSec,
  })

  if (reviewOutput) {
    await db.update(sessions).set({
      review: reviewOutput.line,
      reviewFlag: reviewOutput.flag,
    }).where(eq(sessions.id, sessionId))
  }

  const reviewRowsAfter = reviewOutput
    ? await db
      .select({ id: coachingOutputs.id })
      .from(coachingOutputs)
      .where(and(eq(coachingOutputs.kind, 'session_review'), eq(coachingOutputs.scopeSessionId, sessionId)))
    : reviewRowsBefore
  const reviewSource = reviewOutput
    ? reviewRowsAfter.length > reviewRowsBefore.length ? 'ai' : 'local'
    : 'none'

  // Mark the finish as done, so a repeat returns this result.
  const [afterReview] = await db.select({ contextJson: sessions.contextJson }).from(sessions).where(eq(sessions.id, sessionId))
  await db.update(sessions).set({
    contextJson: mergeContext(afterReview?.contextJson ?? null, { completeResult: { reviewSource, at: nowSec } }),
  }).where(eq(sessions.id, sessionId))

  const [updated] = await db.select().from(sessions).where(eq(sessions.id, sessionId))

  const todayEpochDay = Math.floor(Date.now() / 86400000)
  c.executionCtx.waitUntil(
    runReactiveReplan(db, c.env.ANTHROPIC_API_KEY, {
      trigger: 'session_completed',
      todayEpochDay,
      sessionId,
    }).catch(err => console.warn('[reactive] session_completed failed', err))
  )
  // How it felt: way over target effort eases the next similar session (auto, with a note).
  c.executionCtx.waitUntil(applyFeltHard(db, updated?.scheduledDate ?? todayEpochDay, nowSec).catch(err => console.warn('[coach] felt-hard failed', err)))

  return c.json({ ...updated, reviewSource })
})

app.post('/api/sessions/:id/abandon', async (c) => {
  // Called by the session ErrorBoundary when a crash makes the session
  // unrecoverable. Returns the session to 'planned' so the next app launch
  // doesn't try to resume a broken workout.
  const sessionId = c.req.param('id')
  const db = createDB(c.env)
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!session) return c.json({ error: 'session not found' }, 404)
  if (session.status !== 'in_progress') return c.json({ ok: true, noop: true })
  await db.update(sessions).set({ status: 'planned', startedAt: null }).where(eq(sessions.id, sessionId))
  return c.json({ ok: true })
})

// ─── Zone 2 (dynamic warmup + easy run) ──────────────────────

app.post('/api/sessions/:id/start-foundation-run', async (c) => {
  const sessionId = c.req.param('id')
  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!session) return c.json({ error: 'session not found' }, 404)
  if (session.type !== 'foundation_run') return c.json({ error: 'not a foundation_run session' }, 400)

  // Idempotent
  const existingRun = await db.select().from(runSessions).where(eq(runSessions.sessionId, sessionId))
  const existingCooldown = await db.select().from(postureSessionExercises).where(eq(postureSessionExercises.sessionId, sessionId))
  if (existingRun.length > 0 && existingCooldown.length > 0) {
    const prescription = await getRunPrescription(db, { ...session, notes: 'zone2' })
    const mobilityResponse = await buildMobilityWorkoutResponse(db, sessionId)
    return c.json({ session, runSession: existingRun[0], prescription, postureExercises: mobilityResponse.exercises })
  }

  // Validate the warmup library before creating run rows.
  const missingWarmupIds = await missingExerciseIds(db, FR_WARMUP_TEMPLATE.map(t => t.exerciseId))
  if (missingWarmupIds.length > 0) {
    return c.json({
      error: 'foundation run warmup exercises missing',
      missingExerciseIds: missingWarmupIds,
      recovery: 'Run npm run db:migrate:local for local D1, or npm run db:migrate:remote for remote D1.',
    }, 409)
  }

  const prescription = await getRunPrescription(db, { ...session, notes: 'zone2' })

  // Create run session (Zone 2)
  const runId = crypto.randomUUID()
  await db.insert(runSessions).values({
    id: runId,
    sessionId,
    runType: 'zone2',
    planWeek: null,
    plannedDurationSec: prescription?.targetDurSec ?? null,
    isIndoor: 0,
  })

  // Dynamic warm-up (walk, swings, ankle rocks, hip circles, march), before the run.
  await insertMobilityRows(db, sessionId, FR_WARMUP_TEMPLATE)

  await db.update(sessions).set({ status: 'in_progress', startedAt: nowSec }).where(eq(sessions.id, sessionId))

  const [updated] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  const [run] = await db.select().from(runSessions).where(eq(runSessions.id, runId))
  const mobilityResponse = await buildMobilityWorkoutResponse(db, sessionId)

  return c.json({ session: updated, runSession: run, prescription, postureExercises: mobilityResponse.exercises })
})

app.get('/api/sessions/:id/foundation-run-workout', async (c) => {
  const sessionId = c.req.param('id')
  const db = createDB(c.env)

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!session) return c.json({ error: 'session not found' }, 404)

  const [run] = await db.select().from(runSessions).where(eq(runSessions.sessionId, sessionId))
  const prescription = await getRunPrescription(db, { ...session, notes: 'zone2' })
  const mobilityResponse = await buildMobilityWorkoutResponse(db, sessionId)

  return c.json({ session, runSession: run ?? null, prescription, postureExercises: mobilityResponse.exercises })
})

// ─── Mobility Workout ──────────────────────────────────────────

app.post('/api/sessions/:id/start-mobility', async (c) => {
  const sessionId = c.req.param('id')
  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!session) return c.json({ error: 'session not found' }, 404)
  if (session.type !== 'mobility') return c.json({ error: 'not a mobility session' }, 400)

  // Idempotent: return existing if already started
  const existing = await db.select().from(postureSessionExercises)
    .where(eq(postureSessionExercises.sessionId, sessionId))
  if (existing.length > 0) {
    return c.json(await buildMobilityWorkoutResponse(db, sessionId))
  }

  // The daily session is Foundation (lib/foundation): levelled by Block Zero
  // week (Fighter: level 3), de-duplicated against the day's strength session,
  // a bad-back version when back today is 2 or less, a bad-neck version on a
  // neck injury flag, and the clinch neck add-on once the muay thai ramp
  // allows clinch. Older sessions labelled "Mobility" outside Block Zero
  // keep the legacy daily routine.
  const isFoundation = session.blockType === 'block_zero' || session.label === FOUNDATION_LABEL || LEGACY_FOUNDATION_LABELS.includes(session.label ?? '')
  let rows: MobilityExerciseTemplate[] = DAILY_MOBILITY_TEMPLATE
  let foundation: FoundationInput | null = null
  if (isFoundation) {
    const day = session.scheduledDate ?? Math.floor(nowSec / 86400)
    const dayOfWeek = new Date(day * 86400000).getUTCDay()
    const blockZero = session.blockType === 'block_zero'
    const week = blockZero ? await blockWeekForSession(db, session, day) : null
    const [log] = await db.select({ backToday: dailyLogs.backToday }).from(dailyLogs).where(eq(dailyLogs.logDate, day))
    const state = await loadSessionCoachState(db, session, day)
    const [strength] = await db.select({ label: sessions.label }).from(sessions)
      .where(and(eq(sessions.scheduledDate, day), eq(sessions.type, 'strength'), inArray(sessions.status, ['planned', 'in_progress', 'completed'])))
    const strengthDay = strength ? (blockZero ? strengthDayFor(dayOfWeek, strength.label) : strengthKindFromLabel(strength.label)) : null
    const ramp = await loadMtRamp(db, day)
    const clinchAllowed = ramp.weeksSinceFirstClass != null && allowedClassTypes(mtRampWeek(ramp.weeksSinceFirstClass)).includes('clinch')
    // A raven's back plan: Foundation's bad-back day (page 58 §3.5).
    const bodyPlan = bodyPlanMark(session.contextJson)
    const badBackPlan = bodyPlan?.op === 'badday' && bodyPlan.which === 'back'
    foundation = {
      week,
      backToday: badBackPlan ? Math.min(log?.backToday ?? 2, 2) : log?.backToday ?? null,
      neckFlag: state.injury?.region === 'neck',
      strengthDay,
      dayOfWeek,
      clinchAllowed,
    }
    rows = foundationTemplate(foundation)
  }
  const missingIds = await missingExerciseIds(db, rows.map(r => r.exerciseId))
  if (missingIds.length > 0) {
    return c.json({ error: 'mobility exercises missing', missingExerciseIds: missingIds, recovery: 'Run the D1 migrations (npm run db:migrate:local).' }, 409)
  }
  await insertMobilityRows(db, sessionId, rows)

  await db.update(sessions).set({
    status: 'in_progress',
    startedAt: nowSec,
    ...(foundation ? { contextJson: mergeContext(session.contextJson, { foundation }) } : {}),
  }).where(eq(sessions.id, sessionId))
  return c.json(await buildMobilityWorkoutResponse(db, sessionId))
})

app.get('/api/sessions/:id/mobility-workout', async (c) => {
  const sessionId = c.req.param('id')
  const db = createDB(c.env)

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!session) return c.json({ error: 'session not found' }, 404)

  return c.json(await buildMobilityWorkoutResponse(db, sessionId))
})

app.patch('/api/mobility-exercises/:id', async (c) => {
  const exId = c.req.param('id')
  const body = await c.req.json<{ completed?: number }>()
  const db = createDB(c.env)

  if (body.completed !== undefined) {
    await db.update(postureSessionExercises).set({ completed: body.completed })
      .where(eq(postureSessionExercises.id, exId))
  }

  const [row] = await db.select().from(postureSessionExercises).where(eq(postureSessionExercises.id, exId))
  return c.json(row)
})

// ─── Bag Work Workout ──────────────────────────────────────────

app.post('/api/sessions/:id/start-bag-work', async (c) => {
  const sessionId = c.req.param('id')
  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!session) return c.json({ error: 'session not found' }, 404)
  if (session.type !== 'bag_work') return c.json({ error: 'not a bag work session' }, 400)

  // Idempotent
  const existingRounds = await db.select().from(bagWorkRounds).where(eq(bagWorkRounds.sessionId, sessionId))
  if (existingRounds.length > 0) {
    return c.json(await buildBagWorkResponse(db, sessionId))
  }

  // Get user's enabled techniques
  const [userSettings] = await db.select().from(settings)
  const enabledTechniques = new Set((userSettings?.enabledTechniques ?? 'boxing,kicks,defensive').split(','))

  // Get unlocked combos filtered by enabled techniques
  const allUnlocked = await db.select().from(combos).where(eq(combos.unlocked, 1))
  const unlockedCombos = allUnlocked.filter(c => {
    const comboTechniques = c.techniques.split(',').filter(Boolean)
    return comboTechniques.length === 0 || comboTechniques.every(t => enabledTechniques.has(t))
  })

  if (unlockedCombos.length === 0) {
    return c.json({ error: 'no unlocked combos available' }, 400)
  }

  // Governance (map #9): ease day, injury flag, gap and block decide finishers and round count.
  const bagDay = session.scheduledDate ?? Math.floor(nowSec / 86400)
  const bagState = await loadSessionCoachState(db, session, bagDay)
  const bagReport = await readinessFor(db, bagDay)
  const bagEase = easeForReadiness(bagReport, { type: 'bag_work', label: 'Bag Work', timeSlot: session.timeSlot === 'pm' ? 'pm' : 'am', estimatedMin: 30 })
  const activeBlock = await getActiveBlock(db)
  const rules = bagRules({
    blockType: session.blockType === 'block_zero' ? 'block_zero' : 'fighter',
    weekNumber: activeBlock ? (await trainingWeekFor(db, activeBlock, bagDay, bagDay)).week : 1,
    eased: bagEase.eased || bagState.coachEase != null,
    easeReason: bagEase.eased ? bagEase.reason : bagState.coachEase?.reason ?? null,
    returnActive: bagState.returnCtx.active,
    gapDays: bagState.returnCtx.plan.gapDays,
    returnReason: bagState.returnCtx.reason,
    injuryReason: bagState.injuryAction.action === 'technical' ? bagState.injuryAction.note : null,
    leadIn: session.blockType === 'block_zero' && isBlockLeadInDay(activeBlock, bagDay),
  })

  // AI prescription path (coach prescribes typed rounds), inside the rules
  const apiKey = (c.env as { ANTHROPIC_API_KEY?: string }).ANTHROPIC_API_KEY
  let prescribed: Awaited<ReturnType<typeof runBagPrescription>> = null
  if (apiKey) {
    try {
      const todayEpochDay = Math.floor(nowSec / 86400)
      prescribed = await runBagPrescription(db, apiKey, { sessionId, todayEpochDay, rules })
    } catch (err) {
      console.warn('[start-bag-work] prescription failed', err)
    }
  }
  if (rules.reason) await db.update(sessions).set({ contextJson: mergeContext(session.contextJson, { coach: { note: rules.reason, noFinishers: rules.noFinishers, maxRounds: rules.maxRounds } }) }).where(eq(sessions.id, sessionId))

  if (prescribed && prescribed.rounds.length >= 3) {
    for (const r of governBagRounds(prescribed.rounds, rules)) {
      const roundId = crypto.randomUUID()
      const durationSec = r.roundType === 'warmup' ? 150 : r.roundType === 'conditioning' ? 180 : 180
      await db.insert(bagWorkRounds).values({
        id: roundId,
        sessionId,
        roundNumber: r.roundNumber,
        durationSec,
        restSec: 60,
        roundType: r.roundType,
        coachRationale: r.rationale,
        createdAt: nowSec,
      })
      for (let ci = 0; ci < r.comboIds.length; ci++) {
        await db.insert(bagWorkRoundCombos).values({
          id: crypto.randomUUID(),
          roundId,
          comboId: r.comboIds[ci],
          orderIndex: ci,
        })
      }
    }
  } else {
    // Deterministic fallback: weighted-random rounds with positional round types,
    // after the rules (no power or conditioning finishers when eased or back from a gap).
    // Used when AI is offline or returns too few rounds.
    const POSITIONAL_TYPES = fallbackRoundTypes(rules)
    const ROUND_COUNT = POSITIONAL_TYPES.length
    const COMBOS_PER_ROUND = 3

    for (let r = 0; r < ROUND_COUNT; r++) {
      const roundId = crypto.randomUUID()
      await db.insert(bagWorkRounds).values({
        id: roundId,
        sessionId,
        roundNumber: r + 1,
        durationSec: 180,
        restSec: 60,
        roundType: POSITIONAL_TYPES[r],
        coachRationale: rules.noFinishers && r === ROUND_COUNT - 1 && rules.reason ? `Finisher out. ${rules.reason}` : '',
        createdAt: nowSec,
      })

      const weighted = unlockedCombos.map(c => ({
        combo: c,
        weight: Math.max(1, 10 - c.masteryScore) + (c.isFavourite ? 2 : 0),
      }))
      const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0)

      const picked: typeof unlockedCombos = []
      const used = new Set<string>()
      const pickCount = Math.min(COMBOS_PER_ROUND, unlockedCombos.length)

      for (let ci = 0; ci < pickCount; ci++) {
        let roll = Math.random() * totalWeight
        let chosen = weighted[0].combo
        for (const w of weighted) {
          if (used.has(w.combo.id)) continue
          roll -= w.weight
          if (roll <= 0) { chosen = w.combo; break }
        }
        if (used.has(chosen.id)) {
          chosen = unlockedCombos.find(c => !used.has(c.id)) ?? chosen
        }
        used.add(chosen.id)
        picked.push(chosen)
      }

      for (let ci = 0; ci < picked.length; ci++) {
        await db.insert(bagWorkRoundCombos).values({
          id: crypto.randomUUID(),
          roundId,
          comboId: picked[ci].id,
          orderIndex: ci,
        })
      }
    }
  }

  await db.update(sessions).set({ status: 'in_progress', startedAt: nowSec }).where(eq(sessions.id, sessionId))
  return c.json(await buildBagWorkResponse(db, sessionId))
})

app.get('/api/sessions/:id/bag-workout', async (c) => {
  const sessionId = c.req.param('id')
  const db = createDB(c.env)

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!session) return c.json({ error: 'session not found' }, 404)

  return c.json(await buildBagWorkResponse(db, sessionId))
})

// Rate combos after a bag work session
app.post('/api/sessions/:id/rate-combos', async (c) => {
  const sessionId = c.req.param('id')
  const body = await c.req.json<{ ratings: Array<{ roundId: string; comboId: string; rating: number }> }>()
  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)

  const newFavourites: string[] = []

  for (const r of body.ratings) {
    await db.insert(comboPerformance).values({
      id: crypto.randomUUID(),
      comboId: r.comboId,
      sessionId,
      roundId: r.roundId,
      rating: r.rating,
      createdAt: nowSec,
    })

    // Recompute mastery score: sum of last 5 ratings
    const recent = await db.select().from(comboPerformance)
      .where(eq(comboPerformance.comboId, r.comboId))
    recent.sort((a, b) => b.createdAt - a.createdAt)
    const last5 = recent.slice(0, 5)
    const masteryScore = last5.reduce((sum, p) => sum + p.rating, 0)

    // Track sharp ratings for auto-favourite
    const [combo] = await db.select().from(combos).where(eq(combos.id, r.comboId))
    const newTimesSharp = r.rating === 3 ? (combo?.timesSharp ?? 0) + 1 : (combo?.timesSharp ?? 0)
    const shouldFavourite = newTimesSharp >= 2 && combo?.isFavourite === 0

    const updates: Record<string, unknown> = { masteryScore, timesSharp: newTimesSharp }
    if (shouldFavourite) {
      updates.isFavourite = 1
      newFavourites.push(r.comboId)
    }

    await db.update(combos).set(updates).where(eq(combos.id, r.comboId))
  }

  const ratingSummary = `Rated ${body.ratings.length} combo${body.ratings.length === 1 ? '' : 's'}${newFavourites.length > 0 ? `. ${newFavourites.length} new favourite${newFavourites.length === 1 ? '' : 's'}.` : '.'}`
  await db.insert(coachingOutputs).values({
    id: crypto.randomUUID(),
    kind: 'combo_ratings',
    model: 'client',
    scopeSessionId: sessionId,
    outputJson: JSON.stringify({ summary: ratingSummary, newFavourites }),
    createdAt: nowSec,
  })

  return c.json({ success: true, newFavourites })
})

// Suggest combo unlocks after session
app.post('/api/sessions/:id/suggest-unlocks', async (c) => {
  const db = createDB(c.env)

  const TIER_ORDER = ['foundation', 'weapons', 'flow', 'deception', 'mastery']
  const allCombos = await db.select().from(combos)

  // Find current tier (highest tier with unlocked combos)
  let currentTierIdx = 0
  for (let i = TIER_ORDER.length - 1; i >= 0; i--) {
    if (allCombos.some(c => c.tier === TIER_ORDER[i] && c.unlocked === 1)) {
      currentTierIdx = i
      break
    }
  }

  const currentTier = TIER_ORDER[currentTierIdx]
  const currentTierCombos = allCombos.filter(c => c.tier === currentTier && c.unlocked === 1)
  const mastered = currentTierCombos.filter(c => c.masteryScore >= 9)

  // Need >= 60% mastered to suggest next tier
  if (currentTierCombos.length === 0 || mastered.length / currentTierCombos.length < 0.6) {
    return c.json({ suggestions: [], message: null })
  }

  const nextTierIdx = currentTierIdx + 1
  if (nextTierIdx >= TIER_ORDER.length) {
    return c.json({ suggestions: [], message: 'All tiers mastered!' })
  }

  const nextTier = TIER_ORDER[nextTierIdx]
  const suggestions = allCombos
    .filter(c => c.tier === nextTier && c.unlocked === 0)
    .map(c => ({ id: c.id, text: c.text, tier: c.tier, techniques: c.techniques }))

  return c.json({
    suggestions,
    message: `You've mastered ${mastered.length}/${currentTierCombos.length} ${currentTier} combos. Ready to unlock ${nextTier}?`,
  })
})

// Unlock combos
app.post('/api/combos/unlock', async (c) => {
  const body = await c.req.json<{ comboIds: string[] }>()
  const db = createDB(c.env)

  for (const id of body.comboIds) {
    await db.update(combos).set({ unlocked: 1 }).where(eq(combos.id, id))
  }

  return c.json({ success: true, unlocked: body.comboIds.length })
})

// Toggle favourite
app.patch('/api/combos/:id/favourite', async (c) => {
  const comboId = c.req.param('id')
  const db = createDB(c.env)

  const [combo] = await db.select().from(combos).where(eq(combos.id, comboId))
  if (!combo) return c.json({ error: 'combo not found' }, 404)

  const newVal = combo.isFavourite === 1 ? 0 : 1
  await db.update(combos).set({ isFavourite: newVal }).where(eq(combos.id, comboId))

  const [updated] = await db.select().from(combos).where(eq(combos.id, comboId))
  return c.json(updated)
})

// ─── Running Workout ───────────────────────────────────────────

app.post('/api/sessions/:id/start-run', async (c) => {
  const sessionId = c.req.param('id')
  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!session) return c.json({ error: 'session not found' }, 404)
  if (session.type !== 'running') return c.json({ error: 'not a running session' }, 400)

  // Idempotent
  const existing = await db.select().from(runSessions).where(eq(runSessions.sessionId, sessionId))
  if (existing.length > 0) {
    const prescription = await getRunPrescription(db, session)
    return c.json({ session, runSession: existing[0], prescription })
  }

  // Get prescription from running plan
  const prescription = await getRunPrescription(db, session)

  const runId = crypto.randomUUID()
  await db.insert(runSessions).values({
    id: runId,
    sessionId,
    runType: prescription?.runType ?? 'easy',
    planWeek: prescription?.weekNumber ?? null,
    plannedDurationSec: prescription?.targetDurSec ?? null,
    isIndoor: 0,
  })

  await db.update(sessions).set({ status: 'in_progress', startedAt: nowSec }).where(eq(sessions.id, sessionId))

  const [updated] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  const [run] = await db.select().from(runSessions).where(eq(runSessions.id, runId))
  return c.json({ session: updated, runSession: run, prescription })
})

app.get('/api/sessions/:id/run-workout', async (c) => {
  const sessionId = c.req.param('id')
  const db = createDB(c.env)

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!session) return c.json({ error: 'session not found' }, 404)

  const [run] = await db.select().from(runSessions).where(eq(runSessions.sessionId, sessionId))
  const prescription = await getRunPrescription(db, session)
  return c.json({ session, runSession: run ?? null, prescription })
})

app.patch('/api/run-sessions/:id', async (c) => {
  const runId = c.req.param('id')
  const body = await c.req.json<{
    runType?: string
    distanceKm?: number
    durationSec?: number
    paceSecKm?: number
    isIndoor?: number
    onePaceArc?: string
    onePaceEp?: string
    avgHr?: number
    maxHr?: number
    elevationGainM?: number
  }>()

  const db = createDB(c.env)
  const updates: Record<string, unknown> = {}

  if (body.runType !== undefined) updates.runType = body.runType
  if (body.distanceKm !== undefined) updates.distanceKm = body.distanceKm
  if (body.durationSec !== undefined) updates.durationSec = body.durationSec
  if (body.paceSecKm !== undefined) updates.paceSecKm = body.paceSecKm
  if (body.isIndoor !== undefined) updates.isIndoor = body.isIndoor
  if (body.onePaceArc !== undefined) updates.onePaceArc = body.onePaceArc
  if (body.onePaceEp !== undefined) updates.onePaceEp = body.onePaceEp
  if (body.avgHr !== undefined) updates.avgHr = body.avgHr
  if (body.maxHr !== undefined) updates.maxHr = body.maxHr
  if (body.elevationGainM !== undefined) updates.elevationGainM = body.elevationGainM

  const [current] = await db.select().from(runSessions).where(eq(runSessions.id, runId))
  if (!current) return c.json({ error: 'run session not found' }, 404)
  const completedDurationSec = body.durationSec !== undefined ? body.durationSec : current.durationSec
  const reality = assessRunCompletion({
    plannedDurationSec: current.plannedDurationSec,
    completedDurationSec,
  })
  if (reality.completionRatio !== null) updates.completionRatio = reality.completionRatio
  if (reality.completionStatus !== null) updates.completionStatus = reality.completionStatus

  await db.update(runSessions).set(updates).where(eq(runSessions.id, runId))

  const [row] = await db.select().from(runSessions).where(eq(runSessions.id, runId))
  return c.json(row)
})

// ─── Skip Rope Workout ─────────────────────────────────────────

app.post('/api/sessions/:id/start-skip-rope', async (c) => {
  const sessionId = c.req.param('id')
  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!session) return c.json({ error: 'session not found' }, 404)

  const existing = await db.select().from(skipRopeSessions).where(eq(skipRopeSessions.sessionId, sessionId))
  if (existing.length > 0) {
    return c.json({ session, skipSession: existing[0] })
  }

  // Rope is lower-leg load (F11): fewer rounds on an ease day, an injury flag or the return ramp.
  const state = await loadSessionCoachState(db, session, Math.floor(nowSec / 86400))
  const report = await readinessFor(db, session.scheduledDate ?? Math.floor(nowSec / 86400))
  const eased = report.readinessEase || state.coachEase != null || state.injuryAction.action === 'walk_or_bike'
  const roundCount = eased ? 3 : state.returnCtx.active ? Math.max(2, Math.round(5 * state.returnCtx.volumeFactor)) : 5
  const ropeNote = eased ? (state.injuryAction.note ?? state.coachEase?.reason ?? report.reason ?? 'Easy day.') : state.returnCtx.reason
  if (ropeNote) await db.update(sessions).set({ contextJson: mergeContext(session.contextJson, { coach: { note: ropeNote, roundCount } }) }).where(eq(sessions.id, sessionId))

  const skipId = crypto.randomUUID()
  await db.insert(skipRopeSessions).values({ id: skipId, sessionId, roundCount, roundDurSec: 180 })
  await db.update(sessions).set({ status: 'in_progress', startedAt: nowSec }).where(eq(sessions.id, sessionId))

  const [updated] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  const [skip] = await db.select().from(skipRopeSessions).where(eq(skipRopeSessions.id, skipId))
  return c.json({ session: updated, skipSession: skip })
})

app.get('/api/sessions/:id/skip-rope-workout', async (c) => {
  const sessionId = c.req.param('id')
  const db = createDB(c.env)
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!session) return c.json({ error: 'session not found' }, 404)
  const [skip] = await db.select().from(skipRopeSessions).where(eq(skipRopeSessions.sessionId, sessionId))
  // The planned length and, once done, each round as it went (seconds per round, from the finish).
  const plannedMin = skip ? plannedRoundMinutes(Array.from({ length: skip.roundCount }, () => ({ durationSec: skip.roundDurSec, restSec: SKIP_ROPE_REST_SEC }))) : null
  const roundSecs = parseRoundSecs(JSON.stringify(parseJson<{ roundSecs?: unknown }>(session.contextJson, {}).roundSecs ?? null))
  return c.json({ session, skipSession: skip ?? null, plannedMin, roundSecs })
})

// ─── Active Recovery ───────────────────────────────────────────

app.post('/api/sessions/:id/start-recovery', async (c) => {
  const sessionId = c.req.param('id')
  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!session) return c.json({ error: 'session not found' }, 404)

  const existing = await db.select().from(activeRecoverySessions).where(eq(activeRecoverySessions.sessionId, sessionId))
  if (existing.length > 0) {
    return c.json({ session, recoverySession: existing[0] })
  }

  const recId = crypto.randomUUID()
  await db.insert(activeRecoverySessions).values({ id: recId, sessionId, hipMobility: 0, foamRolling: 0 })
  await db.update(sessions).set({ status: 'in_progress', startedAt: nowSec }).where(eq(sessions.id, sessionId))

  const [updated] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  const [rec] = await db.select().from(activeRecoverySessions).where(eq(activeRecoverySessions.id, recId))
  return c.json({ session: updated, recoverySession: rec })
})

app.get('/api/sessions/:id/recovery-workout', async (c) => {
  const sessionId = c.req.param('id')
  const db = createDB(c.env)
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!session) return c.json({ error: 'session not found' }, 404)
  const [rec] = await db.select().from(activeRecoverySessions).where(eq(activeRecoverySessions.sessionId, sessionId))
  return c.json({ session, recoverySession: rec ?? null })
})

app.patch('/api/recovery-sessions/:id', async (c) => {
  const recId = c.req.param('id')
  const body = await c.req.json<{ hipMobility?: number; foamRolling?: number }>()
  const db = createDB(c.env)
  const updates: Record<string, unknown> = {}
  if (body.hipMobility !== undefined) updates.hipMobility = body.hipMobility
  if (body.foamRolling !== undefined) updates.foamRolling = body.foamRolling
  await db.update(activeRecoverySessions).set(updates).where(eq(activeRecoverySessions.id, recId))
  const [row] = await db.select().from(activeRecoverySessions).where(eq(activeRecoverySessions.id, recId))
  return c.json(row)
})

// ─── MT Class Logging ──────────────────────────────────────────

/** Planned class length: what placement stored on the session, else the usual class (90 min). */
function plannedClassMin(session: { contextJson: string | null; blockType: string | null }): number {
  const ctx = parseJson<{ placement?: { estimatedMin?: number | null } }>(session.contextJson, {})
  const stored = ctx.placement?.estimatedMin
  if (stored != null && stored > 0) return stored
  return estimatedMinutes({ type: 'mt_class', notes: null }, session.blockType === 'block_zero' ? 'block_zero' : 'fighter', 1)
}

app.post('/api/sessions/:id/start-mt-class', async (c) => {
  const sessionId = c.req.param('id')
  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!session) return c.json({ error: 'session not found' }, 404)

  const existing = await db.select().from(mtClassLogs).where(eq(mtClassLogs.sessionId, sessionId))
  if (existing.length > 0) {
    return c.json({ session, mtLog: existing[0], plannedMin: plannedClassMin(session) })
  }

  // Ease day, applied coach ease, injury flag or the return ramp: keep it technical (R10, F16).
  const day = session.scheduledDate ?? Math.floor(nowSec / 86400)
  const state = await loadSessionCoachState(db, session, day)
  const report = await readinessFor(db, day)
  const eased = easeForReadiness(report, { type: 'mt_class', label: session.label ?? 'MT Class', timeSlot: session.timeSlot === 'am' ? 'am' : 'pm', estimatedMin: 90 })
  const mtNote = state.injuryAction.action === 'technical'
    ? state.injuryAction.note
    : eased.eased ? eased.reason
      : state.coachEase ? `${state.coachEase.reason} Technique only tonight. Sit out the hard rounds.`
        : state.returnCtx.active ? `${state.returnCtx.reason} Keep it technical. No hard rounds or sparring.` : null

  const logId = crypto.randomUUID()
  await db.insert(mtClassLogs).values({ id: logId, sessionId })
  await db.update(sessions).set({
    status: 'in_progress',
    startedAt: nowSec,
    ...(mtNote ? { contextJson: mergeContext(session.contextJson, { coach: { note: mtNote, classType: 'technical' } }) } : {}),
  }).where(eq(sessions.id, sessionId))

  const [updated] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  const [mt] = await db.select().from(mtClassLogs).where(eq(mtClassLogs.id, logId))
  return c.json({ session: updated, mtLog: mt, plannedMin: plannedClassMin(updated ?? session), ...(mtNote ? { coach: { note: mtNote, classType: 'technical' } } : {}) })
})

app.get('/api/sessions/:id/mt-class-workout', async (c) => {
  const sessionId = c.req.param('id')
  const db = createDB(c.env)
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!session) return c.json({ error: 'session not found' }, 404)
  const [mt] = await db.select().from(mtClassLogs).where(eq(mtClassLogs.sessionId, sessionId))
  return c.json({ session, mtLog: mt ?? null, plannedMin: plannedClassMin(session) })
})

app.patch('/api/mt-class-logs/:id', async (c) => {
  const logId = c.req.param('id')
  const parsed = mtClassLogPatchSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, 400)
  const body = parsed.data
  const db = createDB(c.env)
  const [current] = await db.select().from(mtClassLogs).where(eq(mtClassLogs.id, logId))
  if (!current) return c.json({ error: 'class log not found' }, 404)

  // Block Zero ramp (R12): no hard sparring, technique/pads/bag in ramp weeks
  // 1-2, light clinch from week 3, weekly class cap. Checked when the type changes.
  let blockZeroNote: { rampWeek: number; reason: string } | null = null
  if (body.classType !== undefined && body.classType !== current.classType) {
    const decision = await checkMtClassForBlockZero(db, current.sessionId, body.classType)
    if (decision && !decision.allowed) {
      return c.json({ error: decision.reason, reason: decision.reason, suggestedType: decision.suggestedType, rampWeek: decision.rampWeek }, 400)
    }
    if (decision) blockZeroNote = { rampWeek: decision.rampWeek, reason: decision.reason }
  }

  const updates: Record<string, unknown> = {}
  if (body.classType !== undefined) updates.classType = body.classType
  if (body.durationMin !== undefined) updates.durationMin = body.durationMin
  if (body.focusSkill !== undefined) updates.focusSkill = body.focusSkill
  if (body.weakness !== undefined) updates.weakness = body.weakness
  if (body.concept !== undefined) updates.concept = body.concept
  if (body.actionItems !== undefined) updates.actionItems = body.actionItems
  // "What you learned" sent from the phone's queue (written offline after class, page 49).
  if (body.learnedNote !== undefined) { updates.learnedNote = body.learnedNote; updates.learnedAt = Math.floor(Date.now() / 1000) }
  if (Object.keys(updates).length > 0) await db.update(mtClassLogs).set(updates).where(eq(mtClassLogs.id, logId))
  const [row] = await db.select().from(mtClassLogs).where(eq(mtClassLogs.id, logId))
  return c.json(blockZeroNote ? { ...row, blockZero: blockZeroNote } : row)
})

// ─── Daily Logs ────────────────────────────────────────────────

app.get('/api/daily-logs/today', async (c) => {
  const date = c.req.query('date')
  if (!date) return c.json({ error: 'date query param required' }, 400)

  const epochDay = isoToEpochDay(date)
  const db = createDB(c.env)
  const rows = await db.select().from(dailyLogs).where(eq(dailyLogs.logDate, epochDay))
  return c.json(rows[0] ?? null)
})

/** "<Place> today" ratings merged into a day's log (null clears a place). */
function mergeRegionRatings(prev: string | null, next: Record<string, number | null> | null): string | null {
  let base: Record<string, number> = {}
  try { base = prev ? JSON.parse(prev) as Record<string, number> : {} } catch { base = {} }
  if (next == null) return prev
  for (const [k, v] of Object.entries(next)) {
    if (v == null) delete base[k]
    else base[k] = v
  }
  return Object.keys(base).length > 0 ? JSON.stringify(base) : null
}

app.post('/api/daily-logs', async (c) => {
  const raw = await c.req.json()
  const parsed = dailyLogSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, 400)
  const body = parsed.data

  const epochDay = isoToEpochDay(body.date)
  const nowSec = Math.floor(Date.now() / 1000)
  const db = createDB(c.env)

  // Partial-update semantics: any field present in the raw request body is written
  // (including explicit null to clear). Omitted fields preserve existing values.
  // Lets the user log throughout the day without wiping earlier entries.
  const rawObj = raw as Record<string, unknown>
  const hasKey = (k: string) => Object.prototype.hasOwnProperty.call(rawObj, k)

  const existing = await db.select().from(dailyLogs).where(eq(dailyLogs.logDate, epochDay))
  if (existing.length > 0) {
    const prev = existing[0]
    await db.update(dailyLogs).set({
      sleepHours: hasKey('sleepHours') ? body.sleepHours ?? null : prev.sleepHours,
      weedGrams: hasKey('weedGrams') ? body.weedGrams ?? null : prev.weedGrams,
      herbScale: hasKey('herbScale') ? body.herbScale ?? null : prev.herbScale,
      alcoholScale: hasKey('alcoholScale') ? body.alcoholScale ?? null : prev.alcoholScale,
      soreness: hasKey('soreness') ? body.soreness ?? null : prev.soreness,
      sleepQuality: hasKey('sleepQuality') ? body.sleepQuality ?? null : prev.sleepQuality,
      energy: hasKey('energy') ? body.energy ?? null : prev.energy,
      stress: hasKey('stress') ? body.stress ?? null : prev.stress,
      mood: hasKey('mood') ? body.mood ?? null : prev.mood,
      backToday: hasKey('backToday') ? body.backToday ?? null : prev.backToday,
      backNotes: hasKey('backNotes') ? body.backNotes ?? null : prev.backNotes,
      notes: hasKey('notes') ? body.notes ?? null : prev.notes,
      regionRatingsJson: hasKey('regionRatings') ? mergeRegionRatings(prev.regionRatingsJson, body.regionRatings ?? null) : prev.regionRatingsJson,
    }).where(eq(dailyLogs.id, prev.id))
    const [row] = await db.select().from(dailyLogs).where(eq(dailyLogs.id, prev.id))
    if (!body.partial) {
      // The check-in built up card by card (partial saves) is complete now: the replan a fresh log gets.
      if (!checkInComplete(prev)) {
        c.executionCtx.waitUntil(
          runReactiveReplan(createDB(c.env), c.env.ANTHROPIC_API_KEY, { trigger: 'wellness_logged', todayEpochDay: Math.floor(Date.now() / 86400000) })
            .catch(err => console.warn('[reactive] wellness_logged failed', err))
        )
      }
      c.executionCtx.waitUntil(checkInCoachRules(createDB(c.env), epochDay, nowSec))
    }
    return c.json(row)
  }

  const id = crypto.randomUUID()
  await db.insert(dailyLogs).values({
    id,
    logDate: epochDay,
    sleepHours: body.sleepHours ?? null,
    weedGrams: body.weedGrams ?? null,
    herbScale: body.herbScale ?? null,
    alcoholScale: body.alcoholScale ?? null,
    soreness: body.soreness ?? null,
    sleepQuality: body.sleepQuality ?? null,
    energy: body.energy ?? null,
    stress: body.stress ?? null,
    mood: body.mood ?? null,
    backToday: body.backToday ?? null,
    backNotes: body.backNotes ?? null,
    notes: body.notes ?? null,
    regionRatingsJson: mergeRegionRatings(null, body.regionRatings ?? null),
    createdAt: nowSec,
  })

  const [row] = await db.select().from(dailyLogs).where(eq(dailyLogs.id, id))
  if (body.partial) return c.json(row)

  const todayEpochDay = Math.floor(Date.now() / 86400000)
  c.executionCtx.waitUntil(
    runReactiveReplan(createDB(c.env), c.env.ANTHROPIC_API_KEY, {
      trigger: 'wellness_logged',
      todayEpochDay,
    }).catch(err => console.warn('[reactive] wellness_logged failed', err))
  )
  c.executionCtx.waitUntil(checkInCoachRules(createDB(c.env), epochDay, nowSec))

  return c.json(row)
})

/** All nine check-in items answered on a saved log. */
function checkInComplete(row: Pick<typeof dailyLogs.$inferSelect, 'sleepHours' | 'sleepQuality' | 'energy' | 'soreness' | 'stress' | 'mood' | 'backToday' | 'alcoholScale' | 'herbScale'>): boolean {
  return [row.sleepHours, row.sleepQuality, row.energy, row.soreness, row.stress, row.mood, row.backToday, row.alcoholScale, row.herbScale].every(v => v != null)
}

// The check-in is the morning after: soreness 4+ eases the next similar
// session; a fresh streak with easy sessions gets one push (once a week).
async function checkInCoachRules(db: DrizzleDB, logDay: number, nowSec: number): Promise<void> {
  try {
    await applyFeltHard(db, logDay, nowSec)
    await maybeRampUp(db, logDay, nowSec)
  } catch (err) {
    console.warn('[coach] check-in rules failed', err)
  }
}

// ─── Block Zero readiness (R10) ────────────────────────────────

// Today's read: each check-in item against the 7-day mean, the ease trigger
// (readiness 2+ items x 2 days, or the soft load flag in Block Zero) and a
// one-line reason. ?date=YYYY-MM-DD (the athlete's local day), default UTC today.
app.get('/api/readiness/today', async (c) => {
  const date = c.req.query('date')
  if (date != null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: 'date must be YYYY-MM-DD' }, 400)
  const epochDay = date ? isoToEpochDay(date) : todayEpochDayUtc()
  const db = createDB(c.env)
  const report = await readinessFor(db, epochDay)
  return c.json({ date: new Date(epochDay * 86400000).toISOString().slice(0, 10), ...report })
})

// ─── Block tests (week 1 / 3 / 6 results) ──────────────────────

app.get('/api/blocks/:id/tests', async (c) => {
  const blockId = c.req.param('id')
  const weekRaw = c.req.query('week')
  const week = weekRaw != null ? Number(weekRaw) : undefined
  if (week !== undefined && !Number.isInteger(week)) return c.json({ error: 'week must be an integer' }, 400)
  const db = createDB(c.env)
  const [block] = await db.select().from(trainingBlocks).where(eq(trainingBlocks.id, blockId))
  if (!block) return c.json({ error: 'block not found' }, 404)
  return c.json(await listBlockTests(db, blockId, week))
})

// Upsert one or many results: { week, testKey, value, unit?, notes? }, an
// array of those, or { results: [...] }. Re-entering a key for a week updates it.
app.post('/api/blocks/:id/tests', async (c) => {
  const blockId = c.req.param('id')
  const parsed = blockTestsBodySchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, 400)
  const db = createDB(c.env)
  const [block] = await db.select().from(trainingBlocks).where(eq(trainingBlocks.id, blockId))
  if (!block) return c.json({ error: 'block not found' }, 404)
  if (block.blockType !== 'block_zero') return c.json({ error: 'Test results belong to a Block Zero block.' }, 400)

  const valid = []
  for (const r of parsed.data) {
    const v = validateTestResult(r, block.totalWeeks)
    if (!v.ok) return c.json({ error: v.error, testKey: r.testKey }, 400)
    valid.push(v)
  }
  const e1rmIds = [...new Set(valid.map(v => v.exerciseId).filter((id): id is string => id != null))]
  const missing = await missingExerciseIds(db, e1rmIds)
  if (missing.length > 0) return c.json({ error: `Unknown exercise: ${missing.join(', ')}.`, missingExerciseIds: missing }, 400)

  const nowSec = Math.floor(Date.now() / 1000)
  const saved = []
  for (const v of valid) {
    saved.push(await upsertBlockTest(db, { blockId, week: v.week, testKey: v.testKey, value: v.value, unit: v.unit, notes: v.notes, source: 'manual', recordedAt: nowSec }))
  }
  // A retest refreshes the athlete model (guarded: no push after a gap or on an ease day).
  if (valid.some(v => v.week > 1)) {
    const today = Math.floor(nowSec / 86400)
    c.executionCtx.waitUntil((async () => {
      const ret = await returnContextFor(db, today)
      const report = await readinessFor(db, today)
      await runAthleteState(db, c.env.ANTHROPIC_API_KEY, 'retest', today, { noPush: ret.active || ret.noPush, easeActive: report.ease })
    })().catch(err => console.warn('[athleteState] retest run failed', err)))
  }
  return c.json(saved)
})

// ─── Program / Blocks / Weeks ──────────────────────────────────

// The active block plus its training week (paused through gaps) and the
// return plan after a gap. ?date=YYYY-MM-DD is the athlete's local today.
// offerBlockZero: a Fighter block after 4+ weeks off (F13: mini Block Zero).
app.get('/api/blocks/current', async (c) => {
  const db = createDB(c.env)
  const date = c.req.query('date')
  const todayDay = localToday(date)
  const current = await currentBlockWeek(db, todayDay)
  if (!current) return c.json(null)
  const ret = await returnContextFor(db, todayDay)
  return c.json({
    ...current.block,
    currentWeek: current.tw.week,
    trainingWeek: { week: current.tw.week, rawWeek: current.tw.rawWeek, pausedWeeks: current.tw.pausedWeeks, restarted: current.tw.restarted, monday: current.tw.monday, leadIn: current.tw.leadIn },
    returnPlan: ret.active
      ? {
          gapDays: ret.plan.gapDays,
          tier: ret.plan.tier,
          loadFactor: ret.loadFactor,
          volumeFactor: ret.volumeFactor,
          restart: ret.plan.restart,
          reason: ret.reason,
          offerBlockZero: current.block.blockType === 'fighter' && ret.plan.restart && ret.daysSinceReturn < 7,
        }
      : null,
  })
})

app.post('/api/blocks', async (c) => {
  const body = await c.req.json<{ name?: string; totalWeeks?: number; blockType?: string; today?: string }>()
  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)
  const blockType = body.blockType === 'block_zero' ? 'block_zero' : 'fighter'

  const block = await createTrainingBlock(db, {
    name: body.name ?? FIGHTER_DEFAULT_NAME,
    blockType,
    totalWeeks: body.totalWeeks ?? FIGHTER_DEFAULT_TOTAL_WEEKS,
    nowSec,
    startedAt: typeof body.today === 'string' ? startedAtForLocalDay(localToday(body.today)) : null,
  })
  return c.json(block)
})

// ─── Block Zero — safe return-to-training entry point ─────────

app.post('/api/blocks/block-zero', async (c) => {
  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)
  const body: { freshStart?: boolean; confirmReset?: boolean; today?: string } = await c.req.json<{ freshStart?: boolean; confirmReset?: boolean; today?: string }>().catch(() => ({}))

  // Fresh start wipes all collected history first, so it needs an explicit confirm
  if (body.freshStart === true) {
    if (body.confirmReset !== true) {
      return c.json({ error: 'Block Zero fresh start requires confirmReset: true' }, 400)
    }
    await clearCollectedTrainingData(db)
  }

  // End any currently active block, then create Block Zero (6 base weeks)
  // The old block's planned sessions from today on go with it (M2: no doubles).
  await endActiveBlocks(db, nowSec, localToday(body.today))
  // The start day is the athlete's local date (D4): a Wednesday-evening start stays Wednesday.
  const block = await createTrainingBlock(db, { name: 'Block Zero', blockType: 'block_zero', totalWeeks: BLOCK_ZERO_BASE_WEEKS, nowSec, startedAt: startedAtForLocalDay(localToday(body.today)) })
  return c.json(block)
})

// ─── Last completed session (for return-from-break detection) ─

app.get('/api/sessions/last-completed', async (c) => {
  const db = createDB(c.env)
  const completed = await db.select()
    .from(sessions)
    .where(eq(sessions.status, 'completed'))
    .orderBy(desc(sessions.completedAt))
    .limit(1)
  return c.json(completed[0] ?? null)
})

app.get('/api/weeks/current', async (c) => {
  const blockId = c.req.query('blockId')
  const weekNumber = c.req.query('weekNumber')
  if (!blockId || !weekNumber) return c.json({ error: 'blockId and weekNumber required' }, 400)

  const db = createDB(c.env)
  // A paused block can repeat a week number: the latest plan for it is current.
  // ?leadIn=1 asks for a mid-week start's lead-in, which is also numbered week 1.
  const leadIn = c.req.query('leadIn') === '1'
  const week = await latestWeekPlan(db, blockId, parseInt(weekNumber), { leadIn })
  if (!week) return c.json(null)

  // Get sessions for this week
  const weekSessions = await db.select().from(sessions).where(eq(sessions.weekPlanId, week.id))
  weekSessions.sort((a, b) => {
    const dateDiff = (a.scheduledDate ?? 0) - (b.scheduledDate ?? 0)
    if (dateDiff !== 0) return dateDiff
    return (a.timeSlot === 'am' ? 0 : 1) - (b.timeSlot === 'am' ? 0 : 1)
  })

  // The week line in plain words, what's new and what's next (page 56 item 16).
  const [block] = await db.select().from(trainingBlocks).where(eq(trainingBlocks.id, week.blockId))
  const whyLine = block ? weekLineFor(week, block, weekSessions) : week.whyLine
  return c.json({ week: { ...weekForClient(week), whyLine }, sessions: weekSessions })
})

app.post('/api/weeks/generate', async (c) => {
  const body = await c.req.json<{ blockId: string; weekNumber?: number; startDate: string; today?: string }>()
  if (!body.blockId || !body.startDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.startDate)) {
    return c.json({ error: 'blockId, startDate required' }, 400)
  }

  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)

  // Determine block type for template and session stamping
  const [blockRow] = await db.select().from(trainingBlocks).where(eq(trainingBlocks.id, body.blockId))
  if (!blockRow) return c.json({ error: 'block not found' }, 404)
  const blockType = blockRow.blockType === 'block_zero' ? 'block_zero' : 'fighter'

  // The server decides the training week for this Monday-Sunday week (paused
  // through gaps); the client's number is only a hint.
  const mondayDay = mondayOf(isoToEpochDay(body.startDate))
  const stamps = weekStamps(blockRow, await trainingWeekFor(db, blockRow, mondayDay, localToday(body.today, mondayDay + 6)))
  const weekNumber = stamps.weekNumber
  const weekId = (await resolveWeekPlan(db, body.blockId, weekNumber, mondayDay, nowSec)) as string
  const weekSessions = await db.select().from(sessions).where(eq(sessions.weekPlanId, weekId))
  const [existingWeek] = await db.select().from(weekPlans).where(eq(weekPlans.id, weekId))
  if (weekSessions.length > 0) return c.json({ week: weekForClient(existingWeek), sessions: weekSessions })

  const createdSessions = []

  // Block week for strength sessions. Fighter cycles every 6 weeks; Block Zero
  // extension weeks hold week-5 levels instead of wrapping to week 1.
  const blockWeek = stamps.strengthWeek
  const mtDays = await mtClassDays(db)
  const extras = await loadTemplateExtras(db, blockRow.id)

  // Seven days, Monday first. Days before the start get nothing; a Block Zero
  // lead-in day gets the lead-in day (Foundation, an easy run-walk Tue/Thu/Sat),
  // all optional (D1, Part B).
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const epochDay = mondayDay + dayOffset
    const day = blockDayPlan(blockRow, epochDay, weekNumber, mtDays, extras)
    const contextJson = day.leadIn ? JSON.stringify({ leadIn: true }) : null
    for (const entry of day.entries) {
      const sessionId = crypto.randomUUID()
      const isStrength = entry.type === 'strength'
      const label = blockType === 'block_zero' ? entry.label : null
      await db.insert(sessions).values({
        id: sessionId,
        type: entry.type,
        label,
        weekPlanId: weekId,
        scheduledDate: epochDay,
        timeSlot: entry.timeSlot,
        blockWeek: isStrength ? blockWeek : null,
        blockType,
        status: 'planned',
        notes: entry.runCategory ?? null,
        source: 'template',
        contextJson,
        createdAt: nowSec,
      })
      createdSessions.push({
        id: sessionId,
        type: entry.type,
        label,
        weekPlanId: weekId,
        scheduledDate: epochDay,
        timeSlot: entry.timeSlot,
        blockWeek: isStrength ? blockWeek : null,
        blockType,
        status: 'planned',
        startedAt: null,
        completedAt: null,
        durationSec: null,
        rpe: null,
        difficulty: null,
        notes: entry.runCategory ?? null,
        contextJson,
        createdAt: nowSec,
      })
    }
  }

  // A raven's plan that waited for this week lands on its days (page 58).
  await applyPendingBodyPlans(db, createdSessions.map(r => (r as { id: string }).id))
  const [week] = await db.select().from(weekPlans).where(eq(weekPlans.id, weekId))
  return c.json({ week: weekForClient(week), sessions: createdSessions })
})

// Prepare a week: the same path the nightly weekly pass takes (server/weeklyPass).
// body.startDate (YYYY-MM-DD, any day of the week) picks the Monday-Sunday
// week, else the athlete's local today. An upcoming week uses the AI planner
// (guarded, rules-only fallback offline); the week already under way is
// prepared from the template and the rules at once. No approval step: the
// prepared week is returned as active, with its why line and reasons.
app.post('/api/weeks/auto-generate', async (c) => {
  const body = await c.req.json<{ blockId: string; startDate?: string; today?: string }>().catch(() => ({} as { blockId: string; startDate?: string; today?: string }))
  if (!body.blockId) return c.json({ error: 'blockId required' }, 400)
  if (body.startDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(body.startDate)) return c.json({ error: 'startDate must be YYYY-MM-DD' }, 400)

  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)
  const todayDay = localToday(body.today)
  const monday = mondayOf(body.startDate ? isoToEpochDay(body.startDate) : todayDay)
  const result = await prepareWeek(db, c.env.ANTHROPIC_API_KEY, { blockId: body.blockId, monday, todayDay, nowSec, useAi: monday > todayDay })
  if (!result) return c.json({ error: 'block not found' }, 404)
  const adjustments = await db.select().from(weekAdjustments).where(eq(weekAdjustments.weekPlanId, result.week.id))
  return c.json({ week: result.week, sessions: result.sessions, analysis: result.analysis, adjustments, prepared: result.prepared, source: result.source })
})

app.patch('/api/weeks/:id', async (c) => {
  const weekId = c.req.param('id')
  // Notes only. There is no approval step: a week's status is not set by the client.
  const body = await c.req.json<{ notes?: string }>()
  const db = createDB(c.env)
  if (body.notes !== undefined) await db.update(weekPlans).set({ notes: body.notes }).where(eq(weekPlans.id, weekId))
  const [row] = await db.select().from(weekPlans).where(eq(weekPlans.id, weekId))
  if (!row) return c.json({ error: 'week not found' }, 404)
  return c.json(weekForClient(row))
})

// ─── History + Analytics ───────────────────────────────────────

app.get('/api/history/sessions', async (c) => {
  const limit = parseInt(c.req.query('limit') ?? '50')
  const db = createDB(c.env)
  const rows = await db.select().from(sessions)
  // Filter to completed/skipped, sort by date desc
  const filtered = rows
    .filter(s => s.status === 'completed' || s.status === 'skipped')
    .sort((a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt))
    .slice(0, limit)
  return c.json(filtered)
})

app.get('/api/history/stats', async (c) => {
  const days = parseInt(c.req.query('days') ?? '7')
  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)
  const cutoff = nowSec - days * 86400

  const allSessions = await db.select().from(sessions)
  const recent = allSessions.filter(s => sessionCompletedOrCreatedAt(s) >= cutoff)

  const completed = recent.filter(s => s.status === 'completed')
  const planned = recent.filter(s => s.status !== 'skipped')
  const totalDurationSec = completed.reduce((sum, s) => sum + (s.durationSec ?? 0), 0)
  const rpeValues = completed.filter(s => s.rpe != null).map(s => s.rpe!)
  const avgRpe = rpeValues.length > 0 ? Math.round(rpeValues.reduce((a, b) => a + b, 0) / rpeValues.length * 10) / 10 : null

  // Streak: count from ALL completed sessions, not just the days window
  const todayEpochDay = Math.floor(nowSec / 86400)
  const allCompletedDays = new Set(
    allSessions.filter(s => s.status === 'completed').map(s => s.scheduledDate).filter(Boolean)
  )
  let streak = 0
  for (let d = todayEpochDay; d >= todayEpochDay - 60; d--) {
    if (allCompletedDays.has(d)) streak++
    else break
  }

  return c.json({
    completed: completed.length,
    planned: planned.length,
    totalDurationMin: Math.round(totalDurationSec / 60),
    avgRpe,
    streak,
  })
})

app.get('/api/history/wellness', async (c) => {
  const days = parseInt(c.req.query('days') ?? '7')
  const db = createDB(c.env)
  const nowEpochDay = Math.floor(Date.now() / 1000 / 86400)
  const cutoffDay = nowEpochDay - days

  const logs = await db.select().from(dailyLogs)
  const recent = logs.filter(l => l.logDate >= cutoffDay)

  if (recent.length === 0) return c.json(null)

  const sleepValues = recent.filter(l => l.sleepHours != null).map(l => l.sleepHours!)
  const sorenessValues = recent.filter(l => l.soreness != null).map(l => l.soreness!)
  // Herb reads the 0-9 scale only: old gram values can't be converted.
  const herbValues = recent.filter(l => l.herbScale != null).map(l => l.herbScale!)
  const alcoholValues = recent.filter(l => l.alcoholScale != null).map(l => l.alcoholScale!)

  const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10 : null

  return c.json({
    entries: recent.length,
    avgSleep: avg(sleepValues),
    avgSoreness: avg(sorenessValues),
    avgHerb: avg(herbValues),
    avgAlcohol: avg(alcoholValues),
  })
})

// ─── Weekly Journals ───────────────────────────────────────────

app.get('/api/weekly-journals/current', async (c) => {
  const date = c.req.query('date')
  if (!date) return c.json({ error: 'date query param required' }, 400)

  // Get Monday of this week
  const d = new Date(`${date}T12:00:00Z`)
  const day = d.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(d)
  monday.setUTCDate(d.getUTCDate() + diff)
  const weekStart = Math.floor(monday.getTime() / 1000 / 86400)

  const db = createDB(c.env)
  const journals = await db.select().from(weeklyJournals).where(eq(weeklyJournals.weekStart, weekStart))
  return c.json(journals[0] ?? null)
})

app.post('/api/weekly-journals', async (c) => {
  const body = await c.req.json<{ date: string; reflection: string }>()
  if (!body.date || !body.reflection) return c.json({ error: 'date and reflection required' }, 400)

  const d = new Date(`${body.date}T12:00:00Z`)
  const day = d.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(d)
  monday.setUTCDate(d.getUTCDate() + diff)
  const weekStart = Math.floor(monday.getTime() / 1000 / 86400)
  const nowSec = Math.floor(Date.now() / 1000)

  const db = createDB(c.env)

  // Check if exists
  const existing = await db.select().from(weeklyJournals).where(eq(weeklyJournals.weekStart, weekStart))
  if (existing.length > 0) {
    await db.update(weeklyJournals).set({ reflection: body.reflection }).where(eq(weeklyJournals.id, existing[0].id))
    const [updated] = await db.select().from(weeklyJournals).where(eq(weeklyJournals.id, existing[0].id))
    return c.json(updated)
  }

  const id = crypto.randomUUID()
  await db.insert(weeklyJournals).values({
    id,
    weekStart,
    reflection: body.reflection,
    prompt: 'How was your week? What went well? What needs work?',
    createdAt: nowSec,
  })

  const [row] = await db.select().from(weeklyJournals).where(eq(weeklyJournals.id, id))
  return c.json(row)
})

// ─── Journal entries ──────────────────────────────────────────

app.get('/api/journal', async (c) => {
  const date = c.req.query('date')
  if (!date) return c.json({ error: 'date query param required' }, 400)

  const type = c.req.query('type') ?? 'daily'
  const epochDay = isoToEpochDay(date)
  const db = createDB(c.env)
  const rows = await db.select().from(journalEntries).where(eq(journalEntries.date, epochDay))
  const match = rows.find((r) => r.type === type)
  return c.json(match ?? null)
})

app.post('/api/journal', async (c) => {
  const body = await c.req.json<{ date: string; type: string; content: string; append?: boolean }>()
  if (!body.date || !body.content || !body.type) return c.json({ error: 'date, type, and content required' }, 400)

  const epochDay = isoToEpochDay(body.date)
  const nowSec = Math.floor(Date.now() / 1000)
  const db = createDB(c.env)

  // Check if entry already exists for this date+type
  const existing = await db.select().from(journalEntries).where(eq(journalEntries.date, epochDay))
  const match = existing.find((r) => r.type === body.type)
  if (match) {
    // append: a second wellness note that day adds to the first instead of replacing it.
    const content = body.append && match.content.trim() ? `${match.content}

${body.content}` : body.content
    await db.update(journalEntries).set({ content }).where(eq(journalEntries.id, match.id))
    const [updated] = await db.select().from(journalEntries).where(eq(journalEntries.id, match.id))
    return c.json(updated)
  }

  const id = crypto.randomUUID()
  await db.insert(journalEntries).values({
    id,
    date: epochDay,
    type: body.type,
    content: body.content,
    createdAt: nowSec,
  })

  const [row] = await db.select().from(journalEntries).where(eq(journalEntries.id, id))
  return c.json(row)
})

app.patch('/api/journal/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ content: string }>()
  if (!body.content) return c.json({ error: 'content required' }, 400)

  const db = createDB(c.env)
  await db.update(journalEntries).set({ content: body.content }).where(eq(journalEntries.id, id))
  const [updated] = await db.select().from(journalEntries).where(eq(journalEntries.id, id))
  if (!updated) return c.json({ error: 'not found' }, 404)
  return c.json(updated)
})

app.get('/api/journal/history', async (c) => {
  const days = parseInt(c.req.query('days') ?? '14', 10)
  const today = new Date()
  const todayEpochDay = Math.floor(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / 1000 / 86400)
  const cutoffDay = todayEpochDay - days

  const db = createDB(c.env)
  const [rows, logs] = await Promise.all([
    db.select().from(journalEntries)
      .where(gte(journalEntries.date, cutoffDay))
      .orderBy(desc(journalEntries.date)),
    db.select({ id: dailyLogs.id, logDate: dailyLogs.logDate, notes: dailyLogs.notes, createdAt: dailyLogs.createdAt })
      .from(dailyLogs)
      .where(gte(dailyLogs.logDate, cutoffDay)),
  ])

  // page 46: the check-in's morning notes (+ ADD NOTE, daily_logs.notes) are Waybook pages too, typed 'morning'
  return c.json(waybookEntries(rows, logs, cutoffDay))
})

// ─── Settings (update) ─────────────────────────────────────────

app.patch('/api/settings', async (c) => {
  const body = await c.req.json<{
    mtClassDays?: string
    amReminder?: string
    pmLeadMin?: number
    pmSessionTime?: string
    onePaceArc?: string
    onePaceEp?: string
    narutoArc?: string | null
    narutoEp?: number | string | null
    lastDeploy?: number
    enabledTechniques?: string
    amEnabled?: boolean
    pmEnabled?: boolean
  }>()

  const naruto = validateNarutoPatch(body)
  if (!naruto.ok) return c.json({ error: naruto.error }, 400)

  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)
  const updates: Record<string, unknown> = { updatedAt: nowSec, ...naruto.updates }

  // Read old settings for cascade comparison
  const [oldSettings] = await db.select().from(settings).where(eq(settings.id, 'default'))
  const oldMtDays = oldSettings?.mtClassDays ?? '1,3,5'

  if (body.mtClassDays !== undefined) updates.mtClassDays = body.mtClassDays
  if (body.amReminder !== undefined) updates.amReminder = body.amReminder
  if (body.pmLeadMin !== undefined) updates.pmLeadMin = body.pmLeadMin
  if (body.pmSessionTime !== undefined) updates.pmSessionTime = body.pmSessionTime
  if (body.onePaceArc !== undefined) updates.onePaceArc = body.onePaceArc
  if (body.onePaceEp !== undefined) updates.onePaceEp = body.onePaceEp
  if (body.lastDeploy !== undefined) updates.lastDeploy = body.lastDeploy
  if (body.enabledTechniques !== undefined) updates.enabledTechniques = body.enabledTechniques
  if (body.amEnabled !== undefined) updates.amEnabled = body.amEnabled ? 1 : 0
  if (body.pmEnabled !== undefined) updates.pmEnabled = body.pmEnabled ? 1 : 0

  await db.update(settings).set(updates).where(eq(settings.id, 'default'))
  const [row] = await db.select().from(settings).where(eq(settings.id, 'default'))

  // Cascade: if MT class days changed, clean up future planned sessions
  let cascade: { removed: number; freedDays?: string[] } | null = null
  if (body.mtClassDays !== undefined && body.mtClassDays !== oldMtDays) {
    const newMtDays = new Set(body.mtClassDays.split(',').filter(Boolean).map(Number))
    const removedDays = oldMtDays.split(',').filter(Boolean).map(Number).filter(d => !newMtDays.has(d))

    if (removedDays.length > 0) {
      const todayEpochDay = Math.floor(Date.now() / 1000 / 86400)
      // Find future planned MT class sessions on removed days
      const futureMtSessions = await db.select().from(sessions).where(
        and(
          eq(sessions.type, 'mt_class'),
          eq(sessions.status, 'planned'),
          gt(sessions.scheduledDate, todayEpochDay)
        )
      )

      // Filter to only sessions on removed day-of-week
      const toDelete = futureMtSessions.filter(s => {
        if (s.scheduledDate == null) return false
        const date = new Date(s.scheduledDate * 86400 * 1000)
        const dow = date.getUTCDay()
        return removedDays.includes(dow)
      })

      for (const s of toDelete) {
        await db.delete(sessions).where(eq(sessions.id, s.id))
      }

      const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      cascade = { removed: toDelete.length, freedDays: removedDays.map(d => DAY_NAMES[d]) }
    }
  }

  return c.json({ ...row, cascade })
})

// ─── Exercise History (for weight suggestions) ───────────────

app.get('/api/exercises/:id/last-session', async (c) => {
  const exerciseId = c.req.param('id')
  const db = createDB(c.env)

  // Find the most recent completed strength session containing this exercise
  const sexes = await db.select().from(strengthSessionExercises)
    .where(eq(strengthSessionExercises.exerciseId, exerciseId))

  const allSessions = await db.select().from(sessions)
  const completedSessionMap = new Map(
    allSessions.filter(s => s.status === 'completed').map(s => [s.id, s])
  )

  let bestMatch: { weight: number; reps: number; date: string } | null = null
  let latestDate = 0

  for (const se of sexes) {
    const session = completedSessionMap.get(se.sessionId)
    if (!session) continue
    const sessionDate = session.completedAt ?? session.createdAt
    if (sessionDate <= latestDate) continue

    const sets = await db.select().from(strengthSets)
      .where(eq(strengthSets.sessionExerciseId, se.id))
    // Only sets the athlete logged: pre-filled, untouched sets never count.
    const workingSets = sets.filter(s => isLoggedWorkSet(s) && s.weightKg != null && s.weightKg > 0)
    if (workingSets.length === 0) continue

    const maxSet = workingSets.reduce((best, s) => (s.weightKg! > best.weightKg! ? s : best))
    const date = new Date(sessionDate * 1000).toISOString().split('T')[0]
    bestMatch = { weight: maxSet.weightKg!, reps: maxSet.reps, date }
    latestDate = sessionDate
  }

  if (!bestMatch) return c.json(null)

  // Determine exercise category for increment size
  const [exercise] = await db.select().from(exercises).where(eq(exercises.id, exerciseId))
  const isLower = exercise?.muscleGroups?.includes('quads') || exercise?.muscleGroups?.includes('glutes') || exercise?.muscleGroups?.includes('hamstrings')
  const incrementKg = isLower ? 4.54 : 2.27 // 10lb lower, 5lb upper

  return c.json({
    lastWeight: bestMatch.weight,
    lastReps: bestMatch.reps,
    lastDate: bestMatch.date,
    suggestedWeight: snapIncreaseKg(bestMatch.weight, bestMatch.weight + incrementKg, loadEquipment(exercise?.equipment)),
  })
})

// ─── Exercise History (rich context for weight prescription) ──

app.get('/api/exercises/:id/history', async (c) => {
  const exerciseId = c.req.param('id')
  const section = c.req.query('section') ?? 'main'
  const db = createDB(c.env)

  const [exercise] = await db.select().from(exercises).where(eq(exercises.id, exerciseId))
  const isLower = exercise?.muscleGroups?.includes('quads') || exercise?.muscleGroups?.includes('glutes') || exercise?.muscleGroups?.includes('hamstrings')
  const incrementKg = isLower ? 4.54 : 2.27 // 10lb lower, 5lb upper

  // Get all session-exercises for this exercise
  const sexes = await db.select().from(strengthSessionExercises)
    .where(eq(strengthSessionExercises.exerciseId, exerciseId))

  const allSessions = await db.select().from(sessions)
  const completedMap = new Map(
    allSessions.filter(s => s.status === 'completed').map(s => [s.id, s])
  )

  // Collect per-session data
  type SessionRecord = {
    date: string
    epoch: number
    maxWeightKg: number
    avgReps: number
    totalSets: number
    /** Working sets that session planned, logged or not. */
    plannedSets: number
    allSets: { weightKg: number; reps: number; plannedReps: number | null; rir: number | null; loadFeedback: string | null }[]
  }
  const sessionRecords: SessionRecord[] = []
  let prRecord: { weightKg: number; reps: number; date: string } | null = null

  for (const se of sexes) {
    const session = completedMap.get(se.sessionId)
    if (!session) continue

    const sets = await db.select().from(strengthSets)
      .where(eq(strengthSets.sessionExerciseId, se.id))
    const workingSets = sets.filter(s => isLoggedWorkSet(s) && s.weightKg != null && s.weightKg > 0)
    if (workingSets.length === 0) continue
    const plannedSets = sets.filter(s => s.isWarmup === 0).length

    const epoch = session.completedAt ?? session.createdAt
    const date = new Date(epoch * 1000).toISOString().split('T')[0]
    const maxWeight = Math.max(...workingSets.map(s => s.weightKg!))
    const avgReps = Math.round(workingSets.reduce((sum, s) => sum + s.reps, 0) / workingSets.length)

    sessionRecords.push({
      date,
      epoch,
      maxWeightKg: maxWeight,
      avgReps,
      totalSets: workingSets.length,
      plannedSets,
      allSets: workingSets.map(s => ({ weightKg: s.weightKg!, reps: s.reps, plannedReps: s.plannedReps, rir: s.rir, loadFeedback: s.loadFeedback })),
    })

    // Track PR (heaviest weight ever)
    if (!prRecord || maxWeight > prRecord.weightKg) {
      const prSet = workingSets.reduce((best, s) => (s.weightKg! > best.weightKg! ? s : best))
      prRecord = { weightKg: prSet.weightKg!, reps: prSet.reps, date }
    }
  }

  // Sort by date descending (most recent first)
  sessionRecords.sort((a, b) => b.epoch - a.epoch)

  const lastSession = sessionRecords[0] ?? null
  const recentTrend = sessionRecords.slice(0, 3).reverse() // oldest-first for display

  // Compute suggestion based on section type
  let suggestion: { type: string; message: string; suggestedWeightKg: number | null } | null = null

  if (section === 'main') {
    suggestion = { type: 'follow_prescription', message: 'Follow prescribed weight', suggestedWeightKg: null }
  } else if (section === 'accessory' && lastSession) {
    // Double progression against the planned reps and set count: weight goes
    // up only after every planned set hit its reps at or under target effort.
    suggestion = accessoryProgression(lastSession.allSets, lastSession.plannedSets, { incrementKg, equipment: loadEquipment(exercise?.equipment) })
  } else if (section === 'core' && lastSession) {
    const recentCount = sessionRecords.filter(r => r.avgReps >= (lastSession.allSets[0]?.reps ?? 10)).length
    if (recentCount >= 2) {
      suggestion = { type: 'tempo', message: 'Try 3-1-3 tempo or add 2.5lb', suggestedWeightKg: null }
    } else {
      suggestion = { type: 'hold_current', message: 'Focus on full reps with control', suggestedWeightKg: null }
    }
  }

  return c.json({
    lastSession: lastSession ? {
      weightKg: lastSession.maxWeightKg,
      reps: lastSession.avgReps,
      date: lastSession.date,
      allSets: lastSession.allSets,
    } : null,
    pr: prRecord,
    recentTrend: recentTrend.map(r => ({ date: r.date, maxWeightKg: r.maxWeightKg, avgReps: r.avgReps })),
    suggestion,
  })
})

// ─── TM Progression (Fighter, end of a wave) ──────────────────
//
// Rule-based (F2, F3, F20, lib/coach/tm): a max moves only on a clean block
// with enough sets and a best effort that beats the e1RM noise. The result is
// applied with a rune and UNDO until the next strength session starts (page 56:
// the coach never asks). Idempotent per block and training week. The weekly
// pass calls the same function at a wave end.
app.post('/api/blocks/:id/progress-tm', async (c) => {
  const blockId = c.req.param('id')
  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)

  const [block] = await db.select().from(trainingBlocks).where(eq(trainingBlocks.id, blockId))
  if (!block) return c.json({ error: 'block not found' }, 404)
  if (block.blockType !== 'fighter') return c.json({ error: 'Training max progression is for Fighter blocks.' }, 400)

  const result = await applyTmUpdate(db, block, Math.floor(nowSec / 86400), nowSec)
  return c.json({
    changeId: result.changeId,
    decisions: result.decisions,
    ...(result.idempotent ? { idempotent: true } : {}),
  })
})

// ─── Reference Data ────────────────────────────────────────────

app.get('/api/exercises', async (c) => {
  const db = createDB(c.env)
  const rows = await db.select().from(exercises)
  return c.json(rows)
})

app.get('/api/combos', async (c) => {
  const db = createDB(c.env)
  const rows = await db.select().from(combos)

  // Optional technique filter
  const techFilter = c.req.query('techniques')
  if (techFilter) {
    const allowed = new Set(techFilter.split(','))
    return c.json(rows.filter(r => {
      const techs = r.techniques.split(',').filter(Boolean)
      return techs.every(t => allowed.has(t))
    }))
  }

  // Sort by tier order, then by text
  const TIER_ORDER: Record<string, number> = { foundation: 0, weapons: 1, flow: 2, deception: 3, mastery: 4 }
  rows.sort((a, b) => (TIER_ORDER[a.tier] ?? 99) - (TIER_ORDER[b.tier] ?? 99))

  return c.json(rows)
})

app.get('/api/settings', async (c) => {
  const db = createDB(c.env)
  const rows = await db.select().from(settings)
  return c.json(rows[0] ?? null)
})

// ─── History: Weight Progression ──────────────────────────────

app.get('/api/history/weight-progression', async (c) => {
  const exerciseId = c.req.query('exerciseId')
  const days = parseInt(c.req.query('days') ?? '90')
  if (!exerciseId) return c.json({ error: 'exerciseId required' }, 400)

  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)
  const cutoff = nowSec - days * 86400

  // Get all strength session exercises for this exercise
  const sexes = await db.select().from(strengthSessionExercises)
    .where(eq(strengthSessionExercises.exerciseId, exerciseId))

  const allSessions = await db.select().from(sessions)
  const sessionMap = new Map(allSessions.map(s => [s.id, s]))

  const dataPoints: { date: string; maxWeightKg: number; totalVolume: number; sets: number }[] = []

  for (const se of sexes) {
    const session = sessionMap.get(se.sessionId)
    if (!session || session.status !== 'completed' || sessionCompletedOrCreatedAt(session) < cutoff) continue

    const sets = await db.select().from(strengthSets)
      .where(eq(strengthSets.sessionExerciseId, se.id))

    // Logged working sets only (warm-ups and untouched pre-filled sets excluded).
    const completedSets = sets.filter(s => isLoggedWorkSet(s) && s.weightKg != null && s.weightKg > 0)
    if (completedSets.length === 0) continue

    const maxWeight = Math.max(...completedSets.map(s => s.weightKg!))
    const totalVol = completedSets.reduce((sum, s) => sum + (s.weightKg ?? 0) * s.reps, 0)
    const date = new Date((session.completedAt ?? session.createdAt) * 1000).toISOString().split('T')[0]

    dataPoints.push({ date, maxWeightKg: maxWeight, totalVolume: totalVol, sets: completedSets.length })
  }

  dataPoints.sort((a, b) => a.date.localeCompare(b.date))

  const exercise = await db.select().from(exercises).where(eq(exercises.id, exerciseId))
  return c.json({ exerciseId, exerciseName: exercise[0]?.name ?? '', dataPoints })
})

// ─── History: Volume Trends ───────────────────────────────────

app.get('/api/history/volume-trends', async (c) => {
  const days = parseInt(c.req.query('days') ?? '30')
  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)
  const cutoff = nowSec - days * 86400

  const allSessions = await db.select().from(sessions)
  const completed = allSessions.filter(s => s.status === 'completed' && sessionCompletedOrCreatedAt(s) >= cutoff)

  const dailyData = new Map<string, { totalDurationMin: number; sessionCount: number }>()

  for (const session of completed) {
    const date = new Date((session.completedAt ?? session.createdAt) * 1000).toISOString().split('T')[0]
    const durationMin = Math.round((session.durationSec ?? 0) / 60)
    const existing = dailyData.get(date) ?? { totalDurationMin: 0, sessionCount: 0 }
    dailyData.set(date, {
      totalDurationMin: existing.totalDurationMin + durationMin,
      sessionCount: existing.sessionCount + 1,
    })
  }

  const dataPoints = Array.from(dailyData.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return c.json({ dataPoints })
})

// ─── History: Consistency ─────────────────────────────────────

app.get('/api/history/consistency', async (c) => {
  const weeks = parseInt(c.req.query('weeks') ?? '8')
  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)
  const todayEpochDay = Math.floor(nowSec / 86400)

  const allSessions = await db.select().from(sessions)

  // Get current day of week (0=Sun)
  const today = new Date()
  const dayOfWeek = today.getDay()
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const currentMondayEpochDay = todayEpochDay + mondayOffset

  const weekData: { weekStart: string; sessionsPlanned: number; sessionsCompleted: number; totalMinutes: number }[] = []

  for (let w = 0; w < weeks; w++) {
    const weekStartDay = currentMondayEpochDay - w * 7
    const weekEndDay = weekStartDay + 7

    const weekSessions = allSessions.filter(s =>
      s.scheduledDate != null && s.scheduledDate >= weekStartDay && s.scheduledDate < weekEndDay
    )

    const planned = weekSessions.length
    const completed = weekSessions.filter(s => s.status === 'completed').length
    const totalMin = weekSessions
      .filter(s => s.status === 'completed')
      .reduce((sum, s) => sum + Math.round((s.durationSec ?? 0) / 60), 0)

    const weekStartDate = new Date(weekStartDay * 86400 * 1000)
    const weekLabel = weekStartDate.toISOString().split('T')[0]

    weekData.push({ weekStart: weekLabel, sessionsPlanned: planned, sessionsCompleted: completed, totalMinutes: totalMin })
  }

  weekData.reverse()

  // Streak
  const completedDays = new Set(
    allSessions.filter(s => s.status === 'completed').map(s => s.scheduledDate).filter(Boolean)
  )
  let streak = 0
  for (let d = todayEpochDay; d >= todayEpochDay - 60; d--) {
    if (completedDays.has(d)) streak++
    else break
  }

  let longestStreak = 0
  let currentRun = 0
  const sortedDays = Array.from(completedDays).sort((a, b) => a! - b!) as number[]
  for (let i = 0; i < sortedDays.length; i++) {
    if (i === 0 || sortedDays[i] === sortedDays[i - 1] + 1) {
      currentRun++
      longestStreak = Math.max(longestStreak, currentRun)
    } else {
      currentRun = 1
    }
  }

  return c.json({ weeks: weekData, currentStreak: streak, longestStreak })
})

// ─── History: Category Completion (for ring display) ─────────

app.get('/api/history/category-completion', async (c) => {
  const days = parseInt(c.req.query('days') ?? '7')
  const db = createDB(c.env)
  const nowEpochDay = Math.floor(Date.now() / 1000 / 86400)
  const cutoffDay = nowEpochDay - days

  const allSessions = await db.select().from(sessions)
  const periodSessions = allSessions.filter(s =>
    s.scheduledDate != null && s.scheduledDate >= cutoffDay && s.scheduledDate <= nowEpochDay
  )

  const weeks = Math.max(1, Math.round(days / 7))
  const weeklyTargets: Record<string, { types: string[]; target: number }> = {
    strength: { types: ['strength'], target: 2 },
    conditioning: { types: ['foundation_run', 'running', 'mt_class', 'bag_work', 'skip_rope'], target: 8 },
    recovery: { types: ['active_recovery', 'mobility'], target: 2 },
  }

  const result: Record<string, { completed: number; target: number }> = {}
  for (const [key, cat] of Object.entries(weeklyTargets)) {
    const completed = periodSessions.filter(
      s => cat.types.includes(s.type) && s.status === 'completed'
    ).length
    result[key] = { completed, target: cat.target * weeks }
  }

  return c.json(result)
})

// ─── History: Personal Records ────────────────────────────────

app.get('/api/history/prs', async (c) => {
  const db = createDB(c.env)

  const [allSexes, allExercises, allSessions, allSets] = await Promise.all([
    db.select().from(strengthSessionExercises),
    db.select().from(exercises),
    db.select().from(sessions),
    db.select().from(strengthSets),
  ])
  const exMap = new Map(allExercises.map(e => [e.id, e]))
  const sessionMap = new Map(allSessions.filter(s => s.status === 'completed').map(s => [s.id, s]))
  const setsByExerciseId = new Map<string, typeof allSets>()
  for (const st of allSets) {
    const arr = setsByExerciseId.get(st.sessionExerciseId) ?? []
    arr.push(st)
    setsByExerciseId.set(st.sessionExerciseId, arr)
  }

  // Group by exercise
  const exercisePRs = new Map<string, { maxWeightKg: number; date: string; allMaxes: number[] }>()

  for (const se of allSexes) {
    const session = sessionMap.get(se.sessionId)
    if (!session) continue
    if (se.section === 'warmup') continue

    const sets = setsByExerciseId.get(se.id) ?? []
    const weights = sets.filter(s => isLoggedWorkSet(s) && s.weightKg != null && s.weightKg > 0 && s.reps >= 1).map(s => s.weightKg!)
    if (weights.length === 0) continue

    const maxW = Math.max(...weights)
    const date = new Date((session.completedAt ?? session.createdAt) * 1000).toISOString().split('T')[0]
    const existing = exercisePRs.get(se.exerciseId)

    if (!existing || maxW > existing.maxWeightKg) {
      const allMaxes = existing ? [...existing.allMaxes, maxW] : [maxW]
      exercisePRs.set(se.exerciseId, { maxWeightKg: maxW, date, allMaxes })
    } else {
      existing.allMaxes.push(maxW)
    }
  }

  const prs = Array.from(exercisePRs.entries()).map(([exerciseId, data]) => {
    const ex = exMap.get(exerciseId)
    const sortedMaxes = data.allMaxes.sort((a, b) => b - a)
    const previousMax = sortedMaxes.length > 1 ? sortedMaxes[1] : null
    return {
      exerciseId,
      exerciseName: ex?.name ?? '',
      maxWeightKg: data.maxWeightKg,
      date: data.date,
      previousMaxKg: previousMax,
    }
  })

  prs.sort((a, b) => a.exerciseName.localeCompare(b.exerciseName))
  return c.json({ prs })
})

// ─── History: Lifestyle Correlations ─────────────────────────

app.get('/api/history/correlations', async (c) => {
  const days = parseInt(c.req.query('days') ?? '30')
  const db = createDB(c.env)
  const nowEpochDay = Math.floor(Date.now() / 1000 / 86400)
  const cutoffDay = nowEpochDay - days

  const logs = await db.select().from(dailyLogs)
  const recentLogs = logs.filter(l => l.logDate >= cutoffDay)

  const allSessions = await db.select().from(sessions)
  const completedSessions = allSessions.filter(s => s.status === 'completed' && s.scheduledDate != null && s.scheduledDate >= cutoffDay)

  // Group sessions by scheduledDate
  const sessionsByDay = new Map<number, typeof completedSessions>()
  for (const s of completedSessions) {
    const day = s.scheduledDate!
    const group = sessionsByDay.get(day) ?? []
    group.push(s)
    sessionsByDay.set(day, group)
  }

  const dataPoints: {
    date: string
    sleepHours: number | null
    soreness: number | null
    herbScale: number | null
    alcoholScale: number | null
    avgRpe: number | null
    sessionCount: number
  }[] = []

  for (const log of recentLogs) {
    const daySessions = sessionsByDay.get(log.logDate)
    if (!daySessions || daySessions.length === 0) continue

    const rpeValues = daySessions.filter(s => s.rpe != null).map(s => s.rpe!)
    const avgRpe = rpeValues.length > 0
      ? Math.round(rpeValues.reduce((a, b) => a + b, 0) / rpeValues.length * 10) / 10
      : null

    const dateStr = new Date(log.logDate * 86400 * 1000).toISOString().split('T')[0]

    dataPoints.push({
      date: dateStr,
      sleepHours: log.sleepHours,
      soreness: log.soreness,
      herbScale: log.herbScale,
      alcoholScale: log.alcoholScale,
      avgRpe,
      sessionCount: daySessions.length,
    })
  }

  dataPoints.sort((a, b) => a.date.localeCompare(b.date))
  return c.json({ dataPoints })
})

// ─── History: Running Progress ───────────────────────────────

app.get('/api/history/running-progress', async (c) => {
  const days = parseInt(c.req.query('days') ?? '90')
  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)
  const cutoff = nowSec - days * 86400

  const allRuns = await db.select().from(runSessions)
  const allSessions = await db.select().from(sessions)
  const sessionMap = new Map(allSessions.map(s => [s.id, s]))

  const dataPoints: { date: string; distanceKm: number; paceSecKm: number; type: string }[] = []
  const recentRunEvidence: Array<{
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
    completedAt: number
  }> = []

  for (const run of allRuns) {
    const session = sessionMap.get(run.sessionId)
    const completedAt = session?.completedAt ?? session?.createdAt ?? null
    if (!session || session.status !== 'completed' || completedAt == null || completedAt < cutoff) continue

    const date = new Date(completedAt * 1000).toISOString().split('T')[0]
    recentRunEvidence.push({
      date,
      runType: run.runType ?? session.type,
      source: run.source,
      distanceKm: run.distanceKm,
      paceSecKm: run.paceSecKm,
      avgHr: run.avgHr,
      maxHr: run.maxHr,
      elevationGainM: run.elevationGainM,
      zoneSeconds: run.zoneSeconds,
      reviewFlag: session.reviewFlag,
      completedAt,
    })

    if (run.distanceKm == null || run.paceSecKm == null) continue
    dataPoints.push({
      date,
      distanceKm: run.distanceKm,
      paceSecKm: run.paceSecKm,
      type: run.runType ?? session.type,
    })
  }

  dataPoints.sort((a, b) => a.date.localeCompare(b.date))
  recentRunEvidence.sort((a, b) => b.completedAt - a.completedAt)

  const totalDistanceKm = Math.round(dataPoints.reduce((sum, d) => sum + d.distanceKm, 0) * 10) / 10
  const paces = dataPoints.map(d => d.paceSecKm)
  const avgPaceSecKm = paces.length > 0 ? Math.round(paces.reduce((a, b) => a + b, 0) / paces.length) : null
  const bestPaceSecKm = paces.length > 0 ? Math.min(...paces) : null

  return c.json({
    dataPoints,
    recentRunEvidence: recentRunEvidence.slice(0, 5).map(run => ({
      date: run.date,
      runType: run.runType,
      source: run.source,
      distanceKm: run.distanceKm,
      paceSecKm: run.paceSecKm,
      avgHr: run.avgHr,
      maxHr: run.maxHr,
      elevationGainM: run.elevationGainM,
      zoneSeconds: run.zoneSeconds,
      reviewFlag: run.reviewFlag,
    })),
    summary: { totalRuns: dataPoints.length, totalDistanceKm, avgPaceSecKm, bestPaceSecKm },
  })
})

app.get('/api/history/weekly-zones', async (c) => {
  const weeksRaw = Number(c.req.query('weeks') ?? 8)
  const weeks = Number.isFinite(weeksRaw) ? Math.max(1, Math.min(weeksRaw, 12)) : 8
  const db = createDB(c.env)

  const [allRuns, allSessions] = await Promise.all([
    db.select().from(runSessions),
    db.select().from(sessions),
  ])

  return c.json(computeWeeklyZones({
    sessions: allSessions,
    runs: allRuns,
    weeks,
  }))
})

app.get('/api/history/aerobic-fitness', async (c) => {
  const daysRaw = Number(c.req.query('days') ?? 90)
  const lowHrRaw = Number(c.req.query('lowHr') ?? 135)
  const highHrRaw = Number(c.req.query('highHr') ?? 145)
  const days = Number.isFinite(daysRaw) ? Math.max(7, Math.min(daysRaw, 180)) : 90
  const lowHr = Number.isFinite(lowHrRaw) ? Math.max(90, Math.min(lowHrRaw, 200)) : 135
  const highHr = Number.isFinite(highHrRaw) ? Math.max(lowHr, Math.min(highHrRaw, 210)) : 145
  const db = createDB(c.env)

  const [allRuns, allSessions] = await Promise.all([
    db.select().from(runSessions),
    db.select().from(sessions),
  ])

  return c.json(computeAerobicFitness({
    sessions: allSessions,
    runs: allRuns,
    lowHr,
    highHr,
    days,
  }))
})

// ─── History: the Ledger (page 32) ───────────────────────────
// Everything the Ledger draws in one read: the rings for the toggle's range, and the charts.
// ?range=week|month|season, ?today=YYYY-MM-DD (the phone's date; defaults to the server's).

app.get('/api/history/ledger', async (c) => {
  const rangeRaw = c.req.query('range')
  const range: LedgerRange = rangeRaw === 'month' || rangeRaw === 'season' ? rangeRaw : 'week'
  const todayRaw = c.req.query('today')
  const today = todayRaw && /^\d{4}-\d{2}-\d{2}$/.test(todayRaw) ? isoToEpochDay(todayRaw) : Math.floor(Date.now() / 86400000)
  const weeks = CHART_WEEKS[range]
  const db = createDB(c.env)

  const [allSessions, allRuns, allSexes, allSets, allExercises, logs, metrics] = await Promise.all([
    db.select().from(sessions),
    db.select().from(runSessions),
    db.select().from(strengthSessionExercises),
    db.select().from(strengthSets),
    db.select().from(exercises),
    db.select().from(dailyLogs),
    db.select().from(bodyMetrics),
  ])
  const dayOf = (s: { scheduledDate: number | null; completedAt: number | null; createdAt: number }) =>
    s.scheduledDate ?? Math.floor((s.completedAt ?? s.createdAt) / 86400)
  const sessionById = new Map(allSessions.map(s => [s.id, s]))

  const runs = allRuns.map(r => {
    const s = sessionById.get(r.sessionId)
    return { epochDay: s ? dayOf(s) : 0, paceSecKm: r.paceSecKm, avgHr: r.avgHr, completed: s?.status === 'completed' }
  })

  const exName = new Map(allExercises.map(e => [e.id, e.name]))
  const sexById = new Map(allSexes.map(se => [se.id, se]))
  const setRows: { epochDay: number; exerciseName: string; weightLbs: number }[] = []
  for (const st of allSets) {
    if (!isLoggedWorkSet(st) || st.weightKg == null || st.weightKg <= 0 || st.reps < 1) continue
    const se = sexById.get(st.sessionExerciseId)
    if (!se || se.section === 'warmup') continue
    const s = sessionById.get(se.sessionId)
    if (!s || s.status !== 'completed') continue
    setRows.push({ epochDay: dayOf(s), exerciseName: exName.get(se.exerciseId) ?? '', weightLbs: Math.round(st.weightKg * 2.20462) })
  }

  const weights = metrics
    .filter(m => m.weightKg != null)
    .map(m => ({ epochDay: Math.floor(loggedAtSec(m.loggedAt) / 86400), weightLbs: Math.round(m.weightKg! * 2.20462 * 10) / 10 }))

  return c.json({
    range,
    today,
    weeks,
    rings: buildRings(allSessions, range, today),
    aerobic: aerobicWeekly(runs, weeks, today),
    strength: strengthWeekly(setRows, weeks, today),
    sleep: sleepWeek(logs, today),
    weight: weightWeekly(weights, weeks, today),
    streak: ledgerStreak(allSessions, today),
    // page 46: a bar per week, lit when the week counted (13 on WEEK, the chart span otherwise)
    consistency: consistencyWeeks(allSessions, CONSISTENCY_WEEKS[range], today),
    // the pond reads the range's sessions (SEASON's rings are per week)
    pond: pondReaction(sessionRings(allSessions, range, today)),
  })
})

// ─── History: Dashboard Summary ──────────────────────────────

app.get('/api/history/dashboard', async (c) => {
  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)
  const todayEpochDay = Math.floor(nowSec / 86400)

  const daysRaw = Number(c.req.query('days') ?? 7)
  const periodDays = [7, 30, 90].includes(daysRaw) ? daysRaw : 7

  const allSessions = await db.select().from(sessions)

  // Streak
  const completedDays = new Set(
    allSessions.filter(s => s.status === 'completed').map(s => s.scheduledDate).filter(Boolean)
  )
  let currentStreak = 0
  for (let d = todayEpochDay; d >= todayEpochDay - 60; d--) {
    if (completedDays.has(d)) currentStreak++
    else break
  }

  // Completion rate (last 30 days)
  const cutoff30 = nowSec - 30 * 86400
  const recent30 = allSessions.filter(s => sessionCompletedOrCreatedAt(s) >= cutoff30)
  const completed30 = recent30.filter(s => s.status === 'completed').length
  const total30 = recent30.filter(s => s.status !== 'planned').length // completed + skipped
  const completionRate = total30 > 0 ? Math.round(completed30 / total30 * 100) : 0

  // PRs this month — batch-load all sets once, group in memory (avoids N+1)
  const [allSexes, allExercises, allSets, allDailyLogs, allRunSessions] = await Promise.all([
    db.select().from(strengthSessionExercises),
    db.select().from(exercises),
    db.select().from(strengthSets),
    db.select().from(dailyLogs),
    db.select().from(runSessions),
  ])
  const exMap = new Map(allExercises.map(e => [e.id, e]))
  const completedSessionMap = new Map(
    allSessions.filter(s => s.status === 'completed').map(s => [s.id, s])
  )
  const setsByExerciseId = new Map<string, typeof allSets>()
  for (const st of allSets) {
    const arr = setsByExerciseId.get(st.sessionExerciseId) ?? []
    arr.push(st)
    setsByExerciseId.set(st.sessionExerciseId, arr)
  }
  const sexesBySessionId = new Map<string, typeof allSexes>()
  for (const se of allSexes) {
    const arr = sexesBySessionId.get(se.sessionId) ?? []
    arr.push(se)
    sexesBySessionId.set(se.sessionId, arr)
  }

  // Track max weight per exercise with date
  const exerciseMaxes = new Map<string, { maxKg: number; date: number }[]>()
  for (const se of allSexes) {
    const session = completedSessionMap.get(se.sessionId)
    if (!session) continue
    if (se.section === 'warmup') continue
    const sets = setsByExerciseId.get(se.id) ?? []
    const weights = sets.filter(s => isLoggedWorkSet(s) && s.weightKg != null && s.weightKg > 0 && s.reps >= 1).map(s => s.weightKg!)
    if (weights.length === 0) continue
    const maxW = Math.max(...weights)
    const entries = exerciseMaxes.get(se.exerciseId) ?? []
    entries.push({ maxKg: maxW, date: session.completedAt ?? session.createdAt })
    exerciseMaxes.set(se.exerciseId, entries)
  }

  let prsThisMonth = 0
  let topLift: { name: string; weightLbs: number } | null = null
  let overallMaxKg = 0
  let overallMaxExId = ''

  for (const [exId, entries] of exerciseMaxes) {
    entries.sort((a, b) => a.date - b.date)
    const allTimeMax = Math.max(...entries.map(e => e.maxKg))

    // Track overall top lift
    if (allTimeMax > overallMaxKg) {
      overallMaxKg = allTimeMax
      overallMaxExId = exId
    }

    // Check if the all-time max was first achieved in the last 30 days
    const firstMaxDate = entries.find(e => e.maxKg === allTimeMax)?.date ?? 0
    if (firstMaxDate >= cutoff30) prsThisMonth++
  }

  if (overallMaxExId) {
    const ex = exMap.get(overallMaxExId)
    topLift = { name: ex?.name ?? '', weightLbs: Math.round(overallMaxKg * 2.20462) }
  }

  // Total runs (last 30 days)
  const runSessionIds = new Set(
    allSessions.filter(s => s.status === 'completed' && sessionCompletedOrCreatedAt(s) >= cutoff30 &&
      (s.type === 'foundation_run' || s.type === 'running')).map(s => s.id)
  )
  const totalRuns = runSessionIds.size

  // Period-over-period comparison (7/30/90 day windows)
  let currentStart: number
  if (periodDays === 7) {
    const today = new Date()
    const dayOfWeek = today.getDay()
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
    currentStart = todayEpochDay + mondayOffset
  } else {
    currentStart = todayEpochDay - (periodDays - 1)
  }
  const previousStart = currentStart - periodDays

  function getRangeStats(startEpochDay: number, dayCount: number) {
    const endEpochDay = startEpochDay + dayCount
    const rangeSessions = allSessions.filter(s =>
      s.scheduledDate != null && s.scheduledDate >= startEpochDay && s.scheduledDate < endEpochDay
    )
    const completedRange = rangeSessions.filter(s => s.status === 'completed')

    // Training time — all completed sessions
    const durationMin = Math.round(
      completedRange.reduce((sum, s) => sum + (s.durationSec ?? 0), 0) / 60
    )

    // RPE
    const rpeValues = completedRange.filter(s => s.rpe != null).map(s => s.rpe!)
    const avgRpe = rpeValues.length > 0 ? Math.round(rpeValues.reduce((a, b) => a + b, 0) / rpeValues.length * 10) / 10 : null

    // Sleep
    const rangeLogs = allDailyLogs.filter(l => l.logDate >= startEpochDay && l.logDate < endEpochDay)
    const sleepValues = rangeLogs.filter(l => l.sleepHours != null).map(l => l.sleepHours!)
    const avgSleep = sleepValues.length > 0 ? Math.round(sleepValues.reduce((a, b) => a + b, 0) / sleepValues.length * 10) / 10 : null

    // Distance
    const runIdSet = new Set(
      completedRange
        .filter(s => s.type === 'foundation_run' || s.type === 'running')
        .map(s => s.id)
    )
    let distanceKm = 0
    for (const r of allRunSessions) {
      if (runIdSet.has(r.sessionId) && r.distanceKm != null) {
        distanceKm += r.distanceKm
      }
    }

    return {
      durationMin,
      sessions: completedRange.length,
      avgRpe,
      avgSleep,
      distanceKm: Math.round(distanceKm * 10) / 10,
    }
  }

  const thisWeek = getRangeStats(currentStart, periodDays)
  const lastWeek = getRangeStats(previousStart, periodDays)

  return c.json({
    currentStreak,
    prsThisMonth,
    completionRate,
    topLift,
    totalRuns,
    thisWeek,
    lastWeek,
  })
})

// ─── User profile ─────────────────────────────────────────────

app.get('/api/user-profile', async (c) => {
  const db = createDB(c.env)
  const rows = await db.select().from(userProfile).where(eq(userProfile.id, 'default'))
  return c.json(rows[0] ?? null)
})

app.post('/api/user-profile', async (c) => {
  const body = await c.req.json<{
    goals: string[]
    injuries: string | null
    trainingHistory: string
  }>()
  const db = createDB(c.env)
  const now = Math.floor(Date.now() / 1000)
  const rows = await db.select().from(userProfile).where(eq(userProfile.id, 'default'))
  if (rows.length > 0) {
    await db
      .update(userProfile)
      .set({
        goals: JSON.stringify(body.goals),
        injuries: body.injuries,
        trainingHistory: body.trainingHistory,
        onboardedAt: rows[0].onboardedAt ?? now,
        updatedAt: now,
      })
      .where(eq(userProfile.id, 'default'))
  } else {
    await db.insert(userProfile).values({
      id: 'default',
      goals: JSON.stringify(body.goals),
      injuries: body.injuries,
      trainingHistory: body.trainingHistory,
      onboardedAt: now,
      createdAt: now,
      updatedAt: now,
    })
  }
  const [profile] = await db.select().from(userProfile).where(eq(userProfile.id, 'default'))
  return c.json(profile)
})


// Partial update of the coach's inputs from Settings: birth date, max HR,
// back / pain status. Only the keys sent are written; null clears one.
app.patch('/api/user-profile', async (c) => {
  const parsed = userProfilePatchSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, 400)
  const body = parsed.data
  const db = createDB(c.env)
  const now = Math.floor(Date.now() / 1000)
  const updates: Record<string, unknown> = { updatedAt: now }
  if (body.dob !== undefined) updates.dob = body.dob
  if (body.maxHr !== undefined) updates.maxHr = body.maxHr
  if (body.injuries !== undefined) updates.injuries = body.injuries?.trim() || null
  const rows = await db.select({ id: userProfile.id }).from(userProfile).where(eq(userProfile.id, 'default'))
  if (rows.length > 0) {
    await db.update(userProfile).set(updates).where(eq(userProfile.id, 'default'))
  } else {
    await db.insert(userProfile).values({ id: 'default', ...updates, createdAt: now, updatedAt: now })
  }
  const [profile] = await db.select().from(userProfile).where(eq(userProfile.id, 'default'))
  return c.json(profile)
})

// ─── AI context management ────────────────────────────────────

app.post('/api/ai/summarize-old-weeks', async (c) => {
  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)

  const [block] = await db
    .select()
    .from(trainingBlocks)
    .where(eq(trainingBlocks.status, 'active'))

  if (!block) return c.json({ error: 'no active block' }, 404)

  const todayDay = Math.floor(nowSec / 86400)
  const currentWeekNumber = (await trainingWeekFor(db, block, todayDay, todayDay)).week

  const summarized = await summarizeOldWeeks(db, c.env.ANTHROPIC_API_KEY, block.id, currentWeekNumber)
  return c.json({ summarized, currentWeekNumber })
})

app.post('/api/ai/block-zero-assessment', async (c) => {
  const db = createDB(c.env)
  const [block] = await db
    .select()
    .from(trainingBlocks)
    .where(eq(trainingBlocks.status, 'active'))

  if (!block || block.blockType !== 'block_zero') {
    return c.json({ error: 'no active block zero' }, 404)
  }

  const output = await runBlockZeroAssessment(db, c.env.ANTHROPIC_API_KEY, block.id)
  if (!output) return c.json({ error: 'assessment unavailable' }, 503)
  return c.json(output)
})

app.get('/api/ai/block-zero-assessment', async (c) => {
  const db = createDB(c.env)
  const output = await getStoredBlockZeroAssessment(db)
  return c.json(output ?? null)
})

app.post('/api/ai/block-zero-transition', async (c) => {
  const db = createDB(c.env)
  const [block] = await db
    .select()
    .from(trainingBlocks)
    .where(eq(trainingBlocks.status, 'active'))

  if (!block || block.blockType !== 'block_zero') {
    return c.json({ error: 'no active block zero' }, 404)
  }

  const output = await runBlockZeroTransition(db, c.env.ANTHROPIC_API_KEY, block.id)
  if (!output) return c.json({ error: 'transition check unavailable' }, 503)
  return c.json(output)
})

// START FIGHTER BLOCK 1 / KEEP BUILDING: the verdict CHECK READINESS stored is applied
// only now (move on ends Block Zero and starts Fighter Block 1; extend lengthens it).
app.post('/api/ai/block-zero-transition/apply', async (c) => {
  const db = createDB(c.env)
  const [block] = await db
    .select()
    .from(trainingBlocks)
    .where(eq(trainingBlocks.status, 'active'))
  if (!block || block.blockType !== 'block_zero') return c.json({ error: 'no active block zero' }, 404)
  const output = await applyStoredBlockZeroTransition(db, block.id)
  if (!output) return c.json({ error: 'check readiness first' }, 409)
  return c.json(output)
})

app.get('/api/ai/block-zero-transition', async (c) => {
  const db = createDB(c.env)
  const output = await getStoredBlockZeroTransition(db)
  return c.json(output ?? null)
})

app.post('/api/ai/ledger-insights', async (c) => {
  const db = createDB(c.env)
  const data = await c.req.json<LedgerInsightData>()
  const insights = await runLedgerInsights(db, c.env.ANTHROPIC_API_KEY, data)
  if (!insights) return c.json({ insights: null })
  return c.json({ insights })
})

app.post('/api/body-metrics', async (c) => {
  const db = createDB(c.env)
  const body = await c.req.json<{
    weightKg?: number
    restingHr?: number
    bodyfatPct?: number
    notes?: string
    loggedAt?: number
  }>()
  if (!body.weightKg || body.weightKg <= 0) {
    return c.json({ error: 'weightKg required' }, 400)
  }
  const now = Math.floor(Date.now() / 1000)
  const id = crypto.randomUUID()
  await db.insert(bodyMetrics).values({
    id,
    // Unix seconds, like the rest of the app (an old build sends ms).
    loggedAt: body.loggedAt != null && Number.isFinite(body.loggedAt) ? loggedAtSec(body.loggedAt) : now,
    weightKg: body.weightKg,
    restingHr: body.restingHr ?? null,
    bodyfatPct: body.bodyfatPct ?? null,
    notes: body.notes ?? null,
    createdAt: now,
  })
  const entry = await db.select().from(bodyMetrics).where(eq(bodyMetrics.id, id)).get()
  return c.json({ entry })
})

app.get('/api/export', async (c) => {
  const db = createDB(c.env)
  const [
    allSessions, allStrengthExercises, allStrengthSets, allRunSessions,
    allBagRounds, allBagRoundCombos, allComboPerformance, allCombos,
    allDailyLogs, allWeeklyJournals, allJournalEntries, allBodyMetrics,
    allTrainingBlocks, allWeekPlans, allTrainingMaxes, allUserProfile,
    allSettings, allBlockTests,
  ] = await Promise.all([
    db.select().from(sessions),
    db.select().from(strengthSessionExercises),
    db.select().from(strengthSets),
    db.select().from(runSessions),
    db.select().from(bagWorkRounds),
    db.select().from(bagWorkRoundCombos),
    db.select().from(comboPerformance),
    db.select().from(combos),
    db.select().from(dailyLogs),
    db.select().from(weeklyJournals),
    db.select().from(journalEntries),
    db.select().from(bodyMetrics),
    db.select().from(trainingBlocks),
    db.select().from(weekPlans),
    db.select().from(trainingMaxes),
    db.select().from(userProfile),
    db.select().from(settings),
    db.select().from(blockTests),
  ])

  const payload = {
    exportedAt: new Date().toISOString(),
    sessions: allSessions,
    strengthSessionExercises: allStrengthExercises,
    strengthSets: allStrengthSets,
    runSessions: allRunSessions,
    bagWorkRounds: allBagRounds,
    bagWorkRoundCombos: allBagRoundCombos,
    comboPerformance: allComboPerformance,
    combos: allCombos,
    dailyLogs: allDailyLogs,
    weeklyJournals: allWeeklyJournals,
    journalEntries: allJournalEntries,
    bodyMetrics: allBodyMetrics,
    trainingBlocks: allTrainingBlocks,
    weekPlans: allWeekPlans,
    trainingMaxes: allTrainingMaxes,
    userProfile: allUserProfile,
    settings: allSettings,
    blockTests: allBlockTests,
  }

  const date = new Date().toISOString().split('T')[0]
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="waymark-export-${date}.json"`,
    },
  })
})

app.get('/api/body-metrics', async (c) => {
  const db = createDB(c.env)
  const limitParam = c.req.query('limit')
  const limit = limitParam ? Math.min(parseInt(limitParam, 10), 100) : 30
  // logged_at mixes ms (old Body page) and seconds: read every row as seconds, newest first.
  const entries = (await db.select().from(bodyMetrics))
    .map(e => ({ ...e, loggedAt: loggedAtSec(e.loggedAt) }))
    .sort((a, b) => b.loggedAt - a.loggedAt)
    .slice(0, limit)
  return c.json({ entries })
})

export default app
