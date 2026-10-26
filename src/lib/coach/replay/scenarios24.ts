// The 24-week simulator (rebuild plan, Phase 1): a made-up returning athlete
// with a true strength and a true 5K the coach never sees
// (trueAthlete.ts), through the real coach for 24 weeks. Each scenario
// prints the weekly table (metrics.ts weeklyReport) and the plan's pass
// lines. Run: npx tsx scripts/replay-sim.mts --suite 24wk [--weeks].
//
// Never real data. Class days come from Settings, as in the app.

import { SIM_START, STEADY, BAD, type Scenario } from './scenarios'
import { rir2Weight, weeklyReport, type PassLine, type WeekRow } from './metrics'
import { TrueAthlete } from './trueAthlete'
import { isLandmine } from '../../landmine'
import type { AthleteHooks, CheckInLog, ReplayAction, ReplayDay, ReplayResult, ReplayScript } from './types'

const TZ = -300
const WEEKS = 24
const RPE = { default: 5, strength: 7, foundation_run: 4, running: 5, mobility: 3, mt_class: 8, bag_work: 7, bag_conditioning: 7 }

export interface Scenario24 extends Scenario {
  /** Settings before the block starts (class days). */
  setup?: { mtClassDays: string; mtClassSlots?: string }
  athlete: TrueAthlete
  /** The weekly table of the last run (filled by check). */
  table?: WeekRow[]
}

function hooks(a: TrueAthlete, extraMiss?: (day: number, type: string) => boolean): AthleteHooks {
  return {
    set: s => a.set(s),
    run: r => a.run(r),
    misses: (day, type) => a.misses(day, type) || (extraMiss?.(day, type) ?? false),
    trueKg: (id, day) => a.true8(id, day),
  }
}

function day(d: number, h: AthleteHooks, opts: { log?: CheckInLog; extra?: ReplayAction[]; before?: ReplayAction[] } = {}): ReplayDay {
  return {
    day: d,
    actions: [
      ...(opts.before ?? []),
      { kind: 'checkin', at: 6 * 60 + 15, log: opts.log ?? STEADY },
      { kind: 'planned', at: 6 * 60 + 40, pmAt: 17 * 60 + 30, rpe: RPE, lifts: { rir: 2 }, athlete: h },
      ...(opts.extra ?? []),
    ],
  }
}

function script24(name: string, build: (d: number, week: number, dow: number) => ReplayDay | null): ReplayScript {
  const days: ReplayDay[] = []
  for (let i = 0; i < WEEKS * 7; i++) {
    const d = SIM_START + i
    const r = build(d, Math.floor(i / 7) + 1, (i + 1) % 7)
    if (r) days.push(r)
  }
  return { name, fromDay: SIM_START, toDay: SIM_START + WEEKS * 7 - 1, tzOffsetMin: TZ, startBlock: { type: 'block_zero', day: SIM_START }, days, talkTestBpm: 150 }
}

const line = (id: string, title: string, pass: boolean, evidence: string, measured = true): PassLine => ({ id, title, measured, pass: measured && pass, evidence })
const weeksWhere = (rows: WeekRow[], f: (r: WeekRow) => boolean) => rows.filter(f).map(r => r.week)
const list = (ws: number[]) => ws.length ? `weeks ${ws.slice(0, 8).join(', ')}${ws.length > 8 ? '…' : ''}` : 'none'

/** The plan's cap: 3 hard days at 4 to 5 training days, 4 at 6. */
export const hardCap = (trainingDays: number) => (trainingDays >= 6 ? 4 : 3)

