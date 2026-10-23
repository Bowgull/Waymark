// Run: tsx src/lib/brain/history.test.ts
// Starting at his real level (Josh, 2026-10-21) on MADE-UP data that only
// resembles the pattern: a few dumbbell sessions and continuous runs some
// months before the block, then the block. The seed's discount and rounding,
// the model it starts, the doses it gives (continuous easy runs, starting
// weights in lb), how his own sessions take over, and the week's first
// strength session in the outline.
import assert from 'node:assert/strict'
import { buildAthleteModel } from './athleteModel'
import { runDose, seedRunWhy, strengthDose, nextContinuous, workUpLadder, type DoseCtx, type RunIn } from './doses'
import { CONTINUOUS_FROM_SEC, SEED_U, discountedKg, firstStrengthPick, seedFromHistory, seedRunRungSec, timeOffDiscount } from './history'
import { solveOutline, type OutlineIn, type OutlineSession } from './outline'
import type { ModelEvents, ModelRun, ModelSession, ModelSet } from './types'

const LB = 0.45359237
const lbOf = (kg: number | null | undefined) => (kg == null ? null : Math.round(kg / LB))
const START = 20845 // Wednesday 2027-01-27 (a mid-week block start)
const MON = START - 2
const LAST = START - 120 // last session about 4 months before

function events(over: Partial<ModelEvents> = {}): ModelEvents {
  return {
    profile: { dob: '1991-03-01', maxHr: 186, backSensitive: true },
    sessions: [], sets: [], runs: [], talkTests: [], bag: [], checkIns: [], notes: [], moves: [], classLogs: [], trainingMaxes: [], openBodyAlerts: [],
    ...over,
  }
}
let sid = 0
function session(day: number, type: string, over: Partial<ModelSession> = {}): ModelSession {
  return { id: `h${++sid}`, type, status: 'completed', day, slot: 'am', startMin: 6 * 60 + 30, durationSec: 1800, rpe: null, skipReason: null, source: 'template', blockType: 'road', notes: null, ...over }
}
function sets(s: ModelSession, exerciseId: string, lb: number[], reps = 8, opts: { logged?: boolean; section?: string; equipment?: ModelSet['equipment']; rir?: number | null } = {}): ModelSet[] {
  return lb.map((w, i) => ({
    sessionId: s.id, day: s.day, exerciseId, section: opts.section ?? 'main', setNumber: i + 1, weightKg: w * LB, reps, plannedWeightKg: w * LB, plannedReps: reps,
    rir: opts.rir ?? null, isWarmup: false, logged: opts.logged ?? true, equipment: opts.equipment ?? 'dumbbell',
  }))
}
function run(s: ModelSession, sec: number, over: Partial<ModelRun> = {}): ModelRun {
  return { sessionId: s.id, day: s.day, type: 'running', durationSec: sec, plannedDurationSec: null, distanceKm: sec / 400, avgHr: 144, maxHr: 158, splits: [], isIndoor: false, completionStatus: null, shortReason: null, rpe: null, pieceSec: null, ...over }
}

// A made-up history: three dumbbell sessions (no RIR; the oldest never marked logged), four continuous runs and two stubs.
const s1 = session(LAST - 20, 'strength')
const s2 = session(LAST - 12, 'strength')
const s3 = session(LAST, 'strength')
const r1 = session(LAST - 25, 'running')
const r2 = session(LAST - 18, 'foundation_run')
const r3 = session(LAST - 9, 'foundation_run')
const r4 = session(LAST - 3, 'running')
const stub = session(LAST - 6, 'foundation_run')
const typo = session(LAST - 5, 'running')
const missed = session(LAST - 1, 'strength', { status: 'missed' })
const history = events({
  sessions: [s1, s2, s3, r1, r2, r3, r4, stub, typo, missed],
  sets: [
    ...sets(s1, 'ex-db-rdl', [25, 20, 25], 8, { logged: false }),
    ...sets(s2, 'ex-db-rdl', [35, 30, 30]),
    ...sets(s2, 'ex-db-row', [20, 30, 20], 10),
    ...sets(s3, 'ex-db-rdl', [35, 35, 35]),
    ...sets(s3, 'ex-db-row', [30, 30, 30], 10),
    ...sets(s3, 'ex-db-ohp', [20, 20, 20]),
    ...sets(s3, 'ex-hammer-curl', [15, 15], 10, { section: 'accessory' }),
    ...sets(s3, 'ex-dead-bugs', [0], 10, { section: 'core', equipment: 'none' }),
    ...sets(missed, 'ex-db-rdl', [60, 60, 60]),
  ],
  runs: [run(r1, 1110), run(r2, 640, { avgHr: 150 }), run(r3, 1050), run(r4, 1720, { avgHr: null }), run(stub, 15), run(typo, 100000)],
})

