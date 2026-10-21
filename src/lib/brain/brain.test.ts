// Run: tsx src/lib/brain/brain.test.ts
// Coach brain P2, the rules-only brain, on made-up data: readiness states
// (§6.1), the per-modality doses and their levels (§5.2, §6.2), earned
// exercise progression, and the week outline (class nights, rest days, the
// limits, at most 2 changes).
import assert from 'node:assert/strict'
import { buildAthleteModel } from './athleteModel'
import { bagDose, liftSignal, liftTargets, runDose, strengthDose, templateFromDose, type DoseCtx, type RunIn, type StrengthIn } from './doses'
import { backDaySwap, chooseSlot, preferTrapBar, ravenSwap } from './progression'
import { lowerState, readinessState } from './readiness'
import { classTarget, solveOutline, violations, type OutlineIn, type OutlineSession } from './outline'
import type { ModelCheckIn, ModelEvents, ModelRun, ModelSession, ModelSet } from './types'

const LB = 0.45359237
const MON = 20822 // Monday 2027-01-04

function events(over: Partial<ModelEvents> = {}): ModelEvents {
  return {
    profile: { dob: '1990-06-01', maxHr: null, backSensitive: false },
    sessions: [], sets: [], runs: [], talkTests: [], bag: [], checkIns: [], notes: [], moves: [], classLogs: [], trainingMaxes: [], openBodyAlerts: [],
    ...over,
  }
}
let sid = 0
function session(day: number, type: string, over: Partial<ModelSession> = {}): ModelSession {
  return { id: `s${++sid}`, type, status: 'completed', day, slot: 'am', startMin: 6 * 60 + 40, durationSec: 1800, rpe: 5, skipReason: null, source: 'template', blockType: 'block_zero', notes: null, ...over }
}
function lift(s: ModelSession, exerciseId: string, sets: Array<{ w: number; reps: number; rir: number | null; planW?: number; planReps?: number }>, equipment: ModelSet['equipment'] = 'dumbbell'): ModelSet[] {
  return sets.map((x, i) => ({
    sessionId: s.id, day: s.day, exerciseId, section: 'main', setNumber: i + 1, weightKg: x.w * LB, reps: x.reps,
    plannedWeightKg: (x.planW ?? x.w) * LB, plannedReps: x.planReps ?? 8, rir: x.rir, isWarmup: false, logged: true, equipment,
  }))
}
function run(s: ModelSession, over: Partial<ModelRun> = {}): ModelRun {
  return { sessionId: s.id, day: s.day, type: 'foundation_run', durationSec: 1400, plannedDurationSec: 1400, distanceKm: 3, avgHr: 135, maxHr: 142, splits: [], isIndoor: false, completionStatus: null, shortReason: null, rpe: 4, pieceSec: 60, rungSec: 60, ...over }
}
const ci = (day: number, v: Partial<ModelCheckIn> = {}): ModelCheckIn => ({ day, sleepHours: 7.5, sleepQuality: 3, energy: 3, soreness: 2, stress: 2, mood: 3, backToday: 3, ...v })
const steady = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ci(from + i))
const lb = (kg: number | null) => (kg == null ? null : Math.round(kg / LB))

// ─── Readiness (§6.1) ────────────────────────────────────────
{
  const base = steady(MON - 14, MON - 1)
  assert.equal(readinessState(base, MON - 1).state, 'GREEN', 'a steady morning is GREEN')
  assert.equal(readinessState([...base, ci(MON, { sleepHours: 8.5, energy: 4, mood: 4 })], MON).state, 'FRESH', 'no item worse, 2+ better: FRESH')
  const bad = { sleepHours: 5.5, sleepQuality: 2, energy: 2, soreness: 4 }
  const day1 = readinessState([...base, ci(MON, bad)], MON)
  assert.equal(day1.state, 'AMBER', '2+ items worse, first day: AMBER')
  assert.ok(day1.why && /slept 5.5 h/i.test(day1.why) && !/load|trend/i.test(day1.why), `plain why with his numbers: ${day1.why}`)
  assert.equal(readinessState([...base, ci(MON, bad), ci(MON + 1, bad)], MON + 1).state, 'RED', '2+ worse two days running: RED')
  assert.equal(readinessState([...base, ci(MON, { soreness: 4 }), ci(MON + 1, { soreness: 4 })], MON + 1).state, 'AMBER', 'the same item worse 2 days running: AMBER')
  assert.equal(readinessState([...base, ci(MON, { soreness: 4 })], MON).state, 'GREEN', 'one item off for one day: still GREEN (one bad night never cancels a session)')
  assert.equal(readinessState([...base, ci(MON, { sleepHours: 4.5, energy: 2 })], MON).state, 'RED', 'under 5 h with energy 2: RED')
  assert.equal(readinessState([...base, ci(MON, bad)], MON + 1).state, 'AMBER', 'no check-in, yesterday amber: AMBER carries')
  assert.equal(readinessState(base, MON, { notes: 'Feeling sick, sore throat' }).state, 'RED', 'a sick note: RED')
  assert.equal(readinessState([ci(MON, { sleepHours: 6, soreness: 4 })], MON).state, 'GREEN', 'no baseline yet: nothing reads as worse')
  assert.equal(lowerState('FRESH', 'AMBER'), 'AMBER')
}

