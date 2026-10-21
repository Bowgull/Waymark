// Run: tsx src/lib/brain/evals/evals.test.ts
// The eval set (idea 9) in CI with the AI mocked: every night through every
// stand-in, good and bad (agrees, always careful, says yes to everything,
// talks class content, pushes with numbers, pushes on a note, writes the
// notebook). The guards must hold for all of them and the rules' criteria
// must hold; the AI criteria are scored and printed (the real model is run by
// hand: scripts/coach-evals.mts).
import assert from 'node:assert/strict'
import { MOCK_AIS, type MockAiName } from '../mockAi'
import { NIGHTS } from './nights'
import { consistency, runNight, score } from './run'

assert.ok(NIGHTS.length >= 40 && NIGHTS.length <= 60, `40-60 nights: ${NIGHTS.length}`)
assert.equal(new Set(NIGHTS.map(n => n.id)).size, NIGHTS.length, 'unique ids')

const mocks: MockAiName[] = ['mirror', 'careful', 'sycophant', 'class-content', 'pusher', 'note-pusher', 'notebook', 'travel']
const failures: string[] = []
const aiScores: Record<string, number[]> = {}
for (const name of mocks) {
  const ai = MOCK_AIS[name]
  for (const n of NIGHTS) {
    const r = await runNight(n, (night, retry) => ai(night.packet, retry != null))
    const guards = score(r, n.criteria, 'guard')
    if (guards.failed.length) failures.push(`${name} / ${n.id}: guard ${guards.failed.join(', ')}`)
    if (name === 'mirror') {
      const rules = score(r, n.criteria, 'rules')
      if (rules.failed.length) failures.push(`rules / ${n.id}: ${rules.failed.map(id => `${id} (${n.criteria.find(c => c.id === id)?.text})`).join(', ')}`)
    }
    if (n.criteria.some(c => c.who === 'ai')) (aiScores[name] ??= []).push(score(r, n.criteria, 'ai').score)
  }
}
assert.deepEqual(failures, [], failures.join('\n'))

// Consistency: a deterministic stand-in is the same every run (the real model is measured by hand).
const night = NIGHTS.find(n => n.id === 'one-easy-session')!
const runs = await Promise.all([1, 2, 3].map(() => runNight(night, nt => MOCK_AIS.pusher(nt.packet, false))))
assert.equal(consistency(runs), 1)

for (const [name, xs] of Object.entries(aiScores)) console.log(`eval ai score with ${name}: ${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2)} over ${xs.length} nights`)
console.log(`ok: ${NIGHTS.length} eval nights; guards hold for ${mocks.length} stand-ins; rules criteria hold`)
console.log('coach-brain eval set tests passed')
