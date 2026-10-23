// Run: tsx src/lib/blockZero/running.test.ts
import {
  RESTART_SESSION_SEC,
  RESTART_WEEKLY_SEC,
  RUN_WALK_WEEKS,
  weeklyRunAllowanceSec,
  ageFromDob,
  getRunWalkWeek,
  easyHrLine,
  hrCeiling,
  isBlockZeroModelRun,
  prescribeRunWalk,
  runWalkTotalSec,
  singleRunCap,
  tanakaMaxHr,
  weeklyRunCap,
} from './running'
import { sessionLoad, weekOverWeekChange, weeklyLoadFlag, weeklyLoadTotals } from './load'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
  console.log(`ok: ${msg}`)
}

// ─── Progression shape ──────────────────────────────────────────

const totals = RUN_WALK_WEEKS.map(runWalkTotalSec)
for (let i = 1; i < 5; i++) {
  assert(totals[i] <= totals[i - 1] * 1.1, `week ${i + 1} session (${totals[i]}s) within 110% of week ${i} (R7)`)
  assert(totals[i] * 3 <= totals[i - 1] * 3 * 1.3, `week ${i + 1} weekly run time within +30% (R8)`)
}
const runFraction = (w: typeof RUN_WALK_WEEKS[number]) => w.runSec / (w.runSec + w.walkSec)
for (let i = 1; i < 5; i++) assert(runFraction(RUN_WALK_WEEKS[i]) > runFraction(RUN_WALK_WEEKS[i - 1]), `week ${i + 1} runs a bigger share of each interval`)
const cut6 = 1 - totals[5] / totals[4]
assert(cut6 >= 0.3 && cut6 <= 0.5, `week 6 run volume down ${(cut6 * 100).toFixed(0)}% (R16)`)
assert(getRunWalkWeek(7) === RUN_WALK_WEEKS[4] && getRunWalkWeek(8) === RUN_WALK_WEEKS[4], 'extension weeks repeat week 5 run-walk')
assert(RESTART_SESSION_SEC === totals[0] && RESTART_WEEKLY_SEC === totals[0] * 3, 'restart levels = week 1')

// ─── Single-run cap (R7) ────────────────────────────────────────

assert(singleRunCap(1800, 1500).capSec === 1650, '110% of a 25 min longest = 27.5 min')
assert(singleRunCap(1500, 1500).capSec === 1500 && singleRunCap(1500, 1500).reason === null, 'under the cap passes untouched')
assert(singleRunCap(1800, null).capSec === RESTART_SESSION_SEC, 'no runs in 30 days: back to week 1')
assert(singleRunCap(1000, 0).capSec === 1000, 'no history but planned is already small: untouched')
assert(singleRunCap(1800, 1500).reason?.includes('110%'), 'cap says why')

// ─── Weekly cap (R8) ────────────────────────────────────────────

assert(weeklyRunCap(2400, { lastWeekRunSec: 4500, thisWeekSoFarSec: 0, sessionsLeftThisWeek: 3 }).capSec === 1950, '130% of 75 min shared over 3 sessions = 32:30')
assert(weeklyRunCap(1200, { lastWeekRunSec: 4500, thisWeekSoFarSec: 0, sessionsLeftThisWeek: 3 }).capSec === 1200, 'under the weekly budget passes')
assert(weeklyRunCap(1800, { lastWeekRunSec: 4500, thisWeekSoFarSec: 5850, sessionsLeftThisWeek: 1 }).capSec === 0, 'budget spent: cap 0')
// D2: the allowance never drops below week-1 volume (3 x 23 min).
assert(weeklyRunAllowanceSec(0) === RESTART_WEEKLY_SEC && weeklyRunAllowanceSec(1380) === RESTART_WEEKLY_SEC && weeklyRunAllowanceSec(4500) === 5850, 'run cap floor: max(week-1 volume, 130% of last week)')
const afterLeadIn = weeklyRunCap(RESTART_SESSION_SEC, { lastWeekRunSec: RESTART_SESSION_SEC, thisWeekSoFarSec: 0, sessionsLeftThisWeek: 3 })
assert(afterLeadIn.capSec === RESTART_SESSION_SEC && afterLeadIn.reason === null, 'one 23-min lead-in run last week: week 1 keeps its three full run-walks')
const afterOne = weeklyRunCap(RESTART_SESSION_SEC, { lastWeekRunSec: 1800, thisWeekSoFarSec: 0, sessionsLeftThisWeek: 3 })
assert(afterOne.capSec === RESTART_SESSION_SEC, 'a short week (one 30-min run) never shrinks the next full week below week 1')
const restart = weeklyRunCap(1800, { lastWeekRunSec: 0, thisWeekSoFarSec: 0, sessionsLeftThisWeek: 3 })
assert(restart.capSec === RESTART_SESSION_SEC && restart.reason?.includes('week-1'), 'no running last week: weekly volume restarts at week 1')

