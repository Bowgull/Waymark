import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

import { createDB } from '../db/client'
import { activeRecoverySessions, bagWorkRoundCombos, bagWorkRounds, combos, dailyLogs, exercises, mtClassLogs, postureSessionExercises, runSessions, sessions, settings, skipRopeSessions, strengthSessionExercises, strengthSets, trainingBlocks, trainingMaxes, weekPlans, weeklyJournals } from '../db/schema'
import { isoToEpochDay } from '../lib/dates'
import { POSTURE_TEMPLATE } from '../lib/postureTemplate'
import { getStrengthTemplate } from '../lib/strengthTemplates'
import { WEEKLY_TEMPLATE } from '../lib/weeklyTemplate'

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

  const result = []
  for (const se of sexes.sort((a, b) => a.orderIndex - b.orderIndex)) {
    const sets = await db.select().from(strengthSets)
      .where(eq(strengthSets.sessionExerciseId, se.id))
    sets.sort((a, b) => a.setNumber - b.setNumber)

    const exercise = exMap.get(se.exerciseId)
    result.push({
      id: se.id,
      exerciseId: se.exerciseId,
      orderIndex: se.orderIndex,
      notes: se.notes,
      exercise: exercise ? { name: exercise.name, formCues: exercise.formCues, equipment: exercise.equipment } : null,
      sets,
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

  // Also get template notes
  const templateNotes = new Map(POSTURE_TEMPLATE.map(t => [t.exerciseId, t.notes ?? null]))

  const result = pExercises
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map(pe => {
      const exercise = exMap.get(pe.exerciseId)
      return {
        ...pe,
        exercise: exercise ? { name: exercise.name, formCues: exercise.formCues, equipment: exercise.equipment } : null,
        notes: templateNotes.get(pe.exerciseId) ?? null,
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

  const template = WEEKLY_TEMPLATE[dayOfWeek] ?? []
  const created = []

  for (const entry of template) {
    const id = crypto.randomUUID()
    await db.insert(sessions).values({
      id,
      type: entry.type,
      scheduledDate: epochDay,
      timeSlot: entry.timeSlot,
      status: 'planned',
      createdAt: nowSec,
    })
    created.push({
      id,
      type: entry.type,
      weekPlanId: null,
      scheduledDate: epochDay,
      timeSlot: entry.timeSlot,
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

  return c.json(created)
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
  return c.json(row)
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

  // Determine template from scheduled date
  const epochDay = session.scheduledDate ?? 0
  const dateMs = epochDay * 86400 * 1000
  const dayOfWeek = new Date(dateMs).getUTCDay()
  const template = getStrengthTemplate(dayOfWeek)

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
      notes: tex.notes ?? null,
    })

    const trainingMax = maxMap.get(tex.exerciseId) ?? null

    for (let setIdx = 0; setIdx < tex.sets.length; setIdx++) {
      const ts = tex.sets[setIdx]
      let suggestedWeight: number | null = null
      if (trainingMax != null) {
        suggestedWeight = ts.isWarmup ? Math.round(trainingMax * 0.5 * 100) / 100 : trainingMax
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

  // Update training maxes from this session's sets
  if (session.type === 'strength') {
    const sexes = await db.select().from(strengthSessionExercises)
      .where(eq(strengthSessionExercises.sessionId, sessionId))

    for (const se of sexes) {
      const sets = await db.select().from(strengthSets)
        .where(eq(strengthSets.sessionExerciseId, se.id))
      const workingSets = sets.filter(s => s.isWarmup === 0 && s.weightKg != null)
      if (workingSets.length === 0) continue

      const maxWeight = Math.max(...workingSets.map(s => s.weightKg!))
      const [existing] = await db.select().from(trainingMaxes)
        .where(eq(trainingMaxes.exerciseId, se.exerciseId))

      if (!existing) {
        await db.insert(trainingMaxes).values({
          id: crypto.randomUUID(),
          exerciseId: se.exerciseId,
          weightKg: maxWeight,
          updatedAt: nowSec,
        })
      } else if (maxWeight > existing.weightKg) {
        await db.update(trainingMaxes).set({ weightKg: maxWeight, updatedAt: nowSec })
          .where(eq(trainingMaxes.exerciseId, se.exerciseId))
      }
    }
  }

  const [updated] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  return c.json(updated)
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

  // Get unlocked combos
  const unlockedCombos = await db.select().from(combos).where(eq(combos.unlocked, 1))
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

    // Pick 3 random combos (no repeats within a round)
    const shuffled = [...unlockedCombos].sort(() => Math.random() - 0.5)
    const picked = shuffled.slice(0, Math.min(COMBOS_PER_ROUND, shuffled.length))

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
    return c.json({ session, runSession: existing[0] })
  }

  const runId = crypto.randomUUID()
  await db.insert(runSessions).values({
    id: runId,
    sessionId,
    runType: 'easy',
    isIndoor: 0,
  })

  await db.update(sessions).set({ status: 'in_progress', startedAt: nowSec }).where(eq(sessions.id, sessionId))

  const [updated] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  const [run] = await db.select().from(runSessions).where(eq(runSessions.id, runId))
  return c.json({ session: updated, runSession: run })
})

app.get('/api/sessions/:id/run-workout', async (c) => {
  const sessionId = c.req.param('id')
  const db = createDB(c.env)

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!session) return c.json({ error: 'session not found' }, 404)

  const [run] = await db.select().from(runSessions).where(eq(runSessions.sessionId, sessionId))
  return c.json({ session, runSession: run ?? null })
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

  // Generate sessions for 7 days (Mon=0 through Sun=6)
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const date = new Date(startDate)
    date.setUTCDate(date.getUTCDate() + dayOffset)
    const dayOfWeek = date.getUTCDay()
    const epochDay = Math.floor(date.getTime() / 1000 / 86400)

    const template = WEEKLY_TEMPLATE[dayOfWeek] ?? []
    for (const entry of template) {
      const sessionId = crypto.randomUUID()
      await db.insert(sessions).values({
        id: sessionId,
        type: entry.type,
        weekPlanId: weekId,
        scheduledDate: epochDay,
        timeSlot: entry.timeSlot,
        status: 'planned',
        createdAt: nowSec,
      })
      createdSessions.push({
        id: sessionId,
        type: entry.type,
        weekPlanId: weekId,
        scheduledDate: epochDay,
        timeSlot: entry.timeSlot,
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

// ─── Settings (update) ─────────────────────────────────────────

app.patch('/api/settings', async (c) => {
  const body = await c.req.json<{
    mtClassDays?: string
    amReminder?: string
    pmLeadMin?: number
    onePaceArc?: string
    onePaceEp?: string
    lastDeploy?: number
  }>()

  const db = createDB(c.env)
  const nowSec = Math.floor(Date.now() / 1000)
  const updates: Record<string, unknown> = { updatedAt: nowSec }

  if (body.mtClassDays !== undefined) updates.mtClassDays = body.mtClassDays
  if (body.amReminder !== undefined) updates.amReminder = body.amReminder
  if (body.pmLeadMin !== undefined) updates.pmLeadMin = body.pmLeadMin
  if (body.onePaceArc !== undefined) updates.onePaceArc = body.onePaceArc
  if (body.onePaceEp !== undefined) updates.onePaceEp = body.onePaceEp
  if (body.lastDeploy !== undefined) updates.lastDeploy = body.lastDeploy

  await db.update(settings).set(updates).where(eq(settings.id, 'default'))
  const [row] = await db.select().from(settings).where(eq(settings.id, 'default'))
  return c.json(row)
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
  return c.json(rows)
})

app.get('/api/settings', async (c) => {
  const db = createDB(c.env)
  const rows = await db.select().from(settings)
  return c.json(rows[0] ?? null)
})

export default app