// ─── Strength doses from the model ───────────────────────────
const strengthIn = (over: Partial<StrengthIn> = {}): StrengthIn => ({
  kind: 'block_zero',
  main: [{ exerciseId: 'ex-goblet-squat', label: 'Goblet Squat', reps: 8 }, { exerciseId: 'ex-bench-press', label: 'Bench Press', reps: 8 }],
  fighter: null, tmKg: {}, equipment: { 'ex-goblet-squat': 'dumbbell', 'ex-bench-press': 'barbell', 'ex-front-squat': 'barbell', 'ex-glute-bridges': 'none' },
  steppedThisWeek: [], lastFeltHard: null, ...over,
})
const ctxFor = (ev: ModelEvents, day: number, over: Partial<DoseCtx> = {}): DoseCtx => ({ day, state: 'GREEN', stateWhy: null, model: buildAthleteModel(ev, day), backToday: null, openPlans: [], ...over })
{
  // Day 1, nothing known: find your weight.
  const d = strengthDose(ctxFor(events(), MON), strengthIn())
  assert.ok(d.lifts.every(l => l.workUp && l.change === 'start' && l.sets === 4), 'day 1: work up in sets of 8')
  assert.ok(d.lifts.every(l => (l.setWeightsKg ?? []).every((w, i, a) => i === 0 || (w ?? 0) > (a[i - 1] ?? 0))), 'each work-up set a little heavier')
  assert.ok(/Find your weight/.test(d.lifts[0].note ?? ''), 'the note says how')
  assert.equal(d.holdSets, d.sets, 'the work-up is its own HOLD dose')
  assert.deepEqual(liftTargets(1), { rir: 4, sets: 2 })
  assert.deepEqual(liftTargets(0.15), { rir: 2, sets: 3 })
}
const lifted = (days: number[], w: number, rir: number, extra: Partial<{ planW: number; reps: number }> = {}) => {
  const sess = days.map(d => session(d, 'strength'))
  // The bench carries the case under test; the goblet squat sits at 1 left (so it never earns the front squat here).
  return { sessions: sess, sets: sess.flatMap(s => [...lift(s, 'ex-goblet-squat', [1, 2, 3].map(() => ({ w: 35, reps: 8, rir: 1 }))), ...lift(s, 'ex-bench-press', [1, 2, 3].map(() => ({ w, reps: extra.reps ?? 8, rir, planW: extra.planW })), 'barbell')]) }
}
{
  // Known and on target (RIR 2): HOLD at the weight he used; sets from u.
  const ev = events(lifted([MON - 21, MON - 14, MON - 7], 95, 2))
  const d = strengthDose(ctxFor(ev, MON), strengthIn())
  const sq = d.lifts[1]
  assert.equal(sq.workUp, false)
  assert.equal(sq.level, 'HOLD', 'RIR 2 on target: HOLD')
  assert.equal(lb(sq.weightKg), 95, 'HOLD: the weight he used')
  assert.equal(sq.sets, 3, 'KNOWN: 3 sets')
  assert.equal(d.lifts[0].level, 'EASE', '1 left on the last set: EASE')
}
{
  // 3+ left two sessions running: PROGRESS, one step up (upper body +2.5-5%, snapped to the next plate pair).
  const ev = events(lifted([MON - 21, MON - 14, MON - 7], 95, 3))
  const d = strengthDose(ctxFor(ev, MON), strengthIn())
  const sq = d.lifts[1]
  assert.equal(sq.level, 'PROGRESS')
  assert.ok(sq.change === 'increase' && lb(sq.weightKg)! > 95 && lb(sq.weightKg)! <= 100, `one step up: ${lb(sq.weightKg)} lb`)
  // One step a week per lift.
  const again = strengthDose(ctxFor(ev, MON), strengthIn({ steppedThisWeek: ['ex-bench-press'] }))
  assert.equal(again.lifts[1].level, 'HOLD', 'already stepped this week: HOLD')
  // Felt way over target last time, or sore next morning: at most HOLD.
  assert.equal(strengthDose(ctxFor(ev, MON), strengthIn({ lastFeltHard: 'Last time felt like a 9.' })).lifts[1].level, 'HOLD')
  // FRESH: PUSH (a step and a set).
  const fresh = strengthDose(ctxFor(ev, MON, { state: 'FRESH' }), strengthIn())
  assert.equal(fresh.lifts[1].level, 'PUSH')
  assert.equal(fresh.lifts[1].sets, 4, 'PUSH adds a set')
  // AMBER caps at HOLD and takes a set off; RED is one easy set.
  const amber = strengthDose(ctxFor(ev, MON, { state: 'AMBER', stateWhy: 'Sleep and energy off.' }), strengthIn())
  assert.ok(amber.lifts[1].level === 'HOLD' && amber.lifts[1].sets === 2, 'AMBER: HOLD, a set less')
  assert.ok(amber.why.includes('Sleep and energy off.'), 'the why names the morning')
  const red = strengthDose(ctxFor(ev, MON, { state: 'RED' }), strengthIn())
  assert.ok(red.lifts.every(l => l.level === 'RECOVER' && l.sets === 1) && red.accessorySets === 1, 'RED: one easy set each')
}
{
  // He lowered the weight mid-session: EASE, from the weight he used.
  const sess = [MON - 14, MON - 7].map(d => session(d, 'strength'))
  const sets = [...lift(sess[0], 'ex-goblet-squat', [{ w: 40, reps: 8, rir: 2 }, { w: 40, reps: 8, rir: 2 }]), ...lift(sess[1], 'ex-goblet-squat', [{ w: 35, reps: 8, rir: 1, planW: 40 }, { w: 35, reps: 8, rir: 1, planW: 40 }])]
  const m = buildAthleteModel(events({ sessions: sess, sets }), MON)
  assert.equal(liftSignal(m.lifts['ex-goblet-squat']).level, 'EASE')
  const d = strengthDose({ day: MON, state: 'GREEN', stateWhy: null, model: m, backToday: null, openPlans: [] }, strengthIn())
  assert.ok(lb(d.lifts[0].weightKg)! <= 35, 'starts from what he used')
  assert.ok(/lowered/.test(d.lifts[0].why ?? ''), `says why: ${d.lifts[0].why}`)
}
{
  // Short on reps while claiming 3+ left: his RIR bias, not a missed rep (HOLD).
  const ev = events(lifted([MON - 21, MON - 14, MON - 7], 95, 3, { reps: 7 }))
  const m = buildAthleteModel(ev, MON)
  assert.ok(m.lifts['ex-bench-press'].last?.claimedShort)
  assert.equal(liftSignal(m.lifts['ex-bench-press']).level, 'HOLD')
}
{
  // Fighter: TM × wave, no ramp at the block start; only time away trims a little.
  const fin = strengthIn({ kind: 'fighter', main: [{ exerciseId: 'ex-front-squat', label: 'Front Squat', reps: 5 }], fighter: { loadKg: { 'ex-front-squat': 75 }, sets: 5, reps: 5 } })
  const fresh = strengthDose(ctxFor(events(), MON), fin)
  assert.equal(fresh.lifts[0].weightKg != null && Math.abs(fresh.lifts[0].weightKg - 75) < 2.3, true, 'block start: TM × wave as planned')
  assert.equal(fresh.lifts[0].sets, 5, 'block start: every set')
  const s = session(MON - 35, 'strength', { blockType: 'fighter' })
  const back = strengthDose(ctxFor(events({ sessions: [s], sets: lift(s, 'ex-front-squat', [{ w: 165, reps: 5, rir: 2 }], 'barbell') }), MON), fin)
  assert.ok(back.lifts[0].weightKg! < 75 && back.lifts[0].weightKg! >= 75 * 0.8 && back.lifts[0].sets === 5, `5 weeks off: a little lighter, same sets (${back.lifts[0].weightKg})`)
}
{
  // The template the start route writes.
  const ev = events(lifted([MON - 21, MON - 14, MON - 7], 95, 2))
  const d = strengthDose(ctxFor(ev, MON), strengthIn())
  const t = templateFromDose({ exercises: [
    { exerciseId: 'ex-goblet-squat', label: 'Goblet Squat', section: 'main', sets: [{ isWarmup: false, targetReps: 8, restSec: 150 }, { isWarmup: false, targetReps: 8, restSec: 150 }] },
    { exerciseId: 'ex-bench-press', label: 'Bench', section: 'main', sets: [{ isWarmup: false, targetReps: 8, restSec: 150 }] },
    { exerciseId: 'ex-db-row', label: 'Row', section: 'accessory', sets: [{ isWarmup: false, targetReps: 10, restSec: 75 }, { isWarmup: false, targetReps: 10, restSec: 75 }] },
  ] }, d)
  assert.equal(t.exercises[1].sets.length, 3, 'main sets from the dose')
  assert.ok(t.exercises[1].sets.every(x => x.suggestedWeightKg === d.lifts[1].weightKg), 'each set at the dose weight')
  assert.equal(t.exercises[2].sets.length, 2, 'accessories as the template has them')
}