/** The plan's pass lines (Phase 1 table), on one run's weekly rows. */
export function planLines(r: ReplayResult, rows: WeekRow[], a: TrueAthlete, opts: { classDays?: (week: number) => number[]; normalFrom?: number; quietWeeks?: number[] } = {}): PassLine[] {
  const quiet = new Set(opts.quietWeeks ?? [])
  const normal = rows.filter(x => !quiet.has(x.week))
  // The step's cap: 3 hard days at 4-5 days, 4 at 6 (3+ runs a week: 6 days; doubled mornings pack 6 into fewer days).
  const capOf = (x: WeekRow) => (x.runs >= 3 ? 4 : hardCap(x.trainingDays))
  const overCap = weeksWhere(normal, x => x.hardDays > capOf(x))
  const streak = weeksWhere(rows, x => x.longestHardStreak >= 3)
  const noRest = weeksWhere(rows, x => x.restDays < 1)
  const legs = rows.flatMap(x => x.breaks.filter(b => b.includes('after heavy legs')))
  const over60 = weeksWhere(rows, x => x.over60 > 0)
  // Page 93: a bag session every week from 5 days; at 4 days the week's class is its Muay Thai (no class days: Bag Conditioning).
  const noBag = weeksWhere(normal, x => x.bag < 1 && !(x.trainingDays <= 4 && x.classes > 0))
  // Hard runs start once he runs 10 minutes straight, week 4 at the earliest (page 76; rebuild plan):
  // every normal week after the week of his first continuous run.
  const firstContinuous = r.doses.find(d => (d.type === 'foundation_run' || d.type === 'running') && d.why.some(w => /no walk breaks/.test(w)))
  const contWeek = firstContinuous ? Math.floor((firstContinuous.day - r.fromDay) / 7) + 1 : null
  // The week after is already built (Saturday) when he first runs 10 straight: hard runs from the week after that.
  const from = opts.normalFrom ?? Math.max(4, (contWeek ?? WEEKS) + 2)
  // Hard runs come with the step: one at 3 runs a week (6 days), two at 4 (page 93).
  const noHardRun = weeksWhere(normal.filter(x => x.week >= from && x.runs >= 3), x => x.hardRuns < 1)
  const testWeeks = weeksWhere(rows, x => x.tests > 0)
  const firstHard = rows.find(x => x.hardRuns > 0)?.week ?? null
  // From the first hard run to each test and on to the end: never more than 8 weeks without one (a week's slack).
  const marks = firstHard == null ? [] : [firstHard, ...testWeeks.filter(w => w >= firstHard), WEEKS]
  const gaps = marks.slice(1).map((w, i) => w - marks[i])
  const testOk = firstHard != null && testWeeks.length > 0 && gaps.every(g => g <= 9)
  const lifts8 = rows.filter(x => x.week >= 8 && x.liftRatio != null)
  const liftOff = lifts8.filter(x => (x.liftRatio as number) < 0.85)
  // A drop after an on-target session: the next prescribed weight of a lift under the last, with no ease that day.
  const drops: string[] = []
  const last = new Map<string, number>()
  for (const d of r.doses.filter(x => x.type === 'strength')) {
    const eased = d.layers.coachEase != null || d.layers.readinessEase || d.layers.injury != null || (d.layers.brain?.level ?? 'HOLD') === 'EASE' || d.layers.brain?.level === 'RECOVER'
    for (const l of d.loads) {
      // A landmine move has its own rule (a plate off only after two hard sessions), apart from the day's level.
      if (isLandmine(l.exerciseId)) continue
      const prev = last.get(l.exerciseId)
      if (l.weightKg != null && prev != null && l.weightKg < prev - 0.01 && !eased) drops.push(`${l.exerciseId} wk ${Math.floor((d.day - r.fromDay) / 7) + 1}`)
      if (l.weightKg != null) last.set(l.exerciseId, l.weightKg)
    }
  }
  const start = rows[0]?.trainingDays ?? 0
  const top = Math.max(...rows.slice(0, 10).map(x => x.trainingDays))
  const classOff: string[] = []
  if (opts.classDays) {
    for (const s of r.sessions.filter(x => x.type === 'mt_class' && x.day != null && x.status !== 'skipped' && x.source !== 'ad_hoc')) {
      const wk = Math.floor((s.day! - r.fromDay) / 7) + 1
      const dow = new Date(s.day! * 86400000).getUTCDay()
      if (!opts.classDays(wk).includes(dow)) classOff.push(`wk ${wk} ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow]}`)
    }
  }
  const lastRow = rows[rows.length - 1]
  void a
  return [
    line('W1', 'Hard days under the cap (3 at 4-5 days, 4 at 6)', overCap.length === 0, `over the cap: ${list(overCap)}; hard days a week ${rows.map(x => x.hardDays).join(' ')}.`),
    line('W2', 'Never 3 hard days in a row', streak.length === 0, `3+ in a row: ${list(streak)}.`),
    line('W3', 'At least 1 rest day every week', noRest.length === 0, `no rest day: ${list(noRest)}.`),
    line('W4', 'No hard run within 48 h after heavy legs', legs.length === 0, `${legs.length} breaks${legs.length ? ` (e.g. ${legs[0]})` : ''}.`),
    line('W5', 'Every session 60 minutes or less (the longer run 75)', over60.length === 0, `weeks with a session over its cap: ${list(over60)}; longest ${Math.max(...rows.map(x => x.longestMin ?? 0))} min.`),
    line('W6', 'A bag session every week (at 4 days, a class week counts: page 93)', noBag.length === 0, `no bag: ${list(noBag)}; bag a week ${rows.map(x => x.bag).join(' ')}.`),
    line('W7', 'Hard runs in every normal week at 3+ runs once he runs 10 min straight (week 4+)', noHardRun.length === 0, `10 min straight first in week ${contWeek ?? '-'}; from week ${from}, none in ${list(noHardRun)}; hard runs a week ${rows.map(x => x.hardRuns).join(' ')}.`),
    line('W8', 'A 5K test every 6 to 8 weeks once hard runs start', testOk, `first hard run week ${firstHard ?? '-'}; tests in ${list(testWeeks)}.`),
    line('W9', 'Lifts within 15% of true by week 8', lifts8.length > 0 && liftOff.length === 0, `weeks 8+ under 0.85: ${list(liftOff.map(x => x.week))}; ratio ${rows.map(x => x.liftRatio?.toFixed(2) ?? '-').join(' ')}.`, lifts8.length > 0),
    line('W10', 'No lift drop after an un-eased session', drops.length === 0, `${drops.length} drops${drops.length ? ` (e.g. ${drops.slice(0, 3).join(', ')})` : ''}.`),
    line('W11', 'Days ramp from 4 toward 6 with good attendance', start <= 4 && top >= 6, `week 1 ${start} days, most in weeks 1-10 ${top}; days a week ${rows.map(x => x.trainingDays).join(' ')}.`),
    line('W12', 'Classes only on Settings class days', classOff.length === 0, `${classOff.length} off-days${classOff.length ? ` (${classOff.slice(0, 4).join(', ')})` : ''}.`, opts.classDays != null),
    line('W13', 'Run km and long run grow', lastRow != null && Math.max(...rows.slice(-4).map(x => x.runKm)) >= 15 && Math.max(...rows.slice(-4).map(x => x.longRunMin ?? 0)) >= 45,
      `km a week ${rows.map(x => x.runKm.toFixed(0)).join(' ')}; long run ${rows.map(x => x.longRunMin ?? '-').join(' ')}.`),
  ]
}

