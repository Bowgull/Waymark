import assert from 'node:assert/strict'

import { dailyLogSchema } from '../../lib/validators/schemas'
import {
  BACK_NOTES_AT,
  CHECK_IN_QUESTIONS,
  answerLabel,
  answeredCount,
  answersFromLog,
  checkInPayload,
  checkInQuestions,
  checkInReducer,
  initialCheckIn,
  noteDayLabel,
  shouldOpenCheckIn,
  type CheckInState,
} from './checkInFlow'

const total = CHECK_IN_QUESTIONS.length

// ─── a tap answers and moves on ──
{
  let s: CheckInState = initialCheckIn()
  assert.equal(s.index, 0)
  s = checkInReducer(s, { type: 'answer', key: 'sleepHours', value: 7 })
  assert.equal(s.index, 1, 'auto-advance')
  assert.equal(s.answers.sleepHours, 7)
  s = checkInReducer(s, { type: 'pass' })
  assert.equal(s.index, 2, 'pass skips a question')
  assert.equal(s.answers.sleepQuality, undefined, 'a passed question stays empty')
  s = checkInReducer(s, { type: 'back' })
  assert.equal(s.index, 1)
  s = checkInReducer(initialCheckIn(), { type: 'back' })
  assert.equal(s.index, 0, 'back on the first card stays put')
}

// ─── every option value is one the API accepts ──
for (const q of CHECK_IN_QUESTIONS) {
  for (const o of q.options) {
    const parsed = dailyLogSchema.safeParse({ date: '2026-10-18', [q.key]: o.value })
    assert.ok(parsed.success, `${q.key}=${o.value} passes dailyLogSchema`)
  }
}

// ─── a bad back asks what bothers it, then moves on ──
{
  let s = initialCheckIn(null, CHECK_IN_QUESTIONS.findIndex(q => q.key === 'backToday'))
  s = checkInReducer(s, { type: 'answer', key: 'backToday', value: BACK_NOTES_AT })
  assert.equal(s.askingBackNotes, true)
  const at = s.index
  s = checkInReducer(s, { type: 'backNotes', text: 'Bending forward' })
  s = checkInReducer(s, { type: 'finishNotes' })
  assert.equal(s.askingBackNotes, false)
  assert.equal(s.index, at + 1)
  const body = checkInPayload(s, '2026-10-18')
  assert.equal(body.backToday, BACK_NOTES_AT)
  assert.equal(body.backNotes, 'Bending forward')
  // A good back never sends notes, and never asks.
  let g = initialCheckIn(null, at)
  g = checkInReducer(g, { type: 'answer', key: 'backToday', value: 4 })
  assert.equal(g.askingBackNotes, false)
  assert.equal(checkInPayload({ ...g, backNotes: 'old' }, '2026-10-18').backNotes, undefined)
  // Back from the notes card returns to the question.
  let b = checkInReducer(initialCheckIn(null, at), { type: 'answer', key: 'backToday', value: 1 })
  b = checkInReducer(b, { type: 'back' })
  assert.equal(b.askingBackNotes, false)
  assert.equal(b.index, at)
}

// ─── the last card finishes; the body has only what was answered ──
{
  let s = initialCheckIn()
  for (const q of CHECK_IN_QUESTIONS) {
    s = q.key === 'stress' ? checkInReducer(s, { type: 'pass' }) : checkInReducer(s, { type: 'answer', key: q.key, value: q.options[q.options.length - 1].value })
  }
  assert.equal(s.done, true)
  assert.equal(s.index, total)
  const body = checkInPayload(s, '2026-10-18')
  assert.equal(body.date, '2026-10-18')
  assert.equal('stress' in body, false, 'untouched stays out of the log')
  assert.equal(body.herbScale, 9, 'herb sends the 0-9 scale')
  assert.equal('weedGrams' in body, false, 'grams are never sent')
  assert.ok(dailyLogSchema.safeParse(body).success, 'the whole body passes the API schema')
  assert.equal(answeredCount(s.answers), total - 1)
  // Done ignores further taps until it is reopened.
  assert.equal(checkInReducer(s, { type: 'pass' }), s)
  const reopened = checkInReducer(s, { type: 'jump', index: 2 })
  assert.equal(reopened.done, false)
  assert.equal(reopened.index, 2)
}

