// Run: tsx src/lib/coach/bodyWatch.test.ts
// Injury weather and the raven (page 58): the triggers (page 57's T1-T4 and
// the load-jump line), the lifecycle with its one readjust, the per-place
// plans and the words the boards say, on the mockup's real week (Block Zero
// week 4, Mon 19 to Sun 25 October 2026).
import {
  askDue,
  askView,
  clearView,
  evaluateWatch,
  groupOf,
  holdChanges,
  leftOutFor,
  levelFor,
  morningReportLine,
  noteView,
  notePain,
  physioView,
  planFor,
  planToast,
  plan2View,
  programLine,
  ravenAlarmLine,
  reportsFor,
  shouldClear,
  stepAfter,
  stepLinesFor,
  stepToast,
  stepUp,
  weatherFor,
  BODY_STAGES,
  type AlertLike,
  type BodyEvent,
  type BodyStage,
  type PlanSession,
  type WatchInputs,
} from './bodyWatch'
import { morningLine } from './summary'
import { assert } from './testUtil'

const D = (iso: string) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000)
const eq = (a: unknown, b: unknown, msg: string) => {
  const ok = JSON.stringify(a) === JSON.stringify(b)
  if (!ok) console.error('  got:', JSON.stringify(a), '\n  want:', JSON.stringify(b))
  assert(ok, msg)
}

const empty: WatchInputs = { skips: [], notes: [], backMornings: [], ratings: [], picks: [], runs: [] }

// ── the knee story (page 57 / 58): 6, 15, 20 and 22 October ──
const runs: WatchInputs['runs'] = [
  // week 2 (Mon 5 Oct): 1:30 bouts; week 3 (Mon 12): 2:00; week 4 (Mon 19): 3:30
  { day: D('2026-10-06'), boutSec: 90, totalSec: 1440 }, { day: D('2026-10-08'), boutSec: 90, totalSec: 1440 },
  { day: D('2026-10-13'), boutSec: 120, totalSec: 1560 }, { day: D('2026-10-17'), boutSec: 120, totalSec: 1560 },
  { day: D('2026-10-20'), boutSec: 210, totalSec: 1650 },
]
const knee: WatchInputs = {
  ...empty,
  skips: [
    { day: D('2026-10-06'), reason: 'injury', detail: 'Knee', name: 'the run-walk' },
    { day: D('2026-10-15'), reason: 'injury', detail: 'Knee', name: 'bag work' },
    { day: D('2026-10-22'), reason: 'injury', detail: 'Knee', name: 'the run-walk' },
    { day: D('2026-10-21'), reason: 'tired', detail: null, name: 'Strength B' },
  ],
  notes: [{ day: D('2026-10-20'), text: 'knee sore the last two rounds', name: 'the run-walk' }],
  runs,
}

// ── reports ──
eq(notePain('knee sore the last two rounds'), ['knee'], 'a note with a place and a pain word is a report')
eq(notePain('felt strong, knee fine'), [], 'a place with no pain word is not')
eq(notePain('Back is aching and the left shoulder too'), ['back', 'shoulder'], 'a note can name two places')
const reps = reportsFor('knee', knee)
eq(reps.map(r => r.kind), ['skip', 'skip', 'note', 'skip'], 'skips and notes, one per day, oldest first (a tired skip is not a report)')
eq(reps[0].text, 'Skipped the run-walk. Knee.', 'a skip reads as the note shows it')
eq([reps[2].text, reps[2].quote], ['Your note on the run-walk: ', 'knee sore the last two rounds'], 'his note keeps his own words')
const sameDay = reportsFor('knee', { ...knee, notes: [...knee.notes, { day: D('2026-10-22'), text: 'knee hurt', name: 'Foundation' }] })
assert(sameDay.length === 4 && sameDay[3].kind === 'skip', 'several reports on one day count once, the skip first')