// ─── Prescription ───────────────────────────────────────────────

const clean = prescribeRunWalk({ week: 3, longestLast30Sec: 1500, weekly: { lastWeekRunSec: 4365, thisWeekSoFarSec: 0, sessionsLeftThisWeek: 3 }, hrCeilingBpm: 133 })
assert(!clean.capped && clean.totalSec === totals[2] && clean.reasons.length === 0, 'clean week 3: plan as written')
assert(clean.targetDesc.includes('7 x (2 min easy run / 1 min walk)') && clean.targetDesc.includes('133 bpm'), 'description names intervals and HR ceiling')
assert(!clean.targetDesc.includes('!') && !clean.targetDesc.includes('—'), 'house voice')

const capped = prescribeRunWalk({ week: 5, longestLast30Sec: 1380, weekly: { lastWeekRunSec: 4140, thisWeekSoFarSec: 0, sessionsLeftThisWeek: 3 } })
assert(capped.capped && capped.totalSec <= 1380 * 1.1, 'week 5 after a 23-min longest: capped to 110%')
assert(capped.runSec === 240 && capped.rounds >= 2, 'capped keeps the week-5 interval, fewer rounds')
assert(capped.reasons.some(r => r.includes('110%')), 'capped says why')

const tight = prescribeRunWalk({ week: 5, longestLast30Sec: 700, weekly: { lastWeekRunSec: 3000, thisWeekSoFarSec: 0, sessionsLeftThisWeek: 3 } })
assert(tight.totalSec === RESTART_SESSION_SEC && tight.runSec === 60 && tight.rounds === 6, 'very short history: the week-1 run-walk, never shorter (no ratchet below week 1)')
// The ratchet (coach-brain P0 replay): an 11-min session can't pin later run-walks to 11 min.
const afterShort = prescribeRunWalk({ week: 4, longestLast30Sec: 660, weekly: { lastWeekRunSec: 3 * 660, thisWeekSoFarSec: 0, sessionsLeftThisWeek: 3 } })
assert(afterShort.totalSec === RESTART_SESSION_SEC && afterShort.rounds === 6 && afterShort.reasons.some(r => r.includes('week-1 run-walk')), 'after 11-min runs: back to the full week-1 run-walk (23 min), with why')
const growing = prescribeRunWalk({ week: 2, longestLast30Sec: RESTART_SESSION_SEC, weekly: { lastWeekRunSec: 3 * RESTART_SESSION_SEC, thisWeekSoFarSec: 0, sessionsLeftThisWeek: 3 } })
assert(!growing.capped && growing.rounds === 7, 'after full week-1 run-walks, week 2 is not capped: the plan climbs')
const spent = prescribeRunWalk({ week: 4, longestLast30Sec: 1500, weekly: { lastWeekRunSec: 3000, thisWeekSoFarSec: RESTART_WEEKLY_SEC, sessionsLeftThisWeek: 1 } })
assert(spent.rounds === 0 && spent.totalSec === 0 && spent.targetDesc.startsWith('Easy walk'), 'weekly budget spent: easy walk, no running')
const afterGap = prescribeRunWalk({ week: 5, longestLast30Sec: null, weekly: { lastWeekRunSec: 0, thisWeekSoFarSec: 0, sessionsLeftThisWeek: 3 } })
assert(afterGap.totalSec <= RESTART_SESSION_SEC, 'after 30 days without running: week-1 length')
assert(afterGap.reasons.length === 1 && afterGap.reasons[0].includes('30 days'), 'restart reason said once')

// ─── HR ceiling (R9) ────────────────────────────────────────────

