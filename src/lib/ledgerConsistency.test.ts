// Run: tsx src/lib/ledgerConsistency.test.ts
// Page 63 final: the mockup's Block Zero week 4 (Thu 19 Nov 2026), every number checked.
import assert from 'node:assert/strict'

import { blockConsistency, dayLabel, usualStart, weeksConsistency, type ConsistencyRow } from './ledgerConsistency'
import { isoToEpochDay } from './dates'
import { mondayOf } from './ledger'

const START = isoToEpochDay('2026-10-26')
const TODAY = START + 24
const rows: ConsistencyRow[] = []
const at = (d: number, hhmm: string) => {
  const [h, m] = hhmm.replace(' pm', '').split(':').map(Number)
  return (START + d) * 86400 + (h + (hhmm.endsWith('pm') ? 12 : 0)) * 3600 + m * 60
}
const TYPE = { strength: 'strength', run: 'foundation_run', mt: 'mt_class' } as const
const STATUS = { done: 'completed', miss: 'missed', skip: 'skipped', todo: 'planned' } as const
const add = (d: number, slot: 'am' | 'pm', type: keyof typeof TYPE, st: keyof typeof STATUS, why: string | null = null, time: string | null = null) =>
  rows.push({ type: TYPE[type], status: STATUS[st], scheduledDate: START + d, timeSlot: slot, startedAt: time ? at(d, time) : null, skipReason: why })
add(0, 'am', 'strength', 'done', null, '6:41'); add(1, 'am', 'run', 'done', null, '6:55'); add(2, 'am', 'strength', 'done', null, '6:38')
add(3, 'am', 'run', 'done', null, '7:04'); add(4, 'am', 'strength', 'done', null, '6:44'); add(5, 'am', 'run', 'done', null, '8:20')
add(7, 'am', 'strength', 'done', null, '6:40'); add(7, 'pm', 'mt', 'miss'); add(8, 'am', 'run', 'done', null, '7:05')
add(9, 'am', 'strength', 'done', null, '6:42'); add(9, 'pm', 'mt', 'done', null, '6:30 pm'); add(10, 'am', 'run', 'skip', 'tired')
add(11, 'am', 'strength', 'done', null, '6:39'); add(12, 'am', 'run', 'skip', 'sick')
add(14, 'am', 'strength', 'skip', 'sick'); add(14, 'pm', 'mt', 'skip', 'sick'); add(15, 'am', 'run', 'skip', 'sick')
add(16, 'am', 'strength', 'done', null, '6:37'); add(16, 'pm', 'mt', 'miss'); add(17, 'am', 'run', 'done', null, '6:58')
add(18, 'am', 'strength', 'done', null, '6:45'); add(19, 'am', 'run', 'miss')
add(21, 'am', 'strength', 'done', null, '6:40'); add(21, 'pm', 'mt', 'skip', 'rough_day'); add(22, 'am', 'run', 'done', null, '7:02')
add(23, 'am', 'strength', 'done', null, '6:43'); add(23, 'pm', 'mt', 'miss'); add(24, 'am', 'run', 'done', null, '6:52')
add(25, 'am', 'strength', 'todo'); add(26, 'am', 'run', 'todo')
for (const w of [28, 35]) {
  add(w, 'am', 'strength', 'todo'); add(w, 'pm', 'mt', 'todo'); add(w + 1, 'am', 'run', 'todo'); add(w + 2, 'am', 'strength', 'todo')
  add(w + 2, 'pm', 'mt', 'todo'); add(w + 3, 'am', 'run', 'todo'); add(w + 4, 'am', 'strength', 'todo'); add(w + 5, 'am', 'run', 'todo')
}
// Foundation is shown, never counted in the bar
rows.push({ type: 'mobility', status: 'completed', scheduledDate: START + 3, timeSlot: 'am', startedAt: null, skipReason: null })

const block = { blockType: 'block_zero', startDay: START, totalWeeks: 6 }
const v = blockConsistency(rows, block, TODAY, { tzOffsetMin: 0, foundation: { done: 6, of: 24 } })