// ── T1 keeps coming back, with the load-jump line ──
const e22 = evaluateWatch('knee', knee, D('2026-10-22'))
assert(e22 != null, 'the fourth report raises the knee')
eq(e22!.triggers, ['comes_back'], 'T1 only: four reports in six weeks')
assert(e22!.level === 1, 'one pattern is green rain')
assert(e22!.count === 4 && e22!.latest - e22!.first + 1 === 17, '"4 times in 17 days"')
eq(e22!.contextLine, 'The last two came the week each run went from 2:00 to 3:30 at a time.', 'the load-jump line names when, not why')
assert(evaluateWatch('knee', { ...knee, skips: knee.skips.slice(0, 1), notes: [] }, D('2026-10-22')) == null, 'one report raises nothing')
assert(evaluateWatch('knee', knee, D('2026-11-10')) == null, 'a run that went quiet 14 days raises nothing')
assert(evaluateWatch('back', knee, D('2026-10-22')) == null, 'other places stay clear')

// ── T2 slow to settle ──
const slow: WatchInputs = { ...empty, skips: [{ day: D('2026-10-01'), reason: 'injury', detail: 'Ankle', name: 'the run-walk' }, { day: D('2026-10-12'), reason: 'injury', detail: 'Ankle', name: 'the run-walk' }, { day: D('2026-10-22'), reason: 'injury', detail: 'Ankle', name: 'the run-walk' }] }
const e2 = evaluateWatch('ankle', slow, D('2026-10-22'))
eq(e2?.triggers, ['comes_back', 'slow'], 'T2: still reported 21 days after the first report')
assert(e2?.level === 2, 'two patterns are a downpour')
const slowRated = evaluateWatch('ankle', { ...empty, skips: slow.skips.slice(0, 2), ratings: [{ day: D('2026-10-23'), region: 'ankle', value: 2 }] }, D('2026-10-23'))
eq(slowRated?.triggers, ['slow'], 'T2 also fires on a sore rating 21 days on')

// ── T3 not easing ──
const rate = (from: string, vals: number[], region = 'knee') => vals.map((v, i) => ({ day: D(from) + i, region, value: v }))
const easing: WatchInputs = { ...knee, ratings: [...rate('2026-10-09', [3, 3, 2, 3, 3, 2, 3]), ...rate('2026-10-16', [2, 3, 2, 2, 3, 2, 2])] }
const e3 = evaluateWatch('knee', easing, D('2026-10-22'))
eq(e3?.triggers, ['comes_back', 'not_easing'], 'T3: this week no better than last (4+ ratings each)')
assert(e3?.level === 2, 'not easing is a downpour')
const better = evaluateWatch('knee', { ...knee, ratings: [...rate('2026-10-09', [2, 2, 2, 2, 2, 2, 2]), ...rate('2026-10-16', [3, 4, 4, 3, 4, 4, 4])] }, D('2026-10-22'))
eq(better?.triggers, ['comes_back'], 'better mornings: not T3')

// ── T4 picked through ──
const picked: WatchInputs = { ...knee, picks: [{ day: D('2026-10-16'), region: 'knee', name: 'skip rope' }, { day: D('2026-10-19'), region: 'knee', name: 'skip rope' }] }
const e4 = evaluateWatch('knee', picked, D('2026-10-22'))
assert(e4?.triggers.includes('picked_through') && e4.level === 3, 'T4: two picks in 14 days and a report within 3 days is a storm')
assert(e4?.picks.length === 2, 'his picks go on the note, quietly')
assert(evaluateWatch('knee', { ...knee, picks: [{ day: D('2026-10-09'), region: 'knee', name: 'skip rope' }, { day: D('2026-10-10'), region: 'knee', name: 'skip rope' }] }, D('2026-10-22'))?.level === 1, 'no report within 3 days of the second pick: not T4')

eq([levelFor([]), levelFor(['comes_back']), levelFor(['slow']), levelFor(['comes_back', 'slow']), levelFor(['not_easing']), levelFor(['comes_back', 'picked_through'])], [0, 1, 1, 2, 2, 3], 'the weather ladder follows the pattern')

// ── the back: only bad or sore mornings, never stiff ──
const stiff: WatchInputs = { ...empty, backMornings: [3, 3, 3, 3, 3].map((v, i) => ({ day: D('2026-10-18') + i, value: v })) }
assert(evaluateWatch('back', stiff, D('2026-10-22')) == null, 'stiff mornings never raise the back')
const soreBack: WatchInputs = { ...empty, backMornings: [2, 3, 1, 3, 2].map((v, i) => ({ day: D('2026-10-18') + i, value: v })) }
eq(evaluateWatch('back', soreBack, D('2026-10-22'))?.triggers, ['comes_back'], 'three bad or sore mornings are T1 for the back')
assert(!evaluateWatch('back', soreBack, D('2026-10-22'))?.triggers.includes('slow'), 'the back waits 42 days for T2')

