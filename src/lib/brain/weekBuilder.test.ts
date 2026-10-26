// Run: tsx src/lib/brain/weekBuilder.test.ts
// The one plan's week (rebuild Phase 2, page 93): every day step with every
// set of 0 to 3 class days keeps the rules; what each step holds; classes
// only on Settings days; doubled mornings; kept sessions; last weekend's lifts.
import assert from 'node:assert/strict'
import { buildWeek, hardCapFor, STEP_SHAPE, type DayStep, type PlanEntry } from './weekBuilder'
import { nextStep, type RampWeek } from './dayRamp'

const ORDER = [1, 2, 3, 4, 5, 6, 0]
const idx = (dow: number) => (dow + 6) % 7
const H = { am: 8, pm: 18 } as const
const at = (e: Pick<PlanEntry, 'dow' | 'timeSlot'>) => idx(e.dow) * 24 + H[e.timeSlot]
const key = (e: PlanEntry) => e.type !== 'mobility'

function rulesBroken(entries: PlanEntry[], step: DayStep): string[] {
  const out: string[] = []
  const work = entries.filter(key)
  const days = ORDER.filter(d => work.some(e => e.dow === d))
  const hard = ORDER.filter(d => work.some(e => e.dow === d && e.hard))
  if (hard.length > hardCapFor(step)) out.push(`${hard.length} hard days`)
  for (let i = 0; i < 5; i++) if ([0, 1, 2].every(k => hard.includes(ORDER[i + k]))) out.push('3 hard in a row')
  if (days.length > STEP_SHAPE[step].days) out.push(`${days.length} days`)
  if (days.length === 7) out.push('no rest day')
  for (const l of work.filter(e => e.type === 'strength')) {
    for (const r of work.filter(e => e.role === 'hard_run')) { const h = at(r) - at(l); if (h > 0 && h < 48) out.push('hard run within 48 h after a lift') }
    for (const c of work.filter(e => e.type === 'mt_class')) { const h = at(c) - at(l); if (h >= 0 && h < 24) out.push('lift before a class') }
  }
  for (const d of ORDER) {
    const here = work.filter(e => e.dow === d && e.type !== 'mt_class')
    if (here.length > 1) {
      const am = here.find(e => e.timeSlot === 'am'), pm = here.find(e => e.timeSlot === 'pm')
      const ok = here.length === 2 && am && pm && ((am.role === 'hard_run' && pm.type === 'strength') || ((am.role === 'run' || am.role === 'long') && pm.type === 'bag_conditioning'))
      if (!ok) out.push(`${here.length} sessions on one day`)
    }
  }
  for (const b of work.filter(e => e.type === 'bag_conditioning')) {
    if (work.some(e => e.type === 'bag_work' && Math.abs(at(e) - at(b)) < 48)) out.push('Bag Conditioning near Bag Work')
    if (work.some(e => e.type === 'mt_class' && idx(e.dow) === idx(b.dow) + 1)) out.push('Bag Conditioning before a class')
  }
  return out
}

// Every step × every set of 0 to 3 class days (64 sets), weeks 2 and 8: the rules hold, classes only on picked days.
const sets: number[][] = [[]]
for (const a of ORDER) { sets.push([a]); for (const b of ORDER) if (idx(b) > idx(a)) { sets.push([a, b]); for (const c of ORDER) if (idx(c) > idx(b)) sets.push([a, b, c]) } }
assert.equal(sets.length, 64)
let builds = 0
for (const step of [4, 5, 6, 7] as DayStep[]) {
  for (const week of [2, 8]) {
    for (const days of sets) {
      const b = buildWeek({ week, step, classDays: days.map(dow => ({ dow, slot: 'any' as const })), runsReady: true })
      const label = `step ${step} week ${week} classes ${days.join(',') || 'none'}`
      assert.deepEqual(b.broken, [], `${label}: ${b.broken.join('; ')}`)
      assert.deepEqual(rulesBroken(b.entries, step), [], `${label}: ${rulesBroken(b.entries, step).join('; ')}`)
      assert.ok(b.entries.filter(e => e.type === 'mt_class').every(e => days.includes(e.dow)), `${label}: classes only on picked days`)
      assert.equal(b.entries.filter(e => e.type === 'strength').length, 2, `${label}: 2 lifts`)
      assert.equal(ORDER.filter(d => b.entries.some(e => e.dow === d && e.type === 'mobility')).length, 7, `${label}: Foundation daily`)
      // Muay Thai every week: a class, Bag Work (5 days on) or Bag Conditioning (no class).
      assert.ok(b.entries.some(e => e.type === 'mt_class' || e.type === 'bag_work' || e.type === 'bag_conditioning'), `${label}: Muay Thai in the week`)
      if (step >= 5) assert.equal(b.entries.filter(e => e.type === 'bag_work').length, 1, `${label}: Bag Work every week from 5 days`)
      if (days.length === 0) assert.ok(b.entries.some(e => e.type === 'bag_conditioning'), `${label}: no class days: Bag Conditioning`)
      builds++
    }
  }
}
console.log(`ok: ${builds} weeks keep every rule`)

