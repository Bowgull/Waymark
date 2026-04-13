import { and, desc, eq, gt, gte, lte } from 'drizzle-orm'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

import { createDB } from '../db/client'
import { activeRecoverySessions, bagWorkRoundCombos, bagWorkRounds, comboPerformance, combos, dailyLogs, exercises, journalEntries, mtClassLogs, postureSessionExercises, runSessions, sessions, settings, skipRopeSessions, strengthSessionExercises, strengthSets, trainingBlocks, trainingMaxes, weekAdjustments, weekPlans, weeklyJournals } from '../db/schema'
import { isoToEpochDay } from '../lib/dates'
import { POSTURE_TEMPLATE } from '../lib/postureTemplate'
import { RUNNING_PLAN_TEMPLATE, ZONE2_PRESCRIPTION } from '../lib/runningPlanTemplate'
import type { TemplateSession } from '../lib/weeklyTemplate'
import { getStrengthTemplate, getWeekPercentage } from '../lib/strengthTemplates'
import { WEEKLY_TEMPLATE } from '../lib/weeklyTemplate'
import { computeSuggestions } from '../lib/sessionSuggestions'
import { analyzeWeek, proposeReschedule } from '../lib/weekAnalysis'

type Bindings = {
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/*', cors())

type DrizzleDB = ReturnType<typeof createDB>

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
  const wavePct = getWeekPercentage(blockWeek)

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
    let prescribedWeightKg: number | null = null

    if (tmKg != null) {
      if (se.section === 'main') {
        prescribedWeightKg = Math.round(tmKg * wavePct * 100) / 100
      } else {
        prescribedWeightKg = tmKg
      }
    }

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

  return { session, exercises: result }
}

async function buildPostureWorkoutResponse(db: DrizzleDB, sessionId: string) {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  const pExercises = await db.select().from(postureSessionExercises)
    .where(eq(postureSessionExercises.sessionId, sessionId))

  const exRows = await db.select().from(exercises)
  const exMap = new Map(exRows.map(e => [e.id, e]))

  // Also get template notes and sections
  const templateMap = new Map(POSTURE_TEMPLATE.map(t => [t.exerciseId, { notes: t.notes ?? null, section: t.section }]))

  const result = pExercises
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map(pe => {
      const exercise = exMap.get(pe.exerciseId)
      const tmpl = templateMap.get(pe.exerciseId)
      return {
        ...pe,
        section: tmpl?.section ?? null,
        exercise: exercise ? { name: exercise.name, formCues: exercise.formCues, equipment: exercise.equipment, formVideoUrl: exercise.formVideoUrl } : null,
        notes: tmpl?.notes ?? null,
      }
    })

  return { session, exercises: result }
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

  return { session, rounds: result }
}

// Helper: get running prescription for a session based on its block week and run category
async function getRunPrescription(db: DrizzleDB, session: { weekPlanId: string | null; blockWeek: number | null; notes?: string | null }) {
  // Check if this is a Zone 2 run (tagged during generation)
  if (session.notes === 'zone2') {
    return {
      weekNumber: ZONE2_PRESCRIPTION.weekNumber,
      runType: ZONE2_PRESCRIPTION.runType,
      targetDesc: ZONE2_PRESCRIPTION.targetDesc,
      targetDurSec: ZONE2_PRESCRIPTION.targetDurSec,
      targetDistKm: ZONE2_PRESCRIPTION.targetDistKm,
    }
  }

  // Progression run: determine week number from weekPlan or block
  let weekNumber: number | null = null

  if (session.weekPlanId) {
    const [wp] = await db.select().from(weekPlans).where(eq(weekPlans.id, session.weekPlanId))
    if (wp) weekNumber = wp.weekNumber
  }

  if (weekNumber == null) {
    // Fallback: compute from active block
    const blocks = await db.select().from(trainingBlocks).where(eq(trainingBlocks.status, 'active'))
    if (blocks.length > 0) {
      const block = blocks[0]
      const startedAt = block.startedAt ?? Math.floor(Date.now() / 1000)
      const weeksSinceStart = Math.floor((Math.floor(Date.now() / 1000) - startedAt) / (7 * 86400))
      weekNumber = Math.min(Math.max(weeksSinceStart + 1, 1), block.totalWeeks)
    }
  }

  if (weekNumber == null) return null

  const plan = RUNNING_PLAN_TEMPLATE.find(r => r.weekNumber === weekNumber)
  if (!plan) return null

  return {
    weekNumber: plan.weekNumber,
    runType: plan.runType,
    targetDesc: plan.targetDesc,
    targetDurSec: plan.targetDurSec,
    targetDistKm: plan.targetDistKm,
  }
}

/** Build effective template for a day, filtering MT classes based on settings. */
function getEffectiveTemplate(dayOfWeek: number, mtClassDays: Set<number>): TemplateSession[] {
  const base = WEEKLY_TEMPLATE[dayOfWeek] ?? []
  return base.filter(entry => {
    if (entry.type === 'mt_class' && !mtClassDays.has(dayOfWeek)) return false
    return true
  })
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
  const rows = await db.select().from(sessions).where(eq(sessions.scheduledDate, epochDay))

  rows.sort((a, b) => (a.timeSlot === 'am' ? -1 : 1) - (b.timeSlot === 'am' ? -1 : 1))
  return c.json(rows)
})

app.post('/api/sessions/generate-today', async (c) => {
  const body = await c.req.json<{ date: string }>()
  if (!body.date) return c.json({ error: 'date required' }, 400)

  const epochDay = isoToEpochDay(body.date)
  const dayOfWeek = new Date(`${body.date}T12:00:00Z`).getUTCDay()
  const nowSec = Math.floor(Date.now() / 1000)

  const db = createDB(c.env)

  // Idempotent: return existing sessions if any
  const existing = await db.select().from(sessions).where(eq(sessions.scheduledDate, epochDay))
  if (existing.length > 0) {
    existing.sort((a, b) => (a.timeSlot === 'am' ? -1 : 1) - (b.timeSlot === 'am' ? -1 : 1))
    return c.json(existing)
  }

  // Read settings to determine which days have MT classes
  const settingsRows = await db.select().from(settings)
  const mtDaysSetting = settingsRows[0]?.mtClassDays ?? '1,3,5'
  const mtClassDays = new Set(mtDaysSetting.split(',').filter(Boolean).map(Number))

  const template = getEffectiveTemplate(dayOfWeek, mtClassDays)
  const created = []

  // Determine current block week for strength sessions
  let blockWeek = 1
  let weekPlanId: string | null = null
  const blocks = await db.select().from(trainingBlocks).where(eq(trainingBlocks.status, 'active'))
  if (blocks.length > 0) {
    const block = blocks[0]
    const startedAt = block.startedAt ?? nowSec
    const weeksSinceStart = Math.floor((nowSec - startedAt) / (7 * 86400))
    blockWeek = (weeksSinceStart % 6) + 1
    const currentWeekNumber = Math.min(Math.max(weeksSinceStart + 1, 1), block.totalWeeks)

    // Auto-create week plan if none exists
    const existingWeeks = await db.select().from(weekPlans).where(eq(weekPlans.blockId, block.id))
    const existingWeek = existingWeeks.find(w => w.weekNumber === currentWeekNumber)
    if (existingWeek) {
      weekPlanId = existingWeek.id
    } else {
      weekPlanId = crypto.randomUUID()
      await db.insert(weekPlans).values({
        id: weekPlanId,
        blockId: block.id,
        weekNumber: currentWeekNumber,
        status: 'draft',
        autoGenerated: 1,
        createdAt: nowSec,
      })
    }
  }

  for (const entry of template) {
    const id = crypto.randomUUID()
    const isStrength = entry.type === 'strength'
    // Tag running sessions with their category so start-run can determine prescription
    const runTag = entry.type === 'running' ? (entry.runCategory ?? null) : null
    await db.insert(sessions).values({
      id,
      type: entry.type,
      weekPlanId,
      scheduledDate: epochDay,
      timeSlot: entry.timeSlot,
      blockWeek: isStrength ? blockWeek : null,
      status: 'planned',
      notes: runTag,
      createdAt: nowSec,
    })
    created.push({
      id,
      type: entry.type,
      weekPlanId,
      scheduledDate: epochDay,
      timeSlot: entry.timeSlot,
      blockWeek: isStrength ? blockWeek : null,
      status: 'planned',
      startedAt: null,
      completedAt: null,
      durationSec: null,
      rpe: null,
      difficulty: null,
      notes: runTag,
      createdAt: nowSec,
    })
  }

  return c.json(created)
})

