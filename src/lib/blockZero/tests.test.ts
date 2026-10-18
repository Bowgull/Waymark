// Run: tsx src/lib/blockZero/tests.test.ts
import { checkSetE1rm, e1rmsFromTests, e1rmTestKey, isTestWeek, parseTestKey, validateTestResult } from './tests'
import { epley } from './e1rm'
import { blockTestsBodySchema, dailyLogSchema, mtClassLogPatchSchema, strengthSetPatchSchema } from '../validators/schemas'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
  console.log(`ok: ${msg}`)
}

// ─── Weeks and keys ─────────────────────────────────────────────

assert([1, 3, 6].every(w => isTestWeek(w, 6)) && ![2, 4, 5, 7].some(w => isTestWeek(w, 6)), 'test weeks are 1, 3 and 6 in a 6-week block')
assert(isTestWeek(7, 7) && isTestWeek(8, 8) && !isTestWeek(9, 9), 'extension weeks can retest, up to week 8')
assert(parseTestKey('e1rm:ex-front-squat')?.kind === 'e1rm' && e1rmTestKey('ex-rdl') === 'e1rm:ex-rdl', 'e1rm keys carry the exercise id')
assert(parseTestKey('mobility:thoracic')?.kind === 'mobility' && parseTestKey('mobility:elbows') === null, 'mobility keys are a fixed area list')
assert(parseTestKey('pushups_max')?.kind === 'fixed' && parseTestKey('bench_1rm') === null && parseTestKey('e1rm:Front Squat') === null, 'unknown keys refused')

// ─── Validation ─────────────────────────────────────────────────

const ok = validateTestResult({ week: 1, testKey: 'pushups_max', value: 22 }, 6)
assert(ok.ok && ok.unit === 'reps', 'unit defaults from the key')
assert(!validateTestResult({ week: 1, testKey: 'pushups_max', value: 22, unit: 'kg' }, 6).ok, 'wrong unit refused')
assert(!validateTestResult({ week: 2, testKey: 'pushups_max', value: 22 }, 6).ok, 'non-test week refused')
assert(!validateTestResult({ week: 1, testKey: 'talk_test_hr', value: 400 }, 6).ok, 'heart rate out of range refused')
assert(validateTestResult({ week: 1, testKey: 'mobility:hips', value: 4, unit: 'score' }, 6).ok, 'mobility score 1-5')
assert(!validateTestResult({ week: 1, testKey: 'mobility:hips', value: 7, unit: 'score' }, 6).ok, 'mobility score above 5 refused')
assert(validateTestResult({ week: 1, testKey: 'mobility:ankle_l', value: 9, unit: 'cm' }, 6).ok, 'mobility as a measure (knee-to-wall cm)')
const e = validateTestResult({ week: 3, testKey: 'e1rm:ex-front-squat', value: 70 }, 6)
assert(e.ok && e.unit === 'kg' && e.exerciseId === 'ex-front-squat', 'e1rm result names its exercise for the existence check')
assert(!validateTestResult({ week: 6, testKey: 'side_plank_sec_l', value: Number.NaN }, 6).ok, 'NaN refused')
const words = [validateTestResult({ week: 2, testKey: 'pushups_max', value: 1 }, 6), validateTestResult({ week: 1, testKey: 'nope', value: 1 }, 6)]
assert(words.every(w => !w.ok && !w.error.includes('!') && !w.error.includes('—')), 'errors in house voice')

// ─── e1RM from a logged check set (R4) ──────────────────────────

const check = { week: 3, section: 'main', isWarmup: false, plannedReps: 5, weightKg: 60, reps: 5, rir: 2 }
assert(checkSetE1rm(check) === epley(60, 7), 'week-3 check set: Epley on reps + RIR')
assert(checkSetE1rm({ ...check, week: 6 }) != null, 'week 6 retest counts')
assert(checkSetE1rm({ ...check, week: 4 }) === null, 'week 4 has no check set')
assert(checkSetE1rm({ ...check, plannedReps: 8 }) === null, 'working sets of 8 never count')
assert(checkSetE1rm({ ...check, rir: null }) === null && checkSetE1rm({ ...check, weightKg: null }) === null, 'needs RIR and weight')
assert(checkSetE1rm({ ...check, reps: 8, rir: 3 }) === null, 'reps + RIR past 10 is out of range')
assert(checkSetE1rm({ ...check, section: 'accessory' }) === null && checkSetE1rm({ ...check, isWarmup: true }) === null, 'main working sets only')

const rows = [
  { week: 3, testKey: 'e1rm:ex-front-squat', value: 70 },
  { week: 6, testKey: 'e1rm:ex-front-squat', value: 76 },
  { week: 7, testKey: 'e1rm:ex-front-squat', value: 78 },
  { week: 6, testKey: 'pushups_max', value: 30 },
]
const retest = e1rmsFromTests(rows, w => w >= 6)
assert(retest.get('ex-front-squat') === 78 && retest.size === 1, 'retest e1RMs: weeks 6+, best per lift, e1rm keys only')

// ─── Request schemas ────────────────────────────────────────────

assert(strengthSetPatchSchema.safeParse({ weightKg: 40, reps: 8, completedAt: 1, rir: 3 }).success, 'set patch takes rir 0-3')
assert(!strengthSetPatchSchema.safeParse({ rir: 4 }).success && !strengthSetPatchSchema.safeParse({ rir: 1.5 }).success, 'rir 4 or fractional refused')
assert(strengthSetPatchSchema.safeParse({ weightKg: null, reps: 30 }).success, 'bodyweight and timed sets still log')
assert(mtClassLogPatchSchema.safeParse({ classType: 'pads', durationMin: 60 }).success, 'class patch: Block Zero names and minutes')
assert(mtClassLogPatchSchema.safeParse({ classType: 'general' }).success, 'class patch: log screen names still accepted')
assert(!mtClassLogPatchSchema.safeParse({ classType: 'kickboxing' }).success && !mtClassLogPatchSchema.safeParse({ durationMin: 0 }).success, 'unknown class type or zero minutes refused')
assert(dailyLogSchema.safeParse({ date: '2026-10-18', sleepQuality: 3, energy: 4, stress: 2, mood: 4, backToday: 3, backNotes: 'Stiff after sitting' }).success, 'check-in takes the new fields')
assert(!dailyLogSchema.safeParse({ date: '2026-10-18', backToday: 6 }).success && !dailyLogSchema.safeParse({ date: '2026-10-18', stress: 0 }).success, 'check-in items are 1-5')
const one = blockTestsBodySchema.safeParse({ week: 1, testKey: 'pushups_max', value: 20 })
const many = blockTestsBodySchema.safeParse({ results: [{ week: 1, testKey: 'pushups_max', value: 20 }, { week: 1, testKey: 'talk_test_hr', value: 142 }] })
const arr = blockTestsBodySchema.safeParse([{ week: 1, testKey: 'pushups_max', value: 20 }])
assert(one.success && one.data.length === 1 && many.success && many.data.length === 2 && arr.success, 'tests body: one, { results }, or an array')

console.log('\nAll Block Zero test-result tests passed')