// ── the quiet rule ──
const quiet = { ...knee, ratings: rate('2026-11-05', [4, 5, 4, 4, 3, 5, 4]) }
assert(shouldClear('knee', quiet, D('2026-11-11'), D('2026-10-22')), 'no report for 14 days and good on 5 of 7 mornings clears it')
assert(!shouldClear('knee', quiet, D('2026-11-04'), D('2026-10-22')), 'not inside 14 days of a report')
assert(!shouldClear('knee', { ...knee, ratings: rate('2026-11-05', [4, 2, 2, 4, 3, 5, 4]) }, D('2026-11-11'), D('2026-10-22')), 'not with sore mornings')
assert(!shouldClear('knee', knee, D('2026-11-08'), D('2026-10-22')) && shouldClear('knee', knee, D('2026-11-12'), D('2026-10-22')), 'never rated: 21 quiet days')

// ── the lifecycle: one readjust, ever ──
const walk = (events: BodyEvent[], from: BodyStage = 'watch') => events.reduce<BodyStage | null>((s, e) => (s ? stepAfter(s, e) : null), from)
assert(walk(['got']) === 'noted' && walk(['got', 'doit']) === 'plan1', 'GOT IT changes nothing; DO IT stays on the note')
assert(walk(['doit', 'ask_due', 'better']) === 'cleared', 'DO IT, the return, FEELS BETTER: the clearing')
assert(walk(['doit', 'ask_due', 'not_now']) === 'ask1', '"Not now" waits; the stage stays')
assert(walk(['doit', 'ask_due', 'sore']) === 'offer2', 'STILL SORE offers plan 2')
assert(walk(['doit', 'ask_due', 'sore', 'doit', 'ask_due', 'sore']) === 'physio', 'still sore at the second return: see a physio')
assert(walk(['doit', 'ask_due', 'sore', 'doit', 'ask_due', 'better']) === 'cleared', 'or it feels better the second time')
assert(walk(['better'], 'physio') === 'cleared', 'FEELS BETTER on the raven at the physio stage clears it')
for (const e of ['doit', 'sore', 'ask_due', 'not_now'] as BodyEvent[]) assert(stepAfter('physio', e) == null, `no third plan: ${e} does nothing at the physio stage`)
for (const s of BODY_STAGES) {
  if (s === 'cleared') continue
  assert(stepAfter(s, 'quiet') === 'cleared', `the quiet rule clears ${s}`)
}
// Exhaustive: from any stage, no path of events makes more than two plans.
{
  const EVENTS: BodyEvent[] = ['got', 'doit', 'ask_due', 'better', 'sore', 'not_now']
  let frontier: Array<{ s: BodyStage; plans: number }> = [{ s: 'watch', plans: 0 }]
  let maxPlans = 0
  for (let depth = 0; depth < 12; depth++) {
    const next: typeof frontier = []
    for (const f of frontier) for (const e of EVENTS) {
      const to = stepAfter(f.s, e)
      if (!to || to === f.s) continue
      const plans = f.plans + (to === 'plan1' || to === 'plan2' ? 1 : 0)
      maxPlans = Math.max(maxPlans, plans)
      next.push({ s: to, plans })
    }
    frontier = next
  }
  assert(maxPlans === 2, 'every path makes at most two plans (one readjust)')
}
assert(askDue('ask1', D('2026-10-28'), D('2026-10-28')) && !askDue('ask1', D('2026-10-29'), D('2026-10-28')), 'the ask is due from ask_on ("Not now" moves it a day)')

