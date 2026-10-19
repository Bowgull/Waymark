// Run: tsx src/lib/waybook.test.ts
// The Waybook's pages: reflections plus the check-in's morning notes (page 46).
import assert from 'node:assert/strict'
import { MORNING_ENTRY_TYPE, morningNoteEntries, waybookEntries } from './waybook'
import { bookPages, entryDateLine, isMorningNote, MORNING_ENTRY_TYPE as MODEL_MORNING } from '../features/library/libraryModel'
import { isoToEpochDay } from './dates'

const D = isoToEpochDay
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok: ${name}`) }

const logs = [
  { id: 'l1', logDate: D('2026-10-18'), notes: 'Hip tight on the left. Slept badly.', createdAt: 100 },
  { id: 'l2', logDate: D('2026-10-17'), notes: '   ', createdAt: 90 },
  { id: 'l3', logDate: D('2026-10-16'), notes: 'Back fine. Calves sore from the run.', createdAt: 80 },
  { id: 'l4', logDate: D('2026-10-15'), notes: null, createdAt: 70 },
  { id: 'l5', logDate: D('2026-01-01'), notes: 'Too old.', createdAt: 10 },
]

test('morning notes: the day’s note from the daily log, blank and old ones left out', () => {
  const m = morningNoteEntries(logs, D('2026-09-01'))
  assert.deepEqual(m.map(e => e.id), ['morning-l1', 'morning-l3'])
  assert.equal(m[0].type, MORNING_ENTRY_TYPE)
  assert.equal(m[0].date, D('2026-10-18'))
  assert.equal(m[0].content, 'Hip tight on the left. Slept badly.')
  assert.equal(MORNING_ENTRY_TYPE, MODEL_MORNING, 'the server and the page agree on the type')
})

test('the book: morning notes on the same pages, tagged, above the day’s reflection', () => {
  const journal = [{ id: 'j1', date: D('2026-10-18'), type: 'daily', content: 'Squat felt honest today.', createdAt: 500 }]
  const all = waybookEntries(journal, logs, D('2026-09-01'))
  assert.equal(all.length, 3)
  const pages = bookPages(all)
  assert.equal(pages.length, 1)
  assert.deepEqual(pages[0].entries.map(e => e.id), ['morning-l1', 'j1', 'morning-l3'])
  assert.deepEqual(pages[0].entries.map(isMorningNote), [true, false, true])
  assert.equal(entryDateLine(pages[0].entries[0]), 'SUN, OCT 18')
})

console.log(`waybook: ${passed} passed`)
