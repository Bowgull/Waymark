// Run: tsx src/lib/coach/replay/replay.test.ts
// The replay harness's pure parts on made-up rows (coach-brain P0, §12): a
// history becomes a day-by-day script; the pass lines and the ease stack read
// a replay record; the scoreboard ratchet keeps passing lines passing.
import assert from 'node:assert/strict'
import { liftPattern, localDay, localMinute, scriptFromHistory, type History } from './history'
import { activeLayers, easeStack, replayLines } from './metrics'
import { compareToBaseline, statusOf } from './ratchet'
import { SCENARIOS, SIM_START, doseVs } from './scenarios'
import type { DoseRecord, ReplayResult } from './types'

const DAY = 20600 // 2026-05-27, a Wednesday
const TZ = -240

// ─── Lift patterns and local time ──────────────────────────────
assert.equal(liftPattern('ex-goblet-squat'), 'squat')
assert.equal(liftPattern('ex-bulgarian-split-squat'), 'squat')
assert.equal(liftPattern('ex-db-rdl'), 'hinge')
assert.equal(liftPattern('ex-block-pull'), 'hinge')
assert.equal(liftPattern('ex-db-row'), 'pull')
assert.equal(liftPattern('ex-lat-pulldown'), 'pull')
assert.equal(liftPattern('ex-db-ohp'), 'press')
assert.equal(liftPattern('ex-push-up'), 'press')
assert.equal(liftPattern('ex-dead-bugs'), 'other')
// 10:42 UTC is 6:42 in Toronto (UTC-4); 01:30 UTC is 21:30 the evening before.
const at = DAY * 86400 + 10 * 3600 + 42 * 60
assert.equal(localMinute(at, TZ, 'am'), 6 * 60 + 42)
assert.equal(localDay(DAY * 86400 + 90 * 60, TZ), DAY - 1, 'an evening session after 8 PM local is still that local day')
assert.equal(localMinute(null, TZ, 'pm'), 18 * 60, 'no start time: the slot\'s usual time')
console.log('ok: lift patterns and local time')