// ── the weather ──
eq(weatherFor({ stage: 'watch', level: 1, ackedLevel: 0, clearedAt: null }, 0), { level: 1, quiet: false, clearing: false }, 'the raven lands: loud green rain')
eq(weatherFor({ stage: 'plan1', level: 1, ackedLevel: 1, clearedAt: null }, 0), { level: 1, quiet: true, clearing: false }, 'after DO IT: the quieter fall')
eq(weatherFor({ stage: 'noted', level: 3, ackedLevel: 1, clearedAt: null }, 0).quiet, false, 'a stronger pattern since GOT IT is loud again')
eq(weatherFor({ stage: 'offer2', level: 1, ackedLevel: 1, clearedAt: null }, 0).quiet, false, 'plan 2 offered: green rain again')
eq(weatherFor({ stage: 'physio', level: 1, ackedLevel: 1, clearedAt: null }, 0), { level: 1, quiet: true, clearing: false }, 'the rain stays at the physio stage')
eq(weatherFor({ stage: 'cleared', level: 1, ackedLevel: 1, clearedAt: 5 }, 5), { level: 0, quiet: false, clearing: true }, 'the day it clears')
eq(weatherFor({ stage: 'cleared', level: 1, ackedLevel: 1, clearedAt: 5 }, 6).clearing, false, 'the next day: clear')

// ── what the coach leaves out of its picks ──
assert(leftOutFor('knee', 'skip_rope') && leftOutFor('knee', 'foundation_run') && !leftOutFor('knee', 'bag_work'), 'knee: rope and runs out of the picks')
assert(leftOutFor('wrist', 'bag_work') && leftOutFor('neck', 'mt_class') && leftOutFor('back', 'strength') && leftOutFor('hip', 'running', 'progression') && !leftOutFor('hip', 'foundation_run'), 'per place, as page 57 §5')
eq(['knee', 'ankle', 'shin', 'back', 'shoulder', 'elbow', 'wrist', 'rib', 'neck', 'hip', 'leg'].map(r => groupOf(r as never)), ['lower', 'lower', 'lower', 'back', 'arm', 'arm', 'arm', 'arm', 'neck', 'hipleg', 'hipleg'], 'five plan groups')

// ── the plans, on the mockup's weeks (Block Zero 4, 5 and 6) ──
let sid = 0
function weekSessions(monday: number, week: number, done = -1): PlanSession[] {
  const out: PlanSession[] = []
  const S = (off: number, type: string, label: string | null, slot: 'am' | 'pm' = 'am') => out.push({ id: `s${++sid}`, day: monday + off, type, label, notes: null, timeSlot: slot, status: monday + off <= done ? 'completed' : 'planned', week, blockZero: true, plan: null })
  for (let i = 0; i < 7; i++) S(i, 'mobility', 'Foundation')
  S(0, 'strength', 'Strength A'); S(1, 'foundation_run', 'Run-Walk'); S(2, 'strength', 'Strength B')
  S(3, 'foundation_run', 'Run-Walk'); S(3, 'bag_work', null, 'pm'); S(4, 'strength', 'Strength C'); S(5, 'foundation_run', 'Run-Walk')
  return out
}
const THU22 = D('2026-10-22')
const weeks = [...weekSessions(D('2026-10-19'), 4, THU22), ...weekSessions(D('2026-10-26'), 5), ...weekSessions(D('2026-11-02'), 6)]
const p1 = planFor('knee', 1, THU22, weeks)
assert(p1.start === D('2026-10-23') && p1.end === D('2026-10-27') && p1.askOn === D('2026-10-28'), 'plan 1: Fri 23 to Tue 27; the raven asks Wed 28')
eq(p1.preview.map(p => [p.type, p.days, p.before, p.after]), [
  ['active_recovery', 'SAT 24 · TUE 27', 'RUN-WALK', 'EASY BIKE'],
  ['foundation_run', 'THU 29 · SAT 31', 'RUN 4:00 × 5', 'RUN 2:00 × 7'],
], 'plan 1 on the week, exactly the mockup\'s rows')
eq(p1.lines, [{ b: 'No running or rope,', rest: ' Fri 23 to Tue 27.' }, { b: 'Bike or walk instead,', rest: ' easy, 25 min.' }, { b: 'Then 2:00 run segments,', rest: ' walk 1:00 × 7.' }], 'plan 1\'s three lines')
eq(p1.changes.find(c => c.op.kind === 'bike')?.was, 'run 4:00 × 5'.replace('4:00 × 5', '3:30 × 5'), 'the day board\'s "was" words for week 4\'s run')
eq(planToast('knee', p1, THU22), { title: 'PLAN ON', text: 'Bike Sat and Tue. Then 2:00 runs.' }, 'the DO IT pop-up')

