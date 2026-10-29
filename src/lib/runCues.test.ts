// Run: tsx src/lib/runCues.test.ts
// A hard run on the screen and in the ear (page 76): the segments and the
// cues, the outdoor pace nudge (20 s off by 10+ s/km, at most once a minute,
// never in the first minute), the units, the post-run line, inside or
// outside from the weather, and the hard run's heart range.
import assert from 'node:assert/strict'
import { hardPlan } from './brain/hardRuns'
import { dueCue, hardAt, hardCues, hardSegments, nextWords, NUDGE_START, nudgeClips, nudgeTargets, phaseWord, pieceOf, stepNudge, type HardSegment, type NudgeState } from './runCues'
import { altMph, numberClip, numberWords, paceClip, paceFlap, paceOf, paceText, parseUnit, speedFlap, speedText, speedUnitWord } from './runSpeed'
import { postRunLine, postRunShort, sameHrPace, type PostRunFacts } from './postRun'
import { movePlan, planOnRunClock } from './timers/runWalk'
import { runWeatherLine, weatherAt } from '../features/weather/runPlace'
import { nextZone, ZONE_START } from './hrZoneState'
import type { Weather } from '../features/weather/weatherData'

// ── Units: KM/H, MPH, or both while none is picked ──
assert.equal(parseUnit('kmh'), 'kmh')
assert.equal(parseUnit('nope'), null)
assert.equal(speedFlap(12.8, 'kmh'), '12.8')
assert.equal(speedFlap(12.8, 'mph'), '8.0')
assert.equal(speedFlap(8, null), '8.0')
assert.equal(speedUnitWord('mph'), 'MPH')
assert.equal(speedText(12.8, null), '12.8 km/h (8.0 mph)')
assert.equal(speedText(12.8, 'mph'), '8.0 mph')
assert.equal(altMph(12.8, null), '8.0 mph')
assert.equal(altMph(12.8, 'kmh'), null)
assert.equal(paceFlap(12.8, 'kmh'), '4:41')
assert.equal(paceFlap(12.8, null), '4:41')
assert.equal(paceFlap(12.8, 'mph'), '7:33')
assert.equal(paceText(9.28, 'kmh'), '6:28 /km')
assert.equal(paceOf(3.1, 1204, null), 388)
// The voice's clip names, and the words they hold.
assert.equal(numberClip(12.8), 'n_128')
assert.equal(numberClip(25), 'n_180')
assert.equal(numberWords(12.8), 'twelve point eight')
assert.equal(numberWords(8), 'eight')
assert.equal(paceClip(281), 'p_441')
assert.equal(paceClip(305), 'p_505')
assert.equal(paceClip(100), 'p_330')

// ── Segments and the cues ──
const iv = hardPlan({ kind: 'intervals', weeksSince: 1, fiveK: { day: 1, sec: 1668 }, easyPaceSecKm: null, maxHr: 186, lineBpm: 147, ease: false, capSec: null }).plan
const segs = hardSegments(iv)
assert.equal(segs.length, 14)
{
  const p = hardAt(segs, 600 + 240 * 2 + 30) // third rep, 30 s in
  assert.equal(phaseWord(p.segment.kind), 'RUN HARD')
  assert.equal(pieceOf(p.segment, iv.reps), '3 of 6')
  assert.equal(p.shownSec, 90)
  assert.equal(nextWords(segs, p.index), 'easy jog 2:00')
  const j = hardAt(segs, 600 + 120 + 10)
  assert.equal(phaseWord(j.segment.kind), 'EASY JOG')
  assert.equal(hardAt(segs, 99999).done, true)
}
{
  const cues = hardCues(segs, false, 'kmh')
  // Every piece's start, ticks before each change, and done.
  assert.deepEqual(cues[0].clips, ['chime_jog', 'zone2_run', 'speed', `n_${Math.round(iv.speeds.easy * 10)}`])
  const firstHard = cues.find(c => c.atSec === 600)
  assert.deepEqual(firstHard?.clips, ['chime_hard', 'run_hard', 'speed', `n_${Math.round(iv.speeds.hard * 10)}`])
  assert.ok(cues.some(c => c.atSec === 597 && c.clips[0] === 'ticks'))
  assert.deepEqual(cues[cues.length - 1].clips, ['chime_done', 'done'])
  // Outside: the pace instead of the speed; MPH picked: per mile.
  const out = hardCues(segs, true, 'mph')
  assert.equal(out.find(c => c.atSec === 600)?.clips[2], 'pace')
  // The cue clock: the latest due cue once; one more than 3 s late is let go.
  const played = new Set<number>()
  const d1 = dueCue(cues, played, 600)
  assert.equal(d1?.cue.atSec, 600)
  played.add(d1!.index)
  assert.equal(dueCue(cues, played, 601), null)
  assert.equal(dueCue(cues, new Set(), 700)?.cue.atSec ?? null, null)
}
// Steady hard: "Halfway." in the middle.
{
  const st = hardPlan({ kind: 'steady', weeksSince: 0, fiveK: null, easyPaceSecKm: null, maxHr: null, lineBpm: 147, ease: false, capSec: null }).plan
  const cues = hardCues(hardSegments(st), false, null)
  // 15 min the first week after the speeds were set (page 93: 15 to 20 min).
  assert.ok(cues.some(c => c.clips.includes('halfway') && c.atSec === 600 + 450))
}
// The test: its 5 km counts up until he finishes it; the cues stop there and come again after.
{
  const t = hardPlan({ kind: 'test', weeksSince: 0, fiveK: null, easyPaceSecKm: null, maxHr: null, lineBpm: 147, ease: false, capSec: null }).plan
  const open = hardSegments(t)
  const p = hardAt(open, 600 + 900)
  assert.equal(p.up, true)
  assert.equal(p.shownSec, 900)
  assert.equal(nextWords(open, 0), '5 km')
  assert.equal(hardCues(open, false, null).at(-1)?.clips[1], 'five_k')
  const closed = hardSegments(t, 600 + 1700)
  assert.equal(closed[2].startSec, 2300)
  assert.deepEqual(hardCues(closed, false, null).at(-1)?.clips, ['chime_done', 'done'])
  assert.equal(nudgeTargets(open)[0], undefined)
}