// ─── Smart session suggestions ──────────────────────────────

app.get('/api/sessions/suggestions', async (c) => {
  const date = c.req.query('date')
  if (!date) return c.json({ error: 'date query param required' }, 400)

  const targetEpochDay = isoToEpochDay(date)
  const db = createDB(c.env)

  // Today's wellness
  const [todayLog] = await db.select().from(dailyLogs).where(eq(dailyLogs.logDate, targetEpochDay))
  const todayWellness = todayLog ? {
    sleepHours: todayLog.sleepHours,
    soreness: todayLog.soreness,
    weedGrams: todayLog.weedGrams,
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

  // This week's sessions (7-day window around target date)
  const weekStart = targetEpochDay - new Date(targetEpochDay * 86400000).getUTCDay()
  const weekEnd = weekStart + 6
  const weekSessions = await db.select().from(sessions).where(
    and(gte(sessions.scheduledDate, weekStart), lte(sessions.scheduledDate, weekEnd))
  )

  // Existing sessions on the target date
  const existingOnDate = weekSessions
    .filter(s => s.scheduledDate === targetEpochDay)
    .map(s => ({ type: s.type, timeSlot: s.timeSlot }))

  // Active block week
  let blockWeek: number | null = null
  const blocks = await db.select().from(trainingBlocks).where(eq(trainingBlocks.status, 'active'))
  if (blocks.length > 0) {
    const block = blocks[0]
    const startedAt = block.startedAt ?? Math.floor(Date.now() / 1000)
    const weeksSinceStart = Math.floor((Math.floor(Date.now() / 1000) - startedAt) / (7 * 86400))
    blockWeek = ((Math.min(Math.max(weeksSinceStart + 1, 1), block.totalWeeks) - 1) % 6) + 1
  }

  const result = computeSuggestions({
    todayWellness,
    recentWellness,
    weekSessions: weekSessions.map(s => ({
      type: s.type,
      status: s.status,
      scheduledDate: s.scheduledDate,
      timeSlot: s.timeSlot,
    })),
    blockWeek,
    targetDate: targetEpochDay,
    existingSessionsOnDate: existingOnDate,
  })

  return c.json(result)
})

// ─── Ad-hoc session insertion ────────────────────────────────

app.post('/api/sessions/insert-ad-hoc', async (c) => {
  const body = await c.req.json<{ date: string; type: string; timeSlot: 'am' | 'pm'; runCategory?: string }>()
  if (!body.date || !body.type || !body.timeSlot) return c.json({ error: 'date, type, timeSlot required' }, 400)

  const epochDay = isoToEpochDay(body.date)
  const nowSec = Math.floor(Date.now() / 1000)
  const db = createDB(c.env)

  // Determine weekPlanId from active block
  let weekPlanId: string | null = null
  const blocks = await db.select().from(trainingBlocks).where(eq(trainingBlocks.status, 'active'))
  if (blocks.length > 0) {
    const block = blocks[0]
    const startedAt = block.startedAt ?? nowSec
    const weeksSinceStart = Math.floor((nowSec - startedAt) / (7 * 86400))
    const currentWeekNumber = Math.min(Math.max(weeksSinceStart + 1, 1), block.totalWeeks)
    const existingWeeks = await db.select().from(weekPlans).where(eq(weekPlans.blockId, block.id))
    const existingWeek = existingWeeks.find(w => w.weekNumber === currentWeekNumber)
    weekPlanId = existingWeek?.id ?? null
  }

  const id = crypto.randomUUID()
  const runTag = body.type === 'running' ? (body.runCategory ?? null) : null

  await db.insert(sessions).values({
    id,
    type: body.type,
    weekPlanId,
    scheduledDate: epochDay,
    timeSlot: body.timeSlot,
    blockWeek: null,
    status: 'planned',
    notes: runTag,
    createdAt: nowSec,
  })

  const [row] = await db.select().from(sessions).where(eq(sessions.id, id))
  return c.json(row)
})

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
  }>()

  const db = createDB(c.env)
  const updates: Record<string, unknown> = {}

  if (body.status !== undefined) updates.status = body.status
  if (body.startedAt !== undefined) updates.startedAt = body.startedAt
  if (body.completedAt !== undefined) updates.completedAt = body.completedAt
  if (body.durationSec !== undefined) updates.durationSec = body.durationSec
  if (body.rpe !== undefined) updates.rpe = body.rpe
  if (body.difficulty !== undefined) updates.difficulty = body.difficulty
  if (body.notes !== undefined) updates.notes = body.notes

  await db.update(sessions).set(updates).where(eq(sessions.id, id))

  const [row] = await db.select().from(sessions).where(eq(sessions.id, id))

  // ─── Skip reschedule proposal ─────────────────────────────
  if (body.status === 'skipped' && row) {
    const todayEpochDay = isoToEpochDay(new Date().toISOString().split('T')[0])
    const weekStart = todayEpochDay - new Date(todayEpochDay * 86400000).getUTCDay()
    const weekEnd = weekStart + 6

    // Get wellness context to auto-detect skip reason
    const [todayLog] = await db.select().from(dailyLogs).where(eq(dailyLogs.logDate, todayEpochDay))
    const skipReasons: string[] = []
    if (todayLog) {
      if (todayLog.soreness != null && todayLog.soreness >= 4) skipReasons.push('Soreness is high')
      if (todayLog.sleepHours != null && todayLog.sleepHours < 6) skipReasons.push('Sleep is low')
      if (todayLog.alcoholScale != null && todayLog.alcoholScale >= 5) skipReasons.push('Recovery day')
    }

    const weekSessions = await db.select().from(sessions).where(
      and(gte(sessions.scheduledDate, weekStart), lte(sessions.scheduledDate, weekEnd))
    )

    const proposal = proposeReschedule(
      { type: row.type, scheduledDate: row.scheduledDate ?? todayEpochDay, timeSlot: row.timeSlot ?? 'am', notes: row.notes },
      weekSessions.map(s => ({ type: s.type, scheduledDate: s.scheduledDate ?? 0, timeSlot: s.timeSlot ?? 'am', status: s.status })),
      todayEpochDay,
    )

    if (proposal) {
      const sourceData = JSON.stringify({
        wellness: todayLog ? { sleepHours: todayLog.sleepHours, soreness: todayLog.soreness, alcoholScale: todayLog.alcoholScale } : null,
        skipReasons,
        originalDate: row.scheduledDate,
      })

      const adjustmentId = crypto.randomUUID()
      await db.insert(weekAdjustments).values({
        id: adjustmentId,
        weekPlanId: row.weekPlanId ?? '',
        adjustmentType: 'skip_reschedule',
        sessionType: row.type,
        action: 'add',
        reason: proposal.reason,
        targetDay: proposal.suggestedDay,
        targetTimeSlot: proposal.suggestedTimeSlot,
        sourceData,
        status: 'proposed',
        createdAt: Math.floor(Date.now() / 1000),
      })

      return c.json({
        session: row,
        skipContext: skipReasons.length > 0 ? skipReasons.join(' · ') : null,
        reschedule: { ...proposal, adjustmentId },
      })
    }

    // No reschedule proposal but still return skip context
    return c.json({
      ...row,
      skipContext: skipReasons.length > 0 ? skipReasons.join(' · ') : null,
    })
  }

  return c.json(row)
})

