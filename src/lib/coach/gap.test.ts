// Run: tsx src/lib/coach/gap.test.ts
import { returnContext, returnPlan, scaleLoadKg, scaleSets } from './gap'
import { assert } from './testUtil'

// ─── The return table (F12, F13) ─────────────────────────────

assert(returnPlan(0).tier === 'none' && returnPlan(6).tier === 'none' && returnPlan(6).loadFactor === 1, 'under 7 days off: no change')
const short = returnPlan(10)
assert(short.tier === 'short' && short.loadFactor === 0.9 && short.volumeFactor === 0.8 && short.durationDays === 7 && !short.restart, '7-13 days: 90% load, 80% volume, one week')
const med = returnPlan(16)
assert(med.tier === 'medium' && med.loadFactor === 0.85 && med.volumeFactor === 0.7 && med.durationDays === 7, '14-20 days: 85% load, 70% volume')
const long = returnPlan(24)
assert(long.tier === 'long' && long.loadFactor === 0.8 && long.durationWeeks === 2 && long.steps[1].loadFactor === 0.9, '21-27 days: 80% then 90% over two weeks')
const re = returnPlan(35)
assert(re.tier === 'restart' && re.restart && re.durationWeeks === 3 && re.loadFactor === 0.75, '28+ days: mini Block Zero, 3-week ramp')
assert(returnPlan(28).restart && !returnPlan(27).restart, 'restart starts at exactly 4 weeks')
for (const g of [7, 14, 21, 30]) {
  const r = returnPlan(g).reason ?? ''
  assert(r.length > 0 && !/[!—–]/.test(r), `${g}-day reason in the house voice: "${r}"`)
}

// ─── The ramp on a given day ────────────────────────────────

const done = [100, 102, 104] // trained, then off
const open = returnContext(done, 116)
assert(open.active && open.returnDay == null && open.plan.gapDays === 11 && open.loadFactor === 0.9, 'open gap: the planned day is the first day back')
const back = [...done, 116]
assert(returnContext(back, 116).loadFactor === 0.9, 'the return session reads the same before and after it is logged')
assert(returnContext(back, 120).active && returnContext(back, 120).daysSinceReturn === 4, 'ramp still on 4 days after the return')
assert(!returnContext(back, 123).active, 'short ramp ends after a week')
const longBack = [100, 125, 127, 130]
const wk2 = returnContext(longBack, 133)
assert(wk2.active && wk2.loadFactor === 0.9 && /Coming back/.test(wk2.reason ?? ''), '24-day gap: the second week tapers to 90%')
assert(!returnContext([100, 103, 105], 108).active, 'normal rest days: no ramp')
assert(!returnContext([], 200).active, 'no history: no ramp (a block start is not a gap)')
assert(returnContext([10], 100).plan.restart && returnContext([10], 100).noFinishers, 'long open gap: restart, no finishers')

// ─── Scaling helpers ─────────────────────────────────────────

assert(scaleSets(3, 0.8) === 2 && scaleSets(2, 0.6) === 1 && scaleSets(1, 0.5) === 1, 'sets scale and never drop below one')
assert(scaleLoadKg(100, 0.9) === 90 && scaleLoadKg(61, 0.85) === 52, 'loads scale to the nearest 0.5 kg')

console.log('coach gap tests passed')
