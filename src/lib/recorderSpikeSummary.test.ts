import assert from 'node:assert/strict'
import { clockText, decodeFlags, gapStats, haversineM, parseJournal, summarizeJournal } from './recorderSpikeSummary'

// Gaps: edges count, duplicates collapse, threshold is strict.
assert.deepEqual(gapStats([], 0, 30), { count: 1, longestSec: 30, totalSec: 30 }, 'no samples = one gap')
assert.deepEqual(gapStats([1, 2, 3, 4, 5], 0, 6), { count: 0, longestSec: 0, totalSec: 0 })
assert.deepEqual(gapStats([1, 1, 1, 10, 11], 0, 12), { count: 1, longestSec: 9, totalSec: 9 })
assert.equal(gapStats([1, 6], 0, 7).count, 0, 'exactly 5 s is not a gap')

// Haversine: 0.001 deg latitude is ~111 m.
const d = haversineM(43.65, -79.38, 43.651, -79.38)
assert.ok(d > 110 && d < 112, `haversine ${d}`)

// Flags
assert.deepEqual(decodeFlags('0x16'), { uint16: false, contactSupported: true, inContact: true, energy: false, rr: true })
assert.deepEqual(decodeFlags('0x04'), { uint16: false, contactSupported: true, inContact: false, energy: false, rr: false })
assert.equal(decodeFlags('0x00')?.contactSupported, false)
assert.equal(decodeFlags('0x11')?.uint16, true)

assert.equal(clockText(65), '1:05')
assert.equal(clockText(3930), '1:05:30')

// A tiny journal: 12 s, HR drops for 7 s, one reconnect, GPS moving north, one bad fix.
const lines: string[] = []
lines.push(JSON.stringify({ t: 100, ev: 'start' }))
for (let i = 1; i <= 12; i++) {
  const t = 100 + i
  const hrUp = i <= 3 || i >= 11
  lines.push(JSON.stringify({
    t, seq: i - 1,
    hr: hrUp ? 140 + i : null,
    hrT: hrUp ? t - 0.2 : 103 - 0.2,
    flagsHex: '0x16',
    rr: hrUp ? [420] : [],
    contact: 'contact',
    lat: 43.65 + i * 0.00002, lon: -79.38,
    hAcc: i === 6 ? 65 : 5,
    speed: 2.5, alt: 80,
    locT: t - 0.5,
    appState: i > 4 ? 'bg' : 'fg',
    locked: i > 4,
    bleState: hrUp ? 'connected' : 'reconnecting',
  }))
  if (i === 4) lines.push(JSON.stringify({ t: t + 0.1, ev: 'disconnected', error: null }))
  if (i === 10) lines.push(JSON.stringify({ t: t + 0.5, ev: 'connected', id: 'X' }))
}
lines.push('not json')
lines.push(JSON.stringify({ t: 112.4, ev: 'stop' }))
const text = lines.join('\n')

assert.equal(parseJournal(text).samples.length, 12)
assert.equal(parseJournal(text).events.length, 4)

const r = summarizeJournal(text)
assert.equal(r.samples, 12)
assert.equal(r.durationSec, 12.4)
assert.equal(r.tickGaps.count, 0)
assert.equal(r.hrGaps.count, 1, 'one HR gap')
assert.equal(r.hrGaps.longestSec, 8, '102.8 -> 110.8')
assert.equal(r.gpsGaps.count, 0)
assert.equal(r.disconnects, 1)
assert.equal(r.reconnects, 1)
assert.deepEqual(r.flagsSeen, ['0x16'])
assert.equal(r.rrPresent, true)
assert.equal(r.rrValues, 5)
assert.equal(r.contact, 'supported')
assert.equal(r.bgSeconds, 8)
assert.equal(r.lockedSeconds, 8)
assert.equal(r.gpsPointsUsed, 11, 'the 65 m fix is dropped')
// 11 points from i=1..12 minus i=6: span is 11 * 0.00002 deg = ~24.5 m
assert.ok(r.distanceM >= 23 && r.distanceM <= 26, `distance ${r.distanceM}`)
assert.equal(r.maxHr, 152)
assert.equal(r.medianHAcc, 5)

// Strap that does not report contact and has no RR.
const plain = [
  JSON.stringify({ t: 0, ev: 'start' }),
  JSON.stringify({ t: 1, hr: 120, hrT: 1, flagsHex: '0x00', rr: [], contact: 'unsupported', appState: 'fg', locked: false, bleState: 'connected' }),
  JSON.stringify({ t: 2, ev: 'stop' }),
].join('\n')
const p = summarizeJournal(plain)
assert.equal(p.rrPresent, false)
assert.equal(p.contact, 'unsupported')
assert.equal(p.gpsGaps.count, 0, '2 s run, no GPS gap over 5 s')
assert.equal(p.distanceM, 0)

console.log('recorder spike summary tests passed')