// ─── Adjustment accept/reject ──────────────────────────────────

app.post('/api/adjustments/:id/accept', async (c) => {
  const adjustmentId = c.req.param('id')
  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)

  const [adj] = await db.select().from(weekAdjustments).where(eq(weekAdjustments.id, adjustmentId))
  if (!adj) return c.json({ error: 'adjustment not found' }, 404)
  if (adj.status !== 'proposed') return c.json({ error: 'adjustment already resolved' }, 400)

  // Mark accepted
  await db.update(weekAdjustments).set({ status: 'accepted' }).where(eq(weekAdjustments.id, adjustmentId))

  // Create the makeup session
  if (adj.action === 'add' && adj.targetDay != null) {
    // Calculate the epoch day for the target day this week
    const todayEpochDay = isoToEpochDay(new Date().toISOString().split('T')[0])
    const weekStart = todayEpochDay - new Date(todayEpochDay * 86400000).getUTCDay()
    const targetEpochDay = weekStart + adj.targetDay

    const sessionId = crypto.randomUUID()
    const runTag = adj.sessionType === 'running'
      ? (JSON.parse(adj.sourceData ?? '{}').runCategory ?? null)
      : null

    await db.insert(sessions).values({
      id: sessionId,
      type: adj.sessionType,
      weekPlanId: adj.weekPlanId,
      scheduledDate: targetEpochDay,
      timeSlot: adj.targetTimeSlot ?? 'am',
      blockWeek: null,
      status: 'planned',
      notes: runTag,
      adjustmentId,
      createdAt: nowSec,
    })

    const [created] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
    return c.json({ adjustment: adj, session: created })
  }

  return c.json({ adjustment: adj })
})

app.post('/api/adjustments/:id/reject', async (c) => {
  const adjustmentId = c.req.param('id')
  const db = createDB(c.env)

  const [adj] = await db.select().from(weekAdjustments).where(eq(weekAdjustments.id, adjustmentId))
  if (!adj) return c.json({ error: 'adjustment not found' }, 404)

  await db.update(weekAdjustments).set({ status: 'rejected' }).where(eq(weekAdjustments.id, adjustmentId))
  return c.json({ adjustment: { ...adj, status: 'rejected' } })
})

// ─── Pending adjustments for a week ────────────────────────────

app.get('/api/adjustments', async (c) => {
  const weekPlanId = c.req.query('weekPlanId')
  const db = createDB(c.env)

  if (weekPlanId) {
    const rows = await db.select().from(weekAdjustments).where(eq(weekAdjustments.weekPlanId, weekPlanId))
    return c.json(rows)
  }

  // Default: return all proposed adjustments
  const rows = await db.select().from(weekAdjustments).where(eq(weekAdjustments.status, 'proposed'))
  return c.json(rows)
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
  const template = getStrengthTemplate(dayOfWeek, blockWeek)
  const weekPct = getWeekPercentage(blockWeek)

  // Get training maxes for weight suggestions
  const maxes = await db.select().from(trainingMaxes)
  const maxMap = new Map(maxes.map(m => [m.exerciseId, m.weightKg]))

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

    for (let setIdx = 0; setIdx < tex.sets.length; setIdx++) {
      const ts = tex.sets[setIdx]
      let suggestedWeight: number | null = null
      if (trainingMax != null) {
        if (ts.isWarmup) {
          suggestedWeight = Math.round(trainingMax * 0.5 * 100) / 100
        } else if (tex.section === 'main') {
          // Wave loading: main lifts use block week percentage
          suggestedWeight = Math.round(trainingMax * weekPct * 100) / 100
        } else {
          // Accessories and core: use full TM
          suggestedWeight = trainingMax
        }
      }

      await db.insert(strengthSets).values({
        id: crypto.randomUUID(),
        sessionExerciseId: exId,
        setNumber: setIdx + 1,
        weightKg: suggestedWeight,
        reps: ts.targetReps,
        isWarmup: ts.isWarmup ? 1 : 0,
        restSec: ts.restSec,
        createdAt: nowSec,
      })
    }
  }

  // Mark session as in_progress
  await db.update(sessions).set({ status: 'in_progress', startedAt: nowSec }).where(eq(sessions.id, sessionId))

  return c.json(await buildWorkoutResponse(db, sessionId))
})

app.get('/api/sessions/:id/workout', async (c) => {
  const sessionId = c.req.param('id')
  const db = createDB(c.env)

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!session) return c.json({ error: 'session not found' }, 404)

  return c.json(await buildWorkoutResponse(db, sessionId))
})

app.patch('/api/strength-sets/:id', async (c) => {
  const setId = c.req.param('id')
  const body = await c.req.json<{
    weightKg?: number | null
    reps?: number
    completedAt?: number
  }>()

  const db = createDB(c.env)
  const updates: Record<string, unknown> = {}

  if (body.weightKg !== undefined) updates.weightKg = body.weightKg
  if (body.reps !== undefined) updates.reps = body.reps
  if (body.completedAt !== undefined) updates.createdAt = body.completedAt // reuse createdAt for completion timestamp

  await db.update(strengthSets).set(updates).where(eq(strengthSets.id, setId))

  const [row] = await db.select().from(strengthSets).where(eq(strengthSets.id, setId))
  return c.json(row)
})

app.post('/api/sessions/:id/complete', async (c) => {
  const sessionId = c.req.param('id')
  const body = await c.req.json<{
    rpe?: number
    difficulty?: number
    notes?: string
  }>()

  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!session) return c.json({ error: 'session not found' }, 404)

  const durationSec = session.startedAt ? nowSec - session.startedAt : null

  await db.update(sessions).set({
    status: 'completed',
    completedAt: nowSec,
    durationSec,
    rpe: body.rpe ?? null,
    difficulty: body.difficulty ?? null,
    notes: body.notes ?? null,
  }).where(eq(sessions.id, sessionId))

  // TM progression is handled by POST /api/blocks/:id/progress-tm after 6-week blocks.
  // We track exercise-level weight history via the last-session endpoint instead of auto-updating TMs.

  const [updated] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  return c.json(updated)
})

// ─── Foundation Run (combined Zone 2 + posture) ───────────────

