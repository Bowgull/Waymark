// Run: tsx src/lib/blockZero/readiness.test.ts
import { evaluateReadiness, latestReadiness, oversleepRead, type CheckIn } from './readiness'
import { easeSession, type PlannedSession } from './autoEase'
import { evaluateClassRequest, mtRampWeek, normaliseClassType, rebalanceDayForClass, weeklyClassCap } from './muayThai'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
  console.log(`ok: ${msg}`)
}

const houseVoice = (s: string | null) => s != null && !s.includes('!') && !s.includes('—')

// ─── Readiness (R10) ────────────────────────────────────────────

// 10 steady days, then 3 bad days (sleep and soreness off), then recovery.
const base: CheckIn[] = Array.from({ length: 10 }, (_, i) => ({ epochDay: 100 + i, sleepHours: 7.5, soreness: 2 }))
const bad: CheckIn[] = [110, 111, 112].map(d => ({ epochDay: d, sleepHours: 5, soreness: 4 }))
const good: CheckIn[] = [113, 114].map(d => ({ epochDay: d, sleepHours: 7.5, soreness: 2 }))
const days = evaluateReadiness([...base, ...bad, ...good])
const byDay = new Map(days.map(d => [d.epochDay, d]))
assert(byDay.get(105)!.flagged === false, 'steady days are not flagged')
assert(byDay.get(110)!.flagged && !byDay.get(110)!.ease, 'first bad day: flagged, no ease yet (needs 2 days)')
assert(byDay.get(111)!.ease && byDay.get(112)!.ease, 'second and third bad days: ease')
assert(!byDay.get(113)!.ease && !byDay.get(114)!.ease, 'back to normal: no ease')
assert(byDay.get(110)!.deltas.sleepHours === 2.5 && byDay.get(110)!.deltas.soreness === 2, 'deltas are signed worse-positive, in item units')
assert(byDay.get(100)!.deltas.sleepHours === null, 'no baseline in the first days: delta null')

// One item off is not enough.
const oneItem = evaluateReadiness([...base, { epochDay: 110, sleepHours: 4, soreness: 2 }, { epochDay: 111, sleepHours: 4, soreness: 2 }])
assert(!oneItem.some(d => d.flagged), 'only sleep off: never flagged (needs 2 items)')

// One bad day is not a trend.
const oneDay = evaluateReadiness([...base, { epochDay: 110, sleepHours: 5, soreness: 4 }, { epochDay: 111, sleepHours: 7.5, soreness: 2 }])
assert(!oneDay.some(d => d.ease), 'single bad day: no ease')

// Polarity: higher energy/mood/back is better, higher stress/alcohol is worse.
const full: CheckIn[] = Array.from({ length: 8 }, (_, i) => ({ epochDay: 200 + i, energy: 4, mood: 4, backToday: 4, stress: 2, alcohol: 0, cannabis: 0 }))
const fullBad = evaluateReadiness([...full, { epochDay: 208, energy: 5, mood: 5, backToday: 5, stress: 1, alcohol: 0, cannabis: 0 }])
assert(!fullBad[fullBad.length - 1].flagged, 'better than baseline on every item: not flagged')
const stressDays = evaluateReadiness([...full, { epochDay: 208, energy: 4, mood: 4, backToday: 4, stress: 4, alcohol: 3 }, { epochDay: 209, energy: 4, mood: 4, backToday: 4, stress: 4, alcohol: 3 }])
assert(stressDays[stressDays.length - 1].ease && stressDays[stressDays.length - 1].worseItems.join(',') === 'stress,alcohol', 'stress and alcohol up two days: ease')
const backMood = evaluateReadiness([...full, { epochDay: 208, mood: 2, backToday: 2 }, { epochDay: 209, mood: 2, backToday: 2 }])
assert(backMood[backMood.length - 1].ease, 'back and mood down two days: ease, missing items tolerated')
// Herb on the 0-9 scale: 2+ points over the 7-day usual is worse; 1 point is not.
const herbTwo = evaluateReadiness([...full, { epochDay: 208, energy: 2, cannabis: 2 }])
assert(herbTwo[herbTwo.length - 1].deltas.cannabis === 2 && herbTwo[herbTwo.length - 1].worseItems.includes('cannabis'), 'herb 2 points over a usual of 0: worse')
const herbEase = evaluateReadiness([...full, { epochDay: 208, energy: 2, cannabis: 3 }, { epochDay: 209, energy: 2, cannabis: 3 }])
assert(herbEase[herbEase.length - 1].ease && herbEase[herbEase.length - 1].worseItems.includes('cannabis'), 'herb well over the usual with low energy, two days: ease')
const herbOne = evaluateReadiness([...full, { epochDay: 208, energy: 2, cannabis: 1 }, { epochDay: 209, energy: 2, cannabis: 1 }])
assert(!herbOne[herbOne.length - 1].worseItems.includes('cannabis') && !herbOne[herbOne.length - 1].ease, 'herb 1 point over the usual: not worse')
const herbUsual: CheckIn[] = Array.from({ length: 8 }, (_, i) => ({ epochDay: 400 + i, energy: 4, cannabis: 5 }))
const herbHabit = evaluateReadiness([...herbUsual, { epochDay: 408, energy: 4, cannabis: 6 }])
assert(herbHabit[herbHabit.length - 1].deltas.cannabis === 1 && !herbHabit[herbHabit.length - 1].flagged, 'against his own usual: 6 after a week of 5 is 1 point, not worse')
const herbHigh = evaluateReadiness([...herbUsual, { epochDay: 408, energy: 4, cannabis: 7 }])
assert(herbHigh[herbHigh.length - 1].worseItems.includes('cannabis'), '7 after a week of 5 is 2 points over: worse')
assert(latestReadiness([...full, { epochDay: 208, energy: 2, cannabis: 3 }, { epochDay: 209, energy: 2, cannabis: 3 }]).reason === 'Energy and cannabis are off your 7-day trend for 2 days.', 'the reason names the herb item')

