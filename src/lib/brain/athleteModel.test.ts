// Run: tsx src/lib/brain/athleteModel.test.ts
// Coach brain P1: the athlete model (coach-brain.md §4, §6.2) on made-up data.
import assert from 'node:assert/strict'
import { biasStep, buildAthleteModel, cellOf, isLive, linePrior, modelRows, noteFlags, runDrift, runUnderLine, setE1rm, usualStartOf, workingWeight } from './athleteModel'
import { athleteSignals } from './signals'
import { agedU, bagRoundsFromU, liftDoseFromU, runPieceFromU, rungDecay, stateFromU, strengthDecay } from './uncertainty'
import type { ModelBag, ModelCheckIn, ModelEvents, ModelRun, ModelSession, ModelSet } from './types'

const LB = 0.45359237
const MON = 20822 // Monday 2027-01-04

function events(over: Partial<ModelEvents> = {}): ModelEvents {
  return {
    profile: { dob: '1990-06-01', maxHr: null, backSensitive: true },
    sessions: [], sets: [], runs: [], talkTests: [], bag: [], checkIns: [], notes: [], moves: [], classLogs: [], trainingMaxes: [], openBodyAlerts: [],
    ...over,
  }
}
let sid = 0
function session(day: number, type: string, over: Partial<ModelSession> = {}): ModelSession {
  return { id: `s${++sid}`, type, status: 'completed', day, slot: 'am', startMin: 6 * 60 + 40, durationSec: 1800, rpe: 5, skipReason: null, source: 'template', blockType: 'block_zero', notes: null, ...over }
}
function lift(s: ModelSession, exerciseId: string, sets: Array<{ w: number; reps: number; rir: number | null; planW?: number; planReps?: number; logged?: boolean }>, equipment: ModelSet['equipment'] = 'dumbbell'): ModelSet[] {
  return sets.map((x, i) => ({
    sessionId: s.id, day: s.day, exerciseId, section: 'main', setNumber: i + 1, weightKg: x.w * LB, reps: x.reps,
    plannedWeightKg: x.planW == null ? null : x.planW * LB, plannedReps: x.planReps ?? 8, rir: x.rir, isWarmup: false, logged: x.logged ?? true, equipment,
  }))
}
function run(s: ModelSession, over: Partial<ModelRun> = {}): ModelRun {
  return { sessionId: s.id, day: s.day, type: s.type, durationSec: 1500, plannedDurationSec: 1500, distanceKm: 3, avgHr: null, maxHr: null, splits: [], isIndoor: false, completionStatus: null, shortReason: null, rpe: s.rpe, pieceSec: 90, ...over }
}
const ci = (day: number, v: Partial<ModelCheckIn> = {}): ModelCheckIn => ({ day, sleepHours: 7.5, sleepQuality: 3, energy: 3, soreness: 2, stress: 2, mood: 3, backToday: 3, ...v })

// ─── Uncertainty (§4) ────────────────────────────────────────
assert.equal(agedU('KNOWN', MON, MON), 0.15)
assert.equal(agedU('KNOWN', MON, MON + 13), 0.25, '+0.1 per full 7 days')
assert.equal(agedU('KNOWN', MON, MON + 14), 0.35)
assert.equal(agedU('LEARNING', MON, MON + 200), 1, 'capped at 1')
assert.equal(stateFromU(0.35), 'LEARNING')
assert.equal(stateFromU(1), 'GUESS')
assert.equal(strengthDecay(14), 1)
assert.equal(strengthDecay(24), 0.95, '−0.5% a day after 14 days')
assert.equal(rungDecay(240, 17, 60), 216, '−1% a day after 7 days')
assert.equal(rungDecay(90, 200, 60), 60, 'down to the floor')
assert.deepEqual(liftDoseFromU(1, { rir: 2, sets: 3 }), { rir: 4, sets: 2 }, 'GUESS: ~3+ left, a set fewer')
assert.deepEqual(liftDoseFromU(0.15, { rir: 2, sets: 3 }), { rir: 2, sets: 3 }, 'KNOWN: the real target')
assert.equal(runPieceFromU(120, 1), 84)
assert.equal(bagRoundsFromU(6, 0.5, 5), 5, 'never above the cap')