// ─── The discount and the seed ───────────────────────────────
{
  assert.equal(timeOffDiscount(10), 0, 'two weeks off: no discount')
  assert.equal(timeOffDiscount(44), 0.075, 'a month past the two weeks: 5% + 2.5%')
  assert.ok(timeOffDiscount(120) > 0.1 && timeOffDiscount(120) < 0.2, `4 months: between 10 and 20% (${timeOffDiscount(120)})`)
  assert.equal(timeOffDiscount(400), 0.2, 'never more than 20%')
  assert.equal(lbOf(discountedKg(35 * LB, 0.14, 'dumbbell')), 30, '35 lb less 14%: 30 lb')
  assert.equal(lbOf(discountedKg(15 * LB, 0.14, 'dumbbell')), 10, 'the snap would land back on 15 lb: one step under it')
  assert.equal(lbOf(discountedKg(35 * LB, 0, 'dumbbell')), 35, 'no time off: where he left off')

  const seed = seedFromHistory(history, START)
  assert.ok(seed, 'a seed from the history')
  if (!seed) throw new Error('no seed')
  assert.equal(seed.daysOff, 120)
  assert.equal(seed.u, SEED_U, 'moderate uncertainty, not GUESS')
  assert.deepEqual(Object.keys(seed.lifts).sort(), ['ex-db-ohp', 'ex-db-rdl', 'ex-db-row', 'ex-hammer-curl'], 'weighted main and accessory lifts; core work and missed sessions are not')
  assert.equal(lbOf(seed.lifts['ex-db-rdl'].lastKg), 35, 'the last exposure, not the heaviest ever (a missed session never counts)')
  assert.equal(seed.lifts['ex-db-rdl'].exposures, 3, 'a finished session with weights counts even when the sets were not marked logged')
  assert.equal(lbOf(seed.lifts['ex-db-rdl'].capKg), 30, 'the top a first session works up to, not its start')
  assert.equal(lbOf(seed.lifts['ex-db-row'].capKg), 25)
  assert.equal(lbOf(seed.lifts['ex-db-ohp'].capKg), 15)
  assert.ok(seed.run, 'a run seed')
  assert.equal(seed.run?.runs, 4, 'stubs and typos are not runs')
  assert.equal(seed.run?.rungSec, 900, `his usual run (~18 min) after 4 months off rounds DOWN to 15 min continuous (audit #9): ${seed.run?.rungSec}`)
  assert.equal(seed.run?.avgHr, 146, 'average HR over the runs that had one')

  // Only short pieces in the history: a run-walk piece, not a continuous run.
  const shortRuns = [session(LAST, 'running'), session(LAST - 2, 'running')]
  const short = seedFromHistory(events({ sessions: shortRuns, runs: shortRuns.map(s => run(s, 500)) }), START)
  assert.ok(short?.run && short.run.rungSec < CONTINUOUS_FROM_SEC && short.run.rungSec >= 60, `short runs seed a run-walk piece: ${short?.run?.rungSec}`)
  // The cap: never over his longest less the discount.
  const capped = seedFromHistory(events({ sessions: shortRuns, runs: [run(shortRuns[0], 1700), run(shortRuns[1], 1700)] }), START)
  assert.ok(capped?.run && capped.run.rungSec <= 1700 * (1 - capped.discount), `capped by the longest less the discount: ${capped?.run?.rungSec}`)

  assert.equal(seedFromHistory(history, LAST + 400), null, 'history from more than 9 months ago seeds nothing')
  assert.equal(seedFromHistory(events(), START), null, 'no history: no seed (from scratch)')
}

