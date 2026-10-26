// Replay harness only (coach-brain P0, §12): runs a ReplayScript through the
// real Worker app and the real nightly job, in Node, on a scratch SQLite, with
// a replay clock. Each session starts through its real start route, so the
// dose written down is exactly what today's coach would have prescribed that
// day. AI calls are counted and answered "offline" (HTTP 400), so every
// decision is the rules' own fallback and nothing leaves the machine.
//
// Never imported by the app or the Worker. Use it only on a scratch database:
// a copy of a backup (scripts/replay.mts) or a migrated in-memory one (tests).
import type Database from 'better-sqlite3'
import { and, eq, inArray,} from 'drizzle-orm'
import {  exercises, sessions, strengthSessionExercises, strengthSets, trainingMaxes, weekPlans } from '../../db/schema'
import { LADDER_MAX_SETS } from '../../lib/brain/doses'
import { carryStart, nextRungAfter, withEffort, withLogged, type LiftCarry } from '../../lib/timers/setWeight'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../../db/schema'
import { d1Shim } from './d1Shim'
import { clockMs, installClock, setClock, uninstallClock } from './clock'
import { runNightlyReplan } from '../nightly'
import { modelSummary, readAthleteEstimates, refreshAthleteModel } from '../athleteModel'
import { loadSessionCoachState } from '../coachData'
import { brainCapFrom, parseDose } from '../brain'
import { loadRunHistory, readinessFor } from '../blockZeroData'
import { blockReadinessFor } from '../readiness'
import { readinessSummary } from '../../lib/brain/readinessParts'
import { getStrengthTemplate, getWeekPercentage } from '../../lib/strengthTemplates'
import { getRunWalkWeek } from '../../lib/blockZero/running'
import { isoOf, withMergedLifts } from '../../lib/coach'
import { CLASS_MINUTES } from '../../lib/coach/sessions'
import { plannedStrengthMinutes, strengthExtraSec } from '../../lib/plannedLength'
import { doseJsonMinutes } from '../../lib/brain/doseMinutes'
import { runWarmupSec } from '../../lib/foundation'
import type {
  AthleteHooks,
  AiCallRecord, AsPrescribed, ChangeRecord, DayRecord, DoseLayers, DoseRecord, LoggedLift, ReplayAction, ReplayResult, ReplayScript,
} from '../../lib/coach/replay/types'
import { liftPattern } from '../../lib/coach/replay/history'
import { mockMessage, packetFromRequest, type MockAi } from '../../lib/brain/mockAi'

const API_KEY = 'replay-only-not-a-secret'
// A non-empty key so every AI caller tries (and is counted); the stub answers 400.
const AI_KEY = 'replay-offline'
const DAY_MS = 86400000
/** Session length a simulated athlete takes, by type (a class is a fixed hour). */
const TYPICAL_MIN: Record<string, number> = { strength: 50, foundation_run: 28, running: 30, mt_class: 60, bag_work: 30, bag_conditioning: 30, skip_rope: 15, mobility: 10, active_recovery: 20 }

type App = { fetch: (req: Request, env: unknown, ctx: unknown) => Response | Promise<Response> }
type SessionRow = typeof sessions.$inferSelect

interface Phase { when: 'nightly' | 'day'; day: number }

/** Which AI caller made a request, from the stack (tsx keeps file names). */
function callerFromStack(stack: string): string {
  if (stack.includes('coachDecision')) return 'coachDecision'
  const known = ['reactiveCoach', 'weeklyPlanAI', 'sessionReviewAI', 'ledgerInsightsAI', 'bagPrescriptionAI', 'runAthleteState', 'classComboAI', 'sessionSuggestions', 'blockZeroAssessment', 'transitionAI', 'summarize']
  for (const k of known) if (stack.includes(k)) return k
  const m = stack.match(/src[\\/](?:lib|server)[\\/][\w/\\.-]+\.ts/g)?.find(f => !f.includes('anthropic.ts') && !f.includes('replay'))
  return m ?? 'unknown'
}

export interface DriverOptions {
  /** Silence the app's console while replaying (default true). */
  quiet?: boolean
  /**
   * Runs before each day's nightly job, on the scratch database. Scenarios use
   * it to stand in for a recorded AI answer (e.g. a stored athlete state).
   */
  beforeDay?: (day: number, sqlite: Database.Database) => void
  /**
   * Coach brain P3: a deterministic stand-in for the nightly decision call
   * (lib/brain/mockAi.ts). Without one, the decision call is answered
   * "offline" like every other AI call, and the rules' pick stands.
   */
  decisionAi?: MockAi
}

