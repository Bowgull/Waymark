// Run: tsx src/lib/brain/strengthProgress.test.ts
// Rebuild Phase 4, strength that progresses (strength.md A1-A4), on made-up
// data: an easy "3+" steps up at once (a big step on a new lift), the
// find-your-weight ladder climbs in rungs and keeps going on the set screen,
// no weight under what he just lifted on target, a steadily rising lift stays
// known, a decision's cap at the rules' own level doesn't drag other lifts
// down, and a harder version starts from the easier one's estimate.
import assert from 'node:assert/strict'
import { buildAthleteModel, trendLine } from './athleteModel'
import { accessoryLift, liftSignal, onTarget, stepUpKg, strengthDose, type DoseCtx, type StrengthIn } from './doses'
import { awaySwap, startFromEasier } from './progression'
import { ladderRungKg } from '../strengthLoads'
import type { ModelEvents, ModelSession, ModelSet } from './types'

const LB = 0.45359237
const MON = 20822 // Monday 2027-01-04
const lb = (kg: number | null | undefined) => (kg == null ? null : Math.round(kg / LB))

function events(over: Partial<ModelEvents> = {}): ModelEvents {
  return {
    profile: { dob: '1985-01-01', maxHr: null, backSensitive: false },
    sessions: [], sets: [], runs: [], talkTests: [], bag: [], checkIns: [], notes: [], moves: [], classLogs: [], trainingMaxes: [], openBodyAlerts: [],
    ...over,
  }
}
let sid = 0
const session = (day: number): ModelSession => ({ id: `s${++sid}`, type: 'strength', status: 'completed', day, slot: 'am', startMin: 400, durationSec: 2700, rpe: 7, skipReason: null, source: 'template', blockType: 'block_zero', notes: null })
function lift(s: ModelSession, exerciseId: string, sets: Array<{ w: number; rir: number | null; planW?: number; reps?: number }>, equipment: ModelSet['equipment'] = 'barbell'): ModelSet[] {
  return sets.map((x, i) => ({
    sessionId: s.id, day: s.day, exerciseId, section: 'main', setNumber: i + 1, weightKg: x.w * LB, reps: x.reps ?? 8,
    plannedWeightKg: (x.planW ?? x.w) * LB, plannedReps: 8, rir: x.rir, isWarmup: false, logged: true, equipment,
  }))
}
const strengthIn = (over: Partial<StrengthIn> = {}): StrengthIn => ({
  kind: 'block_zero',
  main: [{ exerciseId: 'ex-bench-press', label: 'Bench Press', reps: 8 }, { exerciseId: 'ex-goblet-squat', label: 'Goblet Squat', reps: 8 }],
  fighter: null, tmKg: {}, equipment: { 'ex-bench-press': 'barbell', 'ex-goblet-squat': 'dumbbell', 'ex-front-squat': 'barbell' },
  steppedThisWeek: [], lastFeltHard: null, ...over,
})
const ctxFor = (ev: ModelEvents, day: number, over: Partial<DoseCtx> = {}): DoseCtx => ({ day, state: 'GREEN', stateWhy: null, model: buildAthleteModel(ev, day), backToday: null, openPlans: [], ...over })