// ─── History -> script ─────────────────────────────────────────
const h: History = {
  sessions: [
    { id: 'a', type: 'strength', status: 'completed', scheduledDate: DAY, timeSlot: 'am', startedAt: at, durationSec: 1800, rpe: 6, notes: null, skipReason: null, skipReasonDetail: null },
    { id: 'b', type: 'running', status: 'completed', scheduledDate: DAY + 1, timeSlot: null, startedAt: null, durationSec: 1000, rpe: null, notes: null, skipReason: null, skipReasonDetail: null },
    { id: 'c', type: 'mobility', status: 'missed', scheduledDate: DAY + 1, timeSlot: 'am', startedAt: null, durationSec: null, rpe: null, notes: null, skipReason: null, skipReasonDetail: null },
    { id: 'd', type: 'strength', status: 'skipped', scheduledDate: DAY + 2, timeSlot: 'am', startedAt: null, durationSec: null, rpe: null, notes: null, skipReason: 'injury', skipReasonDetail: 'Knee' },
    { id: 'e', type: 'running', status: 'completed', scheduledDate: DAY + 3, timeSlot: 'am', startedAt: null, durationSec: 0, rpe: null, notes: null, skipReason: null, skipReasonDetail: null },
    { id: 'z', type: 'strength', status: 'completed', scheduledDate: DAY + 40, timeSlot: 'am', startedAt: null, durationSec: 1800, rpe: 6, notes: null, skipReason: null, skipReasonDetail: null },
  ],
  sets: [
    { sessionId: 'a', exerciseId: 'ex-db-rdl', section: 'main', orderIndex: 1, setNumber: 2, weightKg: 16, reps: 8, rir: null, isWarmup: 0 },
    { sessionId: 'a', exerciseId: 'ex-db-rdl', section: 'main', orderIndex: 1, setNumber: 1, weightKg: 14, reps: 8, rir: 2, isWarmup: 0 },
    { sessionId: 'a', exerciseId: 'ex-band-pull-aparts', section: 'warmup', orderIndex: 0, setNumber: 1, weightKg: null, reps: 12, rir: null, isWarmup: 1 },
    { sessionId: 'a', exerciseId: 'ex-dead-bugs', section: 'core', orderIndex: 3, setNumber: 1, weightKg: null, reps: 10, rir: null, isWarmup: 0 },
  ],
  runs: [
    { sessionId: 'b', durationSec: 1086, distanceKm: 2.66, avgHr: 143, maxHr: 160, isIndoor: 0 },
    // A treadmill entry typed as 108000 s for 30 min: the session's own time stands.
    { sessionId: 'e', durationSec: 108000, distanceKm: 2, avgHr: null, maxHr: null, isIndoor: 1 },
  ],
  logs: [{ logDate: DAY, createdAt: DAY * 86400 + 10 * 3600, sleepHours: 6, sleepQuality: null, energy: null, soreness: 4, stress: null, mood: null, backToday: null, alcoholScale: 3, herbScale: null, notes: null }],
  notes: [{ date: DAY, type: 'wellness', content: 'Lower back is sore.' }, { date: DAY, type: 'daily', content: 'Not a check-in note.' }],
}
const sc = scriptFromHistory(h, { name: 't', fromDay: DAY, toDay: DAY + 30, tzOffsetMin: TZ, blockStartDay: DAY })
assert.deepEqual(sc.startBlock, { type: 'block_zero', day: DAY })
assert.deepEqual(sc.days.map(d => d.day), [DAY, DAY + 1, DAY + 2, DAY + 3], 'one entry per day with something done, in order; out-of-range days dropped; missed sessions are not actions')
const d0 = sc.days[0].actions
assert.equal(d0[0].kind, 'checkin', 'the check-in (6:00) comes before the 6:42 session')
assert.ok(d0[0].kind === 'checkin' && d0[0].log.notes === 'Lower back is sore.', 'wellness notes ride on the check-in; daily notes do not')
const str = d0[1]
assert.ok(str.kind === 'session' && Array.isArray(str.lifts))
if (str.kind === 'session' && Array.isArray(str.lifts)) {
  assert.equal(str.lifts.length, 1, 'main lifts only (no warm-up, no core)')
  assert.deepEqual(str.lifts[0].sets.map(s => s.weightKg), [14, 16], 'sets in set order')
  assert.equal(str.lifts[0].pattern, 'hinge')
  assert.equal(str.at, 6 * 60 + 42)
  assert.equal(str.durationMin, 30)
}
const run = sc.days[1].actions[0]
assert.ok(run.kind === 'session' && run.type === 'foundation_run' && typeof run.run === 'object' && run.run.avgHr === 143, 'a run carries its HR and is replayed as the run-walk')
assert.ok(run.kind === 'session' && run.rpe === null, 'no RPE stays no RPE')
const skip = sc.days[2].actions[0]
assert.ok(skip.kind === 'skip' && skip.reason === 'injury' && skip.detail === 'Knee')
const tread = sc.days[3].actions[0]
assert.ok(tread.kind === 'session' && typeof tread.run === 'object' && tread.run.durationSec === 0, 'a run time over 4 h is a typing slip: the session time is used')
console.log('ok: history becomes a script')

