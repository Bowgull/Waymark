// Run: tsx src/lib/brain/readinessParts.test.ts
// Coach brain P4: the four readiness parts (coach-brain.md §8) and the meter's
// words (page 69 §5 A), on made-up athletes.
import assert from 'node:assert/strict'
import { buildAthleteModel } from './athleteModel'
import { listWords, longestBreak, readinessParts, type ReadinessIn } from './readinessParts'
import type { ModelCheckIn, ModelEvents, ModelRun, ModelSession, ModelSet } from './types'

const LB = 0.45359237
const MON = 20822 // Monday 2027-01-04
let sid = 0

interface Athlete { weeks: number; skip?: (day: number, i: number) => boolean; runFrom?: number; runPiece?: number; runSec?: number; rir?: number | null; back?: (day: number) => number; talk?: number[]; noRunsAfter?: number }

/** A Block Zero athlete from MON: strength Mon/Wed/Fri, run-walks Tue/Thu/Sat, a check-in every morning. */
function athlete(a: Athlete, today: number): ReadinessIn {
  const sessions: ModelSession[] = []
  const sets: ModelSet[] = []
  const runs: ModelRun[] = []
  const checkIns: ModelCheckIn[] = []
  let i = 0
  for (let d = MON; d <= today && d < MON + a.weeks * 7; d++, i++) {
    const dow = (d - MON) % 7
    checkIns.push({ day: d, sleepHours: 7.5, sleepQuality: 3, energy: 3, soreness: 2, stress: 2, mood: 3, backToday: a.back ? a.back(d) : 3 })
    if (dow === 6) continue
    const type = dow % 2 === 0 ? 'strength' : 'foundation_run'
    const skipped = a.skip?.(d, i) ?? false
    const done = d < today || false
    const s: ModelSession = { id: `s${++sid}`, type, status: skipped ? 'skipped' : done ? 'completed' : 'planned', day: d, slot: 'am', startMin: 400, durationSec: 1800, rpe: 5, skipReason: null, source: 'template', blockType: 'block_zero', notes: null }
    sessions.push(s)
    if (s.status !== 'completed') continue
    if (type === 'strength') {
      for (const [ex, w] of [['ex-goblet-squat', 45], ['ex-db-rdl', 40], ['ex-db-bench-press', 35], ['ex-db-row', 35]] as const) {
        for (let k = 1; k <= 3; k++) sets.push({ sessionId: s.id, day: d, exerciseId: ex, section: 'main', setNumber: k, weightKg: w * LB, reps: 8, plannedWeightKg: w * LB, plannedReps: 8, rir: a.rir === undefined ? 2 : a.rir, isWarmup: false, logged: true, equipment: 'dumbbell' })
      }
    } else if (a.noRunsAfter == null || d < a.noRunsAfter) {
      const big = d >= MON + (a.runFrom ?? 21)
      runs.push({ sessionId: s.id, day: d, type, durationSec: big ? (a.runSec ?? 1700) : 1500, plannedDurationSec: 1500, distanceKm: 3, avgHr: 138, maxHr: 146, splits: [], isIndoor: false, completionStatus: null, shortReason: null, rpe: 4, pieceSec: big ? (a.runPiece ?? 240) : 90 })
    }
  }
  const talkTests = (a.talk ?? [1, 29]).filter(o => MON + o <= today).map(o => ({ day: MON + o, bpm: 150 }))
  const events: ModelEvents = { profile: { dob: '1990-06-01', maxHr: null, backSensitive: true }, sessions, sets, runs, talkTests, bag: [], checkIns, notes: [], moves: [], classLogs: [], trainingMaxes: [], openBodyAlerts: [] }
  const model = buildAthleteModel(events, today, { fromDay: MON })
  return { today, blockStart: MON, model, sessions, sets, checkIns, talkTests, backEaseDays: [] }
}

const noPercent = (s: string) => !/%|gate|pass line/i.test(s)

// ─── A steady athlete: ready in week 5 ───────────────────────
{
  const early = readinessParts(athlete({ weeks: 12 }, MON + 10))
  assert.equal(early.week, 2)
  assert.equal(early.minMet, false, 'under 4 weeks')
  assert.equal(early.ready, false)
  assert.ok(!early.parts.find(p => p.key === 'habit')!.in, 'habit needs 3 weeks of 4+ days')
  assert.ok(early.parts.every(p => p.tiles >= 0 && p.tiles <= (p.in ? 6 : 5)), 'tiles 0-5 while building, 6 when in')
  assert.ok(noPercent(early.line), `closed line: no percentages or "gate" (${early.line})`)

  const ready = readinessParts(athlete({ weeks: 12 }, MON + 32))
  for (const p of ready.parts) assert.ok(p.in, `${p.key} in by week 5: ${p.line}`)
  assert.equal(ready.ready, true, 'all four in, 4 weeks done')
  assert.equal(ready.flap, 'READY')
  assert.equal(ready.tone, 'teal')
  assert.ok(ready.parts.every(p => p.tiles === 6))
  const strength = ready.parts.find(p => p.key === 'strength')!
  assert.ok(/Goblet squat 45 lb/.test(strength.small ?? ''), `real numbers in lb: ${strength.small}`)
  const habit = ready.parts.find(p => p.key === 'habit')!
  assert.ok(/Longest break/.test(habit.small ?? '') && /Mornings \d+ of \d+, evenings \d+ of \d+/.test(habit.small ?? ''), `page 63's details inside Habit: ${habit.small}`)
  const engine = ready.parts.find(p => p.key === 'engine')!
  assert.ok(/150/.test(engine.line) && !/mile/.test(engine.small ?? ''), engine.line)
}