// ─── An easy "3+" steps up at once ───────────────────────────
{
  // One session, every set 3+: a new lift, so the big step (upper +5%).
  const s = session(MON - 7)
  const ev = events({ sessions: [s], sets: lift(s, 'ex-bench-press', [{ w: 95, rir: 3 }, { w: 95, rir: 3 }, { w: 95, rir: 3 }]) })
  const sig = liftSignal(buildAthleteModel(ev, MON).lifts['ex-bench-press'])
  assert.deepEqual([sig.level, sig.large], ['PROGRESS', true], 'one easy session is enough; a new lift takes the big step')
  const d = strengthDose(ctxFor(ev, MON), strengthIn()).lifts[0]
  assert.deepEqual([d.level, d.change, lb(d.weightKg)], ['PROGRESS', 'increase', 100], '95 → 100 lb (5%, the nearest plate pair)')
  assert.ok(/3\+ left/.test(d.why ?? ''), `says why: ${d.why}`)
  assert.equal(lb(stepUpKg(95 * LB, 'ex-front-squat', 'barbell', true)), 105, 'a lower-body big step: +10%')
  assert.equal(lb(stepUpKg(60 * LB, 'ex-goblet-squat', 'dumbbell', true)), 65, 'a 5 lb dumbbell jump is already big: the nearest, not two jumps')
}
{
  // Known lift, last set 3+ but an earlier set at 2: the normal step.
  const days = [MON - 21, MON - 14, MON - 7].map(session)
  const sets = days.flatMap(s => lift(s, 'ex-bench-press', [{ w: 95, rir: 2 }, { w: 95, rir: 2 }, { w: 95, rir: s === days[2] ? 3 : 2 }]))
  const m = buildAthleteModel(events({ sessions: days, sets }), MON)
  assert.equal(m.lifts['ex-bench-press'].state, 'KNOWN')
  const sig = liftSignal(m.lifts['ex-bench-press'])
  assert.deepEqual([sig.level, sig.large], ['PROGRESS', false], 'known, one set at 2: one normal step')
}

// ─── No drop after a session on target ───────────────────────
{
  // Stepped to 100 and hit it at 2 left: the next weight is never under 100, whatever the smoothed e1RM says.
  const days = [MON - 21, MON - 14, MON - 7].map(session)
  const sets = [
    ...lift(days[0], 'ex-bench-press', [{ w: 90, rir: 3 }, { w: 90, rir: 3 }]),
    ...lift(days[1], 'ex-bench-press', [{ w: 95, rir: 3 }, { w: 95, rir: 3 }]),
    ...lift(days[2], 'ex-bench-press', [{ w: 100, rir: 2 }, { w: 100, rir: 2 }, { w: 100, rir: 2 }]),
  ]
  const ev = events({ sessions: days, sets })
  const m = buildAthleteModel(ev, MON)
  assert.ok(onTarget(m.lifts['ex-bench-press'].last))
  const d = strengthDose(ctxFor(ev, MON), strengthIn()).lifts[0]
  assert.equal(d.level, 'HOLD')
  assert.ok(lb(d.weightKg)! >= 100, `on target at 100: holds at 100 or more (${lb(d.weightKg)})`)
  assert.notEqual(d.change, 'decrease')
}
{
  // He took the set screen's step after a 3+ (plan 95, then 100 at 1 left): the plan was easy, the step hard.
  const s = session(MON - 7)
  const ev = events({ sessions: [s], sets: lift(s, 'ex-bench-press', [{ w: 95, rir: 3 }, { w: 100, rir: 2, planW: 95 }, { w: 100, rir: 1, planW: 95 }]) })
  const m = buildAthleteModel(ev, MON)
  assert.equal(m.lifts['ex-bench-press'].last?.raised, true)
  assert.equal(liftSignal(m.lifts['ex-bench-press']).level, 'HOLD', 'information, not an ease')
  assert.ok(lb(strengthDose(ctxFor(ev, MON), strengthIn()).lifts[0].weightKg)! >= 95, 'never under the plan he beat')
}

// ─── Known by the trend, not by flat numbers ─────────────────
{
  const f = trendLine([{ day: 0, e1rm: 100 }, { day: 7, e1rm: 103 }, { day: 14, e1rm: 106 }])
  assert.equal(Math.round(f(21)), 109, 'the line goes on')
  // A steadily rising lift: about 3% a week stays KNOWN (it was flipping back to LEARNING).
  const days = [MON - 21, MON - 14, MON - 7].map(session)
  const sets = days.flatMap((s, i) => lift(s, 'ex-bench-press', [1, 2, 3].map(() => ({ w: [90, 95, 100][i], rir: 2 }))))
  assert.equal(buildAthleteModel(events({ sessions: days, sets }), MON).lifts['ex-bench-press'].state, 'KNOWN', 'rising 5 lb a week: still known')
}