app.post('/api/sessions/:id/start-foundation-run', async (c) => {
  const sessionId = c.req.param('id')
  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!session) return c.json({ error: 'session not found' }, 404)
  if (session.type !== 'foundation_run') return c.json({ error: 'not a foundation_run session' }, 400)

  // Idempotent
  const existingRun = await db.select().from(runSessions).where(eq(runSessions.sessionId, sessionId))
  const existingPosture = await db.select().from(postureSessionExercises).where(eq(postureSessionExercises.sessionId, sessionId))
  if (existingRun.length > 0 && existingPosture.length > 0) {
    const prescription = await getRunPrescription(db, { ...session, notes: 'zone2' })
    const postureResponse = await buildPostureWorkoutResponse(db, sessionId)
    return c.json({ session, runSession: existingRun[0], prescription, postureExercises: postureResponse.exercises })
  }

  // Create run session (Zone 2)
  const runId = crypto.randomUUID()
  await db.insert(runSessions).values({
    id: runId,
    sessionId,
    runType: 'zone2',
    planWeek: null,
    isIndoor: 0,
  })

  // Create posture exercises
  for (let i = 0; i < POSTURE_TEMPLATE.length; i++) {
    const tmpl = POSTURE_TEMPLATE[i]
    await db.insert(postureSessionExercises).values({
      id: crypto.randomUUID(),
      sessionId,
      exerciseId: tmpl.exerciseId,
      orderIndex: i,
      holdSec: tmpl.holdSec ?? null,
      sets: tmpl.sets,
      completed: 0,
    })
  }

  await db.update(sessions).set({ status: 'in_progress', startedAt: nowSec }).where(eq(sessions.id, sessionId))

  const [updated] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  const [run] = await db.select().from(runSessions).where(eq(runSessions.id, runId))
  const prescription = await getRunPrescription(db, { ...updated, notes: 'zone2' })
  const postureResponse = await buildPostureWorkoutResponse(db, sessionId)

  return c.json({ session: updated, runSession: run, prescription, postureExercises: postureResponse.exercises })
})

app.get('/api/sessions/:id/foundation-run-workout', async (c) => {
  const sessionId = c.req.param('id')
  const db = createDB(c.env)

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!session) return c.json({ error: 'session not found' }, 404)

  const [run] = await db.select().from(runSessions).where(eq(runSessions.sessionId, sessionId))
  const prescription = await getRunPrescription(db, { ...session, notes: 'zone2' })
  const postureResponse = await buildPostureWorkoutResponse(db, sessionId)

  return c.json({ session, runSession: run ?? null, prescription, postureExercises: postureResponse.exercises })
})

// ─── Posture Workout ───────────────────────────────────────────

app.post('/api/sessions/:id/start-posture', async (c) => {
  const sessionId = c.req.param('id')
  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!session) return c.json({ error: 'session not found' }, 404)
  if (session.type !== 'posture_corrective') return c.json({ error: 'not a posture session' }, 400)

  // Idempotent: return existing if already started
  const existing = await db.select().from(postureSessionExercises)
    .where(eq(postureSessionExercises.sessionId, sessionId))
  if (existing.length > 0) {
    return c.json(await buildPostureWorkoutResponse(db, sessionId))
  }

  for (let i = 0; i < POSTURE_TEMPLATE.length; i++) {
    const tmpl = POSTURE_TEMPLATE[i]
    await db.insert(postureSessionExercises).values({
      id: crypto.randomUUID(),
      sessionId,
      exerciseId: tmpl.exerciseId,
      orderIndex: i,
      holdSec: tmpl.holdSec ?? null,
      sets: tmpl.sets,
      completed: 0,
    })
  }

  await db.update(sessions).set({ status: 'in_progress', startedAt: nowSec }).where(eq(sessions.id, sessionId))
  return c.json(await buildPostureWorkoutResponse(db, sessionId))
})

app.get('/api/sessions/:id/posture-workout', async (c) => {
  const sessionId = c.req.param('id')
  const db = createDB(c.env)

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!session) return c.json({ error: 'session not found' }, 404)

  return c.json(await buildPostureWorkoutResponse(db, sessionId))
})

