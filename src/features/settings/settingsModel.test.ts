// Settings, Body metrics and Logs: the pure parts (page 37 A, page 45).
import assert from 'node:assert/strict'

import {
  agoText, clampYmd, cleanNumber, countLevels, daysUntilRedeploy, dobFlaps, filterFlaps, formatDob, histDate,
  joinTime, leadFlap, parseDob, splitTime, stepHour, stepMinute, tanakaMaxHr, timeFlap, todayFlap,
} from './settingsModel'
import { kgToLbs, lbsToKg } from '@/lib/units'

let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; void name }

test('times split into the 12-hour drums and join back', () => {
  assert.deepEqual(splitTime('06:30'), { h12: 6, mm: 30, slot: 'am' })
  assert.deepEqual(splitTime('17:30'), { h12: 5, mm: 30, slot: 'pm' })
  assert.deepEqual(splitTime('00:05'), { h12: 12, mm: 5, slot: 'am' })
  assert.deepEqual(splitTime('12:00'), { h12: 12, mm: 0, slot: 'pm' })
  assert.equal(joinTime(12, 0, 'am'), '00:00')
  assert.equal(joinTime(12, 0, 'pm'), '12:00')
  assert.equal(joinTime(5, 30, 'pm'), '17:30')
  for (const t of ['00:00', '06:30', '11:55', '12:10', '23:45']) {
    const s = splitTime(t)
    assert.equal(joinTime(s.h12, s.mm, s.slot), t)
  }
  assert.equal(timeFlap('17:30'), '5:30')
  assert.equal(timeFlap('06:05'), '6:05')
})

test('the drums wrap like page 37 (hours 1..12, minutes by 5)', () => {
  assert.equal(stepHour(12, 1), 1)
  assert.equal(stepHour(1, -1), 12)
  assert.equal(stepHour(6, 1), 7)
  assert.equal(stepMinute(55, 5), 0)
  assert.equal(stepMinute(0, -5), 55)
  assert.equal(stepMinute(32, 5), 37)
})

test('lead and redeploy badge', () => {
  assert.equal(leadFlap(30), '30 MIN BEFORE')
  const day = 86400000
  assert.equal(daysUntilRedeploy(1000 * day, 1000 * day + 2 * day + 5), 5)
  assert.equal(daysUntilRedeploy(1000 * day, 1000 * day + 9 * day), 0)
  assert.equal(daysUntilRedeploy(NaN, 0), null)
  assert.equal(daysUntilRedeploy(0, 0), null)
})

test('birth date: parse, flaps, month ends, Tanaka estimate', () => {
  const d = parseDob('1996-03-14')
  assert.deepEqual(d, { y: 1996, m: 3, d: 14 })
  assert.deepEqual(dobFlaps(d!), ['14', 'MAR', '1996'])
  assert.equal(formatDob(d!), '1996-03-14')
  assert.equal(parseDob(null), null)
  assert.equal(parseDob('14/03/1996'), null)
  assert.deepEqual(clampYmd({ y: 2023, m: 2, d: 31 }), { y: 2023, m: 2, d: 28 })
  assert.deepEqual(clampYmd({ y: 2024, m: 2, d: 31 }), { y: 2024, m: 2, d: 29 })
  // 30 on 18 Oct 2026 (birthday passed): 208 - 21 = 187
  assert.equal(tanakaMaxHr(d, new Date(2026, 9, 18)), 187)
  // birthday not yet: 29
  assert.equal(tanakaMaxHr({ y: 1996, m: 12, d: 1 }, new Date(2026, 9, 18)), Math.round(208 - 0.7 * 29))
  assert.equal(tanakaMaxHr(null, new Date()), null)
})

test('logs: counts and the filter flaps in page 37 order', () => {
  const c = countLevels(['error', 'warn', 'info', 'info', 'debug', 'error'])
  assert.deepEqual(c, { debug: 1, info: 2, warn: 1, error: 2 })
  assert.deepEqual(filterFlaps(6, c).map(f => f.text), ['ALL 6', 'ERRORS 2', 'WARN 1', 'INFO 2', 'DEBUG 1', 'THIS SESSION'])
  const now = 10_000_000_000
  assert.equal(agoText(now - 2 * 3600_000, now), '2 h ago')
  assert.equal(agoText(now - 26 * 3600_000, now), '1 d ago')
  assert.equal(agoText(now - 5 * 60_000, now), '5 min ago')
})

test('body metrics: dates and typed numbers', () => {
  assert.equal(histDate(new Date(2026, 9, 4).getTime()), 'OCT 04')
  assert.equal(todayFlap(new Date(2026, 9, 18)), 'SUN 18 OCT')
  assert.equal(cleanNumber('185.5', 5), '185.5')
  assert.equal(cleanNumber('18,5x', 5), '18.5')
  assert.equal(cleanNumber('1.2.3', 5), '1.23')
  assert.equal(cleanNumber('123456', 3), '123')
})

test('weight is typed and shown in lb, stored in kg', () => {
  for (const lb of [150, 185, 186, 188, 190, 240]) assert.equal(kgToLbs(lbsToKg(lb)), lb)
  assert.ok(Math.abs(lbsToKg(185) - 83.91) < 0.01)
})

console.log(`settingsModel: ${passed} passed`)