// ─── The model it starts, and the doses ──────────────────────
const seed = seedFromHistory(history, START)
const runIn = (over: Partial<RunIn> = {}): RunIn => ({ kind: 'run_walk', longestLast30Sec: null, weekly: { lastWeekRunSec: 0, thisWeekSoFarSec: 0, sessionsLeftThisWeek: 2 }, hrCeilingBpm: 145, lastRunSec: null, riseThisWeek: false, ...over })
const ctx = (ev: ModelEvents, day: number, over: Partial<DoseCtx> = {}): DoseCtx => ({ day, state: 'GREEN', stateWhy: null, model: buildAthleteModel(ev, day, { fromDay: START, seed }), backToday: null, openPlans: [], ...over })
const block = (over: Partial<ModelEvents> = {}) => events({ ...over, sessions: [...history.sessions, ...(over.sessions ?? [])], sets: [...history.sets, ...(over.sets ?? [])], runs: [...history.runs, ...(over.runs ?? [])] })
{
  const m = buildAthleteModel(block(), START, { fromDay: START, seed })
  const rdl = m.lifts['ex-db-rdl']
  assert.deepEqual([rdl.workingSource, rdl.state, rdl.u, rdl.workingKg, lbOf(rdl.seed?.capKg), rdl.exposures], ['history', 'LEARNING', 0.4, null, 30, 0], 'the RDL: no start weight from history, 30 lb its top, LEARNING at u 0.4')
  assert.deepEqual([m.run.rungSec, m.run.rungSource, m.run.state, m.run.u], [900, 'history', 'LEARNING', 0.4], 'the run starts at 15 min continuous')
  assert.equal(m.bag.state, 'GUESS', 'areas with no history still start from nothing')
  const unseeded = buildAthleteModel(block(), START, { fromDay: START })
  assert.deepEqual([Object.keys(unseeded.lifts).length, unseeded.run.rungSec], [0, 60], 'without a seed: from scratch, as before')

  // Strength B on day one (Josh, 2026-10-23: months off, much weaker than his logs): every lift finds its
  // weight from light. The DB RDL works up from 20 lb, never over his June 35 lb less the time off (30 lb).
  const sb = strengthDose(ctx(block(), START + 2), {
    kind: 'block_zero', main: [{ exerciseId: 'ex-db-rdl', label: 'DB Romanian Deadlift', reps: 8 }, { exerciseId: 'ex-ohp', label: 'Overhead Press', reps: 8 }],
    tmKg: {}, equipment: { 'ex-db-rdl': 'dumbbell', 'ex-ohp': 'barbell', 'ex-hammer-curl': 'dumbbell', 'ex-face-pulls': 'machine', 'ex-dead-bugs': 'none', 'ex-calf': 'dumbbell' },
    steppedThisWeek: [], lastFeltHard: null,
    accessories: [
      { exerciseId: 'ex-hammer-curl', label: 'Hammer Curl', section: 'accessory', sets: 3, reps: 10 },
      { exerciseId: 'ex-face-pulls', label: 'Face Pulls', section: 'accessory', sets: 2, reps: 15 },
      { exerciseId: 'ex-dead-bugs', label: 'Dead Bugs', section: 'core', sets: 2, reps: 10 },
      { exerciseId: 'ex-calf', label: 'Calf Raise', section: 'core', sets: 2, reps: 12 },
    ],
    bodyweightIds: ['ex-dead-bugs', 'ex-calf'],
  })
  const [hinge, press] = sb.lifts
  assert.deepEqual([hinge.exerciseId, lbOf(hinge.weightKg), hinge.sets, hinge.targetRir, hinge.workUp], ['ex-db-rdl', 20, 4, 3, true], 'DB RDL: find your weight, 4 × 8 from 20 lb')
  assert.deepEqual(hinge.setWeightsKg?.map(lbOf), [20, 25, 30, 30], 'it climbs, and stops at the top (30 lb), never over it')
  assert.ok(hinge.why && /20 lb/.test(hinge.why) && /30 lb/.test(hinge.why) && /35 lb/.test(hinge.why) && /months off/.test(hinge.why), `plain why in lb: ${hinge.why}`)
  assert.ok(press.workUp && lbOf(press.weightKg) === 45, 'the barbell press: find your weight from the empty bar')
  // Accessories the same way: light start, his history the top; bodyweight moves get no weight.
  const acc = Object.fromEntries((sb.accessories ?? []).map(a => [a.exerciseId, a]))
  assert.deepEqual([acc['ex-hammer-curl']?.workUp, acc['ex-hammer-curl']?.setWeightsKg?.map(lbOf)], [true, [10, 10, 10]], 'hammer curl: 15 lb in June less the time off is 10 lb, the top and the start')
  assert.deepEqual(acc['ex-face-pulls']?.setWeightsKg?.map(lbOf), [20, 25], 'face pulls, no history: from a light 20 lb on the stack')
  assert.ok(!acc['ex-dead-bugs'] && !acc['ex-calf'], 'dead bugs and calf raises: bodyweight, no weight')

  // The run: 15 min continuous at the line, no walk breaks (his usual 18, less the time off).
  const easy = runDose(ctx(block(), START + 1), runIn())
  assert.deepEqual([easy.runSec, easy.walkSec, easy.rounds, easy.walkOnly, easy.level], [900, 0, 1, false, 'HOLD'], '15 min continuous')
  assert.ok(easy.talkTestDue, 'the talk test is still asked')
  // Audit #9 / #19: the why agrees with the number and names the month of the evidence.
  const month = new Date(LAST * 86400000).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })
  assert.ok(easy.why.includes(`15 min easy, no walk breaks: your usual run in ${month} was 18 min, less for 4 months off.`), `why: ${easy.why}`)
  const amber = runDose(ctx(block(), START + 1, { state: 'AMBER', stateWhy: 'Slept 5 h.' }), runIn())
  assert.equal(amber.runSec, 840, 'an AMBER morning: 10% shorter, to the minute')
  assert.equal(nextContinuous(1200), 1320, 'the next step: 10% longer, to the minute')
}