// plan 2 on Wed 28, after plan 1 went on (Thu 29 and Sat 31 carry the 2:00 shape)
const WED28 = D('2026-10-28')
const after1 = weeks.map(s => (p1.changes.some(c => c.sessionId === s.id && c.op.kind === 'shape') ? { ...s, plan: { op: 'shape' as const, was: '4:00 × 5', shapeWeek: 3 } } : s))
  .map(s => (s.day < WED28 ? { ...s, status: 'completed' } : s))
const p2 = planFor('knee', 2, WED28, after1)
assert(p2.start === WED28 && p2.end === D('2026-11-03') && p2.askOn === D('2026-11-04'), 'plan 2: Wed 28 to Tue 3 Nov; the raven comes back Wed 4 Nov')
eq(p2.preview.map(p => [p.type, p.days, p.before, p.after]), [
  ['active_recovery', 'THU 29 · SAT 31 · TUE 3', 'RUN-WALK', 'EASY BIKE'],
  ['bag_work', 'THU 29', 'BAG WORK', 'TECHNIQUE'],
  ['strength', 'FRI 30', '3 × 8', '2 × 8'],
], 'plan 2 on the week (week 6 is already 1 × 8, so Mon 2 keeps its one set)')
eq(p2.lines.map(l => l.b + l.rest), ['No running or rope to Tue 3 Nov.', 'Bike or walk instead: easy, pain-free, 25 min.', 'Bag work technique only; lifts one set lighter, RPE 6.', 'Then 2:00 run segments, if it feels better.'], 'plan 2\'s four lines')
eq(planToast('knee', p2, WED28).text, '7 more days of bike, to Tue 3 Nov.', 'plan 2\'s pop-up')

// other places
const back1 = planFor('back', 1, THU22, weeks)
assert(back1.changes.every(c => c.op.kind === 'back' || c.op.kind === 'badday') && back1.changes.some(c => c.after === 'BACK-FRIENDLY') && back1.changes.some(c => c.after === 'BAD-BACK DAY'), 'back plan 1: back-friendly lifts and the bad-back Foundation')
assert(planFor('back', 2, WED28, after1).changes.some(c => c.after === 'EASY WALK'), 'back plan 2: walking only for conditioning')
const wrist1 = planFor('wrist', 1, D('2026-10-27'), weeks)
eq([...new Set(wrist1.changes.map(c => `${c.before}->${c.after}`))], ['BAG WORK->RESET'], 'wrist plan 1: no bag work or MT; runs stay')
assert(planFor('neck', 1, THU22, weeks).changes.some(c => c.after === 'BAD-NECK DAY'), 'neck plan 1: the bad-neck Foundation')
assert(planFor('hip', 1, THU22, weeks).changes.length === 0, 'hip plan 1: easy run-walks stay (no rope on this week)')
assert(planFor('hip', 2, WED28, after1).changes.every(c => c.after === 'EASY WALK'), 'hip plan 2: runs become walks')

// the physio stage keeps the bikes: new runs become bikes too
const hold = holdChanges('knee', D('2026-11-05'), weeks)
eq(hold.map(c => [c.day, c.after]), [[D('2026-11-05'), 'EASY BIKE'], [D('2026-11-07'), 'EASY BIKE']], 'physio: the bikes stay in place of runs (Thu 5, Sat 7)')

// ── stepping back up on FEELS BETTER (Wed 28) ──
const up = stepUp('knee', D('2026-10-29'), after1)
const steps = up.filter(s => s.shapeWeek != null)
eq(steps.map(s => [s.day, s.shapeWeek, !!s.same, s.before, s.after]), [
  [D('2026-10-29'), 3, true, 'RUN 2:00 × 7', 'RUN 2:00 × 7'],
  [D('2026-10-31'), 4, false, 'RUN 2:00 × 7', 'RUN 3:30 × 5'],
], 'first run back 2:00 × 7 (already on), then 3:30 × 5')
eq(stepToast(up), { title: 'STEPPING UP', text: '2:00 Thu, 3:30 Sat, then the plan.' }, 'the FEELS BETTER pop-up')
eq(stepLinesFor(up, after1, D('2026-10-29')).map(l => [l.d, l.x]), [
  ['THU 29', 'First run back: 2:00, walk 1:00 × 7.'],
  ['SAT 31', '3:30, walk 1:00 × 5 (week 4\'s).'],
  ['NEXT WEEK', 'Back to the plan: 4:00 × 3.'],
], 'the good-news board\'s step lines')
// after plan 2 the bikes go back and the first two runs step up
const bikes = after1.map(s => (p2.changes.some(c => c.sessionId === s.id && c.op.kind === 'bike') ? { ...s, type: 'active_recovery', label: 'Easy Bike', plan: { op: 'bike' as const, was: 'run' } } : s))
const up2 = stepUp('knee', D('2026-11-05'), bikes)
assert(up2.filter(s => s.shapeWeek != null).length === 0 || up2.every(s => s.day >= D('2026-11-05')), 'only from the day after on')