// ─── The scenarios ───────────────────────────────────────────

const CHANGE_WEEK = 10
/** Class days for returner-24wk: Tue/Thu, then Mon/Wed from Wednesday of week 10. */
const changedDays = (week: number) => (week < CHANGE_WEEK ? [2, 4] : week === CHANGE_WEEK ? [1, 2, 3, 4] : [1, 3])

function make(id: string, title: string, setup: Scenario24['setup'], build: (a: TrueAthlete, h: AthleteHooks) => (d: number, week: number, dow: number) => ReplayDay | null,
  lineOpts: (rows: WeekRow[]) => Parameters<typeof planLines>[3], extraMiss?: (day: number, type: string) => boolean, extra?: (r: ReplayResult, rows: WeekRow[]) => PassLine[]): Scenario24 {
  const athlete = new TrueAthlete(SIM_START)
  const h = hooks(athlete, extraMiss)
  const sc: Scenario24 = {
    id, title, setup, athlete,
    script: script24(id, build(athlete, h)),
    check: r => {
      const rows = weeklyReport(r, { fiveKOn: d => athlete.fiveKOn(d) })
      sc.table = rows
      return [...planLines(r, rows, athlete, lineOpts(rows)), ...(extra?.(r, rows) ?? [])]
    },
  }
  return sc
}

const returner = make('returner-24wk', 'A returning athlete, 24 weeks: classes Tue/Thu, changed mid-week to Mon/Wed in week 10', { mtClassDays: '2,4', mtClassSlots: 'tue:pm,thu:pm' },
  (_a, h) => (d, week, dow) => day(d, h, week === CHANGE_WEEK && dow === 3 ? { before: [{ kind: 'settings', at: 6 * 60, patch: { mtClassDays: '1,3', mtClassSlots: 'mon:pm,wed:pm' } }] } : {}),
  () => ({ classDays: changedDays }), undefined,
  (r, rows) => {
    const wk = rows.filter(x => x.week === CHANGE_WEEK || x.week === CHANGE_WEEK + 1)
    const breaks = wk.flatMap(x => x.breaks)
    const over = wk.filter(x => x.hardDays > (x.runs >= 3 ? 4 : hardCap(x.trainingDays)))
    // The days after the change: classes only on the new days, and the week keeps its rules.
    const changeDay = SIM_START + (CHANGE_WEEK - 1) * 7 + 2
    const stale = r.sessions.filter(s => s.type === 'mt_class' && s.day != null && s.day > changeDay && s.status !== 'skipped' && ![1, 3].includes(new Date(s.day * 86400000).getUTCDay()))
    return [line('W14', 'A mid-week class-day change re-plans this week and next with no rule broken', breaks.length === 0 && over.length === 0 && stale.length === 0,
      `weeks ${CHANGE_WEEK}-${CHANGE_WEEK + 1}: ${breaks.length} spacing breaks, ${over.length} weeks over the cap, ${stale.length} classes left on old days; classes ${wk.map(x => x.classes).join(', ')}.`)]
  })

