// Run: tsx src/lib/coach/feltHard.test.ts
// How a session felt: way over target effort, or soreness 4+ the next
// morning, eases the next similar session (small, auto, with a reason).
// Consistently easier than target feeds the ramp-up ask.
import { consistentlyEasier, effortVerdict, summarizeEffort, TARGET_RIR } from './effort'
import { MON, assert,} from './testUtil'
import { nameInSentence, typicalRpe } from './sessions'


assert(effortVerdict({ epochDay: MON, type: 'strength', rpe: 7 }) === 'on_target', 'strength RPE 7: on target')
assert(effortVerdict({ epochDay: MON, type: 'strength', rpe: 9 }) === 'way_harder', 'strength RPE 9: way harder')
assert(effortVerdict({ epochDay: MON, type: 'strength', rpe: 8 }) === 'harder', 'strength RPE 8: harder')
assert(effortVerdict({ epochDay: MON, type: 'strength', rpe: 5 }) === 'easier', 'strength RPE 5: easier')
assert(effortVerdict({ epochDay: MON, type: 'strength', rpe: null, rir: TARGET_RIR + 1 }) === 'easier', '3 reps in reserve with no RPE: easier')
assert(effortVerdict({ epochDay: MON, type: 'strength', rpe: 5, rir: 1 }) === 'harder', 'a grinder set is never easy')
assert(effortVerdict({ epochDay: MON, type: 'strength', rpe: 7, rir: 0 }) === 'way_harder', 'sets to failure: way harder')
assert(effortVerdict({ epochDay: MON, type: 'foundation_run', rpe: 6 }) === 'way_harder', 'easy run at RPE 6: way harder than an easy run')
assert(effortVerdict({ epochDay: MON, type: 'strength', rpe: null }) === 'unknown', 'nothing logged: unknown')

const easier = summarizeEffort([{ epochDay: MON, type: 'strength', rpe: 5 }, { epochDay: MON + 1, type: 'mt_class', rpe: 5 }, { epochDay: MON + 2, type: 'mobility', rpe: 1 }])
assert(easier.sessions === 2 && easier.easier === 2 && consistentlyEasier(easier), 'two sessions under target (Foundation ignored): consistently easier')
assert(!consistentlyEasier(summarizeEffort([{ epochDay: MON, type: 'strength', rpe: 5 }, { epochDay: MON + 1, type: 'strength', rpe: 9 }])), 'one hard session breaks the streak')

// E2E minor 14: names inside a sentence keep their letter ("Mon strength A eases", not "strength a").
assert(nameInSentence('Strength A') === 'strength A' && nameInSentence('MT Technique') === 'MT technique' && nameInSentence('Run-Walk') === 'run-walk', 'session names in a sentence')

// E2E minor 21: the finish sheet opens on the session's own effort, not 7 for everything.
assert(typicalRpe({ type: 'foundation_run', label: 'Run-Walk', notes: null }) === 4 && typicalRpe({ type: 'mt_class', label: 'MT Technique', notes: null }) === 7 && typicalRpe({ type: 'strength', label: 'Strength A', notes: null }) === 7, 'finish sheet start: easy run 4, any class 7 (a class is hard work whatever its label), strength 7')

console.log('feltHard tests passed')