// ── the boards, in the mockup's words ──
const alert = (over: Partial<AlertLike> = {}): AlertLike => ({
  region: 'knee', stage: 'watch', level: 1, ackedLevel: 0, triggers: ['comes_back'], openedAt: THU22, clearedAt: null, clearReason: null,
  evidence: { reports: e22!.reports, picks: [], count: 4, first: e22!.first, latest: e22!.latest }, contextLine: e22!.contextLine,
  planRound: 0, planStartedAt: null, planEndsAt: null, askOn: null, plan1Start: null, answers: [], appliedOn: null, stepLines: null, ...over,
})
const note = noteView(alert(), p1, THU22)
eq([note.from, note.head, note.sl1, note.sl2, note.sl3], ['From the coach', 'KNEE · 4 IN 17 DAYS', 'What the coach noticed', 'Why it matters', 'The plan · 5 days'], 'the note\'s header and sections')
eq(note.rec.map(r => [r.d, r.x, r.q ?? null]), [
  ['TUE 6 OCT', 'Skipped the run-walk. Knee.', null], ['THU 15 OCT', 'Skipped bag work. Knee.', null],
  ['TUE 20 OCT', 'Your note on the run-walk: ', 'knee sore the last two rounds'], ['THU 22 OCT', 'Skipped the run-walk. Knee.', null],
], 'what the coach noticed, with his dates')
eq(note.why, 'In runners, a past injury is the most common sign of the next one. Small strains usually settle in 2 to 5 weeks when they get room.', 'why it matters')
eq(note.foot, 'DO IT puts these on your week, with UNDO. GOT IT changes nothing. The raven asks again Wed 28.', 'the footer')
eq(note.btns, ['got', 'doit'], 'GOT IT, then DO IT')

