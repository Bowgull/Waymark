// Run: tsx src/lib/brain/brain.test.ts
// Coach brain P2, the rules-only brain, on made-up data: readiness states
// (§6.1), the per-modality doses and their levels (§5.2, §6.2), earned
// exercise progression, and the week outline (class nights, rest days, the
// limits, at most 2 changes).
import assert from 'node:assert/strict'
import { buildAthleteModel } from './athleteModel'
import { LONG_CAP_MIN, bagDose, capRunDose, liftSignal, liftTargets, nextContinuous, runDose, strengthDose, templateFromDose, type DoseCtx, type RunIn, type StrengthIn } from './doses'
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

  // Audit 2026-10-23 #3: a blank row (nothing answered) is not a check-in.
  const blank: ModelCheckIn = { day: MON, sleepHours: null, sleepQuality: null, energy: null, soreness: null, stress: null, mood: null, backToday: null }
  assert.equal(readinessState([...base, blank], MON).checkedIn, false, 'a blank row is not checked in')
  assert.equal(readinessState([...base, { ...blank, energy: 3 }], MON).checkedIn, true, 'one answer is a check-in')

  // Audit 2026-10-23 #4: plain AMBER floors before a baseline; RED stays.
  const sore5 = readinessState([ci(MON, { soreness: 5 })], MON)
  assert.equal(sore5.state, 'AMBER', 'no baseline, soreness 5: AMBER')
  assert.equal(sore5.why, 'Soreness 5.')
  assert.equal(readinessState([ci(MON, { stress: 5 })], MON).state, 'AMBER', 'no baseline, stress 5: AMBER')
  const short = readinessState([ci(MON, { sleepHours: 5.5, energy: 2 })], MON)
  assert.equal(short.state, 'AMBER', 'no baseline, under 6 h with energy 2: AMBER')
  assert.equal(short.why, 'Slept 5.5 h with energy 2.')
  assert.equal(readinessState([ci(MON, { sleepHours: 5.5, energy: 3 })], MON).state, 'GREEN', 'short sleep with energy 3: no floor')
  assert.equal(readinessState([ci(MON, { sleepHours: 4.5, energy: 2 })], MON).state, 'RED', 'the RED rule still holds with no baseline')
  assert.equal(readinessState([...steady(MON - 14, MON - 1).map(c => ({ ...c, soreness: 5 })), ci(MON, { soreness: 5 })], MON).state, 'GREEN', 'with a baseline the floor is not read (soreness 5 is his usual)')
  assert.equal(readinessState([ci(MON - 1, { soreness: 5 })], MON).state, 'AMBER', 'a floored yesterday carries to a day with no check-in')
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
  // One ease only (rebuild Phase 8): a lift already at EASE (1 left last time) on an AMBER morning is one set off, not two.
  const ev = events(lifted([MON - 21, MON - 14, MON - 7], 95, 2))
  const calm = strengthDose(ctxFor(ev, MON), strengthIn()).lifts[0]
  const both = strengthDose(ctxFor(ev, MON, { state: 'AMBER', stateWhy: 'Sleep off.' }), strengthIn()).lifts[0]
  assert.deepEqual([calm.level, both.level, both.sets], ['EASE', 'EASE', calm.sets], 'EASE and AMBER: the one set EASE takes, no second')
  const long = { kind: 'continuous' as const, plannedSec: 1800, longestLast30Sec: 3600, weekly: { lastWeekRunSec: 9000, thisWeekSoFarSec: 0, sessionsLeftThisWeek: 3 } }
  const eased = runDose(ctxFor(events(), MON, { levelCap: 'EASE' }), runIn(long))
  const run = runDose(ctxFor(events(), MON, { state: 'AMBER', levelCap: 'EASE' }), runIn(long))
  assert.deepEqual([eased.runSec, run.runSec], [1440, 1440], 'a continuous run: the EASE trim only (80%), not 80% and then 90%')
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
  // The block pull: blocks or the rack's pins (a full gym), whichever is there.
  const hinge = buildAthleteModel(events(), MON)
  hinge.lifts['ex-db-rdl'] = { ...m.lifts['ex-goblet-squat'], exerciseId: 'ex-db-rdl' }
  const h = chooseSlot('hinge', hinge)
  assert.equal(h.exerciseId, 'ex-block-pull')
  assert.ok(/blocks or the rack's pins/.test(h.note ?? ''), 'blocks or pins')
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
  // The reason is an optional tap: skipped, it is neutral (HOLD), never an ease.
  const evSkip = events({ sessions: [r1, cut], runs: [run(r1), run(cut, { durationSec: 700, completionStatus: 'partial', shortReason: null })], talkTests: [{ day: MON - 4, bpm: 150 }] })
  assert.equal(runDose(ctxFor(evSkip, MON), runIn({ longestLast30Sec: 1400 })).level, 'HOLD', 'no reason given: HOLD')
  // The starting line: his max HR when the profile has one, else his age.
  assert.equal(buildAthleteModel(events({ profile: { dob: '1990-06-01', maxHr: 190, backSensitive: false } }), MON).run.lineBpm, Math.round(0.78 * 190))
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

// ─── Rebuild Phase 3: graduation, catching up, the longer run, time off ─
{
  const tt = [{ day: MON - 20, bpm: 150 }]
  const z = (day: number, sec: number, over: Partial<ModelRun> = {}) => {
    const s = session(day, 'foundation_run', { rpe: 4 })
    return { s, r: run(s, { durationSec: sec, plannedDurationSec: sec, pieceSec: sec, rungSec: sec, avgHr: 140, ...over }) }
  }
  const ev = (xs: Array<{ s: ModelSession; r: ModelRun }>, extra: Partial<ModelEvents> = {}) => events({ sessions: xs.map(x => x.s), runs: xs.map(x => x.r), talkTests: tt, ...extra })
  // Graduation: two good runs at 4:00 pieces; the last run-walk ran 12+ min, so the first continuous run is 12 min.
  const rw = [z(MON - 9, 1500, { pieceSec: 240, rungSec: 240 }), z(MON - 2, 1500, { pieceSec: 240, rungSec: 240 })]
  const grad = runDose(ctxFor(ev(rw), MON), runIn({ longestLast30Sec: 1500, lastRunSec: 5 * 240 }))
  assert.deepEqual([grad.walkSec, grad.rounds, grad.runSec], [0, 1, 720], 'graduation: 12 min straight')
  assert.ok(grad.why[0].startsWith('12 minutes straight'), grad.why[0])
  assert.equal(runDose(ctxFor(ev(rw), MON), runIn({ longestLast30Sec: 1500, lastRunSec: 4 * 150 })).runSec, 600, 'a shorter run-walk: 10 min')
  // After time off the rung decays under 10 minutes: run-walk pieces again, and two good ones graduate him again.
  const off = [z(MON - 78, 1500), z(MON - 75, 1500)]
  const back = buildAthleteModel(ev(off), MON)
  assert.ok(back.run.rungSec < 600, `decayed to ${back.run.rungSec}`)
  const after = [...off, z(MON - 4, 1500, { pieceSec: 240, rungSec: 240 }), z(MON - 2, 1500, { pieceSec: 240, rungSec: 240 })]
  const again = runDose(ctxFor(ev(after), MON), runIn({ longestLast30Sec: 1500, lastRunSec: 5 * 240 }))
  assert.equal(again.walkSec, 0, 'never stuck under continuous running: the top rung graduates again')

  // Easy runs grow at least 2 minutes a rise.
  assert.equal(nextContinuous(720), 840)
  // Catching up: easy runs well under a 30-minute hard run grow by a quarter at a time, even twice in a week.
  const t = session(MON - 3, 'running', { rpe: 6, notes: 'tempo' })
  const hard = { s: t, r: run(t, { durationSec: 1800, plannedDurationSec: 1800, pieceSec: null, hard: 'tempo' as const, hardTop: 167 }) }
  const easy2 = [z(MON - 5, 960), hard, z(MON - 1, 960)]
  const cu = runDose(ctxFor(ev(easy2), MON), runIn({ longestLast30Sec: 1800, lastRunSec: 960, riseThisWeek: true, weekly: { lastWeekRunSec: 6000, thisWeekSoFarSec: 0, sessionsLeftThisWeek: 2 } }))
  assert.equal(cu.level, 'PROGRESS')
  assert.equal(cu.runSec, 1200, '16 min to 20: a quarter more, the weekly rise limit not read')
  // Never past the runs he already does.
  const near = [z(MON - 5, 1680), hard, z(MON - 1, 1680)]
  assert.equal(buildAthleteModel(ev(near), MON).run.catchUpSec, 1800)
  const cu2 = runDose(ctxFor(ev(near), MON), runIn({ longestLast30Sec: 1800, lastRunSec: 1680, weekly: { lastWeekRunSec: 8000, thisWeekSoFarSec: 0, sessionsLeftThisWeek: 2 } }))
  assert.deepEqual([cu2.level, cu2.runSec], ['HOLD', 1680], 'its next step would pass them: back to one rise a week (it rose 5 days ago)')
  // The hard run between two easy runs doesn't read as a struggle: the easy run still grows.
  assert.equal(runDose(ctxFor(ev(easy2), MON), runIn({ longestLast30Sec: 1800, weekly: { lastWeekRunSec: 6000, thisWeekSoFarSec: 0, sessionsLeftThisWeek: 2 } })).level, 'PROGRESS')

  // The longer Zone 2 Run: 5 min over the easy run; 5 more after two good ones; past an hour, about 75 min with its warm-up at most.
  const base = [z(MON - 9, 1500), z(MON - 5, 1500)]
  const wk = { lastWeekRunSec: 9000, thisWeekSoFarSec: 0, sessionsLeftThisWeek: 1 }
  const first = runDose(ctxFor(ev(base), MON), runIn({ longestLast30Sec: 2400, weekly: wk, long: null }))
  assert.ok(first.long && first.runSec >= 1500 + 300, `first longer run: ${first.runSec}`)
  assert.ok(first.why.some(w => /longer run this week/.test(w)))
  const step = runDose(ctxFor(ev(base), MON), runIn({ longestLast30Sec: 3000, weekly: wk, long: { lastSec: 2700, goodInRow: 2 } }))
  assert.equal(step.runSec, 3000, 'two good ones at 45 min: 50 min')
  assert.ok(step.why.some(w => /5 minutes more after two good ones/.test(w)))
  assert.equal(runDose(ctxFor(ev(base), MON), runIn({ longestLast30Sec: 3000, weekly: wk, long: { lastSec: 2700, goodInRow: 1 } })).runSec, 2700, 'one good one: held')
  assert.equal(runDose(ctxFor(ev(base), MON), runIn({ longestLast30Sec: 3000, weekly: wk, long: { lastSec: 2700, goodInRow: 0 } })).runSec, 2400, 'a rough one: 5 min less')
  assert.equal(runDose(ctxFor(ev(base), MON), runIn({ longestLast30Sec: 4000, weekly: { ...wk, lastWeekRunSec: 20000 }, long: { lastSec: 3600, goodInRow: 2 } })).runSec, 3900, 'past an hour, 5 min at a time (2026-10-26)')
  assert.equal(runDose(ctxFor(ev(base), MON), runIn({ longestLast30Sec: 6000, weekly: { ...wk, lastWeekRunSec: 30000 }, long: { lastSec: 4500, goodInRow: 2 } })).runSec, 4500, 'never over 75 min')
  // The 110% guard binds it like every run.
  assert.equal(runDose(ctxFor(ev(base), MON), runIn({ longestLast30Sec: 2000, weekly: wk, long: { lastSec: 2700, goodInRow: 2 } })).runSec, 2160, '110% of 33 min')
  // The cap with the warm-up (capRunDose): the longer run's is 75 minutes, every other run's 60.
  const top = runDose(ctxFor(ev(base), MON), runIn({ longestLast30Sec: 6000, weekly: { ...wk, lastWeekRunSec: 30000 }, long: { lastSec: 4500, goodInRow: 2 } }))
  assert.equal(capRunDose(top, 300, LONG_CAP_MIN).runSec, 4200, '75 min with a 5 min warm-up: 70 min of running')
  assert.equal(capRunDose(top, 300).runSec, 3300, 'the 60-minute cap for any other run')
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
  // Rebuild Phase 2: two lifts (C's lunges count as heavy legs, so Friday holds an easy run instead).
  os('c', 'foundation_run', monday + 4), os('r3', 'foundation_run', monday + 5),
]
const outlineIn = (over: Partial<OutlineIn> = {}): OutlineIn => ({
  today: MON + 7, monday: MON + 7, blockType: 'block_zero', blockStart: MON, sessions: bzWeek(MON + 7), classDays: [1, 3, 5], classCap: 3, classHeld: false,
  model: buildAthleteModel(events(), MON + 7), state: 'GREEN', restDue: null, ...over,
})
{
  assert.equal(violations(bzWeek(MON), 'block_zero', MON).length, 0, 'the template week keeps every limit')
  // A missed Monday is not the week's rest day: a session on every other day breaks the rest rule (rebuild Phase 3 fix).
  const full = [os('m', 'strength', MON, { status: 'missed' }), ...[1, 2, 3, 4, 5, 6].map(i => os(`r${i}`, 'foundation_run', MON + i))]
  assert.ok(violations(full, 'block_zero', MON).includes('no rest day'), 'no planned rest day')
  assert.ok(!violations(full.slice(0, 6), 'block_zero', MON).includes('no rest day'), 'Sunday free: rest kept')
  assert.equal(classTarget({ ...outlineIn(), monday: MON }), 0, 'no class in the block\'s first week')
  const r = solveOutline(outlineIn())
  const add = r.changes.find(c => c.kind === 'add')
  assert.ok(add && add.day === MON + 7 + 4, 'week 2: a class on Friday (no heavy legs there)')
  assert.ok(r.changes.length <= 2, 'at most 2 changes')
  assert.equal(r.violationsAfter.length, 0, 'every limit kept')
  assert.ok(add && /Friday/.test(add.why), `why names the day: ${add?.why}`)
  assert.ok(add && add.slot === 'pm' && !/night/i.test(add.why), `a weekday class in the evening, and never called a night: ${add?.why}`)
  assert.equal(solveOutline(outlineIn({ classHeld: true })).changes.filter(c => c.kind === 'add').length, 0, 'a class he took off with UNDO is not offered again that week')
  assert.equal(solveOutline(outlineIn({ ladder: { level: 1, paused: true, avoidDays: [], step: null } })).changes.filter(c => c.kind === 'add').length, 0, 'two suggested classes not done: the ladder steps down a week')
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
  // No class days set: the coach suggests one, never on a heavy-legs day.
  const open = solveOutline(outlineIn({ classDays: [0, 1, 2, 3, 4, 5, 6], classDaysSet: false })).changes.find(c => c.kind === 'add')
  assert.ok(open && ![MON + 7, MON + 9].includes(open.day), `no days set: a day that fits (${open?.day})`)
  assert.ok(open && /No class days set/.test(open.why), open?.why)
  // A second rest day when it is due.
  const rest = solveOutline(outlineIn({ restDue: 'Soreness 4 then 5. A rest day.' }))
  assert.ok(rest.changes.some(c => c.kind === 'rest' && c.day <= MON + 8), 'a rest day lands tomorrow-ish')
}

console.log('coach brain P2 tests passed')