// What each step holds (page 93's table), no class days set, a normal week.
const runsOf = (b: ReturnType<typeof buildWeek>) => b.entries.filter(e => e.type === 'foundation_run' || e.type === 'running').length
const s4 = buildWeek({ week: 6, step: 4, classDays: [], runsReady: true })
assert.equal(runsOf(s4), 2, '4 days: two short runs (2026-10-26)')
assert.equal(s4.entries.filter(e => e.type === 'bag_conditioning').length, 1, '4 days, no class days: one Bag Conditioning')
assert.equal(s4.entries.filter(e => e.type === 'bag_work').length, 0)
const s4c = buildWeek({ week: 1, step: 4, classDays: [{ dow: 2, slot: 'pm' }], runsReady: false })
assert.equal(s4c.entries.filter(e => e.type === 'mt_class').length, 1, '4 days: your class')
assert.equal(s4c.entries.filter(e => e.type === 'bag_conditioning').length, 0, 'a class week has no Bag Conditioning')
assert.ok(s4c.entries.find(e => e.type === 'mt_class')?.timeSlot === 'pm')
assert.equal(runsOf(s4c), 2, '4 days with a class: two runs from week 1')
assert.equal(s4c.trainingDays, 4)
const s6 = buildWeek({ week: 6, step: 6, classDays: [{ dow: 2, slot: 'pm' }], runsReady: true })
assert.equal(runsOf(s6), 3)
assert.equal(s6.entries.filter(e => e.role === 'hard_run').length, 1, '6 days: 1 hard run')
assert.equal(s6.entries.filter(e => e.role === 'long').length, 1, 'one run is the long run')
const s7 = buildWeek({ week: 9, step: 7, classDays: [{ dow: 2, slot: 'pm' }, { dow: 4, slot: 'pm' }], runsReady: true })
assert.equal(runsOf(s7), 4)
assert.equal(s7.entries.filter(e => e.role === 'hard_run').length, 2, 'doubled: 2 hard runs')
assert.equal(s7.entries.filter(e => e.type === 'strength' && e.timeSlot === 'pm').length, 2, 'both lifts in the evening of a hard-run morning')
for (const l of s7.entries.filter(e => e.type === 'strength')) assert.ok(s7.entries.some(e => e.role === 'hard_run' && e.dow === l.dow && e.timeSlot === 'am'), 'run first, lift that evening')
assert.equal(buildWeek({ week: 3, step: 6, classDays: [], runsReady: true }).entries.filter(e => e.role === 'hard_run').length, 0, 'no hard runs before week 4')
assert.equal(buildWeek({ week: 8, step: 6, classDays: [], runsReady: false }).entries.filter(e => e.role === 'hard_run').length, 0, 'none before he runs 10 minutes straight')
// The cap leaves room for classes: 1 at 4-5 days, 1 at 6 with a hard run, 2 doubled; never more than the profile cap.
assert.equal(buildWeek({ week: 9, step: 5, classDays: [1, 3, 5].map(dow => ({ dow, slot: 'any' as const })), runsReady: true }).entries.filter(e => e.type === 'mt_class').length, 1)
assert.equal(s7.entries.filter(e => e.type === 'mt_class').length, 2)
assert.equal(buildWeek({ week: 9, step: 7, classDays: [1, 3, 5].map(dow => ({ dow, slot: 'any' as const })), classCap: 1, runsReady: true }).entries.filter(e => e.type === 'mt_class').length, 1, 'the profile cap')
assert.ok(/^6 days, 2 mornings doubled: 2 lifts, 4 runs \(2 hard\), 2 classes and Bag Work\./.test(s7.why), s7.why)
console.log('ok: what each step holds')