const planned = alert({ stage: 'plan1', ackedLevel: 1, planRound: 1, planStartedAt: p1.start, planEndsAt: p1.end, askOn: p1.askOn, plan1Start: p1.start, appliedOn: THU22 })
eq(morningReportLine(alert(), THU22), { text: 'Knee: 4 times in 17 days.', settled: false }, 'the brass line, watch')
eq(morningReportLine(planned, THU22)?.text, 'Knee plan: bike to Tue 27. The raven\'s back Wed 28.', 'the brass line, plan 1')
eq(programLine(planned, THU22), 'The knee plan, from Thu 22: no running to Tue 27, then 2:00 at a time. The raven asks Wed 28.', 'Program\'s week line')
const asked = { ...planned, stage: 'ask1' as const }
eq(morningReportLine(asked, WED28)?.text, 'The raven\'s back: how\'s the knee?', 'the brass line, the return')
eq(askView(asked, WED28, D('2026-10-29')), { when: 'WED 28 OCT', head: 'HOW\'S THE KNEE?', line: 'Five days of bike, no running. Tomorrow\'s run-walk is the first one back.' }, 'the first return\'s question')
const sore1 = { ...asked, stage: 'offer2' as const, answers: [{ on: WED28, answer: 'sore' as const }] }
eq(morningReportLine(sore1, WED28)?.text, 'Knee: still sore.', 'the brass line, still sore')
const v2 = plan2View(sore1, p2, WED28)
eq([v2.from, v2.head, v2.sl1, v2.sl3], ['One more plan', 'KNEE · STILL SORE', 'So far', 'The plan · 7 more days'], 'plan 2\'s board')
eq(v2.rec.map(r => [r.d, r.x]), [['FRI 23 OCT', 'Plan 1: 5 days of bike, no running.'], ['WED 28 OCT', 'You said: still sore.']], 'so far')
eq(v2.why, 'Five days wasn\'t enough. A longer, gentler week usually is for a small strain. This is the last change the coach makes for the knee.', 'it says it\'s the last change')
eq(v2.foot, 'The raven comes back Wed 4 Nov.', 'plan 2\'s footer')
const plan2 = { ...sore1, stage: 'plan2' as const, planRound: 2, planStartedAt: p2.start, planEndsAt: p2.end, askOn: p2.askOn, appliedOn: WED28 }
eq(morningReportLine(plan2, WED28)?.text, 'Knee plan: 7 more days, to Tue 3 Nov.', 'the brass line, plan 2')
const WED4 = D('2026-11-04')
const ask2 = { ...plan2, stage: 'ask2' as const }
eq(askView(ask2, WED4, null).line, 'Seven more days of bike, no running. Last time it was still sore.', 'the second return\'s question')
const physio = { ...ask2, stage: 'physio' as const, answers: [...ask2.answers, { on: WED4, answer: 'sore' as const }] }
const pv = physioView(physio, WED4)
eq([pv.from, pv.head, pv.sl1], ['See someone', 'KNEE · SEE A PHYSIO', 'Four weeks'], 'the physio board')
eq(pv.rec.map(r => [r.d, r.x]), [['TUE 6 OCT', 'The first report.'], ['FRI 23 OCT', 'Plan 1: 5 days of bike, no running.'], ['WED 28 OCT', 'Still sore. Plan 2: 7 more days.'], ['WED 4 NOV', 'Still sore.']], 'four weeks, listed')
eq(pv.recs.map(r => r.b + r.rest), ['Book a physio or a doctor for the knee.', 'The coach won\'t change the plan again. The easy bikes stay in place of runs until you say it feels better.', 'Nothing is locked. Pick or put back anything yourself.'], 'the coach recommends')
eq(pv.btns, ['got', 'better'], 'GOT IT and FEELS BETTER')
eq(morningReportLine(physio, WED4)?.text, 'Knee: see a physio.', 'the brass line, physio')
const cleared = { ...asked, stage: 'cleared' as const, clearedAt: WED28, clearReason: 'better', stepLines: stepLinesFor(up, after1, D('2026-10-29')) }
eq(morningReportLine(cleared, WED28), { text: 'Knee feels better.', settled: true }, 'the teal line the day it clears')
assert(morningReportLine(cleared, WED28 + 1) == null, 'gone the day after')
const cv = clearView(cleared, WED28)
eq([cv.from, cv.head, cv.settled, cv.ctx, cv.sl2, cv.foot], ['Good news', 'KNEE · FEELS BETTER', true, 'Rope is back in the coach\'s picks.', 'Remember', 'The raven leaves tomorrow'], 'the good-news board')
eq(cv.why, 'If the knee comes back within 6 weeks, these dates still count, so the raven comes sooner.', 'remember')

// the storm and the other triggers' lines
eq(morningReportLine(alert({ level: 3, triggers: ['comes_back', 'picked_through'] }), THU22)?.text, 'Knee: sore again after the run.', 'storm line')
eq(morningReportLine(alert({ level: 2, triggers: ['not_easing'] }), THU22)?.text, 'Knee: no better than last week.', 'downpour line (not easing)')

// ── the morning alarm's line ──
eq(ravenAlarmLine({ ...alert(), seen: false }, THU22 + 1), 'Knee: 4 times in 17 days. Tap to see.', 'once, the morning after, if unread')
assert(ravenAlarmLine({ ...alert(), seen: false }, THU22 + 2) == null, 'only once')
assert(ravenAlarmLine({ ...alert(), seen: true }, THU22 + 1) == null, 'not once it is read')
eq(ravenAlarmLine({ ...planned, seen: true }, WED28), 'The raven\'s back: how\'s the knee?', 'each return morning')
eq(ravenAlarmLine({ ...asked, askOn: WED28 + 1, seen: true }, WED28 + 1), 'The raven\'s back: how\'s the knee?', '"Not now": the next morning too')
assert(ravenAlarmLine({ ...planned, seen: true }, WED28 - 1) == null, 'not before the plan ends')

eq(morningLine([], WED28, "The raven's back: how's the knee?"), "The raven's back: how's the knee?", "morningLine: the raven's line on the alarm")
assert(morningLine([], WED28, null) == null, 'morningLine: no raven, no change, no line')

console.log('bodyWatch: all good')