// ─── Earned progression (Josh's gym) ─────────────────────────
{
  const none = buildAthleteModel(events(), MON)
  assert.equal(chooseSlot('squat', none).exerciseId, 'ex-goblet-squat', 'start: goblet squat')
  assert.equal(chooseSlot('hinge', none).exerciseId, 'ex-db-rdl', 'start: DB RDL')
  const gs = [MON - 21, MON - 14, MON - 7].map(d => session(d, 'strength'))
  const ev = events({ sessions: gs, sets: gs.flatMap(x => lift(x, 'ex-goblet-squat', [1, 2, 3].map(() => ({ w: 35, reps: 8, rir: 2 })))), checkIns: steady(MON - 21, MON - 1) })
  const m = buildAthleteModel(ev, MON)
  const c = chooseSlot('squat', m)
  assert.equal(c.exerciseId, 'ex-front-squat', 'goblet KNOWN, 3 × 8 at 2 left, back 3: front squat')
  assert.ok(c.stepped && /3 × 8/.test(c.why ?? ''), 'says why')
  const sore = buildAthleteModel({ ...ev, checkIns: ev.checkIns.map(x => ({ ...x, backToday: 2 })) }, MON)
  assert.equal(chooseSlot('squat', sore).exerciseId, 'ex-goblet-squat', 'back averaging under 3: not yet')
  // Josh has no blocks: the block pull is from the rack's safety pins.
  const hinge = buildAthleteModel(events(), MON)
  hinge.lifts['ex-db-rdl'] = { ...m.lifts['ex-goblet-squat'], exerciseId: 'ex-db-rdl' }
  const h = chooseSlot('hinge', hinge)
  assert.equal(h.exerciseId, 'ex-block-pull')
  assert.ok(/safety pins at knee height/.test(h.note ?? ''), 'from the pins')
  const sensitive = { ...hinge, back: { ...hinge.back, profileSensitive: true, level: 3.2, last21Mean: 3.2 } }
  assert.ok(preferTrapBar(sensitive) && chooseSlot('hinge', sensitive).exerciseId === 'ex-trap-bar-deadlift', 'a sensitive back: the trap bar')
  assert.equal(backDaySwap('ex-front-squat', 2)?.exerciseId, 'ex-goblet-squat', 'back 2 today: the back-friendly version')
  assert.equal(backDaySwap('ex-front-squat', 3), null)
  assert.equal(ravenSwap('ex-reverse-lunge', [{ region: 'knee' }])?.exerciseId, 'ex-glute-bridges', 'a knee plan: no loaded knee work')
  assert.equal(ravenSwap('ex-bench-press', [{ region: 'knee' }]), null)
}

