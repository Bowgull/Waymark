// Run: tsx src/lib/coach/rampUp.test.ts
// Ramp-up ask: fresh streak + easier sessions -> one ask with safe options;
// never on ease days, never after a gap, at most once a week, never past caps.
import { evaluateReadiness, type CheckIn } from '../blockZero/readiness'
import { freshStreak, joinNames, moreWeightDetail, rampUpAsk, rampUpEligibility, rampUpOptions, RAMP_DECLINE, type RampUpSignals } from './rampUp'
import { summarizeEffort } from './feltHard'
import { MON, assert, ctx, s } from './testUtil'

const houseVoice = (t: string) => !t.includes('!') && !t.includes('—')

// Baseline week (Mon-Sun before MON), then two fresh days (Mon, Tue).
const base: CheckIn[] = Array.from({ length: 7 }, (_, i) => ({ epochDay: MON - 7 + i, sleepHours: 7, soreness: 3, energy: 3 }))
const fresh: CheckIn[] = [MON, MON + 1].map(d => ({ epochDay: d, sleepHours: 7.5, soreness: 2, energy: 4 }))
const days = evaluateReadiness([...base, ...fresh])
assert(days.find(d => d.epochDay === MON)?.fresh === true, 'better on 3 items, none worse: a fresh day')
assert(freshStreak(days, MON + 1) === 2, 'two fresh days in a row')
assert(freshStreak(days, MON + 2) === 2, 'no check-in today: the streak ends yesterday')

const easyEffort = summarizeEffort([
  { epochDay: MON - 3, type: 'strength', rpe: 5 },
  { epochDay: MON - 2, type: 'foundation_run', label: 'Zone 2', rpe: 3 },
  { epochDay: MON - 1, type: 'mt_class', rpe: 6 },
])
const signals: RampUpSignals = { todayEpochDay: MON + 1, readiness: days, effort: easyEffort, liftPush: false, easeToday: false, noPush: false, askedThisWeek: false }
const e = rampUpEligibility(signals)
assert(e.eligible && e.why != null && houseVoice(e.why), `eligible with a plain why: ${e.why}`)
assert(JSON.stringify(e.proof) === JSON.stringify([{ label: 'FRESH', value: '2 DAYS' }, { label: 'EASY', value: '3 OF 3' }]), `proof tiles are short label/value pairs as page 36 (FRESH 2 DAYS, EASY 3 OF 3): ${JSON.stringify(e.proof)}`)
assert(e.proof.every(p => p.label.length + p.value.length <= 14 && p.label === p.label.toUpperCase() && p.value === p.value.toUpperCase()), 'every proof tile fits one short flap, upper case')
assert(e.why === "You've been fresh and sessions felt easy.", `why in the page-36 words: ${e.why}`)
assert(JSON.stringify(rampUpEligibility({ ...signals, effort: summarizeEffort([]), liftPush: true }).proof) === JSON.stringify([{ label: 'FRESH', value: '2 DAYS' }, { label: 'LIFTS', value: 'UP 2 OF 3' }]), 'a lift-trend push shows LIFTS UP 2 OF 3, no empty EASY tile')
assert(joinNames(['Squat', 'RDL']) === 'Squat and RDL' && joinNames(['A', 'B', 'C']) === 'A, B and C' && joinNames(['A']) === 'A', 'lift names join in plain words')

