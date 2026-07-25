// DB-integration smoke for the Athlete-State pass.
// Runs the REAL assembler/serializer/state-builder/persistence against a temp
// SQLite (schema pushed from src/db/schema.ts via drizzle-kit). Verifies the
// query layer + the prior-state memory round-trip. The live Opus call is stubbed
// (that path can only run against the deployed worker). See docs/ATHLETE_STATE_SPEC.md.
//
// Run: npm run smoke:athlete-state  (pushes schema -> _smoke.sqlite, then runs this)
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '../src/db/schema'
import { assembleAthleteContext } from '../src/lib/athleteState/assembleContext'
import { serializeAthleteContext } from '../src/lib/athleteState/serialize'
import { buildAthleteState } from '../src/lib/athleteState/runAthleteState'
import { loadLatestAthleteState, resolveEffectiveLift } from '../src/lib/athleteState/store'
import type { AthleteAssessmentOutput } from '../src/lib/prompts/tools'

const sqlite = new Database('_smoke.sqlite')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = drizzle(sqlite, { schema }) as any

let failures = 0
function check(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`FAIL: ${label}`) } else { console.log(`ok: ${label}`) }
}

const now = Date.now()
const todayEpochDay = Math.floor(now / 86400000)
const nowSec = Math.floor(now / 1000)
const uid = () => crypto.randomUUID()

// ── clean any prior smoke rows ──
for (const t of ['strength_sets', 'strength_session_exercises', 'sessions', 'daily_logs', 'training_maxes', 'exercises', 'user_profile', 'coaching_outputs']) {
  sqlite.prepare(`DELETE FROM ${t}`).run()
}

// ── seed ──
const exId = 'sq'
await db.insert(schema.exercises).values({ id: exId, name: 'Back Squat', category: 'lower', createdAt: nowSec })
await db.insert(schema.trainingMaxes).values({ id: uid(), exerciseId: exId, weightKg: 120, updatedAt: nowSec })
await db.insert(schema.userProfile).values({ id: 'default', createdAt: nowSec, updatedAt: nowSec })

// two completed strength sessions, both falling short on squats -> 'short','short' -> deload
for (const [i, dayAgo] of [[0, 2], [1, 5]] as const) {
  const sessionId = uid()
  const sched = todayEpochDay - dayAgo
  await db.insert(schema.sessions).values({
    id: sessionId, type: 'strength', status: 'completed',
    scheduledDate: sched, completedAt: sched * 86400, createdAt: sched * 86400,
    rpe: i === 0 ? 9 : 8, notes: i === 0 ? 'left hip tight on squats, legs cooked' : null,
  })
  const sseId = uid()
  await db.insert(schema.strengthSessionExercises).values({ id: sseId, sessionId, exerciseId: exId, orderIndex: 0 })
  for (let s = 0; s < 3; s++) {
    await db.insert(schema.strengthSets).values({
      id: uid(), sessionExerciseId: sseId, setNumber: s + 1,
      weightKg: 100, reps: 4, plannedWeightKg: 110, plannedReps: 8,
      inferredStatus: 'rep_shortfall', isWarmup: 0, createdAt: sched * 86400,
    })
  }
}

await db.insert(schema.dailyLogs).values({
  id: uid(), logDate: todayEpochDay - 1, sleepHours: 5.5, soreness: 4, notes: 'wiped out', createdAt: nowSec,
})

// ── 1. assemble ──
const ctx = await assembleAthleteContext(db, todayEpochDay)
const squat = ctx.lifts.find((l: { exerciseName: string }) => l.exerciseName === 'Back Squat')
check('assembler found Back Squat trend', !!squat)
check('squat trend is deload (two short sessions)', squat?.verdict === 'deload' && squat?.loadFactor === 0.9)
check('squat has 2 session points', squat?.sessions.length === 2)
check('wellness captured', ctx.wellness.length === 1 && ctx.wellness[0].sleepHours === 5.5)
check('notes captured (pain signal)', ctx.notes.some((n: { text: string }) => n.text.includes('left hip tight')))
check('training maxes captured', ctx.trainingMaxes.some((t: { exerciseName: string }) => t.exerciseName === 'Back Squat'))
check('prior state null on first run', ctx.priorState === null)

// ── 2. serialize ──
const prompt = serializeAthleteContext(ctx)
check('prompt mentions Back Squat + deload', prompt.includes('Back Squat') && prompt.includes('verdict=deload'))
check('prompt carries the pain note', prompt.includes('left hip tight'))

// ── 3. build state from a stubbed model output + persist ──
const stubOutput: AthleteAssessmentOutput = {
  readiness: 'taxed',
  readinessRationale: 'Effort high while sleep dipped under 6h.',
  lifts: [{ exerciseId: exId, verdict: 'deload', loadFactor: 0.9, rationale: 'Two short squat sessions running.' }],
  weekShape: 'pull_back',
  weekShapeRationale: 'Volume eases while recovery catches up.',
  flags: [{ kind: 'pain', detail: 'left hip tightness on squats' }],
  note: 'Squat backs off, week pulls back after a taxed stretch.',
}
const state = buildAthleteState(stubOutput, ctx, 'session_completed', nowSec)
check('built state has clamped squat loadFactor', state.lifts[0].loadFactor === 0.9)
check('built state joined exerciseName', state.lifts[0].exerciseName === 'Back Squat')

await db.insert(schema.coachingOutputs).values({
  id: uid(), kind: 'athlete_state', model: 'claude-opus-4-8',
  outputJson: JSON.stringify(state), createdAt: nowSec,
})

// ── 4. memory round-trip ──
const ctx2 = await assembleAthleteContext(db, todayEpochDay)
check('prior state read back (memory)', ctx2.priorState !== null)
check('prior state note round-trips', ctx2.priorState?.note === state.note)
check('prior lift verdict round-trips', ctx2.priorState?.lifts[0].verdict === 'deload')
const prompt2 = serializeAthleteContext(ctx2)
check('second prompt includes prior-read block', prompt2.includes('Your previous read'))

// ── 5. Phase 3: state overrides the deterministic trend in the prescription path ──
// Trend for squat is deload (0.9). Persist a state that says push (1.05) and confirm
// resolveEffectiveLift prefers the state verdict, sourced from the DB.
const overrideState = buildAthleteState(
  { ...stubOutput, lifts: [{ exerciseId: exId, verdict: 'push', loadFactor: 1.05, rationale: 'Bar speed is back.' }] },
  ctx, 'rollover', nowSec + 10,
)
await db.insert(schema.coachingOutputs).values({
  id: uid(), kind: 'athlete_state', model: 'claude-opus-4-8',
  outputJson: JSON.stringify(overrideState), createdAt: nowSec + 10,
})
const latest = await loadLatestAthleteState(db)
const stateLift = latest?.lifts.find((l: { exerciseId: string }) => l.exerciseId === exId)
const trendLift = ctx.lifts.find((l: { exerciseId: string }) => l.exerciseId === exId)
const eff = resolveEffectiveLift(trendLift, stateLift)
check('latest state is the newer push override', stateLift?.verdict === 'push')
check('prescription resolver prefers state over trend', eff.source === 'state' && eff.verdict === 'push' && eff.loadFactor === 1.05)
check('trend would have said deload', trendLift?.verdict === 'deload')

sqlite.close()
if (failures > 0) { console.error(`\n${failures} smoke check(s) failed`); process.exit(1) }
console.log('\nAll athlete-state integration smoke checks passed')