// closed: the flap, the bar, the line
assert.equal(v.flap, 'AT RISK')
assert.equal(v.tone, 'gold')
assert.deepEqual([v.done, v.toCome, v.missed], [18, 18, 10])
assert.equal(v.nextAt, 33, '70% of 46')
// open: the four groups
assert.equal(v.nextLine, 'Do 15 of your next 18 to reach the next block.')
assert.equal(v.nextSmall, 'Longest break: 4 days (sick). Keep breaks under a week.')
assert.deepEqual(v.am, { done: 17, of: 22 })
assert.deepEqual(v.pm, { done: 1, of: 6 })
assert.deepEqual(v.types.map(t => [t.label, t.sub, `${t.done}/${t.of}`]), [
  ['Strength', 'mornings, ~6:40', '10/11'],
  ['Run-walk', 'mornings', '7/11'],
  ['MT class', 'evenings, 6:30', '1/6'],
  ['Foundation', 'not counted', '6/24'],
])
assert.deepEqual(v.types[3].tiles.filter(t => t === 'miss'), [], 'Foundation days not done are dark, not clay')
assert.deepEqual(v.why, [{ label: 'Sick', n: 4 }, { label: 'Tired', n: 1 }, { label: 'Rough day', n: 1 }, { label: 'No reason', n: 4 }])
assert.deepEqual(v.after, { back: 7, of: 10 })

// on track: week 2, everything due done
{
  const early = rows.map(r => (r.type === 'mobility' ? r : { ...r, status: (r.scheduledDate ?? 0) <= START + 9 ? 'completed' : 'planned' }))
  const w = blockConsistency(early, block, START + 9)
  assert.equal(w.flap, 'ON TRACK')
  assert.equal(w.tone, 'teal')
  assert.equal(dayLabel(START + 41), 'Sun 6 Dec')
  assert.equal(w.nextLine, 'On track to reach the next block on Sun 6 Dec.')
}

// a break is open: days with nothing done
{
  const b = blockConsistency(rows, block, START + 24 + 6)
  assert.equal(b.flap, '5 DAY BREAK')
  assert.match(b.nextLine, /^One session by Thu 26 Nov keeps this break under a week\./)
}

// can't get there on time: one more week (under half done: two)
{
  // four of the run-walks done turn missed: 14 done of 28 due, 19 needed of 18 to come
  const bad = rows.map(r => ((r.scheduledDate ?? 0) <= START + 8 && r.status === 'completed' && r.type === 'foundation_run' ? { ...r, status: 'missed' } : r))
  const x = blockConsistency(bad, block, TODAY)
  assert.equal(x.flap, 'ONE MORE WEEK')
  assert.equal(x.nextLine, 'Block Zero runs one more week, to Sun 13 Dec. Nothing done is lost.')
  const worse = bad.map(r => ((r.scheduledDate ?? 0) <= TODAY && r.status === 'completed' && r.type === 'strength' && ((r.scheduledDate ?? 0) - START) < 12 ? { ...r, status: 'missed' } : r))
  assert.equal(blockConsistency(worse, block, TODAY).flap, 'TWO MORE WEEKS')
}

// weeks not made yet are counted from the last made week
{
  const madeSoFar = rows.filter(r => (r.scheduledDate ?? 0) < START + 28)
  const x = blockConsistency(madeSoFar, block, TODAY)
  assert.equal(x.done + x.toCome + x.missed, 46)
}

// after Block Zero: the last 4 weeks, no line
{
  const last = weeksConsistency(rows, 4, TODAY, mondayOf)
  assert.equal(last.nextAt, null)
  assert.equal(last.mode, 'weeks')
  assert.match(last.nextLine, /^\d of the last 4 weeks done as planned\.$/)
  assert.equal(last.flap, `${last.nextLine[0]} OF 4 WKS`)
}

// the usual start
assert.equal(usualStart([at(0, '6:41'), at(1, '6:38'), at(2, '6:44')], 0), '~6:41')
assert.equal(usualStart([at(0, '6:41'), at(1, '8:20'), at(2, '6:44')], 0), null, 'starts that wander: no time')
assert.equal(usualStart([], 0), null)
assert.equal(usualStart([at(0, '11:40')], -60), '12:40', 'local time, not UTC')

console.log('ledgerConsistency tests passed')
