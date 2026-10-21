// Run: tsx src/lib/coach/weekCounter.test.ts
import { anchorMondayFor, isLeadInDay, trainingWeek, type TrainingWeekInput } from './weekCounter'
import { MON, assert } from './testUtil'

const base = (over: Partial<TrainingWeekInput>): TrainingWeekInput => ({
  blockType: 'fighter', startDay: MON, totalWeeks: 12, completedKeyDays: [], day: MON, todayDay: MON, plannedKeyPerWeek: 6, ...over,
})
/** Three sessions in each listed week index (0 = first week). */
const trained = (weeks: number[]) => weeks.flatMap(w => [MON + 7 * w, MON + 7 * w + 2, MON + 7 * w + 4])

assert(anchorMondayFor(MON + 2) === MON && anchorMondayFor(MON + 3) === MON + 7 && anchorMondayFor(MON + 6) === MON + 7, 'Fighter: Mon-Wed starts count their week; Thu-Sun starts lead into the next')
// Block Zero (coach brain P2): no lead-in. The start's calendar week is week 1, whatever the weekday.
for (let i = 0; i < 7; i++) {
  assert(anchorMondayFor(MON + i, 'block_zero') === MON, `Block Zero start day +${i}: week 1 is that calendar week`)
  const wrong: number[] = []
  for (let d = MON + i; d < MON + 7; d++) {
    const tw = trainingWeek(base({ blockType: 'block_zero', totalWeeks: 6, startDay: MON + i, day: d, todayDay: d }))
    if (tw.leadIn || isLeadInDay(MON + i, d) || tw.week !== 1) wrong.push(d - MON)
  }
  assert(wrong.length === 0, `start +${i}: no lead-in, every day of the start week reads week 1${wrong.length ? ` (wrong: ${wrong})` : ''}`)
}
const bzLate = trainingWeek(base({ blockType: 'block_zero', totalWeeks: 6, startDay: MON + 2, completedKeyDays: [MON + 3, MON + 5, MON + 7, MON + 9], day: MON + 14, todayDay: MON + 14 }))
assert(bzLate.week === 3 && !bzLate.leadIn, 'Wednesday start: its week is week 1, so the Monday two weeks on is week 3')
assert(!trainingWeek(base({ startDay: MON + 4, day: MON + 4 })).leadIn, 'Fighter never reads as lead-in')

const steady = trainingWeek(base({ completedKeyDays: trained([0, 1, 2]), day: MON + 21, todayDay: MON + 21 }))
assert(steady.week === 4 && steady.pausedWeeks === 0, 'three trained weeks: week 4')

const holiday = trainingWeek(base({ completedKeyDays: trained([0, 1, 3]), day: MON + 28, todayDay: MON + 28 }))
assert(holiday.week === 4 && holiday.pausedWeeks === 1, 'a week with no sessions is paused: week 4, not 5')

const twoOff = trainingWeek(base({ completedKeyDays: trained([0, 1]), day: MON + 28, todayDay: MON + 28 }))
assert(twoOff.week === 3 && twoOff.pausedWeeks === 2, 'two empty weeks (open gap): resume at week 3')

// Left mid-week: week 2 had one session, then 10 days off.
const leftEarly = trainingWeek(base({ completedKeyDays: [...trained([0]), MON + 7, MON + 18], day: MON + 18, todayDay: MON + 18 }))
assert(leftEarly.week === 2, 'the week a 7+ day gap began is repeated when under half was done')
const leftLate = trainingWeek(base({ completedKeyDays: [...trained([0, 1]), MON + 26], day: MON + 28, todayDay: MON + 28 }))
assert(leftLate.week === 4 && leftLate.pausedWeeks === 1, 'a week that was mostly done before the gap still counts; only the empty week pauses')

const future = trainingWeek(base({ completedKeyDays: [...trained([0]), MON + 7], day: MON + 14, todayDay: MON + 8 }))
assert(future.week === 3, 'next week = this week + 1 once this week has a session')
const aheadEmpty = trainingWeek(base({ completedKeyDays: trained([0]), day: MON + 14, todayDay: MON + 8 }))
assert(aheadEmpty.week === 2, 'a week planned ahead is not numbered past an empty current week')

const capped = trainingWeek(base({ completedKeyDays: trained(Array.from({ length: 14 }, (_, i) => i)), day: MON + 98, todayDay: MON + 98 }))
assert(capped.week === 12 && capped.rawWeek === 15, 'plan week caps at the block length; the raw week keeps counting for the Fighter wave')

const leadIn = trainingWeek(base({ startDay: MON + 4, completedKeyDays: [MON + 4], day: MON + 7, todayDay: MON + 7 }))
assert(leadIn.week === 1, 'Friday start: the next Monday is still week 1')

const bzRestart = trainingWeek(base({ blockType: 'block_zero', totalWeeks: 6, completedKeyDays: [...trained([0, 1, 2]), MON + 56], day: MON + 63, todayDay: MON + 63 }))
assert(bzRestart.restarted && bzRestart.week === 2, 'Block Zero: a 4+ week gap restarts at week 1 (week 2 a week later)')
const fighterLong = trainingWeek(base({ completedKeyDays: [...trained([0, 1, 2]), MON + 56], day: MON + 63, todayDay: MON + 63 }))
assert(!fighterLong.restarted && fighterLong.week === 5, 'Fighter: the same gap pauses but does not restart (Block Zero is offered instead)')

const idle = trainingWeek(base({ blockType: 'block_zero', totalWeeks: 6, completedKeyDays: [], day: MON + 14, todayDay: MON + 14 }))
assert(idle.week === 1, 'a block that has not started training stays at week 1')

console.log('coach week counter tests passed')