// ─── Run doses ───────────────────────────────────────────────
function runIn(over: Partial<RunIn> = {}): RunIn {
  return { kind: 'run_walk', longestLast30Sec: null, weekly: { lastWeekRunSec: 0, thisWeekSoFarSec: 0, sessionsLeftThisWeek: 3 }, hrCeilingBpm: 143, lastRunSec: null, riseThisWeek: false, ...over }
}
{
  const first = runDose(ctxFor(events(), MON), runIn())
  assert.equal(first.runSec, 60)
  assert.equal(first.rounds, 6, 'the first run-walk: 6 × 1:00 / 2:00')
  assert.equal(first.talkTestDue, true, 'and it asks the talk test')
  // Two easy runs under the line: one rung up, trimmed by u.
  const r1 = session(MON - 4, 'foundation_run')
  const r2 = session(MON - 2, 'foundation_run')
  const ev = events({ sessions: [r1, r2], runs: [run(r1), run(r2)], talkTests: [{ day: MON - 4, bpm: 150 }] })
  const up = runDose(ctxFor(ev, MON), runIn({ longestLast30Sec: 1400, lastRunSec: 360 }))
  assert.equal(up.level, 'PROGRESS')
  assert.equal(up.rungSec, 90, 'next rung: 1:30')
  assert.ok(up.runSec >= 60 && up.runSec <= 90, `piece trimmed by uncertainty: ${up.runSec}`)
  // Over the line: EASE, never more running than last time.
  const fast = session(MON - 2, 'foundation_run')
  const evFast = events({ sessions: [r1, fast], runs: [run(r1), run(fast, { avgHr: 158, maxHr: 170 })], talkTests: [{ day: MON - 4, bpm: 150 }] })
  const ease = runDose(ctxFor(evFast, MON), runIn({ longestLast30Sec: 1400, lastRunSec: 300 }))
  assert.equal(ease.level, 'EASE')
  assert.ok(ease.runTotalSec <= 300, 'never more running than last time after a struggle')
  assert.ok(ease.why.some(w => /over your line/.test(w)), 'says why')
  // Cut short for time: HOLD, not EASE.
  const cut = session(MON - 2, 'foundation_run')
  const evCut = events({ sessions: [r1, cut], runs: [run(r1), run(cut, { durationSec: 700, completionStatus: 'partial', shortReason: 'no_time' })], talkTests: [{ day: MON - 4, bpm: 150 }] })
  assert.equal(runDose(ctxFor(evCut, MON), runIn({ longestLast30Sec: 1400 })).level, 'HOLD', 'no time: HOLD')
  const evRough = events({ sessions: [r1, cut], runs: [run(r1), run(cut, { durationSec: 700, completionStatus: 'partial', shortReason: 'rough' })], talkTests: [{ day: MON - 4, bpm: 150 }] })
  assert.equal(runDose(ctxFor(evRough, MON), runIn({ longestLast30Sec: 1400 })).level, 'EASE', 'felt rough: EASE')
  // No HR at all: effort and finishing decide, with more caution.
  const noHr = session(MON - 2, 'foundation_run')
  const mNoHr = buildAthleteModel(events({ sessions: [noHr], runs: [run(noHr, { avgHr: null, maxHr: null })] }), MON)
  assert.equal(mNoHr.run.lastRunHadHr, false)
  // Readiness.
  const amber = runDose(ctxFor(ev, MON, { state: 'AMBER', stateWhy: 'Sleep off.' }), runIn({ longestLast30Sec: 1400 }))
  assert.ok(amber.level === 'HOLD' && amber.rounds < up.rounds, 'AMBER: hold the rung, a round fewer')
  const red = runDose(ctxFor(ev, MON, { state: 'RED', stateWhy: 'Two rough mornings.' }), runIn())
  assert.ok(red.walkOnly && red.level === 'RECOVER', 'RED: an easy walk')
  // At most one rise a week.
  const once = runDose(ctxFor(ev, MON), runIn({ longestLast30Sec: 1400, lastRunSec: 360, riseThisWeek: true }))
  assert.ok(once.runTotalSec <= 360, 'a run already went up this week: no second rise')
}