// ── The outdoor pace nudge ──
{
  const seg: HardSegment = { kind: 'hard', round: 1, startSec: 600, sec: 120, kmh: 12.8, open: false }
  const target = 3600 / 12.8 // 281 s/km
  const run = (pace: number, from: number, to: number, start: NudgeState = NUDGE_START, s: HardSegment | null = seg, outdoor = true) => {
    let st = start
    const hits: Array<[number, string]> = []
    for (let t = from; t <= to; t++) {
      const r = stepNudge(st, { clockSec: t, distM: ((t - from) * 1000) / pace, segment: s, outdoor })
      st = r.state
      if (r.nudge) hits.push([t, r.nudge])
    }
    return { st, hits }
  }
  // On pace: nothing.
  assert.deepEqual(run(target + 5, 600, 720).hits, [])
  // 15 s/km fast: a nudge once the settle (10 s) and the 20 s window have passed, then not again for a minute.
  const fast = run(target - 15, 600, 719)
  assert.deepEqual(fast.hits, [[630, 'fast'], [690, 'fast']])
  // Slow: "pick it up".
  assert.deepEqual(run(target + 20, 600, 640).hits.map(h => h[1]), ['slow'])
  // At most once a minute on a long piece.
  const long: HardSegment = { kind: 'steady', round: 0, startSec: 600, sec: 900, kmh: 10.3, open: false }
  const many = run(3600 / 10.3 - 20, 600, 780, NUDGE_START, long)
  assert.deepEqual(many.hits.map(h => h[0]), [630, 690, 750])
  // Never in the run's first minute; never inside; never on an easy piece.
  const early: HardSegment = { ...seg, startSec: 0 }
  assert.ok(run(target - 30, 0, 59, NUDGE_START, early).hits.length === 0)
  assert.deepEqual(run(target - 30, 600, 700, NUDGE_START, seg, false).hits, [])
  assert.deepEqual(run(240, 600, 700, NUDGE_START, { ...seg, kind: 'jog' }).hits, [])
  assert.deepEqual(nudgeClips('fast', 12.8, 'kmh'), ['chime_nudge', 'fast', 'p_441'])
}