// ─── Nothing logged: priors ──────────────────────────────────
{
  const m = buildAthleteModel(events(), MON)
  assert.equal(m.run.state, 'GUESS')
  assert.equal(m.run.lineSource, 'prior')
  assert.equal(m.run.lineBpm, linePrior('1990-06-01', MON))
  assert.equal(linePrior('1990-06-01', MON), Math.round(0.78 * (208 - 0.7 * 36)), '0.78 × Tanaka at 36 = 143')
  assert.equal(m.run.rungSec, 60, 'rung prior: 1:00 pieces')
  assert.equal(m.back.u, 1, 'every area starts at u = 1, the sensitive back included')
  assert.equal(m.back.profileSensitive, true)
  for (const c of [m.run, m.bag, m.klass, m.recovery, m.back, m.adherence]) assert.equal(c.state, 'GUESS')
  assert.equal(m.recovery.state, 'GUESS')
  assert.equal(m.adherence.cells['am-weekday'].p, 0.5)
  assert.deepEqual(Object.keys(m.lifts), [])
}

// ─── From scratch at the block start (Josh, 2026-10-20) ──────
{
  const june = session(MON - 120, 'strength')
  const old = [session(MON - 121, 'foundation_run', { rpe: 4 })]
  const block = session(MON + 1, 'strength')
  const e = events({
    sessions: [june, ...old, block],
    sets: [...lift(june, 'ex-db-rdl', [{ w: 35, reps: 8, rir: 2 }]), ...lift(block, 'ex-goblet-squat', [{ w: 40, reps: 8, rir: 2 }])],
    runs: [run(old[0], { avgHr: 145 })],
    talkTests: [{ day: MON - 121, bpm: 150 }],
    checkIns: [0, 1, 2, 3].map(i => ci(MON - 125 + i)),
    notes: [{ day: MON - 120, text: 'lower back sore', source: 'check_in' }],
    moves: [{ fromDay: MON - 119, toDay: MON - 118, type: 'strength' }],
    trainingMaxes: [{ exerciseId: 'ex-bench-press', weightKg: 40, day: MON - 1 }],
  })
  const fresh = buildAthleteModel(e, MON, { fromDay: MON })
  assert.deepEqual(Object.keys(fresh.lifts), [], 'nothing before the block start: no lifts, no training-max prior from before it')
  for (const c of [fresh.run, fresh.bag, fresh.klass, fresh.recovery, fresh.back, fresh.adherence]) assert.deepEqual([c.state, c.u], ['GUESS', 1])
  assert.equal(fresh.run.lineSource, 'prior', 'the old talk test is ignored')
  assert.equal(fresh.back.backNotes, 0)
  assert.equal(fresh.adherence.cells['am-weekday'].n, 0)
  const day2 = buildAthleteModel(e, MON + 1, { fromDay: MON })
  assert.deepEqual(Object.keys(day2.lifts), ['ex-goblet-squat'], 'learns from the first block session')
  assert.equal(day2.lifts['ex-goblet-squat'].state, 'LEARNING')
}

// ─── Lifts without RIR (June 2026's shape): GUESS, start from what he used ─
{
  const a = session(MON, 'strength')
  const b = session(MON + 2, 'strength')
  const sets = [
    ...lift(a, 'ex-db-rdl', [{ w: 35, reps: 8, rir: null, planW: 35 }, { w: 30, reps: 8, rir: null, planW: 35 }, { w: 30, reps: 8, rir: null, planW: 35 }]),
    ...lift(b, 'ex-db-ohp', [{ w: 20, reps: 6, rir: null, planW: 20 }, { w: 20, reps: 8, rir: null, planW: 20 }, { w: 20, reps: 8, rir: null, planW: 20, logged: false }]),
  ]
  const m = buildAthleteModel(events({ sessions: [a, b], sets }), MON + 3)
  const rdl = m.lifts['ex-db-rdl']
  assert.equal(rdl.state, 'GUESS', 'no RIR: GUESS, not KNOWN')
  assert.equal(rdl.e1rmKg, null)
  assert.equal(rdl.workingSource, 'used')
  assert.equal(Math.round(rdl.workingKg! / LB), 35, 'the heaviest weight he used')
  assert.equal(rdl.last?.lowered, true, 'he lowered the weight mid-session')
  assert.equal(rdl.last?.incomplete, false)
  const ohp = m.lifts['ex-db-ohp']
  assert.equal(ohp.last?.incomplete, true, '6 of 8 reps, and a set never logged')
  assert.equal(ohp.easeStreak, 1)
  // Sets he never logged (pre-filled) are not an exposure at all.
  const none = buildAthleteModel(events({ sessions: [a], sets: lift(a, 'ex-db-row', [{ w: 30, reps: 10, rir: null, logged: false }]) }), MON + 1)
  assert.equal(none.lifts['ex-db-row'], undefined)
}