// ─── Minimum 4 weeks even when everything is in ──────────────
{
  const r = readinessParts(athlete({ weeks: 12, runFrom: 7, talk: [1, 15] }, MON + 24))
  assert.ok(r.allIn, `all four in at week 4: ${r.parts.map(p => `${p.key} ${p.in}`).join(', ')}`)
  assert.equal(r.ready, false, 'not before 4 weeks are done')
  assert.equal(r.flap, '4 OF 4 IN')
  assert.equal(r.line, 'All four in. The move comes after week 4')
}

// ─── Each part on its own ────────────────────────────────────
{
  // Reps left not logged: strength never comes in (RIR missing on every set).
  const noRir = readinessParts(athlete({ weeks: 12, rir: null }, MON + 32))
  assert.ok(!noRir.parts.find(p => p.key === 'strength')!.in, 'no reps left logged: strength stays out')
  // Short runs: engine stays out, and its line says what is left.
  const short = readinessParts(athlete({ weeks: 12, runPiece: 120 }, MON + 32))
  const e = short.parts.find(p => p.key === 'engine')!
  assert.ok(!e.in && /Two run-walks of 27 min or longer/.test(e.line), e.line)
  assert.equal(short.line, 'Engine to go')
  // No recheck of the talk test: engine stays out.
  const once = readinessParts(athlete({ weeks: 12, talk: [1] }, MON + 32))
  assert.ok(!once.parts.find(p => p.key === 'engine')!.in, 'one talk test: not rechecked')
  // A back ease 6 days ago: four more days.
  const inp = athlete({ weeks: 12 }, MON + 32)
  const eased = readinessParts({ ...inp, backEaseDays: [MON + 26] })
  const b = eased.parts.find(p => p.key === 'back')!
  assert.ok(!b.in && b.line === 'Four more days without a back ease.', b.line)
  // Back worse than week 1 by more than half a point.
  const worse = readinessParts(athlete({ weeks: 12, back: d => (d < MON + 7 ? 4 : 3) }, MON + 32))
  assert.ok(!worse.parts.find(p => p.key === 'back')!.in, 'back 3 against 4 in week 1: out')
  // Habit: skipping every other session keeps habit out.
  const flaky = readinessParts(athlete({ weeks: 12, skip: (_d, i) => i % 2 === 0 }, MON + 32))
  assert.ok(!flaky.parts.find(p => p.key === 'habit')!.in, 'half the sessions: habit out')
}

// ─── No maximum: after week 10 the lagging part is named ─────
{
  const r = readinessParts(athlete({ weeks: 13, runPiece: 120 }, MON + 75))
  assert.equal(r.week, 11)
  assert.equal(r.lagging, 'engine')
  assert.equal(r.line, 'Engine is the one left')
  assert.ok(!/fail/i.test([r.line, r.foot, ...r.parts.map(p => p.line)].join(' ')), 'nothing "fails"')
}

// ─── The break flap wins while it is open (page 63) ──────────
{
  const r = readinessParts(athlete({ weeks: 12, skip: d => d >= MON + 27 }, MON + 32))
  assert.ok(/^\d DAY BREAK$/.test(r.flap), r.flap)
  assert.ok(/^One session by \w{3} keeps this break under a week$/.test(r.line), r.line)
}

// ─── The move set: READY with the Monday ─────────────────────
{
  const inp = athlete({ weeks: 12 }, MON + 32)
  const r = readinessParts({ ...inp, move: { lighterFrom: MON + 32, monday: MON + 35 } })
  assert.equal(r.flap, 'READY')
  assert.equal(r.line, 'The Campaign starts Mon 8 Feb')
  assert.ok(/UNDO on that Monday keeps you in Block Zero/.test(r.foot))
}

// ─── Helpers ─────────────────────────────────────────────────
assert.equal(listWords(['Engine', 'Back']), 'Engine and back')
assert.equal(listWords(['Habit', 'Engine', 'Back']), 'Habit, engine and back')
assert.equal(longestBreak([0, 1, 2, 10, 11], 11, 0, 21), 7, '7 days between')
assert.equal(longestBreak([3, 4, 5], 5, 0, 21), 0, 'a slow start is not a break')
assert.equal(longestBreak([0, 1, 2], 6, 0, 21), 3, 'an open break counts to yesterday')

console.log('readiness parts tests passed')