// ─── The work-up ladder and an accessory done in the block ───
{
  const L = (lb: number) => lb * LB
  assert.deepEqual(workUpLadder(L(45), 4, 'ex-bench-press', 'barbell').map(lbOf), [45, 50, 55, 60], 'no history: climbs a step a set')
  assert.deepEqual(workUpLadder(L(20), 4, 'ex-db-row', 'dumbbell', L(25)).map(lbOf), [20, 25, 25, 25], 'his old weight is the top, never passed')
  assert.deepEqual(workUpLadder(L(20), 3, 'ex-db-ohp', 'dumbbell', L(15)).map(lbOf), [15, 15, 15], 'a top under the light start: starts at the top')
  assert.deepEqual(workUpLadder(null, 2, 'ex-bird-dogs', 'none'), [null, null], 'nothing to load')

  // He did face pulls in the block, every rep at 25 lb: next time +5 lb on a green day, held on an AMBER one.
  const facePull = { exerciseId: 'ex-face-pulls', label: 'Face Pulls', section: 'accessory' as const, sets: 2, reps: 15 }
  const last = { 'ex-face-pulls': { plannedSets: 2, sets: [{ weightKg: L(25), reps: 15, plannedReps: 15, rir: 3 }, { weightKg: L(25), reps: 15, plannedReps: 15, rir: 2 }] } }
  const inp = { kind: 'block_zero' as const, main: [], tmKg: {}, equipment: { 'ex-face-pulls': 'machine' as const }, steppedThisWeek: [], lastFeltHard: null, accessories: [facePull], accessoryLast: last }
  const green = strengthDose(ctx(block(), START + 9), inp).accessories?.[0]
  assert.deepEqual([green?.workUp, lbOf(green?.weightKg), green?.change], [false, 30, 'increase'], 'all sets hit: one step up')
  const amber = strengthDose(ctx(block(), START + 9, { state: 'AMBER', stateWhy: 'Slept 5 h.' }), inp).accessories?.[0]
  assert.deepEqual([lbOf(amber?.weightKg), amber?.change], [25, 'hold'], 'AMBER: same weight')
}

