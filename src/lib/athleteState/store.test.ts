// Run: tsx src/lib/athleteState/store.test.ts
import { resolveEffectiveLift } from './store'

let failures = 0
function check(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`FAIL: ${label}`) } else { console.log(`ok: ${label}`) }
}

const trend = { loadFactor: 0.9, verdict: 'deload' as const }
const stateLift = { loadFactor: 1.05, verdict: 'push' as const }

check('state wins when present', (() => {
  const e = resolveEffectiveLift(trend, stateLift)
  return e.source === 'state' && e.loadFactor === 1.05 && e.verdict === 'push'
})())

check('falls back to trend when no state lift', (() => {
  const e = resolveEffectiveLift(trend, undefined)
  return e.source === 'trend' && e.loadFactor === 0.9 && e.verdict === 'deload'
})())

check('neutral 1.0/none when neither present', (() => {
  const e = resolveEffectiveLift(undefined, undefined)
  return e.source === 'none' && e.loadFactor === 1 && e.verdict === undefined
})())

check('state wins even when trend absent', (() => {
  const e = resolveEffectiveLift(undefined, stateLift)
  return e.source === 'state' && e.loadFactor === 1.05
})())

if (failures > 0) { console.error(`\n${failures} test(s) failed`); process.exit(1) }
console.log('\nAll store tests passed')