// Sparse data: fewer than 4 values in the window means no baseline.
const sparse = evaluateReadiness([{ epochDay: 1, sleepHours: 8, soreness: 1 }, { epochDay: 5, sleepHours: 8, soreness: 1 }, { epochDay: 8, sleepHours: 4, soreness: 5 }, { epochDay: 9, sleepHours: 4, soreness: 5 }])
assert(!sparse.some(d => d.flagged), 'two check-ins in the week before: no baseline, no flag')
assert(evaluateReadiness([]).length === 0, 'no check-ins: empty')

const latest = latestReadiness([...base, ...bad])
assert(latest.ease && latest.reason === 'Sleep and soreness are off your 7-day trend for 2 days.', 'latest read gives a one-line reason')
assert(houseVoice(latest.reason), 'readiness reason in house voice')
assert(!latestReadiness(base).ease && latestReadiness([]).epochDay === null, 'no ease on steady or empty data')

// ─── Auto-ease ──────────────────────────────────────────────────

const strength: PlannedSession = { type: 'strength', label: 'Strength A', timeSlot: 'am', estimatedMin: 60, sets: 3, rpe: [7, 8] }
const run: PlannedSession = { type: 'foundation_run', label: 'Run-Walk', timeSlot: 'am', estimatedMin: 30 }
const mob: PlannedSession = { type: 'mobility', label: 'Foundation', timeSlot: 'am', estimatedMin: 12 }

assert(!easeSession(strength, {}).eased, 'no trigger: untouched')
const es = easeSession(strength, { readinessEase: true, readinessReason: latest.reason })
assert(es.eased && es.session.sets === 2 && es.session.rpe![1] === 6 && es.session.estimatedMin === 45, 'strength: one set fewer, RPE 6 cap, shorter')
assert(es.reason === 'Sleep and soreness are off your 7-day trend for 2 days. 2 sets per lift today, RPE 6 cap.', 'strength ease reason')
const er = easeSession(run, { loadFlag: true, loadReason: 'Load is up 25% on last week.' })
assert(er.eased && er.session.type === 'active_recovery' && er.reason?.includes('walk or bike'), 'run becomes easy walk or bike on a load flag')
assert(!easeSession(mob, { readinessEase: true }).eased, 'back care is never eased away')
assert(easeSession({ ...strength, sets: 1 }, { readinessEase: true }).session.sets === 1, 'never below one set')
const mtPlanned = { type: 'mt_class', label: 'MT Class', timeSlot: 'pm' as const, estimatedMin: 60 }
const mt = easeSession(mtPlanned, { readinessEase: true })
assert(mt.eased && mt.session === mtPlanned, 'an eased class night leaves the class itself alone')
assert(mt.reason?.endsWith('Your call tonight: skip the class or move it.') && !/techni|hard rounds|sit out/i.test(mt.reason ?? ''), 'the only class ease is skip or move, never what to do in it')
assert([es, er, mt].every(e => houseVoice(e.reason)), 'ease reasons in house voice')

// ─── Oversleep (soft rule) ──────────────────────────────────────

