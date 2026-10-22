import assert from 'node:assert/strict'
import { cleanHr, durationText, isRecording, recordingSplits, summarizeRecording, zoneStreams, type RunRecording } from './runRecording'

function rec(n: number, hrAt: (i: number) => number | null, opts: { outdoor?: boolean; mps?: number; pausedFrom?: number; pausedTo?: number } = {}): RunRecording {
  const t: number[] = [], hr: (number | null)[] = [], moving: (0 | 1)[] = [], distM: number[] = []
  let d = 0
  for (let i = 0; i < n; i++) {
    const paused = opts.pausedFrom != null && i >= opts.pausedFrom && i < (opts.pausedTo ?? n)
    if (!paused) d += opts.mps ?? 2.5
    t.push(i); hr.push(hrAt(i)); moving.push(paused ? 0 : 1); distM.push(d)
  }
  return { runId: 'r1', sessionId: 's1', runSessionId: 'rs1', startedAt: 1_000, endedAt: 1_000 + n, outdoor: opts.outdoor ?? true, series: { t, hr, moving, distM } }
}

// Out of range and lone spikes go; a jump that holds stays; gaps stay null.
{
  assert.deepEqual(cleanHr([140, 20, 141, 230, null, 142]), [140, null, 141, null, null, 142])
  assert.deepEqual(cleanHr([140, 141, 190, 141, 142]), [140, 141, null, 141, 142])
  assert.deepEqual(cleanHr([120, 121, 150, 151, 150, 152, 151]), [120, 121, 150, 151, 150, 152, 151])
}

// 20 min at 2.5 m/s, HR 138 with a 151 minute: 3.0 km, 20:00, avg / max.
{
  const r = rec(1200, i => (i >= 600 && i < 660 ? 151 : 138))
  const s = summarizeRecording(r)
  assert.equal(s.distanceKm, 3)
  assert.equal(s.durationSec, 1200)
  assert.equal(s.maxHr, 151)
  assert.equal(s.avgHr, 139)
  assert.equal(s.paceSecKm, 400)
  assert.equal(durationText(s.durationSec), '20:00')
  assert.equal(durationText(3906), '65:06')
  // Splits: three whole km, 400 s each.
  const sp = recordingSplits(r)
  assert.deepEqual(sp.map(x => x.kmIndex), [1, 2, 3])
  assert.equal(sp[0].durationSec, 400)
}

// Pauses are not moving time; indoors there is no distance; no strap: no HR.
{
  const r = rec(600, () => null, { pausedFrom: 100, pausedTo: 200 })
  const s = summarizeRecording(r)
  assert.equal(s.durationSec, 500)
  assert.equal(s.avgHr, null)
  assert.equal(s.hrGapShare, 1)
  assert.equal(summarizeRecording({ ...r, outdoor: false }).distanceKm, null)
  assert.deepEqual(recordingSplits({ ...r, outdoor: false }), [])
  assert.equal(zoneStreams(r).hr.length, 0)
}

// The shape check.
{
  assert.ok(isRecording(rec(10, () => 140)))
  assert.ok(!isRecording({ runId: 'x' }))
  const bad = rec(10, () => 140)
  bad.series.hr.pop()
  assert.ok(!isRecording(bad))
}

console.log('runRecording tests passed')