// ─── His own sessions take over (both ways) ──────────────────
{
  // He did the RDL at 30 lb without RIR: his number now, never more careful than the start.
  const b1 = session(START + 2, 'strength', { blockType: 'block_zero' })
  const done = block({ sessions: [b1], sets: sets(b1, 'ex-db-rdl', [30, 30, 30]) })
  const rdl = buildAthleteModel(done, START + 3, { fromDay: START, seed }).lifts['ex-db-rdl']
  assert.deepEqual([rdl.workingSource, rdl.exposures, rdl.state], ['used', 1, 'LEARNING'], 'his own exposure replaces the seed')
  assert.ok(rdl.u <= SEED_U, `no more careful than the start (u ${rdl.u})`)
  const again = strengthDose(ctx(done, START + 5), { kind: 'block_zero', main: [{ exerciseId: 'ex-db-rdl', label: 'DB Romanian Deadlift', reps: 8 }], tmKg: {}, equipment: { 'ex-db-rdl': 'dumbbell' }, steppedThisWeek: [], lastFeltHard: null })
  assert.deepEqual([lbOf(again.lifts[0].weightKg), again.lifts[0].sets], [30, 3], 'next time: 3 × 8 at what he used')

  // Two easy runs under the line: up 10%. A struggle: 20% shorter.
  const e1 = session(START + 1, 'foundation_run', { blockType: 'block_zero', rpe: 4 })
  const e2 = session(START + 3, 'foundation_run', { blockType: 'block_zero', rpe: 4 })
  const fine = (s: ModelSession) => run(s, 1200, { type: 'foundation_run', avgHr: 132, maxHr: 140, rpe: 4, pieceSec: 1200, rungSec: 1200, plannedDurationSec: 1200 })
  const twoEasy = block({ sessions: [e1, e2], runs: [fine(e1), fine(e2)] })
  const up = runDose(ctx(twoEasy, START + 12), runIn({ longestLast30Sec: 1200, lastRunSec: 1200, weekly: { lastWeekRunSec: 2400, thisWeekSoFarSec: 0, sessionsLeftThisWeek: 3 } }))
  assert.deepEqual([up.level, up.runSec, up.walkSec], ['PROGRESS', 1320, 0], 'two easy runs: 22 min')
  const held = runDose(ctx(twoEasy, START + 12), runIn({ longestLast30Sec: 1200, lastRunSec: 1200, riseThisWeek: true, weekly: { lastWeekRunSec: 2400, thisWeekSoFarSec: 1320, sessionsLeftThisWeek: 2 } }))
  assert.equal(held.runSec, 1200, 'one rise a week')
  const hard = session(START + 3, 'foundation_run', { blockType: 'block_zero', rpe: 8 })
  const struggled = block({ sessions: [e1, hard], runs: [fine(e1), run(hard, 1200, { type: 'foundation_run', avgHr: 160, maxHr: 170, rpe: 8, pieceSec: 1200, rungSec: 1200 })] })
  const m = buildAthleteModel(struggled, START + 5, { fromDay: START, seed })
  assert.equal(m.run.rungSec, 960, 'a hard 20 min: next run 16 min')
  const eased = runDose(ctx(struggled, START + 5), runIn({ longestLast30Sec: 1200, lastRunSec: 1200 }))
  assert.deepEqual([eased.level, eased.runSec, eased.walkSec], ['EASE', 960, 0], 'eased, still continuous')
}

// ─── The week's first strength session ───────────────────────
{
  const model = buildAthleteModel(block(), START + 1, { fromDay: START, seed })
  const pick = firstStrengthPick(model, 1)
  assert.equal(pick.label, 'Strength B', 'the day whose lifts it knows best: the hinge day (DB RDL from his history)')
  assert.ok(/this week/.test(pick.why) && /4 months off/.test(pick.why), `plain why: ${pick.why}`)
  assert.equal(firstStrengthPick(buildAthleteModel(events(), START + 1), 1).label, 'Strength A', 'nothing known: A first')

  const os = (id: string, type: string, day: number, over: Partial<OutlineSession> = {}): OutlineSession => ({ id, type, label: type === 'foundation_run' ? 'Run-Walk' : null, day, slot: 'am', status: 'planned', source: 'template', locked: false, ...over })
  // A mid-week start planned by an older lead-in: runs and Foundation, no strength.
  const week = [os('f1', 'mobility', START), os('r1', 'foundation_run', START + 1), os('f2', 'mobility', START + 2), os('r2', 'foundation_run', START + 3), os('f3', 'mobility', START + 4)]
  const inp = (over: Partial<OutlineIn> = {}): OutlineIn => ({
    today: START + 1, monday: MON, blockType: 'block_zero', blockStart: START, sessions: week, classDays: [1, 3, 5], classCap: 3, classHeld: false,
    model, state: 'GREEN', restDue: null, strengthStart: pick, ...over,
  })
  const r = solveOutline(inp())
  const add = r.changes.find(c => c.kind === 'add')
  assert.ok(add && add.kind === 'add' && add.type === 'strength' && add.day === START + 2, `Strength B goes in on the first free day: ${JSON.stringify(add)}`)
  assert.ok(add && /^Strength B on Friday: strength starts this week/.test(add.why), `why: ${add?.why}`)
  assert.equal(r.violationsAfter.length, 0, 'every limit kept')
  assert.ok(!solveOutline(inp({ firstAddDay: START + 3 })).changes.some(c => c.kind === 'add' && c.day < START + 3), 'never before the first add day')
  assert.equal(solveOutline(inp({ strengthStart: null })).changes.filter(c => c.kind === 'add').length, 0, 'no strengthStart: no add')
  const skipped = [...week, os('s1', 'strength', START, { status: 'skipped', locked: true, label: 'Strength A' })]
  assert.equal(solveOutline(inp({ sessions: skipped })).changes.filter(c => c.kind === 'add').length, 0, 'a week that had strength (even skipped) gets none made up')
  assert.equal(solveOutline(inp({ state: 'RED' })).changes.filter(c => c.kind === 'add').length, 0, 'a RED night adds nothing')
}

