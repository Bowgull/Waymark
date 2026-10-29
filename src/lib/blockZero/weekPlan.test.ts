// Run: tsx src/lib/blockZero/weekPlan.test.ts
import { getBlockZeroWeekTemplate, strengthBeforeRunning, strengthDayFor } from './weekPlan'
import { blockZeroPhase, blockZeroTrainingWeek, extensionsUsed } from './weeks'
import { getDayTemplate, strengthBlockWeek, WEEKLY_TEMPLATE } from '../weeklyTemplate'
import { getStrengthTemplate, getWaveLoadingSetsReps, getWeekPercentage } from '../strengthTemplates'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
  console.log(`ok: ${msg}`)
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
const typesOf = (week: number) => ALL_DAYS.flatMap(d => getBlockZeroWeekTemplate(week)[d].map(s => s.type))

// ─── Week numbering (bug 1b) ────────────────────────────────────

assert([1, 2, 3, 4, 5, 6].every(w => blockZeroTrainingWeek(w) === w), 'weeks 1-6 map to themselves')
assert(blockZeroTrainingWeek(7) === 5 && blockZeroTrainingWeek(8) === 5, 'extension weeks 7-8 repeat week 5')
assert(blockZeroTrainingWeek(13) === 5, 'never wraps to week 1, even far past the end')
assert(blockZeroTrainingWeek(0) === 1 && blockZeroTrainingWeek(NaN) === 1, 'bad input clamps to week 1')
assert(blockZeroPhase(1) === 'test' && blockZeroPhase(3) === 'build' && blockZeroPhase(6) === 'consolidate' && blockZeroPhase(7) === 'extension', 'phases')
assert(extensionsUsed(6) === 0 && extensionsUsed(7) === 1 && extensionsUsed(8) === 2 && extensionsUsed(12) === 2, 'extensions used from totalWeeks, capped at 2')

assert(strengthBlockWeek('block_zero', 7) === 5, 'Block Zero strength week 7 stamps week 5')
assert(strengthBlockWeek('block_zero', 8) === 5, 'Block Zero strength week 8 stamps week 5')
assert(strengthBlockWeek('fighter', 7) === 1 && strengthBlockWeek('fighter', 12) === 6, 'Fighter wave still cycles every 6 weeks')

assert(getWeekPercentage(7, 'block_zero') === getWeekPercentage(5, 'block_zero'), 'week 7 load % equals week 5')
assert(getWeekPercentage(7, 'block_zero') > getWeekPercentage(1, 'block_zero'), 'week 7 load % is above week 1')
assert(JSON.stringify(getWaveLoadingSetsReps(7, 'block_zero')) === JSON.stringify(getWaveLoadingSetsReps(5, 'block_zero')), 'week 7 sets x reps equal week 5')
assert(getWeekPercentage(7, 'fighter') === getWeekPercentage(1, 'fighter'), 'Fighter percentages unchanged (week 7 = wave week 1)')

// ─── Week shape ─────────────────────────────────────────────────