export async function runReplay(sqlite: Database.Database, script: ReplayScript, opts: DriverOptions = {}): Promise<ReplayResult> {
  const quiet = opts.quiet !== false
  const shim = d1Shim(sqlite)
  const env = { DB: shim as unknown as D1Database, WAYMARK_API_KEY: API_KEY, ANTHROPIC_API_KEY: AI_KEY }
  const db = drizzle(env.DB, { schema })
  const errors: string[] = []
  const aiCalls: AiCallRecord[] = []
  const changes: ChangeRecord[] = []
  const doses: DoseRecord[] = []
  const days: DayRecord[] = []
  let phase: Phase = { when: 'day', day: script.fromDay }
  const modelByDay: NonNullable<ReplayResult['model']>['byDay'] = []
  let modelFinal: NonNullable<ReplayResult['model']> | undefined

  const realFetch = globalThis.fetch
  const realConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error }
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('anthropic.com')) {
      let model = 'unknown'
      try { model = (JSON.parse(String(init?.body ?? '{}')) as { model?: string }).model ?? 'unknown' } catch { /* keep unknown */ }
      // A nightly call reads the day before (the cron runs in the small hours): it counts for that day.
      aiCalls.push({ day: phase.when === 'nightly' ? phase.day - 1 : phase.day, caller: callerFromStack(new Error().stack ?? ''), model, when: phase.when })
      const decision = opts.decisionAi ? packetFromRequest(String(init?.body ?? '')) : null
      if (decision && opts.decisionAi) return new Response(JSON.stringify(mockMessage(opts.decisionAi(decision.packet, decision.retry))), { status: 200, headers: { 'content-type': 'application/json' } })
      return new Response('{"type":"error","error":{"type":"invalid_request_error","message":"replay: offline"}}', { status: 400 })
    }
    return new Response('replay: no network', { status: 404 })
  }) as typeof fetch
  if (quiet) {
    console.log = () => {}
    console.info = () => {}
    console.warn = () => {}
    console.error = () => {}
  }
  installClock(Date.UTC(1970, 0, 1) + script.fromDay * DAY_MS)
  const app = (await import('../app')).default as unknown as App

  const utcMs = (day: number, localMin: number) => day * DAY_MS + (localMin - script.tzOffsetMin) * 60000
  const waits: Array<Promise<unknown>> = []
  const ctx = { waitUntil: (p: Promise<unknown>) => { waits.push(p.catch(() => undefined)) }, passThroughOnException() {}, props: {} }

  async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
    const res = await app.fetch(new Request(`http://replay.local${path}`, {
      method,
      headers: { Authorization: `Bearer ${API_KEY}`, 'content-type': 'application/json', 'X-Waymark-Today': isoOf(phase.day) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), env, ctx)
    const json = await res.json().catch(() => null) as T
    // Background work (reactive replan, felt-hard) finishes before the next step, as it would by then.
    while (waits.length > 0) await waits.shift()
    if (res.status >= 400) errors.push(`${isoOf(phase.day)} ${method} ${path} -> ${res.status} ${JSON.stringify(json).slice(0, 200)}`)
    return { status: res.status, json }
  }

  // Change rows written before the replay (a copied backup's history) are not the replay's.
  let lastChangeAt = script.fromDay * 86400 - 86400
  const seenChangeIds = new Set<string>()
  function collectChanges(when: 'nightly' | 'day', day: number) {
    const rows = sqlite.prepare(`SELECT wa.id, wa.actor, wa.kind, wa.action, wa.session_type, wa.why, wa.reason, wa.created_at, s.scheduled_date AS target_day, s.time_slot AS target_slot
      FROM week_adjustments wa LEFT JOIN sessions s ON s.id = wa.target_session_id WHERE wa.created_at >= ? ORDER BY wa.created_at`).all(lastChangeAt) as Array<Record<string, unknown>>
    for (const r of rows) {
      const id = r.id as string
      if (seenChangeIds.has(id)) continue
      seenChangeIds.add(id)
      changes.push({
        day, when,
        actor: (r.actor as string | null) ?? 'legacy',
        kind: (r.kind as string | null) ?? (r.action as string),
        sessionType: (r.session_type as string | null) ?? null,
        targetDay: (r.target_day as number | null) ?? null,
        targetSlot: (r.target_slot as string | null) ?? null,
        why: (r.why as string | null) ?? (r.reason as string | null) ?? null,
      })
      lastChangeAt = Math.max(lastChangeAt, r.created_at as number)
    }
  }

  async function readinessSnapshot(day: number): Promise<DayRecord['readiness']> {
    const report = await readinessFor(db, day)
    return { ease: report.readinessEase, fresh: report.state === 'FRESH', flaggedItems: report.worseItems.length, loadFlag: false, state: report.state }
  }

  async function plannedFor(day: number): Promise<DayRecord['planned']> {
    const rows = await db.select().from(sessions).where(eq(sessions.scheduledDate, day))
    return rows.map(r => ({ id: r.id, type: r.type, label: r.label, slot: r.timeSlot, status: r.status, eased: /"coachEase"/.test(r.contextJson ?? '') }))
  }

  async function weekNumberOf(s: SessionRow): Promise<number | null> {
    if (!s.weekPlanId) return null
    const [wp] = await db.select({ n: weekPlans.weekNumber }).from(weekPlans).where(eq(weekPlans.id, s.weekPlanId))
    return wp?.n ?? null
  }

  async function findOrAdd(day: number, a: Extract<ReplayAction, { kind: 'session' }>): Promise<SessionRow | null> {
    const rows = await db.select().from(sessions).where(and(eq(sessions.scheduledDate, day), eq(sessions.type, a.type), inArray(sessions.status, ['planned', 'in_progress'])))
    const pick = rows.find(r => r.timeSlot === a.slot) ?? rows[0]
    if (pick) return pick
    if (a.addIfMissing === false) return null
    const added = await call<{ id?: string }>('POST', '/api/sessions/insert-ad-hoc', { type: a.type, timeSlot: a.slot, date: isoOf(day), today: isoOf(day) })
    if (!added.json?.id) return null
    const [row] = await db.select().from(sessions).where(eq(sessions.id, added.json.id))
    return row ?? null
  }

  /** A started strength session's planned minutes: every set (the main lifts' ramps included) and the moves between exercises. */
  async function strengthMinutes(sessionId: string): Promise<number | null> {
    const exRows = (await db.select().from(strengthSessionExercises).where(eq(strengthSessionExercises.sessionId, sessionId))).sort((a, b) => a.orderIndex - b.orderIndex)
    // The ramps are stored as warm-up rows already: every row's set and rest, plus the moves between exercises.
    const all = []
    for (const ex of exRows) {
      const sets = (await db.select().from(strengthSets).where(eq(strengthSets.sessionExerciseId, ex.id))).sort((a, b) => a.setNumber - b.setNumber)
      all.push(...sets.map(st => ({ isWarmup: st.isWarmup, restSec: st.restSec })))
    }
    const base = plannedStrengthMinutes(all)
    // The ramps are rows already: only the moves between rows (a new station, or the next move of a circuit).
    return base == null ? null : Math.round(base + strengthExtraSec(exRows.map(e => ({ section: e.section ?? 'main', ramp: false }))) / 60)
  }

  /** The ease layers on a started session: since coach brain P2, one dose with one level (dose_json). */
  async function layersFor(s: SessionRow, day: number): Promise<DoseLayers> {
    const state = await loadSessionCoachState(db, s, day)
    const [row] = await db.select().from(sessions).where(eq(sessions.id, s.id))
    const dose = parseDose(row?.doseJson)
    const cap = brainCapFrom(row?.contextJson)
    return {
      leadIn: false,
      returnRamp: null,
      coachEase: cap ? { kind: `morning cap ${cap.state}`, reason: cap.why ?? '' } : null,
      readinessEase: dose?.state === 'RED',
      loadFlag: false,
      loadReason: null,
      autoEased: false,
      autoEaseReason: null,
      injury: state.injuryAction.action !== 'none' ? `${state.injuryAction.action}: ${state.injuryAction.note ?? ''}`.trim() : null,
      push: dose?.level === 'PUSH',
      brain: dose ? { level: dose.level, state: dose.state, u: dose.facts.u, modelState: dose.facts.modelState } : null,
    }
  }

  async function logStrength(sessionId: string, lifts: LoggedLift[] | AsPrescribed, atSec: number, day: number, athlete?: AthleteHooks) {
    const exRows = await db.select().from(strengthSessionExercises).where(eq(strengthSessionExercises.sessionId, sessionId))
    const used = new Set<number>()
    for (const ex of exRows.sort((a, b) => a.orderIndex - b.orderIndex)) {
      const sets = (await db.select().from(strengthSets).where(eq(strengthSets.sessionExerciseId, ex.id)))
        .filter(st => st.isWarmup !== 1)
        .sort((a, b) => a.setNumber - b.setNumber)
      if (!Array.isArray(lifts)) {
        // A simulated athlete: every prescribed set, as prescribed (or short / heavier / lighter).
        // A true athlete follows the set screen (rebuild Phase 4): after a 3+ the next set starts a
        // step up, a climb stops at about 3 left, and a last climbing set at 3+ gets one more rung.
        const own = athlete?.set != null && ex.section === 'main'
        const [lib] = own ? await db.select({ equipment: exercises.equipment }).from(exercises).where(eq(exercises.id, ex.exerciseId)) : []
        const equipment = lib?.equipment ?? null
        let carry: Record<string, LiftCarry> = {}
        const list = [...sets]
        for (let i = 0; i < list.length; i++) {
          const st = list[i]
          let w = st.weightKg == null ? null : Math.round(st.weightKg * (lifts.weightFactor ?? 1) * 100) / 100
          if (own && w != null) w = carryStart(carry[ex.exerciseId], { isWarmup: false, plannedKg: st.plannedWeightKg ?? st.weightKg }, ex.exerciseId, equipment)?.kg ?? w
          let reps = Math.max(0, (st.reps ?? 0) - (lifts.repsShort ?? 0))
          let rir: number | null = ex.section === 'main' ? lifts.rir : null
          let feel: number | undefined
          // A true athlete: his own reps and reps left at this weight (rebuild Phase 1).
          if (own) ({ reps, rir, feel } = athlete!.set!({ exerciseId: ex.exerciseId, weightKg: w, reps: st.reps ?? 0, setNumber: st.setNumber, day }))
          await call('PATCH', `/api/strength-sets/${st.id}`, { weightKg: w, reps, rir, completedAt: atSec })
          if (!own) continue
          // About 3 left on a climb (what he felt, under the 3+ tap): he stays there, as the note asks.
          const climbing = list.length > 1 && (list[list.length - 1].plannedWeightKg ?? 0) > (list[0].plannedWeightKg ?? 0) + 0.01
          const stays = climbing && feel != null && feel <= 3.5 ? Math.min(rir ?? 2, 2) : rir
          carry = withEffort(withLogged(carry, ex.exerciseId, w, { isWarmup: false, plannedKg: st.plannedWeightKg ?? st.weightKg }), ex.exerciseId, stays)
          if (i === list.length - 1) {
            const next = nextRungAfter(list.map(x => ({ isWarmup: false, plannedWeightKg: x.plannedWeightKg ?? x.weightKg })), w, stays, ex.exerciseId, equipment, LADDER_MAX_SETS)
            if (next != null) {
              const r = await call<typeof st>('POST', `/api/strength-sets/${st.id}/rung`, { id: `${st.id}-r${i + 1}`, weightKg: next })
              if (r.json && (r.json as { id?: string }).id) list.push(r.json as typeof st)
            }
          }
        }
        continue
      }
      if (ex.section !== 'main') continue
      // Real history: his lift with this exercise id, else the first unused one of the same pattern.
      let idx = lifts.findIndex((l, i) => !used.has(i) && l.exerciseId === ex.exerciseId)
      if (idx < 0) idx = lifts.findIndex((l, i) => !used.has(i) && l.pattern !== 'other' && l.pattern === liftPattern(ex.exerciseId))
      if (idx < 0) continue
      used.add(idx)
      const mine = lifts[idx].sets
      for (let i = 0; i < Math.min(mine.length, sets.length); i++) {
        await call('PATCH', `/api/strength-sets/${sets[i].id}`, { weightKg: mine[i].weightKg, reps: mine[i].reps ?? sets[i].reps ?? 0, rir: mine[i].rir, completedAt: atSec })
      }
    }
  }

  async function finish(s: SessionRow, a: Extract<ReplayAction, { kind: 'session' }>, endMs: number) {
    setClock(endMs)
    const completedAt = Math.floor(endMs / 1000)
    if (a.rpe != null) {
      await call('POST', `/api/sessions/${s.id}/complete`, { rpe: a.rpe, notes: a.notes ?? '', completedAt })
    } else {
      // No effort logged (a run that came in from Strava): finished without an RPE, as the attach does.
      const [row] = await db.select().from(sessions).where(eq(sessions.id, s.id))
      await call('PATCH', `/api/sessions/${s.id}`, { status: 'completed', completedAt, durationSec: row?.startedAt ? completedAt - row.startedAt : a.durationMin * 60 })
    }
  }

  async function doSession(day: number, a: Extract<ReplayAction, { kind: 'session' }>) {
    const s = await findOrAdd(day, a)
    if (!s) { errors.push(`${isoOf(day)}: no ${a.type} session to start`); return }
    const startMs = utcMs(day, a.at)
    setClock(startMs)
    const layers = await layersFor(s, day)
    const weekNumber = await weekNumberOf(s)
    const endMs = startMs + a.durationMin * 60000
    const base: DoseRecord = {
      day, sessionId: s.id, type: s.type, label: s.label, slot: s.timeSlot, source: s.source, weekNumber, layers,
      baselineMainSets: null, prescribedMainSets: null, loads: [], baselineRunSec: null, prescribedRunSec: null, walkOnly: false,
      prescribedTotalSec: null, longestLast30Sec: null, hrCeilingBpm: null, loggedAvgHr: null, volumeRatio: null, loadRatio: null, rirOnFile: false, why: [],
    }

    if (s.type === 'strength') {
      base.rirOnFile = (sqlite.prepare(`SELECT count(*) AS n FROM strength_sets st JOIN strength_session_exercises e ON e.id = st.session_exercise_id
        WHERE e.section = 'main' AND st.rir IS NOT NULL AND st.completed_at IS NOT NULL`).get() as { n: number }).n > 0
      const r = await call<{ brain?: { lifts?: Array<{ exerciseId: string; weightKg: number | null; change: string }> }; coach?: { loadReasons?: string[]; notes?: string[] } }>('POST', `/api/sessions/${s.id}/start-strength`)
      base.layers = await layersFor(s, day)
      const [startedRow] = await db.select().from(sessions).where(eq(sessions.id, s.id))
      const startedDose = parseDose(startedRow?.doseJson)
      const dow = new Date(day * DAY_MS).getUTCDay()
      const kind = s.blockType === 'block_zero' ? 'block_zero' : 'fighter'
      // The plain dose: today's template plus any missed session's main lifts merged in, before any ease.
      // The plain dose: the rules' HOLD (the brain's own, readiness and signals set aside).
      const template = withMergedLifts(getStrengthTemplate(dow, s.blockWeek ?? 1, kind, s.label), s.contextJson, s.blockWeek ?? 1, kind)
      const baselineMain = startedDose?.strength?.holdSets ?? template.exercises.filter(e => e.section === 'main').reduce((n, e) => n + e.sets.filter(st => !st.isWarmup).length, 0)
      const exRows = await db.select().from(strengthSessionExercises).where(eq(strengthSessionExercises.sessionId, s.id))
      let prescribedMain = 0
      const loads: DoseRecord['loads'] = []
      // Fighter: the plain load is TM x the wave's % (what start-strength multiplies factors onto).
      const tms = new Map((await db.select().from(trainingMaxes)).map(t => [t.exerciseId, t.weightKg]))
      const wavePct = getWeekPercentage(s.blockWeek ?? 1, kind)
      const ratios: number[] = []
      for (const ex of exRows.filter(e => e.section === 'main')) {
        const sets = (await db.select().from(strengthSets).where(eq(strengthSets.sessionExerciseId, ex.id))).filter(st => st.isWarmup !== 1)
        prescribedMain += sets.length
        const bz = r.json?.brain?.lifts?.find(l => l.exerciseId === ex.exerciseId)
        loads.push({ exerciseId: ex.exerciseId, weightKg: sets[0]?.weightKg ?? null, change: bz?.change ?? null })
        const tm = tms.get(ex.exerciseId)
        const w = sets[0]?.weightKg
        if (kind === 'fighter' && tm != null && w != null && tm * wavePct > 0) ratios.push(w / (tm * wavePct))
      }
      Object.assign(base, {
        baselineMainSets: baselineMain,
        prescribedMainSets: prescribedMain,
        loads,
        volumeRatio: baselineMain > 0 ? Math.round((prescribedMain / baselineMain) * 100) / 100 : null,
        loadRatio: ratios.length ? Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100) / 100 : null,
        why: [...(r.json?.coach?.loadReasons ?? []), ...(r.json?.coach?.notes ?? [])],
      })
      doses.push(base)
      base.plannedMin = await strengthMinutes(s.id)
      if (a.athlete?.trueKg) base.trueKg = Object.fromEntries(loads.map(l => [l.exerciseId, Math.round(a.athlete!.trueKg!(l.exerciseId, day) * 10) / 10]))
      if (a.lifts) await logStrength(s.id, a.lifts, Math.floor(endMs / 1000), day, a.athlete)
      await finish(s, a, endMs)
      return
    }

    if (s.type === 'foundation_run' || s.type === 'running') {
      const route = s.type === 'foundation_run' ? 'start-foundation-run' : 'start-run'
      const r = await call<{ runSession?: { id: string }; prescription?: { targetDurSec?: number | null; targetDesc?: string; z2CeilingBpm?: number; talkTestDue?: boolean; runWalk?: { runSec: number; walkSec: number; rounds: number; warmupSec: number }; autoEase?: { eased: boolean; reason: string | null }; coach?: { eased: boolean; reasons: string[] } } }>('POST', `/api/sessions/${s.id}/${route}`)
      const p = r.json?.prescription
      base.layers = await layersFor(s, day)
      const [startedRow] = await db.select().from(sessions).where(eq(sessions.id, s.id))
      const runDoseNow = parseDose(startedRow?.doseJson)?.run
      const shape = s.blockType === 'block_zero' && weekNumber != null ? getRunWalkWeek(weekNumber) : null
      const baselineRun = runDoseNow ? runDoseNow.holdRunSec : shape ? shape.runSec * shape.rounds : null
      const prescribedRun = p?.runWalk ? p.runWalk.runSec * p.runWalk.rounds : null
      const walkOnly = (p?.autoEase?.eased ?? false) || (p?.coach?.eased ?? false)
      const hist = await loadRunHistory(db, day)
      Object.assign(base, {
        baselineRunSec: baselineRun,
        prescribedRunSec: prescribedRun,
        walkOnly,
        prescribedTotalSec: p?.targetDurSec ?? null,
        longestLast30Sec: hist.longestLast30Sec,
        hrCeilingBpm: p?.z2CeilingBpm ?? null,
        volumeRatio: baselineRun && prescribedRun != null ? Math.round((prescribedRun / baselineRun) * 100) / 100 : null,
        why: [p?.targetDesc ?? ''].filter(Boolean),
      })
      base.layers.autoEased = walkOnly
      base.layers.autoEaseReason = p?.autoEase?.reason ?? p?.coach?.reasons?.join(' ') ?? null
      doses.push(base)
      const runId = r.json?.runSession?.id
      base.plannedMin = p?.targetDurSec != null ? Math.round((p.targetDurSec + (s.type === 'foundation_run' ? runWarmupSec() : 0)) / 60) : null
      if (runId && a.run === 'as_prescribed' && a.athlete?.run) {
        // A true athlete: his own time, distance and heart rate (rebuild Phase 1).
        const mine = a.athlete.run({ day, type: s.type, notes: startedRow?.notes ?? s.notes, targetDurSec: p?.targetDurSec ?? null, runWalk: p?.runWalk ?? null, z2CeilingBpm: p?.z2CeilingBpm ?? null, walkOnly })
        base.loggedAvgHr = mine.avgHr
        base.loggedKm = mine.distanceKm
        await call('PATCH', `/api/run-sessions/${runId}`, { durationSec: mine.durationSec, distanceKm: mine.distanceKm, avgHr: mine.avgHr ?? undefined, maxHr: mine.maxHr ?? undefined, ...(mine.fiveKSec != null ? { fiveKSec: mine.fiveKSec } : {}) })
        await finish(s, a, startMs + mine.durationSec * 1000 + 5 * 60000)
        return
      }
      if (runId && a.run) {
        const plannedSec = p?.targetDurSec ?? a.durationMin * 60
        const run = a.run === 'as_prescribed'
          ? { durationSec: Math.round(plannedSec * (a.runFactor ?? 1)), avgHr: p?.z2CeilingBpm != null ? p.z2CeilingBpm - 8 : null, maxHr: p?.z2CeilingBpm != null ? p.z2CeilingBpm - 1 : null }
          : { durationSec: a.run.durationSec, distanceKm: a.run.distanceKm ?? undefined, avgHr: a.run.avgHr ?? undefined, maxHr: a.run.maxHr ?? undefined, isIndoor: a.run.isIndoor ? 1 : 0 }
        base.loggedAvgHr = run.avgHr ?? null
        await call('PATCH', `/api/run-sessions/${runId}`, run)
        // Log your run asks the talk-test question when the coach wants the line (first run, rechecks).
        if (p?.talkTestDue && script.talkTestBpm != null) {
          const blockId = (sqlite.prepare(`SELECT id FROM training_blocks WHERE status = 'active'`).get() as { id: string } | undefined)?.id
          if (blockId) await call('POST', `/api/blocks/${blockId}/tests`, { week: weekNumber ?? 1, testKey: 'talk_test_hr', value: script.talkTestBpm, unit: 'bpm' })
        }
        const runEnd = a.run === 'as_prescribed' ? startMs + run.durationSec * 1000 + 5 * 60000 : endMs
        await finish(s, a, runEnd)
        return
      }
      await finish(s, a, endMs)
      return
    }

    const startRoute: Record<string, string> = { mt_class: 'start-mt-class', bag_work: 'start-bag-work', mobility: 'start-mobility', skip_rope: 'start-skip-rope', active_recovery: 'start-recovery', bag_conditioning: 'start-bag-conditioning' }
    const route = startRoute[s.type]
    if (route) {
      const r = await call<{ mtLog?: { id: string } }>('POST', `/api/sessions/${s.id}/${route}`)
      // A class is a fixed hour: the log card's minutes (G1 #7) as he'd save it.
      if (s.type === 'mt_class' && r.json?.mtLog?.id) await call('PATCH', `/api/mt-class-logs/${r.json.mtLog.id}`, { durationMin: a.durationMin })
    }
    const [startedRow] = await db.select().from(sessions).where(eq(sessions.id, s.id))
    base.plannedMin = s.type === 'mt_class' ? CLASS_MINUTES : startedRow ? (doseJsonMinutes(startedRow) ?? plannedOtherMinutes(startedRow)) : null
    doses.push(base)
    await finish(s, a, endMs)
  }

  async function doAction(day: number, a: ReplayAction) {
    setClock(utcMs(day, a.at))
    if (a.kind === 'open') {
      await call('POST', '/api/sessions/generate-today', { date: isoOf(day) })
      await call('GET', `/api/body/watch?today=${isoOf(day)}`)
    } else if (a.kind === 'checkin') {
      await call('POST', '/api/daily-logs', { date: isoOf(day), ...a.log })
    } else if (a.kind === 'session') {
      await doSession(day, a)
    } else if (a.kind === 'skip') {
      const [row] = await db.select().from(sessions).where(and(eq(sessions.scheduledDate, day), eq(sessions.type, a.type), eq(sessions.status, 'planned')))
      if (!row) { errors.push(`${isoOf(day)}: no planned ${a.type} to skip`); return }
      await call('PATCH', `/api/sessions/${row.id}`, { status: 'skipped', skipReason: a.reason, skipReasonDetail: a.detail ?? null, today: isoOf(day) })
    } else if (a.kind === 'add') {
      await call('POST', '/api/sessions/insert-ad-hoc', { type: a.type, timeSlot: a.slot, date: isoOf(day), today: isoOf(day), ...(a.label ? { label: a.label } : {}) })
    } else if (a.kind === 'planned') {
      const rows = (await db.select().from(sessions).where(and(eq(sessions.scheduledDate, day), eq(sessions.status, 'planned'))))
        .filter(r => !(a.skipTypes ?? []).includes(r.type))
        // A true athlete misses some: left planned, they turn missed overnight.
        .filter(r => !a.athlete?.misses?.(day, r.type))
        .sort((x, y) => (x.timeSlot === 'pm' ? 1 : 0) - (y.timeSlot === 'pm' ? 1 : 0))
      for (const r of rows) {
        const slot = r.timeSlot === 'pm' ? 'pm' : 'am'
        const at = slot === 'pm' ? a.pmAt ?? 18 * 60 : a.at
        await doSession(day, {
          kind: 'session', at, type: r.type, slot, durationMin: TYPICAL_MIN[r.type] ?? 30, rpe: a.rpe[r.type] ?? a.rpe.default,
          lifts: a.lifts, run: 'as_prescribed', runFactor: a.runFactor, notes: a.notes, addIfMissing: false, athlete: a.athlete,
        })
      }
    } else if (a.kind === 'settings') {
      await call('PATCH', '/api/settings', a.patch)
    } else if (a.kind === 'body') {
      const w = await call<{ alerts?: Array<{ id: string; stage?: string }>; ask?: { id: string } | null; board?: unknown }>('GET', `/api/body/watch?today=${isoOf(day)}`)
      const payload = w.json as unknown as Record<string, unknown> | null
      const ids = findAlertIds(payload)
      for (const id of ids) {
        if (a.answer === 'apply') await call('POST', `/api/body/watch/${id}/apply`, { today: isoOf(day) })
        else await call('POST', `/api/body/watch/${id}/answer`, { answer: 'better', today: isoOf(day) })
      }
    }
  }

  try {
    // BEGIN (page 64): the block, then its first week, as Program does.
    if (script.startBlock) {
      phase = { when: 'day', day: script.startBlock.day }
      setClock(utcMs(script.startBlock.day, 6 * 60 + 30))
      if (script.startBlock.type === 'block_zero') {
        const b = await call<{ id: string }>('POST', '/api/blocks/block-zero', { today: isoOf(script.startBlock.day) })
        if (b.json?.id) await call('POST', '/api/weeks/generate', { blockId: b.json.id, startDate: isoOf(script.startBlock.day), today: isoOf(script.startBlock.day) })
      } else {
        const b = await call<{ id: string }>('POST', '/api/blocks', { blockType: 'fighter', today: isoOf(script.startBlock.day) })
        if (b.json?.id) await call('POST', '/api/weeks/generate', { blockId: b.json.id, startDate: isoOf(script.startBlock.day), today: isoOf(script.startBlock.day) })
      }
      collectChanges('day', script.startBlock.day)
    }
    const byDay = new Map(script.days.map(d => [d.day, d]))
    for (let day = script.fromDay; day <= script.toDay; day++) {
      // The cron at 07:00 UTC: the small hours in the athlete's zone (coach brain section 5.1).
      phase = { when: 'nightly', day }
      setClock(day * DAY_MS + 7 * 3600000)
      opts.beforeDay?.(day, sqlite)
      await runNightlyReplan(env, clockMs())
      while (waits.length > 0) await waits.shift()
      collectChanges('nightly', day)
      modelByDay.push({ day, rows: (await readAthleteEstimates(db)).map(r => ({ kind: r.kind, key: r.key, state: r.state, n: r.n, u: r.uncertainty })) })

      phase = { when: 'day', day }
      const plan = byDay.get(day)
      const actions = plan?.actions ?? []
      const active = actions.length > 0
      // The app opens before the first thing he does (Today's generate-today and the raven's morning pass).
      if (active && actions[0].kind !== 'open') await doAction(day, { kind: 'open', at: Math.max(0, actions[0].at - 1) })
      setClock(utcMs(day, actions[0]?.at ?? 7 * 60))
      const planned = await plannedFor(day)
      const did: string[] = []
      for (const a of actions) {
        await doAction(day, a)
        did.push(a.kind === 'session' ? `${a.type}${a.rpe != null ? ` rpe ${a.rpe}` : ''}` : a.kind === 'settings' ? `settings ${JSON.stringify(a.patch)}` : a.kind === 'skip' ? `skip ${a.type} (${a.reason})` : a.kind === 'add' ? `add ${a.type}` : a.kind)
      }
      collectChanges('day', day)
      // Readiness as the day stood (after his check-in).
      const br = await blockReadinessFor(db, day)
      days.push({ day, active, planned, did, readiness: await readinessSnapshot(day), block: br ? { parts: readinessSummary(br), flap: br.flap, line: br.line, ready: br.ready, week: br.week } : null })
    }
    // The model after the last day's sessions (what the next night would store).
    setClock(utcMs(script.toDay, 23 * 60))
    const m = await refreshAthleteModel(db, script.toDay, Math.floor(clockMs() / 1000))
    const final = (await readAthleteEstimates(db)).map(r => ({ kind: r.kind, key: r.key, state: r.state, n: r.n, u: r.uncertainty, value: JSON.parse(r.valueJson) as unknown }))
    modelFinal = { byDay: modelByDay, final, summary: modelSummary(m) }
  } finally {
    globalThis.fetch = realFetch
    Object.assign(console, realConsole)
    uninstallClock()
  }

  const finalRows = await db.select().from(sessions)
  const decisionRows = sqlite.prepare('SELECT day, source, calls, final_json, verify_errors_json, candidates_json FROM coach_decisions ORDER BY day').all() as Array<Record<string, unknown>>
  return {
    decisions: decisionRows.map(r => ({
      day: r.day as number, source: r.source as string, calls: r.calls as number,
      final: JSON.parse(r.final_json as string), candidates: JSON.parse(r.candidates_json as string),
      verifyErrors: r.verify_errors_json ? JSON.parse(r.verify_errors_json as string) as string[] : [],
    })),
    name: script.name,
    fromDay: script.fromDay,
    toDay: script.toDay,
    days,
    doses,
    changes,
    aiCalls,
    sessions: finalRows.map(r => ({ id: r.id, day: r.scheduledDate, type: r.type, label: r.label, slot: r.timeSlot, status: r.status, source: r.source, contextJson: r.contextJson, rpe: r.rpe, durationSec: r.durationSec, blockType: r.blockType, notes: r.notes })),
    errors,
    model: modelFinal,
  }
}

/** Minutes for a session with no dose minutes: its planned length if stored, else the type's planning estimate. */
function plannedOtherMinutes(row: SessionRow): number | null {
  const ctx = (() => { try { return JSON.parse(row.contextJson ?? '{}') as { plannedMin?: number; plan?: { minutes?: number } } } catch { return {} } })()
  if (typeof ctx.plannedMin === 'number') return ctx.plannedMin
  // The week builder's plan mark (Bag Conditioning's minutes).
  if (typeof ctx.plan?.minutes === 'number') return ctx.plan.minutes
  return TYPICAL_MIN[row.type] ?? null
}

/** Alert ids anywhere in the body-watch payload that can be applied or answered. */
function findAlertIds(payload: Record<string, unknown> | null): string[] {
  const out = new Set<string>()
  const walk = (v: unknown) => {
    if (!v || typeof v !== 'object') return
    if (Array.isArray(v)) { v.forEach(walk); return }
    const o = v as Record<string, unknown>
    if (typeof o.alertId === 'string') out.add(o.alertId)
    if (typeof o.id === 'string' && (('region' in o) || ('stage' in o))) out.add(o.id)
    Object.values(o).forEach(walk)
  }
  walk(payload)
  return [...out]
}