// ─── Bag ─────────────────────────────────────────────────────
{
  const first = bagDose(ctxFor(events(), MON), { maxRounds: 6 })
  assert.equal(first.rounds, 4, 'the first bag session: 4 technique rounds')
  assert.equal(first.finishers, false)
  const sess = [MON - 7, MON - 4, MON - 2].map(d => session(d, 'bag_work', { rpe: 5 }))
  const ev = events({ sessions: sess, bag: sess.map(s => ({ sessionId: s.id, day: s.day, status: 'completed', roundsPlanned: 5, roundsRated: null, roundsDone: 5, ratings: [], rpe: 5, skipReason: null })) })
  const d = bagDose(ctxFor(ev, MON), { maxRounds: 6 })
  assert.ok(d.rounds >= 4 && d.rounds <= 6, `rounds from tolerance × (1 − 0.3u): ${d.rounds}`)
  // Rounds he worked count even unrated; a "no time" end never lowers tolerance.
  const cutEv = events({ sessions: sess, bag: sess.map((s, i) => ({ sessionId: s.id, day: s.day, status: 'completed', roundsPlanned: 6, roundsRated: null, roundsDone: i === 2 ? 3 : 6, endReason: i === 2 ? 'no_time' : null, ratings: [], rpe: 5, skipReason: null })) })
  assert.ok((buildAthleteModel(cutEv, MON).bag.roundsTolerated ?? 0) >= 6, 'ended early for time: tolerance holds')
}