// ─── Lifts with RIR: e1RM, ≤3% a session, KNOWN, working weight ─
{
  assert.equal(setE1rm(100, 8, 2, 0), 100 * (1 + 10 / 30))
  assert.equal(setE1rm(100, 11, 1, 0), null, 'over 10 reps: no e1RM')
  assert.equal(setE1rm(100, 5, null, 0), null)
  assert.equal(setE1rm(100, 5, 3, 0), 100 * (1 + 8.5 / 30), '3 = "3+" counts as 3.5')
  const days = [MON, MON + 2, MON + 4, MON + 7]
  const ss = days.map(d => session(d, 'strength'))
  const sets = ss.flatMap((s, i) => lift(s, 'ex-goblet-squat', [{ w: 50, reps: 8, rir: 3, planW: 50 }, { w: 50, reps: 8, rir: 2, planW: 50 }, { w: i === 3 ? 60 : 50, reps: 8, rir: 2, planW: 50 }]))
  const m = buildAthleteModel(events({ sessions: ss, sets }), MON + 7)
  const sq = m.lifts['ex-goblet-squat']
  const first = 50 * LB * (1 + 10 / 30)
  assert.ok(sq.e1rmKg! <= Math.round(first * 1.03 * 10) / 10 + 0.1, 'a 60 lb set moves e1RM at most 3%')
  assert.equal(sq.last?.raised, true, 'raised the weight and hit the reps')
  assert.equal(sq.state, 'LEARNING', 'the 60 lb last set sits 20% off the others: not KNOWN yet')
  const m3 = buildAthleteModel(events({ sessions: ss.slice(0, 3), sets: sets.slice(0, 9) }), MON + 4)
  assert.equal(m3.lifts['ex-goblet-squat'].state, 'KNOWN', '3 RIR sessions in 21 days within ±5%')
  assert.equal(m3.lifts['ex-goblet-squat'].u, 0.15)
  assert.equal(Math.round(sq.workingKg! / LB) % 5, 0, 'snapped to 5 lb dumbbells')
  assert.equal(workingWeight(first, 8, 2, 0, 'dumbbell'), Math.round(50 * LB * 100) / 100, '8 @ RIR 2 from its own e1RM is the same weight')
  // A layoff: KNOWN fades and the estimate decays (no separate ramp).
  const later = buildAthleteModel(events({ sessions: ss, sets }), MON + 7 + 60)
  assert.equal(later.lifts['ex-goblet-squat'].u, 1, '8 weeks off: 0.5 + 0.8, capped at 1')
  assert.equal(later.lifts['ex-goblet-squat'].state, 'GUESS')
  assert.ok(later.lifts['ex-goblet-squat'].e1rmKg! < sq.e1rmKg! * 0.8, '−0.5%/day after 14 days')
}

// ─── RIR bias (the sandbagger): reported 3+, reps drop ───────
{
  assert.equal(biasStep([{ weightKg: 20, reps: 7, plannedReps: 8, rir: 3 }, { weightKg: 20, reps: 7, plannedReps: 8, rir: 3 }]), -0.25)
  assert.equal(biasStep([{ weightKg: 20, reps: 8, plannedReps: 8, rir: 0 }, { weightKg: 20, reps: 8, plannedReps: 8, rir: 0 }]), 0.25, 'said 0 left, did it again')
  assert.equal(biasStep([{ weightKg: 20, reps: 8, plannedReps: 8, rir: 2 }, { weightKg: 20, reps: 8, plannedReps: 8, rir: 2 }]), 0)
  const ss = Array.from({ length: 10 }, (_, i) => session(MON + i * 2, 'strength'))
  const sets = ss.flatMap(s => lift(s, 'ex-db-row', [{ w: 40, reps: 7, rir: 3, planW: 40 }, { w: 40, reps: 7, rir: 3, planW: 40 }, { w: 40, reps: 7, rir: 3, planW: 40 }]))
  const three = buildAthleteModel(events({ sessions: ss.slice(0, 3), sets: sets.slice(0, 9) }), MON + 5)
  assert.equal(three.lifts['ex-db-row'].rirBias, -0.75, '−0.25 a session')
  const ten = buildAthleteModel(events({ sessions: ss, sets }), MON + 19)
  assert.equal(ten.lifts['ex-db-row'].rirBias, -1.5, 'clamped at ±1.5')
  assert.ok(ten.lifts['ex-db-row'].e1rmKg! < 40 * LB * (1 + 10.5 / 30), 'the bias pulls the e1RM below the face value')
}