for (const w of [1, 2, 3, 4, 5, 6, 7, 8]) {
  const types = typesOf(w)
  assert(!types.includes('mt_class'), `week ${w}: no MT class scheduled`)
  assert(types.filter(t => t === 'strength').length === 3, `week ${w}: 3 strength days`)
  // Page 76: weeks 1-3 every run easy; from week 4 Tuesday is tempo and Saturday intervals.
  if (w < 4) assert(types.filter(t => t === 'foundation_run').length === 3, `week ${w}: 3 run-walk days`)
  else {
    const tpl = getBlockZeroWeekTemplate(w)
    assert(types.filter(t => t === 'foundation_run').length === 1 && types.filter(t => t === 'running').length === 2, `week ${w}: one easy run, two hard runs`)
    // The 5K test has no slot: the coach places it when he is ready (lib/brain/hardRuns.ts testReady).
    assert(tpl[2][1].runCategory === 'tempo' && tpl[6][1].runCategory === 'intervals' && tpl[4][1].type === 'foundation_run', `week ${w}: Tuesday tempo, Thursday easy, Saturday intervals`)
  }
  assert(ALL_DAYS.every(d => getBlockZeroWeekTemplate(w)[d].some(s => s.type === 'mobility' && s.label === 'Foundation')), `week ${w}: Foundation every day`)
  assert(ALL_DAYS.every(d => strengthBeforeRunning(getBlockZeroWeekTemplate(w)[d])), `week ${w}: strength before running on shared days`)
  const trainingDays = ALL_DAYS.filter(d => getBlockZeroWeekTemplate(w)[d].some(s => s.type !== 'mobility'))
  assert(trainingDays.length === 6, `week ${w}: 6 training days, 1 rest day`)
  const dayMinutes = ALL_DAYS.map(d => getBlockZeroWeekTemplate(w)[d].reduce((m, s) => m + s.estimatedMin, 0))
  assert(Math.max(...dayMinutes) <= 90, `week ${w}: no day over 90 min`)
}
assert([1, 3, 6, 7].every(w => !typesOf(w).includes('skip_rope')), 'no rope session in any week (the fixed-effort test is gone); rope stays a run swap')
assert([1, 6].every(w => getBlockZeroWeekTemplate(w)[1].map(s => s.type).join(',') === 'mobility,strength'), 'test weeks: Monday is Foundation and Strength A only')
assert(getBlockZeroWeekTemplate(2)[2][1].alternativeType === 'skip_rope' && getBlockZeroWeekTemplate(2)[4][1].alternativeType === 'skip_rope', 'runs the day after A and B allow rope instead')
assert(getBlockZeroWeekTemplate(2)[6][1].alternativeType === undefined, 'Saturday run has no swap')
assert(strengthBeforeRunning([{ timeSlot: 'am', type: 'foundation_run', label: 'r', estimatedMin: 20 }, { timeSlot: 'am', type: 'strength', label: 's', estimatedMin: 60 }]) === false, 'run before strength is caught')

assert(strengthDayFor(1) === 'A' && strengthDayFor(3) === 'B' && strengthDayFor(5) === 'C', 'Mon/Wed/Fri map to A/B/C')
assert(strengthDayFor(1, 'Strength C') === 'C', 'stored label wins over the day')
assert(strengthDayFor(2) === 'B' && strengthDayFor(0) === 'A' && strengthDayFor(6) === 'C', 'off-template days map to a slot')

// ─── Shared day template (bug 1a) ───────────────────────────────

const mtDays = new Set([1, 3, 5])
for (const w of [1, 3, 6, 7]) {
  for (const d of ALL_DAYS) {
    const day = getDayTemplate('block_zero', w, d, mtDays)
    assert(day.every(s => s.type !== 'mt_class'), `block_zero week ${w} day ${d}: no MT even on class days`)
  }
}
assert(JSON.stringify(getDayTemplate('block_zero', 2, 1, mtDays)) === JSON.stringify(getBlockZeroWeekTemplate(2)[1]), 'block_zero day template comes from the week plan')
assert(getDayTemplate('fighter', 1, 1, mtDays).some(s => s.type === 'mt_class'), 'Fighter Monday keeps MT on a class day')
assert(!getDayTemplate('fighter', 1, 1, new Set()).some(s => s.type === 'mt_class'), 'Fighter drops MT off class days')
assert(getDayTemplate('fighter', 1, 2, mtDays).length === WEEKLY_TEMPLATE[2].length, 'Fighter non-MT day unchanged')

// ─── Strength templates for Block Zero ──────────────────────────