// Kept sessions count, and a re-shape only fills the open days.
const kept = buildWeek({ week: 6, step: 5, classDays: [{ dow: 5, slot: 'pm' }], runsReady: true, open: [4, 5, 6, 0], kept: [{ dow: 1, slot: 'am', type: 'strength', label: 'Strength A' }, { dow: 2, slot: 'am', type: 'foundation_run' }] })
assert.ok(kept.entries.every(e => [4, 5, 6, 0].includes(e.dow)), 'only open days get sessions')
assert.deepEqual(kept.entries.filter(e => e.type === 'strength').map(e => e.label), ['Strength B'], 'the lift left is B')
assert.equal(kept.entries.filter(e => e.type === 'foundation_run' || e.type === 'running').length, 1, 'one run left of two')
// Last Sunday's evening lift: no hard run on Monday or Tuesday morning.
const after = buildWeek({ week: 9, step: 6, classDays: [], runsReady: true, prevLifts: [{ daysBefore: 1, slot: 'pm', label: 'Strength B' }] })
assert.ok(after.entries.filter(e => e.role === 'hard_run').every(e => ![1, 2].includes(e.dow)), 'the 48 h reach into the week')
console.log('ok: kept sessions and last weekend')

// The day ramp (page 93): start at 4, up after 2 weeks as planned, down after 2 busy weeks, back from quiet weeks.
const w = (step: DayStep | null, missed: number, done = 5, rough: number | null = 0, hardRunDone = true): RampWeek => ({ monday: 0, step, planned: 5, done, missed, roughShare: rough, hardRunDone })
assert.equal(nextStep([]).step, 4, 'a new plan starts at 4 days')
assert.equal(nextStep([w(4, 0)]).step, 4, 'a step holds 2 weeks first')
assert.deepEqual([nextStep([w(4, 0), w(4, 1)]).step, nextStep([w(4, 0), w(4, 1)]).change], [5, 'up'], 'two weeks as planned: up one')
assert.equal(nextStep([w(5, 0), w(5, 2)]).step, 5, 'a week with 2 missed: hold')
assert.deepEqual([nextStep([w(6, 2), w(6, 3)]).step, nextStep([w(6, 2), w(6, 3)]).change], [5, 'down'], 'two busy weeks: down one')
assert.equal(nextStep([w(5, 0), w(5, 0, 5, 0.6)]).step, 5, 'rough mornings: no step up')
assert.equal(nextStep([w(5, 0, 5, 0.6), w(5, 0, 5, 0.7)]).step, 4, 'two weeks of rough mornings: down')
assert.equal(nextStep([w(6, 0, 5, 0, false), w(6, 0)]).step, 6, 'doubled mornings need a hard run done each week')
assert.equal(nextStep([w(6, 0), w(6, 0)]).step, 7)
assert.equal(nextStep([w(7, 0), w(7, 0)]).step, 7, 'the top step holds')
assert.deepEqual([nextStep([w(6, 5, 0), w(6, 5, 0)]).step, nextStep([w(6, 5, 0), w(6, 5, 0)]).change], [4, 'gap'], 'two quiet weeks: two steps down')
assert.equal(nextStep([w(4, 5, 0), w(4, 5, 0)]).step, 4, 'never under 4')
// Away while the block paused (no week planned, nothing done): two quiet weeks too.
const away = { monday: 0, step: null, planned: 0, done: 0, missed: 0, roughShare: null, hardRunDone: false }
assert.deepEqual([nextStep([w(7, 0), w(7, 0), away, away]).step, nextStep([w(7, 0), w(7, 0), away, away]).change], [5, 'gap'], 'paused two weeks: two steps down')
console.log('ok: the day ramp')

// Nothing fits even loosened (a class kept on every day): the lifts stay, flagged, never dropped quietly.
{
  const kept = [0, 1, 2, 3, 4, 5, 6].map(dow => ({ dow, slot: 'pm' as const, type: 'mt_class', label: 'MT Class', notes: null }))
  const full = buildWeek({ week: 1, step: 4, classDays: [], kept, runsReady: true })
  const lifts = full.entries.filter(e => e.type === 'strength')
  assert.equal(lifts.length, 2, 'both lifts kept')
  assert.equal(new Set(lifts.map(e => e.dow)).size, 2, 'on two days')
  assert.ok(full.broken.length > 0, 'and the broken rules say so')
  const none = buildWeek({ week: 1, step: 4, classDays: [], open: [], runsReady: true })
  assert.equal(none.entries.length, 0, 'no open day: nothing placed')
  console.log('ok: lifts kept when nothing fits')
}