// ─── Run: line, U, drift, rung, too fast / too slow, no HR, cut short ─
{
  assert.deepEqual(runUnderLine({ splits: [{ durationSec: 300, avgHr: 140 }, { durationSec: 300, avgHr: 150 }], avgHr: 145 }, 145), { u: 0.5, source: 'splits' })
  assert.equal(runUnderLine({ splits: [], avgHr: 145 }, 145).u, 0.5)
  assert.ok(runUnderLine({ splits: [], avgHr: 149 }, 143).u! < 0.2, 'avg 6 over the line: U under 20%')
  assert.deepEqual(runUnderLine({ splits: [], avgHr: null }, 145), { u: null, source: 'none' })
  assert.equal(runDrift([{ durationSec: 300, avgHr: 120 }, { durationSec: 300, avgHr: 140 }, { durationSec: 300, avgHr: 142 }, { durationSec: 300, avgHr: 152 }]), 12, 'first split dropped as warm-up: 152 − 140')

  const s1 = session(MON + 1, 'foundation_run', { rpe: 4 })
  const s2 = session(MON + 3, 'foundation_run', { rpe: 4 })
  const s3 = session(MON + 5, 'foundation_run', { rpe: 5 })
  const tests = [{ day: MON + 1, bpm: 151 }, { day: MON + 3, bpm: 153 }]
  const easy = (s: ModelSession, piece: number) => run(s, { avgHr: 140, pieceSec: piece, splits: [{ durationSec: 400, avgHr: 138 }, { durationSec: 400, avgHr: 140 }, { durationSec: 400, avgHr: 141 }] })
  const m = buildAthleteModel(events({ sessions: [s1, s2, s3], talkTests: tests, runs: [easy(s1, 60), easy(s2, 90), easy(s3, 120)] }), MON + 5)
  assert.equal(m.run.lineBpm, 152, 'two talk tests within 4 bpm: their mean')
  assert.ok(m.run.lineBpm > m.run.linePriorBpm, 'his line sits above the age guess')
  assert.equal(m.run.state, 'KNOWN', '2 talk tests within ±4 and 3 runs with HR')
  assert.equal(m.run.uShare, 1)
  assert.equal(m.run.rungSec, 120, 'the longest piece handled at U ≥85% and effort ≤5')
  assert.equal(m.run.recheckDue, false)

  // Too fast: HR over the line → rung one step back.
  const s4 = session(MON + 7, 'foundation_run', { rpe: 6 })
  const fast = run(s4, { avgHr: 160, pieceSec: 120, splits: [{ durationSec: 400, avgHr: 155 }, { durationSec: 400, avgHr: 160 }, { durationSec: 400, avgHr: 165 }] })
  const m2 = buildAthleteModel(events({ sessions: [s1, s2, s3, s4], talkTests: tests, runs: [easy(s1, 60), easy(s2, 90), easy(s3, 120), fast] }), MON + 7)
  const last = m2.run.recent[m2.run.recent.length - 1]
  assert.equal(last.tooFast, true)
  assert.equal(last.struggled, true)
  assert.equal(m2.run.rungSec, 90, 'one rung back')

  // Too slow: U ~100%, HR 10+ under the line, effort ≤4: counts toward going up.
  const s5 = session(MON + 7, 'foundation_run', { rpe: 3 })
  const slow = run(s5, { avgHr: 135, pieceSec: 210, splits: [{ durationSec: 400, avgHr: 133 }, { durationSec: 400, avgHr: 135 }, { durationSec: 400, avgHr: 136 }] })
  const m3 = buildAthleteModel(events({ sessions: [s1, s2, s3, s5], talkTests: tests, runs: [easy(s1, 60), easy(s2, 90), easy(s3, 120), slow] }), MON + 7)
  assert.equal(m3.run.recent[m3.run.recent.length - 1].tooSlow, true)
  assert.equal(m3.run.rungSec, 210)

  // Cut short for time: HOLD (no rung change), kept as a schedule fact.
  const s6 = session(MON + 7, 'foundation_run', { rpe: 4 })
  const timeCut = run(s6, { avgHr: 140, durationSec: 700, plannedDurationSec: 1500, completionStatus: 'shortened', shortReason: 'schedule', pieceSec: 210 })
  const m4 = buildAthleteModel(events({ sessions: [s1, s2, s3, s6], talkTests: tests, runs: [easy(s1, 60), easy(s2, 90), easy(s3, 120), timeCut] }), MON + 7)
  const lc = m4.run.recent[m4.run.recent.length - 1]
  assert.equal(lc.cutShort, true)
  assert.equal(lc.scheduleCut, true)
  assert.equal(lc.struggled, false, 'time is never "too hard"')
  assert.equal(m4.run.rungSec, 120)
  assert.equal(m4.adherence.scheduleSkips.total, 1)
  // Cut short with no reason given (the tap is optional): neutral, never a step back (Josh, 2026-10-21).
  const m5 = buildAthleteModel(events({ sessions: [s1, s2, s3, s6], talkTests: tests, runs: [easy(s1, 60), easy(s2, 90), easy(s3, 120), { ...timeCut, shortReason: null }] }), MON + 7)
  assert.equal(m5.run.recent[m5.run.recent.length - 1].struggled, false)
  assert.equal(m5.run.rungSec, 120, 'the rung holds')
  // Cut short because it felt rough: a step back.
  const m5b = buildAthleteModel(events({ sessions: [s1, s2, s3, s6], talkTests: tests, runs: [easy(s1, 60), easy(s2, 90), easy(s3, 120), { ...timeCut, shortReason: 'rough' }] }), MON + 7)
  assert.equal(m5b.run.recent[m5b.run.recent.length - 1].struggled, true)

  // No HR: effort and finishing decide, with more uncertainty.
  const s7 = session(MON + 7, 'running', { rpe: 4 })
  const noHr = run(s7, { avgHr: null, pieceSec: 210 })
  const m6 = buildAthleteModel(events({ sessions: [s1, s2, s3, s7], talkTests: tests, runs: [easy(s1, 60), easy(s2, 90), easy(s3, 120), noHr] }), MON + 7)
  assert.equal(m6.run.lastRunHadHr, false)
  assert.equal(m6.run.recent[m6.run.recent.length - 1].handled, true)
  assert.equal(m6.run.u, 0.25, 'KNOWN 0.15 + 0.1 for a run without HR')
  // Indoor counts like outdoor.
  const m7 = buildAthleteModel(events({ sessions: [s1, s2, s3, s7], talkTests: tests, runs: [easy(s1, 60), easy(s2, 90), easy(s3, 120), { ...easy(s7, 210), isIndoor: true }] }), MON + 7)
  assert.equal(m7.run.rungSec, 210)

  // Guards: a Strava stub and a typo'd 30-hour run carry no duration.
  const stub = session(MON, 'foundation_run')
  const typo = session(MON + 1, 'running')
  const g = buildAthleteModel(events({ sessions: [stub, typo], runs: [run(stub, { durationSec: 11, avgHr: 133 }), run(typo, { durationSec: 108000, pieceSec: null })] }), MON + 2)
  assert.equal(g.run.runs, 1, 'the stub is dropped')
  assert.equal(g.run.longestLast30Sec, null, 'the typo has no duration')
  assert.equal(g.run.recheckWhy, 'No talk test yet.')
}

