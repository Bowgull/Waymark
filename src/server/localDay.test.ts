// Run: tsx src/server/localDay.test.ts
// The local-day fix (coach-brain P0, §1.4.6): the server's "today" is the
// athlete's day. Every app request carries the phone's local date
// (X-Waymark-Today); an explicit `today` wins; without either the old
// fallback (the target day capped at UTC today) stands. 8:30 PM in Toronto is
// already tomorrow in UTC: the coach must still read it as today.
import assert from 'node:assert/strict'
import { athleteDayFrom, isoToEpochDay, localIsoOf, TODAY_HEADER } from '../lib/dates'
import { migratedSqlite } from './replay/db'
import { d1Shim } from './replay/d1Shim'
import { installClock, uninstallClock } from './replay/clock'

const OCT20 = isoToEpochDay('2026-10-20')
// 2026-10-21 00:30 UTC = 2026-10-20 20:30 in Toronto (UTC-4).
const lateEvening = Date.UTC(2026, 9, 21, 0, 30)

// ─── The rule ────────────────────────────────────────────────
assert.equal(athleteDayFrom({ header: '2026-10-20', nowMs: lateEvening }), OCT20, 'the header is his day')
assert.equal(athleteDayFrom({ today: '2026-10-19', header: '2026-10-20', nowMs: lateEvening }), OCT20 - 1, 'an explicit today wins over the header')
assert.equal(athleteDayFrom({ header: 'garbage', nowMs: lateEvening }), OCT20 + 1, 'a bad header falls back to the UTC day')
assert.equal(athleteDayFrom({ targetDay: OCT20, nowMs: lateEvening }), OCT20, 'no header: the target day capped at UTC today (the old rule)')
assert.equal(athleteDayFrom({ today: 42, nowMs: lateEvening }), OCT20 + 1, 'a non-string today is ignored')
assert.match(localIsoOf(Date.now()), /^\d{4}-\d{2}-\d{2}$/, 'an outbox entry\'s day as YYYY-MM-DD')
console.log('ok: the athlete day rule')

// ─── On the real app, late in the evening ────────────────────
installClock(lateEvening)
try {
  const app = (await import('./app')).default
  const env = { DB: d1Shim(migratedSqlite(':memory:')), WAYMARK_API_KEY: 'k', ANTHROPIC_API_KEY: '' }
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} }
  const get = async (path: string, headers: Record<string, string> = {}) => {
    const res = await app.fetch(new Request(`http://local${path}`, { headers: { Authorization: 'Bearer k', ...headers } }), env as never, ctx as never)
    return res.json() as Promise<{ epochDay: number }>
  }
  const withHeader = await get('/api/readiness/today', { [TODAY_HEADER]: '2026-10-20' })
  assert.equal(withHeader.epochDay, OCT20, 'readiness at 8:30 PM reads his day (Oct 20), not UTC\'s Oct 21')
  const withQuery = await get('/api/readiness/today?date=2026-10-19', { [TODAY_HEADER]: '2026-10-20' })
  assert.equal(withQuery.epochDay, OCT20 - 1, 'an explicit date still wins')
  const bare = await get('/api/readiness/today')
  assert.equal(bare.epochDay, OCT20 + 1, 'a request without the header keeps the old UTC fallback')
} finally {
  uninstallClock()
}
console.log('ok: the server reads the athlete\'s day')
