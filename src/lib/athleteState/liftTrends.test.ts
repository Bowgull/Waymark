// Run: tsx src/lib/athleteState/liftTrends.test.ts
import {
  computeLiftVerdict,
  sessionSignalFromStatuses,
  clampLoadFactor,
  type ExerciseSessionPoint,
} from './liftTrends'

let failures = 0
function check(label: string, cond: boolean) {
  if (!cond) {
    failures++
    console.error(`FAIL: ${label}`)
  } else {
    console.log(`ok: ${label}`)
  }
}

function pts(...signals: Array<ExerciseSessionPoint['signal']>): ExerciseSessionPoint[] {
  // newest first; epochDay descending
  return signals.map((signal, i) => ({ epochDay: 1000 - i, signal, bandColor: null }))
}

// ── sessionSignalFromStatuses ──────────────────────────────
check('empty statuses -> normal', sessionSignalFromStatuses([]) === 'normal')
check('all normal -> normal', sessionSignalFromStatuses(['normal', 'normal']) === 'normal')
check('one shortfall among normals -> normal (not yanked)', sessionSignalFromStatuses(['rep_shortfall', 'normal', 'normal']) === 'normal')
check('two shortfalls -> short', sessionSignalFromStatuses(['rep_shortfall', 'rep_shortfall', 'normal']) === 'short')
check('lighter dominant -> short', sessionSignalFromStatuses(['lighter', 'lighter']) === 'short')
check('surplus dominant -> over', sessionSignalFromStatuses(['rep_surplus', 'rep_surplus']) === 'over')
check('heavier dominant -> over', sessionSignalFromStatuses(['heavier', 'heavier']) === 'over')
check('null statuses -> normal', sessionSignalFromStatuses([null, null]) === 'normal')

// ── computeLiftVerdict ─────────────────────────────────────
check('no sessions -> insufficient/hold/1.0',
  (() => { const r = computeLiftVerdict([]); return r.direction === 'insufficient_data' && r.verdict === 'hold' && r.loadFactor === 1.0 })())

check('single short session -> hold (do not yank on one data point)',
  (() => { const r = computeLiftVerdict(pts('short')); return r.verdict === 'hold' && r.loadFactor === 1.0 })())

check('single over session -> hold (need consistency to push)',
  (() => { const r = computeLiftVerdict(pts('over')); return r.verdict === 'hold' && r.loadFactor === 1.0 })())

check('two shorts -> deload 0.9 regressing',
  (() => { const r = computeLiftVerdict(pts('short', 'short')); return r.direction === 'regressing' && r.verdict === 'deload' && r.loadFactor === 0.9 })())

check('two overs -> push 1.05 progressing',
  (() => { const r = computeLiftVerdict(pts('over', 'over')); return r.direction === 'progressing' && r.verdict === 'push' && r.loadFactor === 1.05 })())

check('short then over (mixed) -> hold',
  (() => { const r = computeLiftVerdict(pts('short', 'over')); return r.verdict === 'hold' && r.loadFactor === 1.0 })())

check('two shorts + one over in window -> hold (not unanimous)',
  (() => { const r = computeLiftVerdict(pts('short', 'short', 'over')); return r.verdict === 'hold' })())

check('three shorts -> deload',
  (() => { const r = computeLiftVerdict(pts('short', 'short', 'short')); return r.verdict === 'deload' && r.loadFactor === 0.9 })())

check('recovery: latest two normal after old short -> hold',
  (() => { const r = computeLiftVerdict(pts('normal', 'normal', 'short')); return r.verdict === 'hold' })())

// ── clampLoadFactor ────────────────────────────────────────
check('clamp below floor', clampLoadFactor(0.5) === 0.85)
check('clamp above ceiling', clampLoadFactor(1.5) === 1.05)
check('clamp passthrough', clampLoadFactor(1.0) === 1.0)

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`)
  process.exit(1)
}
console.log('\nAll liftTrends tests passed')