app.patch('/api/posture-exercises/:id', async (c) => {
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
    return comboTechniques.every(t => enabledTechniques.has(t))
  })

  if (unlockedCombos.length === 0) {
    return c.json({ error: 'no unlocked combos available' }, 400)
  }

  const ROUND_COUNT = 6
  const COMBOS_PER_ROUND = 3

  for (let r = 0; r < ROUND_COUNT; r++) {
    const roundId = crypto.randomUUID()
    await db.insert(bagWorkRounds).values({
      id: roundId,
      sessionId,
      roundNumber: r + 1,
      durationSec: 180,
      restSec: 60,
      createdAt: nowSec,
    })

    // Weighted selection: lower mastery = more likely to be picked; favourites get a bonus
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
        // Fallback: pick first unused
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

// Swap a combo in a round (re-roll)
app.post('/api/sessions/:id/swap-combo', async (c) => {
  const body = await c.req.json<{ roundId: string; oldComboId: string }>()
  const db = createDB(c.env)

  // Get combos already in this round
  const roundCombos = await db.select().from(bagWorkRoundCombos).where(eq(bagWorkRoundCombos.roundId, body.roundId))
  const usedIds = new Set(roundCombos.map(rc => rc.comboId))

  // Get user's enabled techniques
  const [userSettings] = await db.select().from(settings)
  const enabledTechniques = new Set((userSettings?.enabledTechniques ?? 'boxing,kicks,defensive').split(','))

  // Pick a new combo from unlocked pool excluding current round's combos
  const allUnlocked = await db.select().from(combos).where(eq(combos.unlocked, 1))
  const available = allUnlocked.filter(c => {
    if (usedIds.has(c.id) && c.id !== body.oldComboId) return false
    if (c.id === body.oldComboId) return false
    const techniques = c.techniques.split(',').filter(Boolean)
    return techniques.every(t => enabledTechniques.has(t))
  })

  if (available.length === 0) {
    return c.json({ error: 'no other combos available' }, 400)
  }

  const newCombo = available[Math.floor(Math.random() * available.length)]

  // Update the junction row
  const targetRow = roundCombos.find(rc => rc.comboId === body.oldComboId)
  if (targetRow) {
    await db.update(bagWorkRoundCombos).set({ comboId: newCombo.id }).where(eq(bagWorkRoundCombos.id, targetRow.id))
  }

  return c.json({ combo: newCombo })
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

  const skipId = crypto.randomUUID()
  await db.insert(skipRopeSessions).values({ id: skipId, sessionId, roundCount: 5, roundDurSec: 180 })
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
  return c.json({ session, skipSession: skip ?? null })
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

app.post('/api/sessions/:id/start-mt-class', async (c) => {
  const sessionId = c.req.param('id')
  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!session) return c.json({ error: 'session not found' }, 404)

  const existing = await db.select().from(mtClassLogs).where(eq(mtClassLogs.sessionId, sessionId))
  if (existing.length > 0) {
    return c.json({ session, mtLog: existing[0] })
  }

  const logId = crypto.randomUUID()
  await db.insert(mtClassLogs).values({ id: logId, sessionId })
  await db.update(sessions).set({ status: 'in_progress', startedAt: nowSec }).where(eq(sessions.id, sessionId))

  const [updated] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  const [mt] = await db.select().from(mtClassLogs).where(eq(mtClassLogs.id, logId))
  return c.json({ session: updated, mtLog: mt })
})

app.get('/api/sessions/:id/mt-class-workout', async (c) => {
  const sessionId = c.req.param('id')
  const db = createDB(c.env)
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!session) return c.json({ error: 'session not found' }, 404)
  const [mt] = await db.select().from(mtClassLogs).where(eq(mtClassLogs.sessionId, sessionId))
  return c.json({ session, mtLog: mt ?? null })
})

app.patch('/api/mt-class-logs/:id', async (c) => {
  const logId = c.req.param('id')
  const body = await c.req.json<{
    classType?: string
    focusSkill?: string
    weakness?: string
    concept?: string
    actionItems?: string
  }>()
  const db = createDB(c.env)
  const updates: Record<string, unknown> = {}
  if (body.classType !== undefined) updates.classType = body.classType
  if (body.focusSkill !== undefined) updates.focusSkill = body.focusSkill
  if (body.weakness !== undefined) updates.weakness = body.weakness
  if (body.concept !== undefined) updates.concept = body.concept
  if (body.actionItems !== undefined) updates.actionItems = body.actionItems
  await db.update(mtClassLogs).set(updates).where(eq(mtClassLogs.id, logId))
  const [row] = await db.select().from(mtClassLogs).where(eq(mtClassLogs.id, logId))
  return c.json(row)
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

app.post('/api/daily-logs', async (c) => {
  const body = await c.req.json<{
    date: string
    sleepHours?: number
    weedGrams?: number
    alcoholScale?: number
    soreness?: number
    notes?: string
  }>()
  if (!body.date) return c.json({ error: 'date required' }, 400)

  const epochDay = isoToEpochDay(body.date)
  const nowSec = Math.floor(Date.now() / 1000)
  const db = createDB(c.env)

  // Check if log already exists
  const existing = await db.select().from(dailyLogs).where(eq(dailyLogs.logDate, epochDay))
  if (existing.length > 0) {
    return c.json(existing[0])
  }

  const id = crypto.randomUUID()
  await db.insert(dailyLogs).values({
    id,
    logDate: epochDay,
    sleepHours: body.sleepHours ?? null,
    weedGrams: body.weedGrams ?? null,
    alcoholScale: body.alcoholScale ?? null,
    soreness: body.soreness ?? null,
    notes: body.notes ?? null,
    createdAt: nowSec,
  })

  const [row] = await db.select().from(dailyLogs).where(eq(dailyLogs.id, id))
  return c.json(row)
})

// ─── Program / Blocks / Weeks ──────────────────────────────────

app.get('/api/blocks/current', async (c) => {
  const db = createDB(c.env)
  const blocks = await db.select().from(trainingBlocks).where(eq(trainingBlocks.status, 'active'))
  return c.json(blocks[0] ?? null)
})

app.post('/api/blocks', async (c) => {
  const body = await c.req.json<{ name?: string; totalWeeks?: number }>()
  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)

  const id = crypto.randomUUID()
  await db.insert(trainingBlocks).values({
    id,
    name: body.name ?? '12-Week Base Build',
    totalWeeks: body.totalWeeks ?? 12,
    startedAt: nowSec,
    status: 'active',
    createdAt: nowSec,
  })

  const [block] = await db.select().from(trainingBlocks).where(eq(trainingBlocks.id, id))
  return c.json(block)
})

app.get('/api/weeks/current', async (c) => {
  const blockId = c.req.query('blockId')
  const weekNumber = c.req.query('weekNumber')
  if (!blockId || !weekNumber) return c.json({ error: 'blockId and weekNumber required' }, 400)

  const db = createDB(c.env)
  const weeks = await db.select().from(weekPlans).where(eq(weekPlans.blockId, blockId))
  const week = weeks.find(w => w.weekNumber === parseInt(weekNumber))
  if (!week) return c.json(null)

  // Get sessions for this week
  const weekSessions = await db.select().from(sessions).where(eq(sessions.weekPlanId, week.id))
  weekSessions.sort((a, b) => {
    const dateDiff = (a.scheduledDate ?? 0) - (b.scheduledDate ?? 0)
    if (dateDiff !== 0) return dateDiff
    return (a.timeSlot === 'am' ? 0 : 1) - (b.timeSlot === 'am' ? 0 : 1)
  })

  return c.json({ week, sessions: weekSessions })
})

app.post('/api/weeks/generate', async (c) => {
  const body = await c.req.json<{ blockId: string; weekNumber: number; startDate: string }>()
  if (!body.blockId || !body.weekNumber || !body.startDate) {
    return c.json({ error: 'blockId, weekNumber, startDate required' }, 400)
  }

  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)

  // Check if week already exists
  const existing = await db.select().from(weekPlans).where(eq(weekPlans.blockId, body.blockId))
  const existingWeek = existing.find(w => w.weekNumber === body.weekNumber)
  if (existingWeek) {
    const weekSessions = await db.select().from(sessions).where(eq(sessions.weekPlanId, existingWeek.id))
    return c.json({ week: existingWeek, sessions: weekSessions })
  }

  // Create week plan
  const weekId = crypto.randomUUID()
  await db.insert(weekPlans).values({
    id: weekId,
    blockId: body.blockId,
    weekNumber: body.weekNumber,
    status: 'draft',
    createdAt: nowSec,
  })

  // Parse start date (Monday of the week)
  const startDate = new Date(`${body.startDate}T12:00:00Z`)
  const createdSessions = []

  // Block week for strength sessions (use weekNumber modulo 6)
  const blockWeek = ((body.weekNumber - 1) % 6) + 1

  // Generate sessions for 7 days (Mon=0 through Sun=6)
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const date = new Date(startDate)
    date.setUTCDate(date.getUTCDate() + dayOffset)
    const dayOfWeek = date.getUTCDay()
    const epochDay = Math.floor(date.getTime() / 1000 / 86400)

    const template = WEEKLY_TEMPLATE[dayOfWeek] ?? []
    for (const entry of template) {
      const sessionId = crypto.randomUUID()
      const isStrength = entry.type === 'strength'
      await db.insert(sessions).values({
        id: sessionId,
        type: entry.type,
        weekPlanId: weekId,
        scheduledDate: epochDay,
        timeSlot: entry.timeSlot,
        blockWeek: isStrength ? blockWeek : null,
        status: 'planned',
        createdAt: nowSec,
      })
      createdSessions.push({
        id: sessionId,
        type: entry.type,
        weekPlanId: weekId,
        scheduledDate: epochDay,
        timeSlot: entry.timeSlot,
        blockWeek: isStrength ? blockWeek : null,
        status: 'planned',
        startedAt: null,
        completedAt: null,
        durationSec: null,
        rpe: null,
        difficulty: null,
        notes: null,
        createdAt: nowSec,
      })
    }
  }

  const [week] = await db.select().from(weekPlans).where(eq(weekPlans.id, weekId))
  return c.json({ week, sessions: createdSessions })
})

