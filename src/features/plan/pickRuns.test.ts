// Run: tsx src/features/plan/pickRuns.test.ts
// EVERYTHING ELSE collapses the run types into one RUNS line; RUNS opens them in their own order.
import assert from 'node:assert/strict'
import { everythingEntries, isRunPick, runPicks } from './pickRuns'

const all = [
  { type: 'strength', label: 'Strength' }, { type: 'foundation_run', label: 'Run-Walk' }, { type: 'mt_class', label: 'MT Class' },
  { type: 'running', runCategory: 'progression', label: 'Zone 2 Run' }, { type: 'bag_work', label: 'Bag Work' },
  { type: 'running', runCategory: '5k_test', label: '5K Test' }, { type: 'running', runCategory: 'tempo', label: 'Tempo' },
  { type: 'running', runCategory: 'intervals', label: 'Intervals' }, { type: 'skip_rope', label: 'Skip Rope' },
]
const e = everythingEntries(all)
assert.deepEqual(e.map(x => (x.kind === 'runs' ? `RUNS(${x.count})` : x.row.label)), ['Strength', 'RUNS(5)', 'MT Class', 'Bag Work', 'Skip Rope'], 'one RUNS line where the first run sat; MT Class and Skip Rope still there')
assert.deepEqual(runPicks(all).map(o => o.label), ['Zone 2 Run', 'Run-Walk', 'Tempo', 'Intervals', '5K Test'])
assert.equal(isRunPick({ type: 'skip_rope' }), false)
assert.deepEqual(everythingEntries([{ type: 'strength', label: 'Strength' }]).map(x => x.kind), ['row'], 'no runs: no RUNS line')
console.log('pickRuns: ok')