const week = [
  s('strength', MON + 3, { label: null }),
  s('mt_class', MON + 2, { timeSlot: 'pm' }),
  s('foundation_run', MON + 4, { label: 'Zone 2' }),
]
const optInput = {
  ctx: ctx({ todayEpochDay: MON + 1, sessions: week, planWeekLoad: 5000 }),
  upcoming: week.map(x => ({ ...x, id: x.id as string })),
  blockType: 'fighter' as const,
  weekNumber: 3,
  liftPush: false,
  classDays: new Set([1, 3, 5]),
  mainLifts: [{ exerciseId: 'ex-squat', name: 'Squat', workingKg: 100 }, { exerciseId: 'ex-rdl', name: 'RDL', workingKg: 80 }],
  nextStrength: { names: ['Squat', 'RDL'], sets: 2, reps: 8 },
}
const ask = rampUpAsk(signals, optInput)
assert(ask != null && ask.options.length >= 2 && ask.options.length <= 3, `an ask with safe options (${ask?.options.map(o => o.id).join(', ')})`)
assert(ask!.options[0].id === 'extra_set' && ask!.options[0].title === '+1 SET', 'first option: +1 SET on the next strength day')
assert(ask!.options[0].detail === 'Squat and RDL, 3×8', `+1 SET sub-line as page 36: ${ask!.options[0].detail}`)
const run = ask!.options.find(o => o.id === 'extra_run')
assert(run == null || /^Zone 2, \d+ min$/.test(run.detail), `EXTRA RUN sub-line as page 36 ("Zone 2, 30 min"): ${run?.detail}`)
assert(rampUpOptions({ ...optInput, nextStrength: null })[0].detail.endsWith('main lifts'), 'no plan for the strength day: a plain fallback line')
const more = ask!.options.find(o => o.id === 'more_weight')
assert(more != null && more.title === 'MORE WEIGHT' && more.kind === 'load_step' && more.lifts.length === 2 && more.lifts[0].toKg === 105, 'MORE WEIGHT carries per-lift new values (+5%)')
assert(more != null && /^Squat \d+ · RDL \d+(, \+\d+)? lb$/.test(more.detail) && !/load step/i.test(more.detail), `MORE WEIGHT detail as page 36 ("Squat 140 · RDL 120, +5 lb"): ${more?.detail}`)
assert(ask!.decline.title === RAMP_DECLINE.title && ask!.decline.title === 'NOT THIS WEEK', 'decline is NOT THIS WEEK')
assert(houseVoice(ask!.question) && ask!.expiresOnDay === MON + 7, 'question in house voice, lapses with the week')
assert(moreWeightDetail([{ exerciseId: 'a', name: 'Squat', fromKg: 61.2, toKg: 63.5 }]).endsWith('+5 lb'), 'per-lift step shown in lb')

// Every add passes placement (stacking, run caps, MT ramp and cap).
const adds = rampUpOptions({ ...optInput, ctx: ctx({ todayEpochDay: MON + 1, sessions: week, planWeekLoad: 5000, mt: { weeksSinceRampStart: 6, profileCap: 1 } }) })
assert(!adds.some(o => o.id === 'extra_class'), 'MT cap reached: no extra class offered')
const noRunRoom = rampUpOptions({ ...optInput, ctx: ctx({ todayEpochDay: MON + 1, sessions: week, planWeekLoad: 5000, run: { longestLast30Sec: 40 * 60, lastWeekRunSec: 10 * 60, thisWeekRunSec: 60 * 60 } }) })
assert(!noRunRoom.some(o => o.id === 'extra_run'), 'weekly run cap reached: no extra run offered')
const overPlan = rampUpOptions({ ...optInput, ctx: ctx({ todayEpochDay: MON + 1, sessions: week, planWeekLoad: 100 }) })
assert(!overPlan.some(o => o.kind === 'add'), 'past the 10% load allowance: no added session')

// Never on ease days, never after a gap, once a week, needs easier sessions.
assert(!rampUpEligibility({ ...signals, easeToday: true }).eligible, 'ease day: no ask')
assert(!rampUpEligibility({ ...signals, noPush: true }).eligible, 'return ramp or injury: no ask')
assert(!rampUpEligibility({ ...signals, askedThisWeek: true }).eligible, 'already asked this week: no ask')
assert(!rampUpEligibility({ ...signals, effort: summarizeEffort([{ epochDay: MON - 1, type: 'strength', rpe: 7 }]) }).eligible, 'sessions on target: no ask')
assert(rampUpEligibility({ ...signals, effort: summarizeEffort([]), liftPush: true }).eligible, 'a lift-trend push counts as easier than target')
assert(!rampUpEligibility({ ...signals, effort: summarizeEffort([{ epochDay: MON - 3, type: 'strength', rpe: 5 }, { epochDay: MON - 2, type: 'mt_class', rpe: 5 }, { epochDay: MON - 1, type: 'strength', rpe: 9 }]) }).eligible, 'one session harder than target: no ask')
assert(!rampUpEligibility({ ...signals, readiness: evaluateReadiness([...base, fresh[0]]), todayEpochDay: MON }).eligible, 'one fresh day is not a streak')
const easeDayOpts = rampUpOptions({ ...optInput, ctx: ctx({ todayEpochDay: MON + 1, sessions: week, planWeekLoad: 5000, easeDays: [MON + 3] }) })
assert(!easeDayOpts.some(o => o.epochDay === MON + 3), 'no option lands on an eased day')
const bzTest = rampUpOptions({ ...optInput, blockType: 'block_zero', weekNumber: 1 })
assert(!bzTest.some(o => o.id === 'extra_set' || o.id === 'more_weight'), 'Block Zero test week keeps its sets')

console.log('rampUp tests passed')