// ─── Metrics over a made-up record ─────────────────────────────
function dose(over: Partial<DoseRecord> & Pick<DoseRecord, 'day' | 'type'>): DoseRecord {
  return {
    sessionId: `s${over.day}`, label: null, slot: 'am', source: 'template', weekNumber: 2,
    layers: { leadIn: false, returnRamp: null, coachEase: null, readinessEase: false, loadFlag: false, loadReason: null, autoEased: false, autoEaseReason: null, injury: null, push: false },
    baselineMainSets: null, prescribedMainSets: null, loads: [], baselineRunSec: null, prescribedRunSec: null, walkOnly: false,
    prescribedTotalSec: null, longestLast30Sec: null, hrCeilingBpm: null, loggedAvgHr: null, volumeRatio: null, loadRatio: null, rirOnFile: false, why: [],
    ...over,
  }
}
const r: ReplayResult = {
  name: 'made-up', fromDay: DAY, toDay: DAY + 9, errors: [], sessions: [],
  days: Array.from({ length: 10 }, (_, i) => ({ day: DAY + i, active: i < 3, planned: [], did: [], readiness: null })),
  doses: [
    dose({ day: DAY, type: 'strength', volumeRatio: 0.5, prescribedMainSets: 2, baselineMainSets: 4, layers: { ...dose({ day: 0, type: 'x' }).layers, returnRamp: { tier: 'restart', gapDays: 100, loadFactor: 0.75, volumeFactor: 0.6 } } }),
    dose({ day: DAY + 1, type: 'foundation_run', prescribedRunSec: 360, baselineRunSec: 360, volumeRatio: 1, prescribedTotalSec: 1380, longestLast30Sec: 1200, hrCeilingBpm: 132, loggedAvgHr: 149 }),
    dose({ day: DAY + 2, type: 'foundation_run', prescribedRunSec: 540, baselineRunSec: 630, volumeRatio: 0.86, prescribedTotalSec: 1300, longestLast30Sec: 1380, why: ['Load is up 40% on last week.'] }),
  ],
  changes: [
    { day: DAY + 5, when: 'nightly', actor: 'coach', kind: 'missed', sessionType: 'strength', targetDay: DAY + 4, targetSlot: 'am', why: 'Strength A missed.' },
    { day: DAY + 6, when: 'nightly', actor: 'coach', kind: 'missed', sessionType: 'strength', targetDay: DAY + 5, targetSlot: 'am', why: 'Strength B missed.' },
  ],
  aiCalls: [{ day: DAY + 6, caller: 'reactiveCoach', model: 'm', when: 'nightly' }, { day: DAY + 1, caller: 'sessionReviewAI', model: 'm', when: 'day' }],
}
const stack = easeStack(r.doses)
assert.equal(stack[0].product, 0.38, 'sets 0.5 x the ramp\'s 0.75 load')
assert.deepEqual(activeLayers(r.doses[0]), ['return ramp restart (load 0.75, volume 0.6)'])
const lines = replayLines(r)
const byId = Object.fromEntries(lines.map(l => [l.id, l]))
assert.equal(byId.L1.pass, false, 'a banned word ("load") in a why fails the invariants')
assert.match(byId.L1.evidence, /banned words 1/)
assert.equal(byId.L2.pass, false)
assert.match(byId.L2.evidence, /1 AI calls on 1 of 7 inactive days/)
assert.equal(byId.L3.pass, false, 'a session at 0.38 of the plain dose is a stack')
assert.equal(byId.L4.measured, false, 'no missed PM sessions: nothing to measure')
assert.equal(byId.L5.pass, false, 'the run after an over-the-line run went up (360 -> 540 s)')
assert.equal(byId.L7.pass, false, 'a 7-day lapse with an AI call and a change after day 3 is not silent')
console.log('ok: pass lines and the ease stack')

// ─── The ratchet ──────────────────────────────────────────────
const pass = { id: 'X1', title: 't', measured: true, pass: true, evidence: '' }
const fail = { ...pass, pass: false }
const na = { ...pass, measured: false, pass: false }
assert.equal(statusOf(pass), 'pass')
assert.equal(statusOf(fail), 'fail')
assert.equal(statusOf(na), 'na')
const c1 = compareToBaseline({ a: { X1: 'pass', X2: 'fail' } }, { a: [fail, { ...pass, id: 'X2' }] })
assert.equal(c1.regressions.length, 1, 'a line that passed and now fails is a regression')
assert.equal(c1.improvements.length, 1, 'a line that failed and now passes is an improvement')
assert.deepEqual(c1.next, { a: { X1: 'fail', X2: 'pass' } })
const c2 = compareToBaseline({}, { b: [pass, { ...na, id: 'X9' }] })
assert.equal(c2.regressions.length + c2.improvements.length, 0, 'a new scenario is neither')
assert.equal(c2.total, 1, 'N/A lines are not counted')
console.log('ok: the ratchet')

// ─── The scenarios are well-formed ────────────────────────────
assert.equal(new Date(SIM_START * 86400000).getUTCDay(), 1, 'scenarios start on a Monday')
assert.ok(SCENARIOS.length >= 8, 'the eight personas of §12.2 (and the Fighter stack check)')
for (const s of SCENARIOS) {
  assert.equal(s.script.fromDay, SIM_START)
  assert.ok(s.script.days.every(d => d.day >= s.script.fromDay && d.day <= s.script.toDay), `${s.id}: days inside the run`)
  assert.equal(new Set(s.script.days.map(d => d.day)).size, s.script.days.length, `${s.id}: one entry per day`)
}
assert.equal(new Set(SCENARIOS.map(s => s.id)).size, SCENARIOS.length, 'scenario ids are unique')
const a = dose({ day: 1, type: 'strength', prescribedMainSets: 2, loads: [{ exerciseId: 'x', weightKg: 20, change: null }] })
const b = dose({ day: 0, type: 'strength', prescribedMainSets: 4, loads: [{ exerciseId: 'x', weightKg: 25, change: null }] })
assert.equal(doseVs(a, b), 0.4, 'half the sets at 80% of the weight')
console.log('ok: scenarios')
