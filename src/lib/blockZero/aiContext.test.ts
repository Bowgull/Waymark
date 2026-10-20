// Run: tsx src/lib/blockZero/aiContext.test.ts
import { estimateTokens, runCapsMin, serializeBlockZeroContext, type BlockZeroAiContextInput } from './aiContext'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
  console.log(`ok: ${msg}`)
}

const full: BlockZeroAiContextInput = {
  weekNumber: 3,
  totalWeeks: 6,
  readiness: {
    checkedIn: true,
    readinessEase: true,
    reason: 'Sleep and energy are off your 7-day trend for 2 days.',
    items: [
      { item: 'sleepHours', today: 5.5, mean7: 7.4, worse: true },
      { item: 'sleepQuality', today: 2, mean7: 3.9, worse: true },
      { item: 'energy', today: 2, mean7: 3.9, worse: true },
      { item: 'soreness', today: 3, mean7: 2.1, worse: false },
      { item: 'stress', today: 3, mean7: 2.4, worse: false },
      { item: 'mood', today: 3, mean7: 3.7, worse: false },
      { item: 'backToday', today: 3, mean7: 3.6, worse: false },
      { item: 'alcohol', today: 0, mean7: 0.3, worse: false },
      { item: 'cannabis', today: null, mean7: null, worse: false },
    ],
  },
  load: { last7: 1460, prev7: 1210, change: 0.207, flagged: true, applies: true },
  lifts: [
    { name: 'Goblet Squat', topSet: { weightKg: 26, reps: 8, rir: 3 }, next: { weightKg: 27.5, change: 'increase' } },
    { name: 'Bench Press', topSet: { weightKg: 52.5, reps: 8, rir: 2 }, next: { weightKg: 52.5, change: 'hold' } },
    { name: 'DB Romanian Deadlift', topSet: { weightKg: 24, reps: 8, rir: 3 }, next: { weightKg: 25, change: 'increase' } },
    { name: 'Overhead Press', topSet: { weightKg: 32.5, reps: 7, rir: 1 }, next: { weightKg: 31, change: 'decrease' } },
    { name: 'Dumbbell Row', topSet: { weightKg: 22, reps: 8, rir: 3 }, next: { weightKg: 22.5, change: 'increase' } },
    { name: 'Reverse Lunge', topSet: { weightKg: 12, reps: 8, rir: 3 }, next: { weightKg: 12.5, change: 'increase' } },
    { name: 'Seventh Lift', topSet: { weightKg: 10, reps: 8, rir: 3 }, next: null },
  ],
  backScores: [4, 4, null, 3, 3, 2, 2],
  backTrend: 'worse',
  run: { longestLast30Sec: 24 * 60 + 15, lastWeekRunSec: 72 * 60 },
  hrCeilingBpm: 142,
  mt: { weeksSinceFirstClass: 0, classesThisWeek: 1, profileCap: 2 },
}

const text = serializeBlockZeroContext(full)
console.log(`\n${text}\n`)

// Content.
assert(text.includes('Week 3 of 6. Phase: build.'), 'week and phase')
assert(text.includes('2 x 8 at RPE 7-8 (2-3 left)') && text.includes('3-5 rep check set at RPE 8') && text.includes('Never to failure'), 'this week\'s sets/reps/RPE and the check set')
assert(text.includes('7 x (2m run / 1m walk)') && text.includes('26 min') && text.includes('HR <= 142'), 'run-walk prescription and HR ceiling')
assert(text.includes('single <= 26 min') && text.includes('week <= 93 min'), 'run caps: 110% single, +30% weekly')
assert(text.includes('worse: sleepH 5.5 vs 7.4, sleepQ 2 vs 3.9, energy 2 vs 3.9; 5 others within a point') && text.includes('Ease: on'), 'readiness items vs the 7-day mean, ease on')
assert(text.includes('1460 vs 1210 (+21%)') && text.includes('Flag: on'), 'weekly sRPE load and week-over-week change')
assert(text.includes('Lifts (lb x reps') && text.includes('Bench Press 116x8 @2 -> 116 hold') && text.includes('Goblet Squat 57x8 @3+ -> 61 up'), 'recent RIR per main lift and next load per rules, in lb')
assert(!/\bkg\b|\dkg/i.test(text), 'no kg anywhere in the Block Zero context')
assert(!text.includes('Seventh Lift'), 'lifts capped at 6')
assert(text.includes('4 4 - 3 3 2 2') && text.includes('Trend: worse'), 'back today trend')
assert(text.includes('Muay thai:') && text.includes('Cap 2/week, 1 done') && text.includes('Each class is 60 min of hard work'), 'MT: cap and a class as an hour of hard work')
assert(!/Allowed:|technique|pads|clinch|sparring/i.test(text.slice(text.indexOf('Muay thai:'), text.indexOf('Muay thai:') + 160)), 'no class types offered to the AI (coach-brain §14)')
assert(text.includes('HARD LIMITS. You may only choose within these limits:') && text.includes('no mt_class') && text.includes('no hard session added today') && text.includes('no hard session added this week'), 'hard limits stated plainly, ease and load flag limits included')
assert(text.includes('one-line why: short sentences, no exclamation marks, no em dashes'), 'asks for a one-line why in the house voice')
assert(!/[!—]/.test(text), 'the context itself is in the house voice')

// Size bound.
const tokens = estimateTokens(text)
assert(tokens < 350 && text.length < 1300, `under 350 tokens (about ${tokens}, ${text.length} chars, every field filled)`)

// Sparse input: week 1, nothing logged.
const sparse = serializeBlockZeroContext({
  weekNumber: 1, totalWeeks: 6, readiness: null, load: null, lifts: [], backScores: [null, null, null, null, null, null, null], backTrend: null,
  run: null, hrCeilingBpm: null, mt: { weeksSinceFirstClass: null, classesThisWeek: 0, profileCap: null },
})
assert(sparse.includes('Phase: start') && sparse.includes('work up to a set of 8') && sparse.includes('no check-in today') && sparse.includes('under 2 weeks of data'), 'sparse week 1 renders')
assert(sparse.includes('single <= 23 min') && sparse.includes('week <= 69 min'), 'no run history: week-1 restart caps')
assert(!sparse.includes('Back today'), 'no back line without scores')
const ext = serializeBlockZeroContext({ ...full, weekNumber: 7, totalWeeks: 7 })
assert(ext.includes('Phase: extension') && ext.includes('3 x 8'), 'extension week reads week-5 targets')
assert(runCapsMin({ longestLast30Sec: 20 * 60, lastWeekRunSec: 60 * 60 }).single === 22, 'single cap 110% of 20 min = 22')

// Training data only: no personal fields reach the text, even if a caller passes them.
const leaky = { ...full, goals: 'Win a fight in Bangkok', injuries: 'Old L4 disc', name: 'Test Athlete', dob: '1990-01-01', notes: 'Slept at my mum\'s' } as unknown as BlockZeroAiContextInput
const leakText = serializeBlockZeroContext(leaky)
for (const secret of ['Bangkok', 'L4', 'Test Athlete', '1990', 'mum']) assert(!leakText.includes(secret), `no personal field leaks (${secret})`)
assert(leakText === text, 'extra fields change nothing')

console.log('\nBlock Zero AI context passed')