const steadySleep: CheckIn[] = Array.from({ length: 7 }, (_, i) => ({ epochDay: 300 + i, sleepHours: 7, energy: 4, soreness: 2 }))
const longTired = evaluateReadiness([...steadySleep, { epochDay: 307, sleepHours: 9, energy: 2, soreness: 2 }, { epochDay: 308, sleepHours: 9, energy: 2, soreness: 2 }])
const lt = longTired.find(d => d.epochDay === 307)!
assert(lt.oversleep === 'fatigue' && lt.worseItems.includes('sleepHours') && lt.deltas.sleepHours === 2, 'long sleep with low energy counts as worse sleep')
assert(longTired[longTired.length - 1].ease, 'long sleep + low energy two days running: ease, like poor sleep')
assert(latestReadiness([...steadySleep, { epochDay: 307, sleepHours: 9, energy: 2 }, { epochDay: 308, sleepHours: 9, energy: 2 }]).reason?.startsWith('Long sleep and energy'), 'the reason names the long sleep')
const longSore = evaluateReadiness([...steadySleep, { epochDay: 307, sleepHours: 8.6, energy: 4, soreness: 4 }, { epochDay: 308, sleepHours: 8.6, energy: 4, soreness: 4 }])
assert(longSore[longSore.length - 1].oversleep === 'fatigue' && longSore[longSore.length - 1].ease, 'long sleep with high soreness: ease')
const longGood = evaluateReadiness([...steadySleep, { epochDay: 307, sleepHours: 9, energy: 4, soreness: 2 }, { epochDay: 308, sleepHours: 9.5, energy: 5, soreness: 2 }])
const lg = longGood[longGood.length - 1]
assert(lg.oversleep === 'recovery' && lg.deltas.sleepHours === 0 && !lg.flagged && !lg.worseItems.includes('sleepHours'), 'long sleep with good energy: neutral')
assert(!lg.betterItems.includes('sleepHours'), 'long sleep never counts as better (no fresh credit)')
const normalMore = evaluateReadiness([...steadySleep, { epochDay: 307, sleepHours: 8, energy: 4, soreness: 2 }])
assert(normalMore[normalMore.length - 1].oversleep === null && normalMore[normalMore.length - 1].betterItems.includes('sleepHours'), 'an hour more than usual is just better sleep')
assert(oversleepRead({ sleepHours: 9, sleepMean: null, energy: 1 }) === null, 'no sleep baseline: no oversleep read')

// ─── MT classes (R12; coach-brain §14) ──────────────────────────
// How many a week, never what kind: a class is a fixed hour and what is taught
// is the gym's call, so no class type is ever refused or suggested.

assert(mtRampWeek(null) === 1 && mtRampWeek(0) === 1 && mtRampWeek(2) === 3, 'ramp week counts from the first class')
assert(weeklyClassCap(1) === 2 && weeklyClassCap(3) === 3 && weeklyClassCap(3, 2) === 2 && weeklyClassCap(1, 0) === 0, 'weekly cap: 2 then 3, profile cap wins when lower')
assert(normaliseClassType('Technique') === 'technical' && normaliseClassType('pads') === 'padwork' && normaliseClassType('Bag') === 'padwork' && normaliseClassType('kickboxing') === null, 'class type aliases (a log field)')

const first = evaluateClassRequest({ weeksSinceFirstClass: null, classesThisWeek: 0 })
assert(first.allowed && first.cap === 2, 'first class: allowed')
const capped = evaluateClassRequest({ weeksSinceFirstClass: 0, classesThisWeek: 2 })
assert(!capped.allowed && capped.reason.includes('cap is 2'), 'third class in ramp week 1: over the cap')
const later = evaluateClassRequest({ weeksSinceFirstClass: 2, classesThisWeek: 2 })
assert(later.allowed && later.cap === 3, 'week 3 back: a third class fits')
assert(!evaluateClassRequest({ weeksSinceFirstClass: 4, classesThisWeek: 0, profileCap: 0 }).allowed, 'profile cap 0: no classes')
assert([first, capped, later].every(d => houseVoice(d.reason)), 'class reasons in house voice')
assert([first, capped, later].every(d => !/techni|sparring|clinch|pads|light|hard rounds/i.test(d.reason)), 'no class content in any reason')
assert(!('suggestedType' in capped) && !('classType' in capped), 'a decision never names a kind of class')

const mtClass: PlannedSession = { type: 'mt_class', label: 'MT Class', timeSlot: 'pm', estimatedMin: 90, classType: 'technical' }
const runDay = rebalanceDayForClass([mob, run], mtClass)
assert(runDay.moved.length === 1 && runDay.moved[0].type === 'foundation_run' && !runDay.sessions.some(s => s.type === 'foundation_run'), 'run moves off a class day')
assert(runDay.sessions.some(s => s.type === 'mobility') && runDay.sessions.some(s => s.type === 'mt_class'), 'back care stays, class added')
const liftDay = rebalanceDayForClass([mob, strength], mtClass)
const lifted = liftDay.sessions.find(s => s.type === 'strength')!
assert(lifted.sets === 2 && lifted.rpe![1] === 7 && lifted.timeSlot === 'am', 'strength stays AM, one set lighter, RPE 7 cap')
assert(liftDay.sessions.find(s => s.type === 'mt_class')!.timeSlot === 'pm', 'class goes PM after strength (R15)')
assert(liftDay.moved.length === 0 && houseVoice(liftDay.reason), 'nothing moved on a lift day, reason in house voice')
assert(rebalanceDayForClass([mob], mtClass).reason === null, 'rest day + class: nothing to rebalance')

console.log('\nAll Block Zero readiness, auto-ease and MT tests passed')
