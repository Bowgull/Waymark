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
  // Page 76: weeks 1-3 every run easy; from week 4 Tuesday is steady hard (the 5K test in weeks 4, 8) and Saturday run hard / jog.
  if (w < 4) assert(types.filter(t => t === 'foundation_run').length === 3, `week ${w}: 3 run-walk days`)
  else {
    const tpl = getBlockZeroWeekTemplate(w)
    assert(types.filter(t => t === 'foundation_run').length === 1 && types.filter(t => t === 'running').length === 2, `week ${w}: one easy run, two hard runs`)
    assert(tpl[2][1].runCategory === (w === 4 || w === 8 ? '5k_test' : 'tempo') && tpl[6][1].runCategory === 'intervals' && tpl[4][1].type === 'foundation_run', `week ${w}: Tuesday ${w === 4 || w === 8 ? 'the 5K test' : 'steady hard'}, Thursday easy, Saturday run hard / jog`)
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
const mainNotes = a1.exercises.filter(e => e.section === 'main').map(e => e.notes ?? '')
assert(mainNotes.every(n => n.includes('RPE 6-7')), 'week 1 main lifts carry the RPE 6-7 target in notes')
assert(a3.exercises.filter(e => e.section === 'main').every(e => e.sets[0].targetReps === 5 && e.sets[0].loadMultiplier === 1.1), 'week 3 starts with a check set of 5 at ~1.1x load')
const DURABILITY = ['ex-neck-iso-4way', 'ex-wrist-curl', 'ex-reverse-wrist-curl']
assert(DURABILITY.every(id => a1.exercises.some(e => e.exerciseId === id) && c1.exercises.some(e => e.exerciseId === id)), 'durability on A and C: 4-way neck isometrics, wrist curl, reverse wrist curl')
assert(a1.exercises.some(e => e.exerciseId === 'ex-single-leg-calf-raise') && c1.exercises.some(e => e.exerciseId === 'ex-tibialis-raise'), 'calf raises on A, tibialis raises on C')
assert(![...DURABILITY, 'ex-chin-tucks', 'ex-hammer-curl'].some(id => b1.exercises.some(e => e.exerciseId === id)), 'no durability on B (2x per week)')
assert(![a1, c1].some(t => t.exercises.some(e => e.exerciseId === 'ex-chin-tucks' || e.exerciseId === 'ex-hammer-curl')), 'Phase A stand-ins (chin tucks, hammer curl) are gone')
assert(JSON.stringify(c7) === JSON.stringify(c5), 'week 7 strength C is identical to week 5')
const fighterB = getStrengthTemplate(4, 1, 'fighter')
assert(fighterB.id === 'strength_b' && fighterB.exercises.some(e => e.exerciseId === 'ex-rdl'), 'Fighter templates unchanged')

const workingSetCount = (t: typeof a1) => t.exercises.filter(e => e.section !== 'warmup').reduce((n, e) => n + e.sets.length, 0)
const w5 = workingSetCount(getStrengthTemplate(1, 5, 'block_zero'))
const w6 = workingSetCount(getStrengthTemplate(1, 6, 'block_zero'))
const cut = 1 - w6 / w5
assert(cut >= 0.3 && cut <= 0.5, `week 6 volume cut ${(cut * 100).toFixed(0)}% sits in the 30-50% band (R16)`)
assert(getWeekPercentage(6, 'block_zero') === getWeekPercentage(5, 'block_zero'), 'week 6 holds intensity')

console.log('\nAll Block Zero week plan tests passed')
