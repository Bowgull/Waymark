// Run: tsx src/lib/coach/feltHard.test.ts
// How a session felt: way over target effort, or soreness 4+ the next
// morning, eases the next similar session (small, auto, with a reason).
// Consistently easier than target feeds the ramp-up ask.
import { consistentlyEasier, effortVerdict, feltHardEase, summarizeEffort, TARGET_RIR } from './feltHard'
import { MON, assert, s } from './testUtil'
import { nameInSentence } from './sessions'

const houseVoice = (t: string) => !t.includes('!') && !t.includes('—')

assert(effortVerdict({ epochDay: MON, type: 'strength', rpe: 7 }) === 'on_target', 'strength RPE 7: on target')
assert(effortVerdict({ epochDay: MON, type: 'strength', rpe: 9 }) === 'way_harder', 'strength RPE 9: way harder')
assert(effortVerdict({ epochDay: MON, type: 'strength', rpe: 8 }) === 'harder', 'strength RPE 8: harder')
assert(effortVerdict({ epochDay: MON, type: 'strength', rpe: 5 }) === 'easier', 'strength RPE 5: easier')
assert(effortVerdict({ epochDay: MON, type: 'strength', rpe: null, rir: TARGET_RIR + 1 }) === 'easier', '3 reps in reserve with no RPE: easier')
assert(effortVerdict({ epochDay: MON, type: 'strength', rpe: 5, rir: 1 }) === 'harder', 'a grinder set is never easy')
assert(effortVerdict({ epochDay: MON, type: 'strength', rpe: 7, rir: 0 }) === 'way_harder', 'sets to failure: way harder')
assert(effortVerdict({ epochDay: MON, type: 'foundation_run', rpe: 6 }) === 'way_harder', 'easy run at RPE 6: way harder than an easy run')
assert(effortVerdict({ epochDay: MON, type: 'strength', rpe: null }) === 'unknown', 'nothing logged: unknown')

const nextStrength = { ...s('strength', MON + 3), id: 'next-str' }
const nextRun = { ...s('foundation_run', MON + 2, { label: 'Zone 2' }), id: 'next-run' }
const upcoming = [nextRun, nextStrength]

const hard = feltHardEase({ done: { sessionId: 'done1', epochDay: MON + 1, type: 'strength', rpe: 9 }, nextMorningSoreness: 2, upcoming, todayEpochDay: MON + 1, nowSec: 1 })
assert(hard != null && hard.targetSessionId === 'next-str' && hard.ease.kind === 'reduce' && hard.cause === 'effort', 'RPE 9 strength: the next strength day eases')
assert(hard != null && houseVoice(hard.ease.reason) && hard.ease.reason.includes('Thu'), `one-line reason: ${hard?.ease.reason}`)
const sore = feltHardEase({ done: { sessionId: 'done2', epochDay: MON + 1, type: 'strength', rpe: 7 }, nextMorningSoreness: 4, upcoming, todayEpochDay: MON + 2, nowSec: 1 })
assert(sore != null && sore.cause === 'soreness' && sore.targetSessionId === 'next-str' && sore.ease.reason.startsWith('Soreness 4'), 'soreness 4 the morning after: next similar session eases')
assert(feltHardEase({ done: { epochDay: MON + 1, type: 'strength', rpe: 7 }, nextMorningSoreness: 3, upcoming, todayEpochDay: MON + 2, nowSec: 1 }) === null, 'on target and soreness 3: nothing changes')
assert(feltHardEase({ done: { epochDay: MON + 1, type: 'foundation_run', label: 'Zone 2', rpe: 3 }, nextMorningSoreness: 4, upcoming, todayEpochDay: MON + 2, nowSec: 1 }) === null, 'soreness after an easy run is not blamed on it')
const runHard = feltHardEase({ done: { epochDay: MON, type: 'running', notes: 'zone2', rpe: 7 }, nextMorningSoreness: null, upcoming, todayEpochDay: MON + 1, nowSec: 1 })
assert(runHard?.targetSessionId === 'next-run', 'runs are one family: a hard run eases the next easy run')
assert(feltHardEase({ done: { epochDay: MON + 1, type: 'strength', rpe: 10 }, nextMorningSoreness: null, upcoming: [{ ...nextStrength, eased: true }], todayEpochDay: MON + 1, nowSec: 1 }) === null, 'an already eased session is left alone')
assert(feltHardEase({ done: { epochDay: MON + 1, type: 'mobility', rpe: 10 }, nextMorningSoreness: 5, upcoming, todayEpochDay: MON + 1, nowSec: 1 }) === null, 'Foundation never triggers an ease')

const easier = summarizeEffort([{ epochDay: MON, type: 'strength', rpe: 5 }, { epochDay: MON + 1, type: 'mt_class', rpe: 5 }, { epochDay: MON + 2, type: 'mobility', rpe: 1 }])
assert(easier.sessions === 2 && easier.easier === 2 && consistentlyEasier(easier), 'two sessions under target (Foundation ignored): consistently easier')
assert(!consistentlyEasier(summarizeEffort([{ epochDay: MON, type: 'strength', rpe: 5 }, { epochDay: MON + 1, type: 'strength', rpe: 9 }])), 'one hard session breaks the streak')

// E2E minor 14: names inside a sentence keep their letter ("Mon strength A eases", not "strength a").
assert(nameInSentence('Strength A') === 'strength A' && nameInSentence('MT Technique') === 'MT technique' && nameInSentence('Run-Walk') === 'run-walk', 'session names in a sentence')

console.log('feltHard tests passed')
