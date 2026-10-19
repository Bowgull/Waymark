// Run: tsx src/lib/blockZero/classTonight.test.ts
import { planClassTonight, type DayRow } from './classTonight'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
  console.log(`ok: ${msg}`)
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const R = (id: string, type: string, timeSlot: 'am' | 'pm', status = 'planned', label: string | null = null): DayRow => ({ id, type, label, timeSlot, status })
const cls = { label: 'MT Technique', timeSlot: 'pm' }

// A Block Zero day: Foundation, strength, a run in the evening.
const day = [R('m', 'mobility', 'am', 'completed', 'Foundation'), R('s', 'strength', 'am', 'planned', 'Strength C'), R('r', 'foundation_run', 'pm', 'planned', 'Run-Walk')]
const p = planClassTonight(day, cls)
assert(same(p.move, ['r']), 'the run moves off the class day')
assert(same(p.ease, ['s']), 'strength drops a set')
assert(same(p.toAm, []), 'strength already in the morning stays there')

// Strength in the evening comes to the morning; rope moves like a run.
const p2 = planClassTonight([R('s', 'strength', 'pm'), R('j', 'skip_rope', 'am')], cls)
assert(same(p2.toAm, ['s']) && same(p2.ease, ['s']), 'evening strength comes to the morning, one set lighter')
assert(same(p2.move, ['j']), 'skip rope moves like a run')

// Done, skipped and the class itself never change.
const p3 = planClassTonight([R('s', 'strength', 'am', 'completed'), R('r', 'running', 'pm', 'skipped'), R('c', 'mt_class', 'pm')], cls)
assert(same(p3, { ease: [], toAm: [], move: [] }), 'done, skipped and the class itself stay as they are')

// Foundation only: nothing rebalances.
assert(same(planClassTonight([R('m', 'mobility', 'am')], cls), { ease: [], toAm: [], move: [] }), 'a Foundation-only day: nothing to rebalance')

console.log('classTonight: all passed')