const a1 = getStrengthTemplate(1, 1, 'block_zero')
const a3 = getStrengthTemplate(1, 3, 'block_zero')
const b1 = getStrengthTemplate(3, 1, 'block_zero')
const c1 = getStrengthTemplate(5, 1, 'block_zero')
const c7 = getStrengthTemplate(5, 7, 'block_zero')
const c5 = getStrengthTemplate(5, 5, 'block_zero')
assert(a1.id === 'strength_a' && b1.id === 'strength_b' && c1.id === 'strength_c', 'A/B/C templates by day')
assert(getStrengthTemplate(4, 2, 'block_zero', 'Strength A').id === 'strength_a', 'label picks the template on a moved day')
assert(a1.exercises.some(e => e.exerciseId === 'ex-goblet-squat' && e.section === 'main'), 'week 1 squat is goblet (back-friendly first)')
assert(a3.exercises.some(e => e.exerciseId === 'ex-front-squat' && e.section === 'main'), 'week 3 squat is front squat')
assert(b1.exercises.some(e => e.exerciseId === 'ex-db-rdl' && e.section === 'main'), 'week 1 hinge is DB RDL')
// Rebuild Phase 4 (page 93): A and B are the two lifts. The dose sets the sets and weights, so the
// stale week-3 / week-6 check-set notes and week-6 cut are gone from them (Strength C keeps its own).
const mainOf = (t: typeof a1) => t.exercises.filter(e => e.section === 'main').map(e => e.exerciseId)
assert(JSON.stringify(mainOf(a1)) === JSON.stringify(['ex-goblet-squat', 'ex-landmine-press', 'ex-db-row']), `Strength A: squat, the press, the row (${mainOf(a1)})`)
assert(JSON.stringify(mainOf(b1)) === JSON.stringify(['ex-lm-punch', 'ex-db-rdl', 'ex-bench-press', 'ex-lm-reverse-lunge']), `Strength B: the punch, the hinge, the bench, the lunge (${mainOf(b1)})`)
assert([a1, b1].every(t => t.exercises.some(e => /row/.test(e.exerciseId))), 'pulling twice a week: a row on A and on B (2026-10-26)')
assert(!a1.exercises.concat(b1.exercises).some(e => /RPE|check/i.test(e.notes ?? '')), 'no stale week targets in the notes')
assert(a1.exercises.some(e => e.exerciseId === 'ex-lm-rdl' && e.section === 'warmup'), 'A: a light hinge in the warm-up (the hinge twice a week)')
const ARMS_A = ['ex-chin-up-negative', 'ex-hammer-curl', 'ex-suitcase-carry']
const ARMS_B = ['ex-db-row', 'ex-dips', 'ex-wrist-curl']
assert(JSON.stringify(a1.exercises.slice(-3).map(e => e.exerciseId)) === JSON.stringify(ARMS_A), 'A ends with the arm block: chin-ups, hammer curls, grip')
assert(JSON.stringify(b1.exercises.slice(-3).map(e => e.exerciseId)) === JSON.stringify(ARMS_B), 'B ends with the arm block: the dumbbell row, dips, wrist curls (the row works the same arms as the hammer curls)')
assert(a1.exercises.concat(b1.exercises).filter(e => /chin-up/.test(e.exerciseId)).length === 1, 'chin-ups once a week, never twice in a lift')
assert(['ex-single-leg-calf-raise', 'ex-copenhagen-plank'].every(id => a1.exercises.some(e => e.exerciseId === id)), 'A: loaded calves, the Copenhagen plank')
assert(['ex-nordic-curl', 'ex-bent-knee-calf-raise'].every(id => b1.exercises.some(e => e.exerciseId === id)), 'B: the Nordic, bent-knee calves (the tibialis raise made room for the row)')
assert(!a1.exercises.concat(b1.exercises).some(e => ['ex-ez-curl', 'ex-tricep-pushdown', 'ex-lateral-raise'].includes(e.exerciseId)), 'no isolation arm work')
assert(c1.exercises.some(e => e.exerciseId === 'ex-tibialis-raise'), 'Strength C keeps its durability')
assert(JSON.stringify(c7) === JSON.stringify(c5), 'week 7 strength C is identical to week 5')
const fighterB = getStrengthTemplate(4, 1, 'fighter')
assert(fighterB.id === 'strength_b' && fighterB.exercises.some(e => e.exerciseId === 'ex-rdl'), 'Fighter templates unchanged')
assert(getWeekPercentage(6, 'block_zero') === getWeekPercentage(5, 'block_zero'), 'week 6 holds intensity')

console.log('\nAll Block Zero week plan tests passed')