// ─── Bag ─────────────────────────────────────────────────────
{
  const bags: ModelBag[] = [0, 3, 6].map(i => ({ sessionId: `b${i}`, day: MON + i, status: 'completed', roundsPlanned: 4, roundsRated: 4, ratings: [2, 3, 2, 3], rpe: 6, skipReason: null }))
  const sess = bags.map(b => session(b.day, 'bag_work', { id: b.sessionId }))
  const m = buildAthleteModel(events({ sessions: sess, bag: bags }), MON + 7)
  assert.equal(m.bag.roundsTolerated, 5, '4, +1 after two effort-≤6 sessions; not again until he does 5')
  assert.equal(m.bag.state, 'KNOWN')
  const sore = buildAthleteModel(events({ sessions: sess, bag: bags, notes: [{ day: MON + 6, text: 'Left wrist a bit sore after the bag', source: 'session' }] }), MON + 7)
  assert.equal(sore.bag.roundsTolerated, 3, 'a wrist note brings it under what he did')
  assert.equal(sore.bag.wristShinFlags, 1)
  const skipped = buildAthleteModel(events({ bag: [{ ...bags[0], status: 'skipped', skipReason: 'schedule' }] }), MON + 1)
  assert.equal(skipped.bag.scheduleCuts, 1)
  assert.equal(skipped.bag.roundsTolerated, null, 'a time skip says nothing about tolerance')
}