// ─── Audit #9: the first run rounds down after time off ──────
{
  assert.equal(seedRunRungSec(1080, timeOffDiscount(135)), 900, '18 min usual, 4.5 months off: 15 min')
  assert.equal(seedRunRungSec(1080, 0), 900, 'no discount: still rounded down to 5 min (never up to 20)')
  assert.equal(seedRunRungSec(1500, 0.05), 1200, '25 min less 5%: 20 min')
  assert.equal(seedRunRungSec(660, 0.2), 600, 'never under 10 min when his usual was 10 or more')
  assert.equal(seedRunRungSec(500, 0), 300, 'under 10 min usual: no floor (the run-walk pieces take over)')
  assert.equal(seedRunWhy(900, { medianSec: 1080, lastDay: 20620, daysOff: 125 }), '15 min easy, no walk breaks: your usual run in June was 18 min, less for 4 months off.')
  assert.equal(seedRunWhy(1200, { medianSec: 1200, lastDay: 20620, daysOff: 5 }), '20 min easy, no walk breaks: your usual run in June was 20 min.')
}

// ─── Audit #8: a walk-only day is never a run ────────────────
{
  // A walk-only dose ran 0 s: "last run 0" never caps the next run (it is no run at all).
  const zero = runDose(ctx(block(), START + 3), runIn({ lastRunSec: 0, riseThisWeek: true }))
  const none = runDose(ctx(block(), START + 3), runIn({ lastRunSec: null, riseThisWeek: true }))
  assert.deepEqual([zero.runSec, zero.rounds, zero.walkOnly], [none.runSec, none.rounds, none.walkOnly], 'last run 0 s reads as no last run')
  assert.ok(zero.runSec >= CONTINUOUS_FROM_SEC && !zero.walkOnly, `still his run (${zero.runSec} s)`)
  // A walk logged on a walk-only day (a long, easy, HR-low "run") moves nothing on the rung.
  const w = session(START + 1, 'foundation_run', { blockType: 'block_zero', rpe: 2 })
  const walked = block({ sessions: [w], runs: [run(w, 1500, { type: 'foundation_run', avgHr: 105, maxHr: 112, rpe: 2, pieceSec: null, rungSec: null, walkOnly: true })] })
  const before = buildAthleteModel(block(), START + 3, { fromDay: START, seed })
  const after = buildAthleteModel(walked, START + 3, { fromDay: START, seed })
  assert.deepEqual([after.run.rungSec, after.run.rungSource, after.run.runs], [before.run.rungSec, before.run.rungSource, before.run.runs], 'the rung, its source and the run count are as before the walk')
  // The same walk without the mark would have read as a 25 min run and raised the rung: the mark is what keeps it out.
  const unmarked = block({ sessions: [w], runs: [run(w, 1500, { type: 'foundation_run', avgHr: 105, maxHr: 112, rpe: 2, pieceSec: null, rungSec: null })] })
  assert.notEqual(buildAthleteModel(unmarked, START + 3, { fromDay: START, seed }).run.rungSec, before.run.rungSec, 'unmarked, the walk would move the rung')
}

console.log('history seed tests passed')