app.post('/api/weeks/auto-generate', async (c) => {
  const body = await c.req.json<{ blockId: string }>()
  if (!body.blockId) return c.json({ error: 'blockId required' }, 400)

  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)

  const [block] = await db.select().from(trainingBlocks).where(eq(trainingBlocks.id, body.blockId))
  if (!block) return c.json({ error: 'block not found' }, 404)

  const startedAt = block.startedAt ?? nowSec
  const weeksSinceStart = Math.floor((nowSec - startedAt) / (7 * 86400))
  const currentWeekNumber = Math.min(Math.max(weeksSinceStart + 1, 1), block.totalWeeks)

  // Check if week already exists
  const existing = await db.select().from(weekPlans).where(eq(weekPlans.blockId, body.blockId))
  const existingWeek = existing.find(w => w.weekNumber === currentWeekNumber)
  if (existingWeek) {
    const weekSessions = await db.select().from(sessions).where(eq(sessions.weekPlanId, existingWeek.id))
    weekSessions.sort((a, b) => {
      const dateDiff = (a.scheduledDate ?? 0) - (b.scheduledDate ?? 0)
      if (dateDiff !== 0) return dateDiff
      return (a.timeSlot === 'am' ? 0 : 1) - (b.timeSlot === 'am' ? 0 : 1)
    })
    return c.json({ week: existingWeek, sessions: weekSessions })
  }

  // Calculate Monday of current week
  const now = new Date()
  const day = now.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(now)
  monday.setDate(now.getDate() + diff)
  const startDate = new Date(`${monday.toLocaleDateString('en-CA')}T12:00:00Z`)

  const weekId = crypto.randomUUID()
  await db.insert(weekPlans).values({
    id: weekId,
    blockId: body.blockId,
    weekNumber: currentWeekNumber,
    status: 'draft',
    autoGenerated: 1,
    createdAt: nowSec,
  })

  const blockWeek = ((currentWeekNumber - 1) % 6) + 1

  // ─── Analyze previous week for adaptive generation ─────────
  const mondayEpochDay = Math.floor(startDate.getTime() / 1000 / 86400)
  const prevWeekStart = mondayEpochDay - 7
  const prevWeekEnd = mondayEpochDay - 1
  const prevPrevWeekStart = mondayEpochDay - 14
  const prevPrevWeekEnd = mondayEpochDay - 8

  // Get previous week's sessions
  const prevWeekSessions = await db.select().from(sessions).where(
    and(gte(sessions.scheduledDate, prevWeekStart), lte(sessions.scheduledDate, prevWeekEnd))
  )

  // Get daily logs for this and previous week
  const thisWeekLogs = await db.select().from(dailyLogs).where(
    and(gte(dailyLogs.logDate, prevWeekStart), lte(dailyLogs.logDate, prevWeekEnd))
  )
  const prevPrevWeekLogs = await db.select().from(dailyLogs).where(
    and(gte(dailyLogs.logDate, prevPrevWeekStart), lte(dailyLogs.logDate, prevPrevWeekEnd))
  )

  // Get previous week's analysis (if it exists) for pattern detection
  const prevWeekPlan = existing.find(w => w.weekNumber === currentWeekNumber - 1)
  let previousAnalysis = null
  if (prevWeekPlan?.analysisJson) {
    try { previousAnalysis = JSON.parse(prevWeekPlan.analysisJson) } catch { /* ignore */ }
  }

  const analysis = analyzeWeek(
    prevWeekSessions.map(s => ({
      type: s.type, status: s.status, scheduledDate: s.scheduledDate ?? 0,
      timeSlot: s.timeSlot ?? 'am', rpe: s.rpe, difficulty: s.difficulty, notes: s.notes,
    })),
    thisWeekLogs.map(l => ({
      logDate: l.logDate, sleepHours: l.sleepHours, soreness: l.soreness,
      weedGrams: l.weedGrams, alcoholScale: l.alcoholScale,
    })),
    prevPrevWeekLogs.map(l => ({
      logDate: l.logDate, sleepHours: l.sleepHours, soreness: l.soreness,
      weedGrams: l.weedGrams, alcoholScale: l.alcoholScale,
    })),
    previousAnalysis,
  )

  // Store analysis on the new week plan
  await db.update(weekPlans).set({ analysisJson: JSON.stringify(analysis) }).where(eq(weekPlans.id, weekId))

  // ─── Apply MT class day filter ─────────────────────────────
  const [settingsRow] = await db.select().from(settings)
  const mtDaysStr = settingsRow?.mtClassDays ?? '1,3,5'
  const mtClassDays = new Set(mtDaysStr.split(',').map(Number))

  // ─── Generate sessions from template ───────────────────────
  const createdSessions = []

  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const date = new Date(startDate)
    date.setUTCDate(date.getUTCDate() + dayOffset)
    const dayOfWeek = date.getUTCDay()
    const epochDay = Math.floor(date.getTime() / 1000 / 86400)

    const template = getEffectiveTemplate(dayOfWeek, mtClassDays)
    for (const entry of template) {
      const sessionId = crypto.randomUUID()
      const isStrength = entry.type === 'strength'
      await db.insert(sessions).values({
        id: sessionId,
        type: entry.type,
        weekPlanId: weekId,
        scheduledDate: epochDay,
        timeSlot: entry.timeSlot,
        blockWeek: isStrength ? blockWeek : null,
        status: 'planned',
        notes: entry.runCategory ?? null,
        createdAt: nowSec,
      })
      createdSessions.push({
        id: sessionId, type: entry.type, weekPlanId: weekId,
        scheduledDate: epochDay, timeSlot: entry.timeSlot,
        blockWeek: isStrength ? blockWeek : null, status: 'planned',
        startedAt: null, completedAt: null, durationSec: null,
        rpe: null, difficulty: null, notes: entry.runCategory ?? null,
        adjustmentId: null, createdAt: nowSec,
      })
    }
  }

  // ─── Create adjustment proposals from analysis ─────────────
  const adjustments = []
  for (const rec of analysis.recommendations) {
    if (rec.action === 'maintain') continue

    const adjId = crypto.randomUUID()
    await db.insert(weekAdjustments).values({
      id: adjId,
      weekPlanId: weekId,
      adjustmentType: 'deficit_carryforward',
      sessionType: rec.sessionType,
      action: rec.action,
      reason: rec.reason,
      targetDay: rec.dayOfWeek ?? null,
      targetTimeSlot: rec.timeSlot ?? null,
      sourceData: JSON.stringify({ analysisWeek: currentWeekNumber - 1, wellness: analysis.wellness }),
      status: 'proposed',
      createdAt: nowSec,
    })
    adjustments.push({ id: adjId, ...rec, status: 'proposed' })
  }

  const [week] = await db.select().from(weekPlans).where(eq(weekPlans.id, weekId))
  return c.json({ week, sessions: createdSessions, analysis, adjustments })
})