// ─── MT class: tolerance and class-night fit ─────────────────
{
  const wk1 = [session(MON + 2, 'mt_class', { slot: 'pm', startMin: 18 * 60 + 30, source: 'coach' })]
  const wk2 = [session(MON + 9, 'mt_class', { slot: 'pm', startMin: 18 * 60 + 30, source: 'coach' }), session(MON + 11, 'mt_class', { slot: 'pm', status: 'skipped', skipReason: 'schedule', source: 'coach' })]
  const wk3 = [session(MON + 16, 'mt_class', { slot: 'pm', status: 'skipped', skipReason: 'too_sore', source: 'coach' }), session(MON + 18, 'mt_class', { slot: 'pm', status: 'skipped', skipReason: 'schedule', source: 'coach' })]
  const checkIns = [MON + 3, MON + 10].map(d => ci(d, { soreness: 2 }))
  const m = buildAthleteModel(events({ sessions: [...wk1, ...wk2, ...wk3], checkIns }), MON + 20)
  const wed = m.klass.nights[3]
  const fri = m.klass.nights[5]
  assert.equal(wed.attended, 2)
  assert.equal(wed.recoverySkips, 1, 'a sore skip is kept apart')
  assert.equal(wed.n, 2, '...and out of the fit')
  assert.equal(fri.scheduleSkips, 2, 'Friday keeps not fitting')
  assert.ok(fri.p < 0.3 && wed.p > 0.7)
  assert.equal(m.klass.perWeekTolerated, 2, '1 → 2 after an easy week; the time skips never lower it')
  assert.equal(m.adherence.scheduleSkips.byType.mt_class, 2)
}

// ─── Recovery baselines and responses ────────────────────────
{
  assert.equal(isLive([1, 3, 6, 9]), true, '4 values in 10 days')
  assert.equal(isLive([1, 5, 12, 20]), false)
  const cis = [0, 1, 2, 3].map(i => ci(MON + i, { sleepHours: 7 + i * 0.5 }))
  const m = buildAthleteModel(events({ checkIns: cis }), MON + 3)
  assert.equal(m.recovery.state, 'LEARNING')
  assert.equal(m.recovery.baseline.sleepHours?.mean, 7.75)
  assert.equal(buildAthleteModel(events({ checkIns: cis.slice(0, 3) }), MON + 3).recovery.state, 'GUESS')
  const two = Array.from({ length: 20 }, (_, i) => ci(MON + i))
  assert.equal(buildAthleteModel(events({ checkIns: two }), MON + 19).recovery.state, 'KNOWN', '14+ check-ins')
}

// ─── Back: trend and sensitivity to hinging ──────────────────
{
  const cis = Array.from({ length: 21 }, (_, i) => ci(MON + i, { backToday: 4 }))
  const ss = [2, 6, 10, 14].map(i => session(MON + i, 'strength'))
  for (const s of ss) cis[s.day - MON + 1].backToday = 2
  const sets = ss.flatMap(s => lift(s, 'ex-db-rdl', [{ w: 40, reps: 8, rir: 2 }]))
  const m = buildAthleteModel(events({ sessions: ss, sets, checkIns: cis }), MON + 20)
  assert.equal(m.back.sensitivity.hinge?.delta, -2, 'the morning after hinging is 2 points worse')
  assert.equal(m.back.state, 'KNOWN')
  assert.equal(noteFlags('Lower back tight this morning').includes('back'), true)
  assert.equal(noteFlags('Back from the trip, felt good').includes('back'), false, '"back from" is not the back')
}