const noClasses = make('returner-no-classes', 'No class days in Settings: bag every week, no classes ever', { mtClassDays: '' },
  (_a, h) => d => day(d, h), () => ({ classDays: () => [] }))

const BUSY = [6, 7, 8, 9]
const busy = make('returner-busy', 'Busy month (weeks 6-9: misses Tue and Thu): days step down, then back up', { mtClassDays: '2,4', mtClassSlots: 'tue:pm,thu:pm' },
  (_a, h) => d => day(d, h), () => ({ classDays: () => [2, 4], quietWeeks: BUSY }),
  (d, type) => { const wk = Math.floor((d - SIM_START) / 7) + 1; const dow = new Date(d * 86400000).getUTCDay(); return BUSY.includes(wk) && (dow === 2 || dow === 4) && type !== 'mobility' },
  (_r, rows) => {
    const before = rows.find(x => x.week === BUSY[0])?.trainingDays ?? 0
    const low = Math.min(...rows.filter(x => BUSY.includes(x.week) || x.week === BUSY[BUSY.length - 1] + 1).map(x => x.trainingDays))
    const after = Math.max(...rows.filter(x => x.week > BUSY[BUSY.length - 1] + 1).map(x => x.trainingDays))
    return [line('B1', 'Days step down in a busy stretch and come back after', low < before && after >= before, `week ${BUSY[0]} ${before} days, lowest in the busy stretch ${low}, most after ${after}; days ${rows.map(x => x.trainingDays).join(' ')}.`)]
  })

const SICK_FROM = SIM_START + 7 * 7 + 1 // week 8 Tuesday
const sick = make('returner-sick', 'Sick 3 days in week 8: no hard run in the easy days after', { mtClassDays: '2,4', mtClassSlots: 'tue:pm,thu:pm' },
  (_a, h) => d => (d >= SICK_FROM && d < SICK_FROM + 3
    ? { day: d, actions: [{ kind: 'checkin', at: 6 * 60 + 15, log: { ...BAD, notes: 'Sick, fever and a sore throat.' } }] }
    : day(d, h)),
  () => ({ classDays: () => [2, 4], quietWeeks: [8] }), undefined,
  r => {
    const end = SICK_FROM + 3
    const hard = r.sessions.filter(s => s.type === 'running' && s.day != null && s.day >= end && s.day < end + 3 && s.status !== 'skipped' && ['tempo', 'intervals', '5k_test'].includes(s.notes ?? ''))
    return [line('S1', 'No hard run or test in the 3 days after being sick', hard.length === 0, `${hard.length} hard runs planned in the 3 days after.`)]
  })

const LAPSE_WEEKS = [12, 13]
const lapse = make('returner-lapse', 'Two quiet weeks (12-13): back at 4 days, no crash', { mtClassDays: '2,4', mtClassSlots: 'tue:pm,thu:pm' },
  (_a, h) => (d, week) => (LAPSE_WEEKS.includes(week) ? null : day(d, h)),
  () => ({ classDays: () => [2, 4], quietWeeks: [...LAPSE_WEEKS, 14] }), undefined,
  (_r, rows) => {
    const back = rows.find(x => x.week === LAPSE_WEEKS[LAPSE_WEEKS.length - 1] + 1)
    const before = rows.find(x => x.week === LAPSE_WEEKS[0] - 1)
    // Fewer days, or as many days with fewer sessions (6 days with two doubled mornings can sit on 5 calendar days).
    const fewer = back != null && before != null && (back.trainingDays < before.trainingDays || (back.trainingDays === before.trainingDays && back.keySessions < before.keySessions))
    return [line('L1', 'Back from 2 quiet weeks at fewer days, not the full week', fewer, `week ${LAPSE_WEEKS[0] - 1} ${before?.trainingDays} days (${before?.keySessions} sessions), first week back ${back?.trainingDays} days (${back?.keySessions} sessions).`)]
  })

export const SIM24_SCENARIOS: Scenario24[] = [returner, noClasses, busy, sick, lapse]
export { rir2Weight }