// ─── herb: 0 (none) and 1-9 (9 = most), page 51 ──
{
  const herb = CHECK_IN_QUESTIONS.find(q => q.key === 'herbScale')!
  assert.equal(herb.title, 'Herb', 'the title stays')
  assert.equal(herb.sub, 'Last 24 h · 0 none, 9 most')
  assert.deepEqual(herb.options.map(o => o.value), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  assert.equal(herb.options[0].sub, 'none')
  assert.equal(herb.options[9].sub, 'most')
  assert.ok(herb.options.slice(1, 9).every(o => o.sub === undefined), '1-8 carry only the digit')
  assert.equal(herb.columns, 5, 'two rows of five')
  assert.equal(answerLabel('herbScale', 0), '0')
  assert.equal(answerLabel('herbScale', 9), '9')
  assert.equal(dailyLogSchema.safeParse({ date: '2026-10-18', herbScale: 10 }).success, false, '10 is off the scale')
  assert.equal(dailyLogSchema.safeParse({ date: '2026-10-18', herbScale: 2.5 }).success, false, 'whole points only')
  assert.deepEqual(answersFromLog({ herbScale: 3 }), { herbScale: 3 })
}

// ─── editing from the collapsed card ──
{
  const answers = answersFromLog({ sleepHours: 6, soreness: 4, energy: null, backToday: 2 })
  assert.deepEqual(answers, { sleepHours: 6, soreness: 4, backToday: 2 })
  assert.equal(answerLabel('sleepHours', 9), '9+ h')
  assert.equal(answerLabel('soreness', 4), 'sore')
  assert.equal(answerLabel('alcoholScale', 3), '3+')
  assert.equal(answersFromLog(null).sleepHours, undefined)
  const s = initialCheckIn(answers, 3)
  assert.equal(s.index, 3)
  assert.equal(s.answers.soreness, 4, 'existing answers are kept')
  assert.equal(initialCheckIn(null, 99).index, total - 1, 'start is clamped')
}

// ─── when the cards open ──
{
  const today = '2026-10-18'
  assert.equal(shouldOpenCheckIn({ today, hasLogToday: false, skippedOn: null, requested: false }), true, 'first open of the day')
  assert.equal(shouldOpenCheckIn({ today, hasLogToday: true, skippedOn: null, requested: false }), false, 'already checked in')
  assert.equal(shouldOpenCheckIn({ today, hasLogToday: false, skippedOn: today, requested: false }), false, 'skipped today')
  assert.equal(shouldOpenCheckIn({ today, hasLogToday: false, skippedOn: '2026-10-17', requested: false }), true, 'yesterday’s skip is old')
  assert.equal(shouldOpenCheckIn({ today, hasLogToday: true, skippedOn: today, requested: true }), true, "the alarm's I'M UP always opens")
}

// + ADD NOTE opened (page 46): the board names the day as "Sun 18"
assert.equal(noteDayLabel('2026-10-18'), 'Sun 18')
assert.equal(noteDayLabel('2026-10-01'), 'Thu 1')
assert.equal(noteDayLabel('nope'), '')

// ─── page 58: "Knee today" while the knee is on watch ──
{
  const qs = checkInQuestions([{ region: 'knee', label: 'KNEE TODAY' }])
  assert.equal(qs.length, 10, 'ten cards while the knee is on watch')
  assert.equal(qs[7].key, 'region:knee', 'Knee today is card 8 of 10, right after Back today')
  assert.equal(qs[7].sub, 'How it feels right now')
  assert.deepEqual(qs[7].options.map(o => o.sub), ['bad', 'sore', 'stiff', 'good', 'fine'], 'the same five tiles as Back today')
  let s = initialCheckIn(null, 7, qs)
  assert.equal(s.total, 10)
  s = checkInReducer(s, { type: 'answer', key: 'region:knee', value: 2 })
  assert.equal(s.index, 8, 'a tap answers and moves on')
  const body = checkInPayload(s, '2026-10-23')
  assert.deepEqual(body.regionRatings, { knee: 2 }, 'saved as { knee: 2 }')
  assert.ok(dailyLogSchema.safeParse(body).success, 'the server takes it')
  assert.equal(answersFromLog({ regionRatingsJson: '{"knee":4}' })['region:knee'], 4, 'read back from the log')
  assert.equal(checkInQuestions().length, total, 'nine cards with nothing on watch')
}

console.log('checkInFlow tests passed')
