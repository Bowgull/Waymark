// Block Zero test-row formatting (no test week since 2026-10-18). The end
// gate's comparison, verdict and Program board are gone (coach-brain §8).
import assert from 'node:assert/strict'

import { formatTestValue, liftNameFromId } from './testWeek'

// ─── formatting: lb for weights ──
{
  assert.equal(formatTestValue(88.5, 'kg'), '195 lb', 'weights stored in kg read in lb')
  assert.equal(formatTestValue(142, 'bpm'), '142 bpm')
  assert.equal(liftNameFromId('ex-front-squat'), 'Front squat')
}

console.log('test-row tests passed')