// ─── When he trains: Beta per slot, usual start, half weight, rest days ─
{
  assert.equal(cellOf(MON, 'pm', null), 'pm-weekday')
  assert.equal(cellOf(MON + 5, null, 7 * 60), 'am-weekend')
  assert.deepEqual(usualStartOf([397, 402, 564, 1138]), { minute: 397, of: 4, inCluster: 2 }, '6:37 and 6:42 cluster: ~6:40')
  const am = [0, 2, 4, 7, 9, 11].map(i => session(MON + i, 'strength', { startMin: 400 + (i % 3) }))
  const pm = [1, 3, 8].map(i => session(MON + i, 'skip_rope', { slot: 'pm', status: 'missed', startMin: null }))
  const sickSkip = session(MON + 10, 'foundation_run', { status: 'skipped', skipReason: 'sick' })
  const timeSkip = session(MON + 12, 'foundation_run', { status: 'skipped', skipReason: 'schedule' })
  const m = buildAthleteModel(events({ sessions: [...am, ...pm, sickSkip, timeSkip] }), MON + 13)
  const c = m.adherence.cells
  assert.equal(c['pm-weekday'].p, 0.2, '0 of 3 PM: Beta(1, 4)')
  assert.equal(c['am-weekday'].n, 6, 'the sick skip (Thu) is not an adherence miss')
  assert.equal(c['am-weekend'].n, 1, 'the time skip (Sat) is')
  assert.ok(m.adherence.usualStart.strength.minute >= 400 && m.adherence.usualStart.strength.minute <= 402)
  assert.equal(m.adherence.scheduleSkips.total, 1)
  const old = buildAthleteModel(events({ sessions: am }), MON + 200)
  assert.equal(old.adherence.cells['am-weekday'].n, 3, 'older than 90 days: half weight')

  // Rest days: he trains Mon/Wed/Fri/Sat and keeps moving Sunday's session off Sunday.
  const days = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 18, 19].map(i => session(MON + i, 'strength'))
  const moves = [6, 13, 20].map(i => ({ fromDay: MON + i, toDay: MON + i + 1, type: 'foundation_run' }))
  const r = buildAthleteModel(events({ sessions: days, moves }), MON + 21)
  assert.ok(r.adherence.preferredRestDays.includes(0), 'Sunday is his rest day')
  assert.ok(!r.adherence.preferredRestDays.includes(1), 'Monday is not')
}

// ─── Rows and signals ────────────────────────────────────────
{
  const s = session(MON, 'strength')
  const e = events({ trainingMaxes: [], sessions: [s], sets: lift(s, 'ex-db-rdl', [{ w: 40, reps: 8, rir: 2 }]), checkIns: [0, 1, 2, 3, 4].map(i => ci(MON - 4 + i, { sleepHours: i === 4 ? 5 : 8, soreness: i === 4 ? 4 : 2 })) })
  const m = buildAthleteModel(e, MON)
  const rows = modelRows(m)
  const keys = rows.map(r => `${r.kind}:${r.key}`)
  assert.equal(new Set(keys).size, keys.length, 'one row per kind and key')
  for (const k of ['lift:ex-db-rdl', 'run:line', 'run:tolerance', 'bag:main', 'class:main', 'class:nights', 'recovery:main', 'back:main', 'adherence:am-weekday', 'adherence:pm-weekend', 'adherence:start-times', 'adherence:rest-days', 'adherence:schedule']) {
    assert.ok(keys.includes(k), k)
  }
  for (const r of rows) {
    assert.ok(r.uncertainty >= 0 && r.uncertainty <= 1)
    assert.doesNotThrow(() => JSON.parse(r.valueJson))
  }
  const facts = athleteSignals(m, e, MON)
  const f = (id: string) => facts.find(x => x.id === id)?.value
  assert.equal(f('f.ci.sleepHours'), 5)
  assert.equal(f('f.ci.sleepHours.vsUsual'), -3)
  assert.equal(f('f.ci.worseItems'), 2, 'sleep and soreness are off his usual')
  assert.equal(f('f.lift.ex-db-rdl.lastRir'), 2)
  assert.equal(new Set(facts.map(x => x.id)).size, facts.length, 'fact ids are unique')
  // Deterministic: the same events give the same model.
  assert.deepEqual(buildAthleteModel(e, MON), m)
}

console.log('ok: athlete model')