// ─── A decision's cap at the rules' own level ────────────────
{
  // The goblet squat eases (1 left); the bench is on target. The decision agrees at the session's EASE:
  // the bench keeps its own HOLD, its sets and weight.
  const days = [MON - 21, MON - 14, MON - 7].map(session)
  const sets = days.flatMap(s => [...lift(s, 'ex-bench-press', [1, 2, 3].map(() => ({ w: 95, rir: 2 }))), ...lift(s, 'ex-goblet-squat', [1, 2, 3].map(() => ({ w: 40, rir: 1 })), 'dumbbell')])
  const ev = events({ sessions: days, sets })
  const rules = strengthDose(ctxFor(ev, MON), strengthIn())
  assert.equal(rules.level, 'EASE')
  const agreed = strengthDose(ctxFor(ev, MON, { levelCap: 'EASE' }), strengthIn())
  assert.deepEqual([agreed.lifts[0].level, agreed.lifts[0].sets, lb(agreed.lifts[0].weightKg)], [rules.lifts[0].level, rules.lifts[0].sets, lb(rules.lifts[0].weightKg)], 'the bench is not eased by the squat')
  assert.equal(strengthDose(ctxFor(ev, MON, { levelCap: 'RECOVER' }), strengthIn()).lifts[0].level, 'RECOVER', 'a cap under the rules still caps every lift')
}

// ─── The ladder: rungs, and the harder version's start ───────
{
  assert.equal(lb(ladderRungKg(45 * LB, 'barbell', 'upper')), 55, 'bench rung: 10 lb')
  assert.equal(lb(ladderRungKg(45 * LB, 'barbell', 'lower')), 65, 'a lower-body bar: 20 lb')
  assert.equal(lb(ladderRungKg(300 * LB, 'barbell', 'lower')), 330, 'heavy: the 10% step is bigger than the jump')
  // Day 1: a 4-rung ladder from the bar.
  const d = strengthDose(ctxFor(events(), MON), strengthIn()).lifts[0]
  assert.deepEqual(d.setWeightsKg?.map(lb), [45, 55, 65, 75], 'the bench ladder')
  assert.ok(/heavier each set while it feels easy/.test(d.note ?? '') && /about 3 left/.test(d.note ?? ''), `the note: ${d.note}`)
  // Goblet squat known at 50 lb x 8 @ 2: the front squat starts from it (1.5x, 70%), not the empty bar.
  const days = [MON - 21, MON - 14, MON - 7].map(session)
  const ev = events({ sessions: days, sets: days.flatMap(s => lift(s, 'ex-goblet-squat', [1, 2, 3].map(() => ({ w: 50, rir: 2 })), 'dumbbell')) })
  const m = buildAthleteModel(ev, MON)
  assert.equal(Math.round(startFromEasier('squat', 'ex-front-squat', m)! / LB), 75, 'about 75 lb of front squat for 8 at 2 left')
  assert.equal(startFromEasier('squat', 'ex-goblet-squat', m), null, 'the easy one has nothing to start from')
  const fs = strengthDose(ctxFor(ev, MON), strengthIn({ main: [{ exerciseId: 'ex-goblet-squat', label: 'Goblet Squat', reps: 8 }] })).lifts[0]
  assert.equal(fs.exerciseId, 'ex-front-squat', 'earned the front squat')
  assert.ok(fs.workUp && lb(fs.setWeightsKg?.[0])! >= 45 && lb(fs.setWeightsKg?.[0])! <= 55, `starts near 70% of it: ${fs.setWeightsKg?.map(lb)}`)
  assert.ok(/starts from your goblet squat/.test(fs.why ?? ''), `says so: ${fs.why}`)
}
{
  // A climb he stopped (stayed at 75 under the 85 rung) is not "lowered".
  const s = session(MON - 7)
  const ev = events({ sessions: [s], sets: lift(s, 'ex-bench-press', [{ w: 45, rir: 3 }, { w: 55, rir: 3 }, { w: 65, rir: 2 }, { w: 65, rir: 2, planW: 75 }]) })
  const last = buildAthleteModel(ev, MON).lifts['ex-bench-press'].last
  assert.equal(last?.lowered, false, 'stopping the climb is what the note asks')
  const back = events({ sessions: [s], sets: lift(s, 'ex-bench-press', [{ w: 45, rir: 3 }, { w: 55, rir: 3 }, { w: 45, rir: 1, planW: 65 }]) })
  assert.equal(buildAthleteModel(back, MON).lifts['ex-bench-press'].last?.lowered, true, 'going back down a climb is lowering')
}