app.patch('/api/weeks/:id', async (c) => {
  const weekId = c.req.param('id')
  const body = await c.req.json<{ status?: string; notes?: string }>()
  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)

  const updates: Record<string, unknown> = {}
  if (body.status !== undefined) updates.status = body.status
  if (body.notes !== undefined) updates.notes = body.notes
  if (body.status === 'approved') updates.approvedAt = nowSec

  await db.update(weekPlans).set(updates).where(eq(weekPlans.id, weekId))
  const [row] = await db.select().from(weekPlans).where(eq(weekPlans.id, weekId))
  return c.json(row)
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
  const recent = allSessions.filter(s => s.createdAt >= cutoff)

  const completed = recent.filter(s => s.status === 'completed')
  const planned = recent.filter(s => s.status !== 'skipped')
  const totalDurationSec = completed.reduce((sum, s) => sum + (s.durationSec ?? 0), 0)
  const rpeValues = completed.filter(s => s.rpe != null).map(s => s.rpe!)
  const avgRpe = rpeValues.length > 0 ? Math.round(rpeValues.reduce((a, b) => a + b, 0) / rpeValues.length * 10) / 10 : null

  // Streak: consecutive days with at least one completed session (counting back from today)
  const todayEpochDay = Math.floor(nowSec / 86400)
  const completedDays = new Set(completed.map(s => s.scheduledDate).filter(Boolean))
  let streak = 0
  for (let d = todayEpochDay; d >= todayEpochDay - 60; d--) {
    if (completedDays.has(d)) streak++
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
  const weedValues = recent.filter(l => l.weedGrams != null).map(l => l.weedGrams!)
  const alcoholValues = recent.filter(l => l.alcoholScale != null).map(l => l.alcoholScale!)

  const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10 : null

  return c.json({
    entries: recent.length,
    avgSleep: avg(sleepValues),
    avgSoreness: avg(sorenessValues),
    avgWeed: avg(weedValues),
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
  const body = await c.req.json<{ date: string; type: string; content: string }>()
  if (!body.date || !body.content || !body.type) return c.json({ error: 'date, type, and content required' }, 400)

  const epochDay = isoToEpochDay(body.date)
  const nowSec = Math.floor(Date.now() / 1000)
  const db = createDB(c.env)

  // Check if entry already exists for this date+type
  const existing = await db.select().from(journalEntries).where(eq(journalEntries.date, epochDay))
  const match = existing.find((r) => r.type === body.type)
  if (match) {
    await db.update(journalEntries).set({ content: body.content }).where(eq(journalEntries.id, match.id))
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
  const rows = await db.select().from(journalEntries)
    .where(gte(journalEntries.date, cutoffDay))
    .orderBy(desc(journalEntries.date))

  return c.json(rows)
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
    lastDeploy?: number
    enabledTechniques?: string
  }>()

  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)
  const updates: Record<string, unknown> = { updatedAt: nowSec }

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

  await db.update(settings).set(updates).where(eq(settings.id, 'default'))
  const [row] = await db.select().from(settings).where(eq(settings.id, 'default'))

  // Cascade: if MT class days changed, clean up future planned sessions
  let cascade: { removed: number } | null = null
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
    const workingSets = sets.filter(s => s.isWarmup === 0 && s.weightKg != null && s.weightKg > 0)
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
    suggestedWeight: Math.round((bestMatch.weight + incrementKg) * 100) / 100,
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
  type SessionRecord = { date: string; epoch: number; maxWeightKg: number; avgReps: number; totalSets: number; allSets: { weightKg: number; reps: number }[] }
  const sessionRecords: SessionRecord[] = []
  let prRecord: { weightKg: number; reps: number; date: string } | null = null

  for (const se of sexes) {
    const session = completedMap.get(se.sessionId)
    if (!session) continue

    const sets = await db.select().from(strengthSets)
      .where(eq(strengthSets.sessionExerciseId, se.id))
    const workingSets = sets.filter(s => s.isWarmup === 0 && s.weightKg != null && s.weightKg > 0)
    if (workingSets.length === 0) continue

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
      allSets: workingSets.map(s => ({ weightKg: s.weightKg!, reps: s.reps })),
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
    const lastSets = lastSession.allSets
    const targetReps = lastSets[0]?.reps ?? 10
    const minReps = Math.min(...lastSets.map(s => s.reps))
    // Double progression: if all sets hit target reps or above, bump weight
    if (minReps >= targetReps && lastSets.length >= 3) {
      const newWeight = Math.round((lastSession.maxWeightKg + incrementKg) * 100) / 100
      suggestion = {
        type: 'weight_increase',
        message: `All sets hit ${targetReps} reps. Increase weight`,
        suggestedWeightKg: newWeight,
      }
    } else {
      suggestion = {
        type: 'rep_increase',
        message: `Build to ${lastSets.length}×${targetReps}, then increase`,
        suggestedWeightKg: lastSession.maxWeightKg,
      }
    }
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

// ─── TM Progression (after 6-week block) ─────────────────────

app.post('/api/blocks/:id/progress-tm', async (c) => {
  const blockId = c.req.param('id')
  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)

  const [block] = await db.select().from(trainingBlocks).where(eq(trainingBlocks.id, blockId))
  if (!block) return c.json({ error: 'block not found' }, 404)

  // Get all exercises and determine upper vs lower
  const allExercises = await db.select().from(exercises)
  const exMap = new Map(allExercises.map(e => [e.id, e]))

  // Get all sessions in this block via week plans
  const blockWeekPlans = await db.select().from(weekPlans).where(eq(weekPlans.blockId, blockId))
  const weekPlanIds = new Set(blockWeekPlans.map(wp => wp.id))
  const allBlockSessions = await db.select().from(sessions)
  const blockStrengthSessions = allBlockSessions.filter(s =>
    s.status === 'completed' && s.type === 'strength' &&
    s.weekPlanId != null && weekPlanIds.has(s.weekPlanId)
  )

  // Build a map of exercise → completed working sets in this block
  const exerciseSetMap = new Map<string, { total: number; clean: number }>()
  for (const session of blockStrengthSessions) {
    const sexes = await db.select().from(strengthSessionExercises)
      .where(eq(strengthSessionExercises.sessionId, session.id))
    for (const se of sexes) {
      if (se.section !== 'main') continue
      const sets = await db.select().from(strengthSets)
        .where(eq(strengthSets.sessionExerciseId, se.id))
      const workingSets = sets.filter(s => s.isWarmup === 0)
      const entry = exerciseSetMap.get(se.exerciseId) ?? { total: 0, clean: 0 }
      for (const s of workingSets) {
        entry.total++
        if (s.weightKg != null && s.weightKg > 0 && s.reps >= (s.reps > 0 ? s.reps : 1)) {
          entry.clean++
        }
      }
      exerciseSetMap.set(se.exerciseId, entry)
    }
  }

  const currentMaxes = await db.select().from(trainingMaxes)
  const updates: { exerciseId: string; newWeightKg: number }[] = []
  const warnings: { exerciseId: string; reason: string }[] = []

  for (const tm of currentMaxes) {
    const ex = exMap.get(tm.exerciseId)
    if (!ex) continue
    const isLower = ex.muscleGroups?.includes('quads') || ex.muscleGroups?.includes('glutes') || ex.muscleGroups?.includes('hamstrings')
    const increment = isLower ? 4.54 : 2.27 // +10lb lower, +5lb upper

    // Check if this exercise had clean sets in the block
    const setData = exerciseSetMap.get(tm.exerciseId)
    if (setData && setData.total > 0) {
      const cleanRate = setData.clean / setData.total
      if (cleanRate < 0.9) {
        warnings.push({
          exerciseId: tm.exerciseId,
          reason: `Only ${Math.round(cleanRate * 100)}% of sets completed clean. TM held`,
        })
        continue // Skip TM bump for this exercise
      }
    }

    const newWeight = Math.round((tm.weightKg + increment) * 100) / 100
    await db.update(trainingMaxes).set({ weightKg: newWeight, updatedAt: nowSec })
      .where(eq(trainingMaxes.exerciseId, tm.exerciseId))
    updates.push({ exerciseId: tm.exerciseId, newWeightKg: newWeight })
  }

  return c.json({ updated: updates, warnings })
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
    if (!session || session.status !== 'completed' || session.createdAt < cutoff) continue

    const sets = await db.select().from(strengthSets)
      .where(eq(strengthSets.sessionExerciseId, se.id))

    const completedSets = sets.filter(s => s.weightKg != null && s.weightKg > 0)
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
  const completed = allSessions.filter(s => s.status === 'completed' && s.type === 'strength' && s.createdAt >= cutoff)

  const dailyData = new Map<string, { totalSets: number; totalVolume: number; sessionCount: number }>()

  for (const session of completed) {
    const date = new Date((session.completedAt ?? session.createdAt) * 1000).toISOString().split('T')[0]
    const sexes = await db.select().from(strengthSessionExercises)
      .where(eq(strengthSessionExercises.sessionId, session.id))

    let dayVolume = 0
    let daySets = 0

    for (const se of sexes) {
      const sets = await db.select().from(strengthSets).where(eq(strengthSets.sessionExerciseId, se.id))
      for (const s of sets) {
        if (s.weightKg != null && s.weightKg > 0) {
          dayVolume += s.weightKg * s.reps
          daySets++
        }
      }
    }

    const existing = dailyData.get(date) ?? { totalSets: 0, totalVolume: 0, sessionCount: 0 }
    dailyData.set(date, {
      totalSets: existing.totalSets + daySets,
      totalVolume: existing.totalVolume + dayVolume,
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
  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)
  const todayEpochDay = Math.floor(nowSec / 86400)

  // Find Monday of current week
  const today = new Date()
  const dayOfWeek = today.getDay()
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const mondayEpochDay = todayEpochDay + mondayOffset
  const sundayEpochDay = mondayEpochDay + 7

  const weekSessions = await db.select().from(sessions)
  const thisWeek = weekSessions.filter(s =>
    s.scheduledDate != null && s.scheduledDate >= mondayEpochDay && s.scheduledDate < sundayEpochDay
  )

  const categories: Record<string, { types: string[]; target: number }> = {
    strength: { types: ['strength'], target: 2 },
    conditioning: { types: ['foundation_run', 'running', 'mt_class', 'bag_work', 'skip_rope'], target: 8 },
    recovery: { types: ['active_recovery', 'posture_corrective'], target: 2 },
  }

  const result: Record<string, { completed: number; target: number }> = {}
  for (const [key, cat] of Object.entries(categories)) {
    const completed = thisWeek.filter(
      s => cat.types.includes(s.type) && s.status === 'completed'
    ).length
    result[key] = { completed, target: cat.target }
  }

  return c.json(result)
})

// ─── History: Personal Records ────────────────────────────────

app.get('/api/history/prs', async (c) => {
  const db = createDB(c.env)

  const allSexes = await db.select().from(strengthSessionExercises)
  const allExercises = await db.select().from(exercises)
  const exMap = new Map(allExercises.map(e => [e.id, e]))
  const allSessions = await db.select().from(sessions)
  const sessionMap = new Map(allSessions.filter(s => s.status === 'completed').map(s => [s.id, s]))

  // Group by exercise
  const exercisePRs = new Map<string, { maxWeightKg: number; date: string; allMaxes: number[] }>()

  for (const se of allSexes) {
    const session = sessionMap.get(se.sessionId)
    if (!session) continue

    const sets = await db.select().from(strengthSets).where(eq(strengthSets.sessionExerciseId, se.id))
    const weights = sets.filter(s => s.weightKg != null && s.weightKg > 0 && s.isWarmup === 0).map(s => s.weightKg!)
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
    weedGrams: number | null
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
      weedGrams: log.weedGrams,
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

  for (const run of allRuns) {
    const session = sessionMap.get(run.sessionId)
    if (!session || session.status !== 'completed' || session.createdAt < cutoff) continue
    if (run.distanceKm == null || run.paceSecKm == null) continue

    const date = new Date((session.completedAt ?? session.createdAt) * 1000).toISOString().split('T')[0]
    dataPoints.push({
      date,
      distanceKm: run.distanceKm,
      paceSecKm: run.paceSecKm,
      type: run.runType ?? session.type,
    })
  }

  dataPoints.sort((a, b) => a.date.localeCompare(b.date))

  const totalDistanceKm = Math.round(dataPoints.reduce((sum, d) => sum + d.distanceKm, 0) * 10) / 10
  const paces = dataPoints.map(d => d.paceSecKm)
  const avgPaceSecKm = paces.length > 0 ? Math.round(paces.reduce((a, b) => a + b, 0) / paces.length) : null
  const bestPaceSecKm = paces.length > 0 ? Math.min(...paces) : null

  return c.json({
    dataPoints,
    summary: { totalRuns: dataPoints.length, totalDistanceKm, avgPaceSecKm, bestPaceSecKm },
  })
})

// ─── History: Dashboard Summary ──────────────────────────────

app.get('/api/history/dashboard', async (c) => {
  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)
  const todayEpochDay = Math.floor(nowSec / 86400)

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
  const recent30 = allSessions.filter(s => s.createdAt >= cutoff30)
  const completed30 = recent30.filter(s => s.status === 'completed').length
  const total30 = recent30.filter(s => s.status !== 'planned').length // completed + skipped
  const completionRate = total30 > 0 ? Math.round(completed30 / total30 * 100) : 0

  // PRs this month
  const allSexes = await db.select().from(strengthSessionExercises)
  const allExercises = await db.select().from(exercises)
  const exMap = new Map(allExercises.map(e => [e.id, e]))
  const completedSessionMap = new Map(
    allSessions.filter(s => s.status === 'completed').map(s => [s.id, s])
  )

  // Track max weight per exercise with date
  const exerciseMaxes = new Map<string, { maxKg: number; date: number }[]>()
  for (const se of allSexes) {
    const session = completedSessionMap.get(se.sessionId)
    if (!session) continue
    const sets = await db.select().from(strengthSets).where(eq(strengthSets.sessionExerciseId, se.id))
    const weights = sets.filter(s => s.weightKg != null && s.weightKg > 0 && s.isWarmup === 0).map(s => s.weightKg!)
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
    let firstMaxDate = entries.find(e => e.maxKg === allTimeMax)?.date ?? 0
    if (firstMaxDate >= cutoff30) prsThisMonth++
  }

  if (overallMaxExId) {
    const ex = exMap.get(overallMaxExId)
    topLift = { name: ex?.name ?? '', weightLbs: Math.round(overallMaxKg * 2.20462) }
  }

  // Total runs (last 30 days)
  const runSessionIds = new Set(
    allSessions.filter(s => s.status === 'completed' && s.createdAt >= cutoff30 &&
      (s.type === 'foundation_run' || s.type === 'running')).map(s => s.id)
  )
  const totalRuns = runSessionIds.size

  // Week-over-week comparison
  const today = new Date()
  const dayOfWeek = today.getDay()
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const thisMonday = todayEpochDay + mondayOffset
  const lastMonday = thisMonday - 7

  async function getWeekStats(mondayEpochDay: number) {
    const weekSessions = allSessions.filter(s =>
      s.scheduledDate != null && s.scheduledDate >= mondayEpochDay && s.scheduledDate < mondayEpochDay + 7
    )
    const completedWeek = weekSessions.filter(s => s.status === 'completed')

    // Volume
    let volume = 0
    for (const s of completedWeek.filter(ws => ws.type === 'strength')) {
      const sexes = await db.select().from(strengthSessionExercises).where(eq(strengthSessionExercises.sessionId, s.id))
      for (const se of sexes) {
        const sets = await db.select().from(strengthSets).where(eq(strengthSets.sessionExerciseId, se.id))
        for (const st of sets) {
          if (st.weightKg != null && st.weightKg > 0) volume += st.weightKg * st.reps
        }
      }
    }

    // RPE
    const rpeValues = completedWeek.filter(s => s.rpe != null).map(s => s.rpe!)
    const avgRpe = rpeValues.length > 0 ? Math.round(rpeValues.reduce((a, b) => a + b, 0) / rpeValues.length * 10) / 10 : null

    // Sleep (from dailyLogs)
    const logs = await db.select().from(dailyLogs)
    const weekLogs = logs.filter(l => l.logDate >= mondayEpochDay && l.logDate < mondayEpochDay + 7)
    const sleepValues = weekLogs.filter(l => l.sleepHours != null).map(l => l.sleepHours!)
    const avgSleep = sleepValues.length > 0 ? Math.round(sleepValues.reduce((a, b) => a + b, 0) / sleepValues.length * 10) / 10 : null

    // Distance (from run sessions)
    const runIds = completedWeek
      .filter(s => s.type === 'foundation_run' || s.type === 'running')
      .map(s => s.id)
    let distanceKm = 0
    if (runIds.length > 0) {
      const allRuns = await db.select().from(runSessions)
      for (const r of allRuns) {
        if (runIds.includes(r.sessionId) && r.distanceKm != null) {
          distanceKm += r.distanceKm
        }
      }
    }

    return {
      volume: Math.round(volume * 2.20462), // kg to lbs
      sessions: completedWeek.length,
      avgRpe,
      avgSleep,
      distanceKm: Math.round(distanceKm * 10) / 10,
    }
  }

  const thisWeek = await getWeekStats(thisMonday)
  const lastWeek = await getWeekStats(lastMonday)

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

export default app