// ── After a run: one line ──
{
  const out: PostRunFacts = { outdoor: true, distanceKm: 3.1, durationSec: 1204, avgHr: 141, kmh: null, incline: null, sameHrPaceSecKm: 400, first: false }
  assert.equal(postRunLine(out, 'kmh'), '3.1 km in 20:04 · 6:28 /km · heart 141 · 12 s/km faster than last time at the same heart rate')
  assert.equal(postRunShort(out, null), '6:28 /km · 12 s/km faster than last time at the same heart rate.')
  assert.equal(postRunLine({ ...out, first: true, sameHrPaceSecKm: null }, 'kmh'), '3.1 km in 20:04 · 6:28 /km · heart 141 · your first outside run with the strap: this is your starting point')
  assert.equal(postRunLine({ ...out, sameHrPaceSecKm: 380 }, 'kmh')?.endsWith('8 s/km slower than last time at the same heart rate'), true)
  assert.equal(postRunLine({ outdoor: false, distanceKm: null, durationSec: 1200, avgHr: 141, kmh: 8.5, incline: 1, sameHrPaceSecKm: null, first: false }, null), '20 min at 8.5 km/h (5.3 mph) · incline 1 · heart 141')
  // The run to compare with: the latest outside run within 3 bpm.
  const earlier = [
    { avgHr: 150, distanceKm: 3, durationSec: 1100, isIndoor: 0, day: 5 },
    { avgHr: 142, distanceKm: 3, durationSec: 1200, isIndoor: 0, day: 3 },
    { avgHr: 140, distanceKm: 3, durationSec: 1230, isIndoor: 1, day: 6 },
  ]
  assert.deepEqual(sameHrPace({ avgHr: 141 }, earlier), { pace: 400, first: false })
  assert.deepEqual(sameHrPace({ avgHr: 141 }, []), { pace: null, first: true })
}

// ── The weather at the run's hour: only the weather, never inside or outside (2026-10-29) ──
assert.equal(runWeatherLine({ t: 9, feels: 7, sky: 'sun', pop: 0 }, '7'), '9° and clear at 7')
assert.equal(runWeatherLine({ t: 3, feels: -1, sky: 'rain', pop: 80 }, '6'), '3° and sleet at 6')
assert.equal(runWeatherLine({ t: -1, feels: -6, sky: 'snow', pop: 70 }, '9'), '−1° and snow at 9')
{
  const now = Date.UTC(2026, 10, 17, 12)
  const w = { hours: [{ at: now, sky: 'rain', t: 3, pop: 80, mm: 1, code: 61, feels: -1, humidex: null }], week: [{ at: now + 86400000, sky: 'sun', hi: 12, lo: 4, words: 'Clear' }] } as unknown as Weather
  assert.equal(weatherAt(w, now + 1800000)?.sky, 'rain')
  assert.equal(weatherAt(w, now + 86400000 + 3600000)?.sky, 'sun')
  assert.equal(weatherAt(w, now + 9 * 86400000), null)
}

// ── The hard run's heart: gold over the top, ember only 10 over for 30 s ──
{
  let z = nextZone(ZONE_START, 178, 176, 0, 10)
  assert.equal(z.zone, 'gold')
  z = nextZone(z, 185, 176, 40_000, 10)
  assert.equal(z.zone, 'gold')
  z = nextZone(z, 187, 176, 41_000, 10)
  z = nextZone(z, 187, 176, 72_000, 10)
  assert.equal(z.zone, 'over')
  // An easy run keeps its line (no overBy).
  assert.equal(nextZone(nextZone(ZONE_START, 150, 147, 0), 150, 147, 31_000).zone, 'over')
}

// Page 85: a swipe moves the plan, not the run clock. The cues are made from the plan on the
// run clock, so the new piece's words are due now (as at a natural change) and the old ones are past.
{
  const segs = hardSegments(iv)
  // 30 s into the first hard piece, swipe up: the jog after it starts now.
  const at = segs[1].startSec + 30
  const shift = movePlan(segs, 0, at, 'skip')!
  const onRun = planOnRunClock(segs, shift)
  assert.equal(hardAt(onRun, at).index, 2)
  assert.equal(hardAt(onRun, at).shownSec, segs[2].sec)
  const cues = hardCues(onRun, false, 'kmh')
  const played = new Set(cues.map((c, i) => (c.atSec < at ? i : -1)).filter(i => i >= 0))
  const due = dueCue(cues, played, at)!
  assert.equal(due.cue.atSec, at)
  assert.ok(due.cue.clips.includes('easy_jog'), 'the jog\'s words play now')
  // The nudge window follows the hard pieces too.
  assert.equal(nudgeTargets(onRun)[1].fromSec, onRun[3].startSec)
  // Swipe down: the jog again from now, its words again.
  const back = movePlan(segs, shift, at + 20, 'restart')!
  const again = hardCues(planOnRunClock(segs, back), false, 'kmh')
  assert.ok(again.some(c => c.atSec === at + 20 && c.clips.includes('easy_jog')))
}

console.log('runCues: ok')