{
  // Rebuild Phase 8: away, per his note, the main lifts take a bodyweight or band version (the rules read it, not only the AI).
  assert.equal(awaySwap('ex-bench-press', false), null, 'at home: no swap')
  assert.deepEqual(['ex-goblet-squat', 'ex-db-rdl', 'ex-db-row', 'ex-bench-press', 'ex-landmine-press', 'ex-lm-reverse-lunge', 'ex-lm-punch'].map(id => awaySwap(id, true)?.exerciseId),
    ['ex-tempo-squat', 'ex-single-leg-rdl', 'ex-band-row', 'ex-push-up', 'ex-pike-push-up', 'ex-reverse-lunge', 'ex-pike-push-up'])
  const main = [{ exerciseId: 'ex-lm-punch', label: 'Landmine Punch', reps: 4 }, { exerciseId: 'ex-bench-press', label: 'Bench Press', reps: 8 }, { exerciseId: 'ex-landmine-press', label: 'Landmine Press', reps: 8 }]
  const equipment = { 'ex-bench-press': 'barbell', 'ex-push-up': 'bodyweight', 'ex-pike-push-up': 'bodyweight' } as const
  const d = strengthDose(ctxFor(events(), MON, { away: true }), strengthIn({ main, equipment, bodyweightIds: ['ex-push-up', 'ex-pike-push-up'] }))
  assert.deepEqual(d.lifts.map(l => l.exerciseId), ['ex-pike-push-up', 'ex-push-up', 'ex-pike-push-up'], 'no landmine, no bench: the hotel-room versions')
  assert.ok(d.lifts.every(l => l.weightKg == null), `no weights on bodyweight moves: ${d.lifts.map(l => l.weightKg)}`)
  assert.ok(/Away, per your note/.test(d.lifts[1].why ?? ''), d.lifts[1].why ?? '')
}

{
  // Pulling twice a week (2026-10-26): B's arm-block row starts at the weight he rows on A, not a light ladder.
  const s = session(MON - 3)
  const ev = events({ sessions: [s], sets: lift(s, 'ex-db-row', [{ w: 30, rir: 2, reps: 10 }, { w: 30, rir: 2, reps: 10 }], 'dumbbell') })
  const row = accessoryLift(ctxFor(ev, MON), strengthIn({ equipment: { 'ex-db-row': 'dumbbell' } }), { exerciseId: 'ex-db-row', label: 'Dumbbell Row', section: 'accessory', sets: 3, reps: 10 }, 'PROGRESS', null)
  assert.deepEqual([lb(row?.weightKg), row?.workUp, row?.sets], [30, false, 3], 'the weight from A, 3 straight sets')
  const fresh = accessoryLift(ctxFor(events(), MON), strengthIn({ equipment: { 'ex-db-row': 'dumbbell' } }), { exerciseId: 'ex-db-row', label: 'Dumbbell Row', section: 'accessory', sets: 3, reps: 10 }, 'PROGRESS', null)
  assert.equal(fresh?.workUp, true, 'never rowed: find the weight from light')
}

console.log('strength progress tests passed')
