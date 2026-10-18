// Run: tsx src/lib/blockZero/checkIn.test.ts
import { checkInFromDailyLog, readinessReport, rollingLoadRead, type DailyLogFields } from './checkIn'
import { easeSession } from './autoEase'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
  console.log(`ok: ${msg}`)
}

const D = 20500
// daily_logs rows as the API stores them (Phase B columns included).
const row = (logDate: number, over: Partial<DailyLogFields> = {}): DailyLogFields => ({
  logDate, sleepHours: 7.5, sleepQuality: 4, energy: 4, soreness: 2, stress: 2, mood: 4, backToday: 4, alcoholScale: 0, weedGrams: 0, ...over,
})

const c = checkInFromDailyLog(row(D, { alcoholScale: 3, weedGrams: 0.5 }))
assert(c.epochDay === D && c.sleepQuality === 4 && c.backToday === 4 && c.alcohol === 3 && c.cannabis === 0.5, 'daily_logs row maps to the readiness check-in (alcohol and cannabis from the old columns)')
const legacy = checkInFromDailyLog({ logDate: D, sleepHours: 6, soreness: 3 })
assert(legacy.energy === null && legacy.sleepQuality === null && legacy.sleepHours === 6, 'old rows without the new fields still map')

// A clean week, then two bad days (sleep quality and energy down, stress up).
const week = Array.from({ length: 7 }, (_, i) => row(D + i))
const bad = (d: number) => row(d, { sleepQuality: 2, energy: 2, stress: 4 })
const logs = [...week, bad(D + 7), bad(D + 8)].map(checkInFromDailyLog)

const day1 = readinessReport(logs, D + 7)
assert(day1.checkedIn && day1.flaggedToday && !day1.readinessEase && !day1.ease, 'one bad day flags but does not ease')
const sq = day1.items.find(i => i.item === 'sleepQuality')
assert(sq?.today === 2 && sq.mean7 === 4 && sq.delta === 2 && sq.worse, 'items read against the 7-day mean')
const day2 = readinessReport(logs, D + 8)
assert(day2.readinessEase && day2.ease && day2.reason != null, 'second bad day in a row: ease, with a reason')
assert(day2.worseItems.includes('energy') && day2.worseItems.includes('stress'), 'reason items come from the new check-in fields')
assert(!day2.reason?.includes('!') && !day2.reason?.includes('—'), 'reason in house voice')
const none = readinessReport(logs, D + 9)
assert(!none.checkedIn && !none.ease, 'no check-in today: no ease')
const early = readinessReport(logs.slice(0, 2), D + 1)
assert(early.items.every(i => i.mean7 === null) && !early.ease, 'under 4 days of history: no baseline, no ease')
const backOnly = readinessReport([...week, row(D + 7, { backToday: 2 }), row(D + 8, { backToday: 2 })].map(checkInFromDailyLog), D + 8)
assert(!backOnly.ease, 'back alone (one item) does not ease; back swaps handle it')

// ─── Rolling load (R5) ──────────────────────────────────────────

const START = D
const steady = Array.from({ length: 14 }, (_, i) => ({ epochDay: START + i, rpe: 6, minutes: 50 }))
const flat = rollingLoadRead(steady, START + 14, START)
assert(flat.applies && !flat.flagged && flat.last7 === flat.prev7, 'steady load: no flag')
const jump = rollingLoadRead([...steady.slice(0, 7), ...steady.slice(7).map(e => ({ ...e, minutes: 70 }))], START + 14, START)
assert(jump.flagged && jump.reason?.includes('40%'), 'load up 40% on the week before: soft flag with the number')
const tooEarly = rollingLoadRead([{ epochDay: START + 3, rpe: 6, minutes: 60 }], START + 8, START)
assert(!tooEarly.applies && !tooEarly.flagged && tooEarly.reason === null, 'first two weeks of the block: nothing to compare, no flag')
const todayIgnored = rollingLoadRead([...steady, { epochDay: START + 14, rpe: 10, minutes: 300 }], START + 14, START)
assert(!todayIgnored.flagged, "today's own sessions never count")
const mtOnly = rollingLoadRead([...steady, { epochDay: START + 13, rpe: 8, minutes: 90 }], START + 14, START)
assert(mtOnly.last7 === flat.last7 + 720 && mtOnly.flagged, 'a 90-min class at RPE 8 adds 720 to the week and can trip the flag')

const withLoad = readinessReport(week.map(checkInFromDailyLog), D + 6, jump)
assert(withLoad.ease && !withLoad.readinessEase && withLoad.reason === jump.reason, 'load flag alone eases, reason from load')
const eased = easeSession({ type: 'strength', label: 'Strength A', timeSlot: 'am', estimatedMin: 60, sets: 3, rpe: [7, 8] }, { loadFlag: true, loadReason: jump.reason })
assert(eased.eased && eased.session.sets === 2 && eased.session.rpe?.[1] === 6, 'eased strength: one set fewer, RPE 6 cap')

console.log('\nAll Block Zero check-in tests passed')