assert(tanakaMaxHr(30) === 187, 'Tanaka: 208 - 0.7 x 30 = 187')
assert(hrCeiling({ talkTestBpm: 141, measuredMaxHr: 190, ageYears: 30, defaultBpm: 145 }).source === 'talk_test', 'talk test wins')
const measured = hrCeiling({ measuredMaxHr: 190, ageYears: 30, defaultBpm: 145 })
assert(measured.bpm === 148 && measured.source === 'measured_max', 'measured max: 78% = 148')
const tanaka = hrCeiling({ ageYears: 30, defaultBpm: 145 })
assert(tanaka.bpm === 146 && tanaka.source === 'tanaka', 'age only: 78% of Tanaka = 146')
assert(hrCeiling({ defaultBpm: 145 }).bpm === 145, 'nothing known: app default')
assert(ageFromDob('1995-07-15', Math.floor(Date.UTC(2026, 9, 17) / 86400000)) === 31, 'age from dob after birthday')
assert(ageFromDob('1995-12-15', Math.floor(Date.UTC(2026, 9, 17) / 86400000)) === 30, 'age from dob before birthday')
assert(ageFromDob(null, 20000) === null && ageFromDob('garbage', 20000) === null, 'bad dob: null')

// ─── Session load (R5) ──────────────────────────────────────────

assert(sessionLoad(6, 60) === 360, 'sRPE load = RPE x minutes')
assert(sessionLoad(null, 60) === null && sessionLoad(6, null) === null, 'missing input: null')
const weeks = weeklyLoadTotals([
  { epochDay: 100, rpe: 5, minutes: 60 },
  { epochDay: 102, rpe: 6, minutes: 30 },
  { epochDay: 108, rpe: 7, minutes: 60 },
  { epochDay: 109, rpe: null, minutes: 60 },
  { epochDay: 99, rpe: 9, minutes: 60 },
], 100, 2)
assert(weeks[0] === 480 && weeks[1] === 420, 'weekly totals bucket by 7-day window, skip missing RPE and out-of-range days')
assert(weekOverWeekChange(400, 460) === 0.15 && weekOverWeekChange(0, 100) === null, 'week-over-week change')
assert(!weeklyLoadFlag(400, 460).flagged, '+15% exactly: no flag')
const hi = weeklyLoadFlag(400, 500)
assert(hi.flagged && hi.reason === 'Load is up 25% on last week.', '+25%: soft flag with reason')
assert(weeklyLoadFlag(0, 300).flagged, 'load after a zero week: flag')
assert(!weeklyLoadFlag(0, 0).flagged, 'nothing either week: no flag')

// ─── The one HR line (audit #32) ─────────────────────────────
{
  const day = 20700
  const base = { tests: [] as Array<{ day: number; bpm: number }>, day, dob: '1990-06-01', maxHr: null as number | null }
  const prior = easyHrLine(base)
  assert(prior.source === 'tanaka' && prior.bpm === Math.round(0.78 * tanakaMaxHr(ageFromDob('1990-06-01', day) as number)), `no talk test: 0.78 × Tanaka from his birth date (${prior.bpm})`)
  assert(easyHrLine({ ...base, maxHr: 190 }).bpm === 148 && easyHrLine({ ...base, maxHr: 190 }).source === 'measured_max', 'a measured max HR first: 0.78 × 190 = 148')
  assert(easyHrLine({ ...base, dob: null }).bpm === Math.round(0.78 * tanakaMaxHr(35)), 'nothing known: Tanaka at 35')
  assert(easyHrLine({ ...base, tests: [{ day: day - 3, bpm: 150 }] }).bpm === 150, 'one talk test: its number')
  assert(easyHrLine({ ...base, tests: [{ day: day - 10, bpm: 150 }, { day: day - 3, bpm: 153 }] }).bpm === 152, 'two that agree within 4 bpm: their average')
  assert(easyHrLine({ ...base, tests: [{ day: day - 10, bpm: 140 }, { day: day - 3, bpm: 152 }] }).bpm === 152, 'two that disagree: the latest')
  assert(easyHrLine({ ...base, tests: [{ day: day + 1, bpm: 160 }] }).source !== 'talk_test', 'a test after the day does not count yet')
}

// ─── Block Zero's model runs (the "running" Zone 2 run follows the rung) ──
assert(isBlockZeroModelRun({ type: 'foundation_run', blockType: 'block_zero' }), 'the run-walk')
assert(isBlockZeroModelRun({ type: 'running', blockType: 'block_zero', notes: 'zone2' }), 'a Zone 2 run added in Block Zero')
assert(!isBlockZeroModelRun({ type: 'running', blockType: 'block_zero', notes: 'tempo' }), 'a hard run keeps its plan')
assert(!isBlockZeroModelRun({ type: 'running', blockType: 'fighter', notes: 'zone2' }), 'outside Block Zero: the running plan')

console.log('\nAll Block Zero running and load tests passed')
