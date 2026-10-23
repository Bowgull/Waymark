// Run: tsx src/lib/libraryHints.test.ts
// Page 60's live coach hints (approved 2026-10-20): the mockup's lines from his own logs,
// and the static hint when there is no history.
import assert from 'node:assert/strict'

import { comboHint, exerciseHint, lastWorkingSets, runHint, runWalkShape, runWalkTotal, setText, type SetRow } from './libraryHints'

const SQUAT = 'Your main squat. Goblet squats in weeks 1-2, front squat from week 3. Sets of 8 with 2-3 reps left; your squat max is worked out from these sets.'

// the last logged working set: warm-ups, pre-filled (never logged) and zero-rep sets left out
const set = (o: Partial<SetRow>): SetRow => ({ exerciseId: 'ex-front-squat', weightKg: 47.6, reps: 8, bandColor: null, isWarmup: 0, setNumber: 1, completedAt: 1_800_000_000, day: 20_833, ...o })
const last = lastWorkingSets([
  set({ weightKg: 40, completedAt: 1_799_000_000, day: 20_821 }),
  set({ weightKg: 47.6, reps: 8, setNumber: 3 }),
  set({ weightKg: 47.6, reps: 7, setNumber: 2 }),
  set({ weightKg: 20, isWarmup: 1, completedAt: 1_800_000_500 }),
  set({ weightKg: 60, completedAt: null, setNumber: 4 }),
  set({ weightKg: 60, reps: 0, completedAt: 1_800_000_900 }),
  set({ exerciseId: 'ex-band-row', weightKg: null, bandColor: 'red', reps: 12, day: null, completedAt: 1_800_086_400 }),
  set({ exerciseId: 'ex-pullup', weightKg: null, reps: 5 }),
])
assert.deepEqual(last['ex-front-squat'], { weightKg: 47.6, reps: 8, bandColor: null, day: 20_833 })
assert.equal(last['ex-band-row'].day, Math.floor(1_800_086_400 / 86400), 'no session day: the day it was logged')
assert.equal(lastWorkingSets([set({ isWarmup: 1 }), set({ completedAt: null })])['ex-front-squat'], undefined, 'nothing logged: no history')

// the lift: lb from kg, "Last time 105 lb × 8." after the static hint (page 60's Front Squat)
assert.equal(setText({ weightKg: 47.6, reps: 8, bandColor: null }), '105 lb × 8')
assert.equal(exerciseHint(SQUAT, last['ex-front-squat']), `${SQUAT} Last time 105 lb × 8.`)
assert.equal(exerciseHint(SQUAT, null), SQUAT, 'no history: the static hint')
assert.equal(exerciseHint(null, last['ex-front-squat']), 'Last time 105 lb × 8.')
assert.equal(exerciseHint('No stop', last['ex-front-squat']), 'No stop. Last time 105 lb × 8.')
assert.equal(exerciseHint(null, last['ex-band-row']), 'Last time red band × 12.')
assert.equal(exerciseHint(null, last['ex-pullup']), 'Last time 5 reps.')
assert.equal(exerciseHint(null, null), null)

// a combo: open and still being learned, page 60's line for its tier; locked, the static hint
const LOCKED = 'Locked. The coach offers it after a bag session once your Weapons combos are solid.'
assert.equal(comboHint({ tier: 'weapons', unlocked: 1, masteryScore: 6, coachHint: LOCKED }), 'Open, in your Weapons rounds. Rate it after each round; it comes up more until it is Solid.')
assert.equal(comboHint({ tier: 'foundation', unlocked: 1, masteryScore: 0, coachHint: null }), 'Open, in your Fundamentals rounds. Rate it after each round; it comes up more until it is Solid.')
assert.equal(comboHint({ tier: 'weapons', unlocked: 0, masteryScore: 0, coachHint: LOCKED }), LOCKED)
assert.equal(comboHint({ tier: 'foundation', unlocked: 1, masteryScore: 12, coachHint: 'Open. In your Fundamentals rounds; rate it after each round to build mastery.' }), 'Open. In your Fundamentals rounds; rate it after each round to build mastery.', 'mastered: the static hint')
assert.equal(comboHint({ tier: 'weapons', unlocked: 1, masteryScore: 12, coachHint: LOCKED }), 'Open, in your Weapons rounds.', 'mastered, but the static hint still says locked')

// run-walk: this Block Zero week's shape (page 60's Run-Walk, week 3)
const RUNWALK = { runType: 'run_walk', coachHint: 'Every Block Zero run (Tue, Thu, Sat). Week 1 is 6 rounds of 1 min run, 2 min walk.' }
assert.equal(runHint(RUNWALK, { week: 3, runSec: 120, walkSec: 60, rounds: 7, warmupSec: 300 }), 'Every Block Zero run: Tue, Thu, Sat. Week 3: 7 rounds of 2 min run, 1 min walk. 26 min in all.')
assert.equal(runHint(RUNWALK, { week: 2, runSec: 90, walkSec: 75, rounds: 7, warmupSec: 300 }), 'Every Block Zero run: Tue, Thu, Sat. Week 2: 7 rounds of 1.5 min run, 75 sec walk. 24 min in all.')
assert.equal(runHint(RUNWALK, { week: 4, runSec: 210, walkSec: 60, rounds: 5, warmupSec: 300 }), 'Every Block Zero run: Tue, Thu, Sat. Week 4: 5 rounds of 3.5 min run, 1 min walk. 27.5 min in all.')
assert.equal(runHint(RUNWALK, null), RUNWALK.coachHint, 'no Block Zero: the static hint')
assert.equal(runHint({ runType: 'tempo', coachHint: 'Later.' }, { week: 3, runSec: 120, walkSec: 60, rounds: 7, warmupSec: 300 }), 'Later.')

// page 65: the run-walk item page's meta line and its whole time
assert.equal(runWalkShape({ week: 1, runSec: 60, walkSec: 120, rounds: 6, warmupSec: 300 }), '6 × 1 min run, 2 min walk')
assert.equal(runWalkTotal({ week: 1, runSec: 60, walkSec: 120, rounds: 6, warmupSec: 300 }), '23 min in all.')
assert.equal(runWalkTotal({ week: 3, runSec: 120, walkSec: 60, rounds: 7, warmupSec: 300 }), '26 min in all.')
// Audit #17: the coach's dosed run, not the week's template.
assert.equal(runWalkShape({ week: 1, runSec: 1200, walkSec: 0, rounds: 1, warmupSec: 0 }), '20 min easy, no walk breaks')
assert.equal(runWalkTotal({ week: 1, runSec: 1200, walkSec: 0, rounds: 1, warmupSec: 0 }), '20 min in all.')
assert.equal(runWalkShape({ week: 1, runSec: 0, walkSec: 0, rounds: 0, warmupSec: 1500, walkOnly: true }), 'easy walk or bike, 25 min')
assert.equal(runHint({ runType: 'run_walk' }, { week: 1, runSec: 900, walkSec: 0, rounds: 1, warmupSec: 0 }), 'Every Block Zero run: Tue, Thu, Sat. Next: 15 min easy, no walk breaks.')

console.log('libraryHints tests passed')