// ─── The week outline ────────────────────────────────────────
const os = (id: string, type: string, day: number, over: Partial<OutlineSession> = {}): OutlineSession => ({ id, type, label: type === 'strength' ? 'Strength A' : null, day, slot: 'am', status: 'planned', source: 'template', locked: false, ...over })
const bzWeek = (monday: number): OutlineSession[] => [
  os('a', 'strength', monday, { label: 'Strength A' }), os('r1', 'foundation_run', monday + 1),
  os('b', 'strength', monday + 2, { label: 'Strength B' }), os('r2', 'foundation_run', monday + 3),
  os('c', 'strength', monday + 4, { label: 'Strength C' }), os('r3', 'foundation_run', monday + 5),
]
const outlineIn = (over: Partial<OutlineIn> = {}): OutlineIn => ({
  today: MON + 7, monday: MON + 7, blockType: 'block_zero', blockStart: MON, sessions: bzWeek(MON + 7), classNights: [1, 3, 5], classCap: 3, classHeld: false,
  model: buildAthleteModel(events(), MON + 7), state: 'GREEN', restDue: null, ...over,
})
{
  assert.equal(violations(bzWeek(MON), 'block_zero', MON).length, 0, 'the template week keeps every limit')
  assert.equal(classTarget({ ...outlineIn(), monday: MON }), 0, 'no class in the block\'s first week')
  const r = solveOutline(outlineIn())
  const add = r.changes.find(c => c.kind === 'add')
  assert.ok(add && add.day === MON + 7 + 4, 'week 2: a class on Friday (Strength C, no heavy legs)')
  assert.ok(r.changes.length <= 2, 'at most 2 changes')
  assert.equal(r.violationsAfter.length, 0, 'every limit kept')
  assert.ok(add && /Friday/.test(add.why), `why names the night: ${add?.why}`)
  assert.equal(solveOutline(outlineIn({ classHeld: true })).changes.filter(c => c.kind === 'add').length, 0, 'a class he took off with UNDO is not offered again that week')
  assert.equal(solveOutline(outlineIn({ classPaused: true })).changes.filter(c => c.kind === 'add').length, 0, 'two suggested classes not done: the ladder steps down a week')
  // A class already there (his own or skipped for time) fills the week: nothing crammed.
  const skipped = solveOutline(outlineIn({ sessions: [...bzWeek(MON + 7), os('k', 'mt_class', MON + 9, { slot: 'pm', status: 'skipped', locked: true })] }))
  assert.equal(skipped.changes.filter(c => c.kind === 'add').length, 0, 'a skipped class is never made up')
  // His class on Wednesday night: Strength B (heavy legs) moves; his class stays where he put it.
  const his = solveOutline(outlineIn({ sessions: [...bzWeek(MON + 7), os('k', 'mt_class', MON + 9, { slot: 'pm', locked: true, source: 'ad_hoc' })] }))
  assert.equal(his.violationsBefore.length > 0 && his.violationsAfter.length, 0, `no heavy legs before his class after the pass (${his.violationsBefore})`)
  assert.ok(his.changes.every(c => c.kind !== 'move' || c.sessionId !== 'k'), 'his class is never moved')
  // Locked sessions never move.
  const locked = solveOutline(outlineIn({ sessions: bzWeek(MON + 7).map(s => ({ ...s, locked: true })) }))
  assert.ok(locked.changes.every(c => c.kind === 'add'), 'held or done sessions stay')
  // A second rest day when it is due.
  const rest = solveOutline(outlineIn({ restDue: 'Soreness 4 then 5. A rest day.' }))
  assert.ok(rest.changes.some(c => c.kind === 'rest' && c.day <= MON + 8), 'a rest day lands tomorrow-ish')
}

console.log('coach brain P2 tests passed')
