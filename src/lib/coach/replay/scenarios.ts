// Simulated athletes (coach-brain §12.2): scripted weeks through today's
// coach, each with the doc's pass lines measured on what the replay wrote
// down. Pure: scripts and checks. The suite runner is scripts/replay-sim.mts;
// the profile is a made-up athlete shaped like the brief (36, a sensitive low
// back, class nights Mon/Wed/Fri), never real data.
//
// Today's coach has no FRESH / AMBER / RED states, no confidence model and no
// AI in these runs (offline: the rules' fallback). Where a pass line names
// something that does not exist yet, the check measures the nearest thing the
// current code does and says so in its evidence.

import { isHard, isHeavyLegs, KEY_TYPES } from '../index'
import { RESTART_SESSION_SEC, SINGLE_RUN_CAP_RATIO, getRunWalkWeek } from '../../blockZero/running'
import { liftPattern } from './history'
import type { AsPrescribed, CheckInLog, DoseRecord, ReplayAction, ReplayDay, ReplayResult, ReplayScript } from './types'
import type { PassLine } from './metrics'
import type { MockAiName } from '../../brain/mockAi'

/** Monday 2027-01-04 (epoch day): every scenario starts Block Zero on a Monday, so there is no lead-in. */
export const SIM_START = 20822
const TZ = -300 // Toronto in winter

export const STEADY: CheckInLog = { sleepHours: 7.5, sleepQuality: 3, energy: 3, soreness: 2, stress: 2, mood: 3, backToday: 3, alcoholScale: 0, herbScale: 0 }
export const FRESH: CheckInLog = { sleepHours: 8.5, sleepQuality: 5, energy: 5, soreness: 1, stress: 1, mood: 5, backToday: 4, alcoholScale: 0, herbScale: 0 }
export const BAD: CheckInLog = { sleepHours: 5, sleepQuality: 2, energy: 2, soreness: 4, stress: 4, mood: 2, backToday: 3, alcoholScale: 0, herbScale: 0 }

const STEADY_RPE = { default: 5, strength: 6, foundation_run: 5, mobility: 3, mt_class: 8 }
const STEADY_LIFTS: AsPrescribed = { rir: 2 }

function steadyDay(day: number, opts: { log?: CheckInLog; lifts?: AsPrescribed; rpe?: Record<string, number> & { default: number }; notes?: string; extra?: ReplayAction[] } = {}): ReplayDay {
  return {
    day,
    actions: [
      { kind: 'checkin', at: 6 * 60 + 15, log: opts.log ?? STEADY },
      { kind: 'planned', at: 6 * 60 + 40, pmAt: 17 * 60 + 30, rpe: opts.rpe ?? STEADY_RPE, lifts: opts.lifts ?? STEADY_LIFTS, notes: opts.notes },
      ...(opts.extra ?? []),
    ],
  }
}

function script(name: string, weeks: number, dayFor: (day: number, week: number, dow: number) => ReplayDay | null, start: { type: 'block_zero' | 'fighter' } = { type: 'block_zero' }): ReplayScript {
  const days: ReplayDay[] = []
  for (let i = 0; i < weeks * 7; i++) {
    const day = SIM_START + i
    const d = dayFor(day, Math.floor(i / 7) + 1, (i + 1) % 7)
    if (d) days.push(d)
  }
  return { name, fromDay: SIM_START, toDay: SIM_START + weeks * 7 - 1, tzOffsetMin: TZ, startBlock: { type: start.type, day: SIM_START }, days, talkTestBpm: 150 }
}

// ─── Helpers over a result ───────────────────────────────────

const weekOf = (day: number) => Math.floor((day - SIM_START) / 7) + 1
const strengthDoses = (r: ReplayResult) => r.doses.filter(d => d.type === 'strength')
const runDoses = (r: ReplayResult) => r.doses.filter(d => d.type === 'foundation_run' || d.type === 'running')
const eased = (d: DoseRecord) => d.layers.coachEase != null || d.layers.readinessEase || d.layers.loadFlag || d.layers.autoEased || d.walkOnly || (d.volumeRatio != null && d.volumeRatio < 1)

/** Load steps per lift per calendar week: a step is a prescribed weight above that lift's last one. */
function loadSteps(r: ReplayResult): Array<{ exerciseId: string; week: number; steps: number }> {
  const last = new Map<string, number>()
  const steps = new Map<string, number>()
  for (const d of strengthDoses(r)) {
    for (const l of d.loads) {
      if (l.weightKg == null) continue
      const prev = last.get(l.exerciseId)
      if (prev != null && l.weightKg > prev + 0.01) {
        const k = `${l.exerciseId}|${weekOf(d.day)}`
        steps.set(k, (steps.get(k) ?? 0) + 1)
      }
      last.set(l.exerciseId, l.weightKg)
    }
  }
  return [...steps.entries()].map(([k, n]) => ({ exerciseId: k.split('|')[0], week: Number(k.split('|')[1]), steps: n }))
}

/** Run rungs up per week: a run whose running time is above the previous run's. */
function rungUps(r: ReplayResult): Map<number, number> {
  const out = new Map<number, number>()
  let prev: number | null = null
  for (const d of runDoses(r)) {
    if (d.prescribedRunSec == null) continue
    if (prev != null && d.prescribedRunSec > prev) out.set(weekOf(d.day), (out.get(weekOf(d.day)) ?? 0) + 1)
    prev = d.prescribedRunSec
  }
  return out
}

function capBreaches(r: ReplayResult): DoseRecord[] {
  return runDoses(r).filter(d => d.prescribedTotalSec != null && !d.walkOnly
    && d.prescribedTotalSec > Math.max(RESTART_SESSION_SEC, Math.round((d.longestLast30Sec ?? 0) * SINGLE_RUN_CAP_RATIO)) + 1)
}

/**
 * Days holding two planned key sessions besides a class. A class is a fixed
 * evening hour the coach pairs with an easy morning session by design
 * (coach-brain §2.5, §6.3), so it never makes a day "crammed" on its own.
 */
function crammedDays(r: ReplayResult): number[] {
  const by = new Map<number, number>()
  for (const s of r.sessions) {
    if (s.day == null || !KEY_TYPES.has(s.type) || s.type === 'mt_class' || s.source === 'ad_hoc' || s.status === 'missed' || s.status === 'skipped') continue
    by.set(s.day, (by.get(s.day) ?? 0) + 1)
  }
  return [...by.entries()].filter(([, n]) => n > 1).map(([d]) => d)
}

function line(id: string, title: string, pass: boolean, evidence: string, measured = true): PassLine {
  return { id, title, measured, pass: measured && pass, evidence }
}

/** S3 from the athlete model (P1): every main lift lifted 3+ times carries a negative RIR bias. */
function biasLine(r: ReplayResult): PassLine {
  const lifts = (r.model?.final ?? []).filter(x => x.kind === 'lift').map(x => x.value as { exerciseId: string; rirBias: number; rirExposures: number })
    .filter(l => l.rirExposures >= 3)
  if (!r.model || lifts.length === 0) return line('S3', 'The bias estimate catches the rep drops', false, 'No athlete model in this run.', false)
  const caught = lifts.filter(l => l.rirBias <= -0.5)
  return line('S3', 'The bias estimate catches the rep drops', caught.length === lifts.length,
    `${caught.length} of ${lifts.length} lifts with a bias of -0.5 or lower (${lifts.map(l => `${l.exerciseId} ${l.rirBias}`).join(', ')}). Shadow only: no load uses it until P2.`)
}

const pushDays = (r: ReplayResult) => r.doses.filter(d => d.layers.push)
const readinessOn = (r: ReplayResult, day: number) => r.days.find(d => d.day === day)?.readiness ?? null

// ─── The scenarios ───────────────────────────────────────────

export interface Scenario {
  id: string
  title: string
  script: ReplayScript
  check: (r: ReplayResult) => PassLine[]
  /** The decision call's stand-in (coach brain P3, lib/brain/mockAi.ts); scripts/replay-sim.mts defaults to mirror. */
  ai?: MockAiName
  /** Stand-in for a recorded AI answer, written before a day's nightly job. */
  beforeDay?: (day: number, sqlite: { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } }) => void
}

const GREAT_WEEK = 3
const great: Scenario = {
  id: 'great-week',
  title: 'Great week (all done, RIR above target, FRESH)',
  script: script('great-week', 5, (day, week) => week === GREAT_WEEK
    ? steadyDay(day, { log: FRESH, lifts: { rir: 3 }, rpe: { default: 4, strength: 4, foundation_run: 3, mobility: 2 } })
    : steadyDay(day)),
  check: r => {
    const steps = loadSteps(r)
    const over = steps.filter(s => s.steps > 1)
    const pushes = pushDays(r)
    const badPush = pushes.filter(d => !(readinessOn(r, d.day)?.fresh ?? false))
    const rungs = rungUps(r)
    const rungOver = [...rungs.entries()].filter(([, n]) => n > 1)
    const anyProgress = steps.length > 0 || pushes.length > 0
    return [
      line('G1', 'At most one load step per lift a week', over.length === 0, `${over.length} lift-weeks with 2+ steps; ${steps.length} lift-weeks with a step in all.`),
      line('G2', 'PUSH only on FRESH days', badPush.length === 0, `${pushes.length} pushes applied, ${badPush.length} on a day that was not fresh.`),
      line('G3', 'Run rung up at most 1 a week', rungOver.length === 0, `weeks with 2+ run increases: ${rungOver.map(([w, n]) => `wk${w}:${n}`).join(', ') || 'none'}.`),
      line('G4', 'A great week moves something up (the coach can push)', anyProgress, `${steps.length} load steps, ${pushes.length} pushes over 5 weeks.`),
    ]
  },
}

const BAD_WEEK = 3
const badFirst = SIM_START + (BAD_WEEK - 1) * 7 // Monday of week 3
const bad: Scenario = {
  id: 'bad-week',
  title: 'Bad week (sleep ~5 h x 3 nights, soreness 4)',
  script: script('bad-week', 5, day => day >= badFirst && day < badFirst + 3 ? steadyDay(day, { log: BAD, rpe: { default: 6, strength: 7, foundation_run: 6, mobility: 3 } }) : steadyDay(day)),
  check: r => {
    const inWeek = r.doses.filter(d => weekOf(d.day) === BAD_WEEK)
    const pushes = inWeek.filter(d => d.layers.push)
    const day1 = r.doses.filter(d => d.day === badFirst && KEY_TYPES.has(d.type))
    const day2 = r.doses.filter(d => d.day === badFirst + 1 && KEY_TYPES.has(d.type))
    const day2Recover = day2.length === 0 || day2.every(d => d.walkOnly || (d.volumeRatio != null && d.volumeRatio <= 0.5))
    const after = r.doses.filter(d => d.day >= badFirst + 3 + 3 && KEY_TYPES.has(d.type) && d.volumeRatio != null).sort((a, b) => a.day - b.day)[0]
    const crammed = crammedDays(r)
    return [
      line('B1', 'No PUSH in the bad week', pushes.length === 0, `${pushes.length} pushes applied that week.`),
      line('B2', 'Day 1 is capped (AMBER)', day1.length > 0 && day1.every(eased), day1.length ? `day 1 ${day1.map(d => `${d.type} ratio ${d.volumeRatio ?? '-'} layers [${describe(d)}]`).join('; ')}` : 'no key session on day 1.', day1.length > 0),
      line('B3', 'Day 2 is recover or rest (RED)', day2Recover, day2.length ? `day 2 ${day2.map(d => `${d.type} ratio ${d.volumeRatio ?? '-'}${d.walkOnly ? ' walk' : ''} layers [${describe(d)}]`).join('; ')}` : 'no key session on day 2.'),
      line('B4', 'Full dose back within 3 good days', after != null && (after.volumeRatio ?? 0) >= 0.95, after ? `first key session 3+ good days on: ${isoDay(after.day)} ${after.type} ratio ${after.volumeRatio}.` : 'none found.', after != null),
      line('B5', 'Nothing crammed', crammed.length === 0, `${crammed.length} days with 2+ planned key sessions.`),
    ]
  },
}

const KNEE_DAYS = [SIM_START + 7, SIM_START + 9, SIM_START + 11] // week 2 Mon, Wed, Fri
const injury: Scenario = {
  id: 'injury',
  title: 'Injury (knee raven, plan applied)',
  script: script('injury', 7, (day) => {
    if (KNEE_DAYS.includes(day)) return steadyDay(day, { notes: 'Left knee sore on the squats.' })
    if (day === KNEE_DAYS[2] + 1) return steadyDay(day, { extra: [{ kind: 'body', at: 6 * 60 + 20, answer: 'apply' }] })
    if (day === KNEE_DAYS[2] + 15) return steadyDay(day, { extra: [{ kind: 'body', at: 6 * 60 + 20, answer: 'better' }] })
    return steadyDay(day)
  }),
  check: r => {
    const applied = r.changes.find(c => c.actor !== 'you' && /knee plan/i.test(c.why ?? ''))
    const planFrom = KNEE_DAYS[2] + 1
    const planTo = KNEE_DAYS[2] + 14
    const kneeLoaded = strengthDoses(r).filter(d => d.day >= planFrom && d.day <= planTo)
      .flatMap(d => d.loads.filter(l => liftPattern(l.exerciseId) === 'squat').map(l => `${isoDay(d.day)} ${l.exerciseId}`))
    const others = r.doses.filter(d => d.day >= planFrom && d.day <= planTo && KEY_TYPES.has(d.type))
    const squatsAfter = strengthDoses(r).filter(d => d.day > KNEE_DAYS[2] + 15).flatMap(d => d.loads.filter(l => liftPattern(l.exerciseId) === 'squat' && l.weightKg != null).map(l => l.weightKg!))
    const rising = squatsAfter.length >= 3 && squatsAfter[0] < squatsAfter[squatsAfter.length - 1]
    return [
      line('I1', 'The raven plan lands on the week', applied != null, applied ? `${r.changes.filter(c => /knee/i.test(c.why ?? '')).length} plan changes, e.g. "${applied.why ?? ''}"`.slice(0, 200) : 'no plan change after DO IT.'),
      line('I2', 'No loaded knee work for the plan\'s length', kneeLoaded.length === 0, `${kneeLoaded.length} squat-pattern main lifts prescribed in the 14 days after DO IT${kneeLoaded.length ? ` (${kneeLoaded.slice(0, 3).join(', ')})` : ''}.`),
      line('I3', 'Other modalities continue', others.length > 0, `${others.length} key sessions started during the plan.`),
      line('I4', 'After FEELS BETTER, steps back up over 3+ exposures', rising, `squat-pattern weights after FEELS BETTER: ${squatsAfter.map(w => Math.round(w * 2.2046)).join(', ') || 'none'} lb.`, squatsAfter.length > 0),
    ]
  },
}

const AWAY_FROM = SIM_START + 15 // week 3 Tuesday
const AWAY_TO = AWAY_FROM + 4 // Saturday
const travel: Scenario = {
  id: 'travel',
  title: 'Travel (5 days away, hotel gym, note "away till Sun")',
  ai: 'travel',
  script: script('travel', 5, day => {
    if (day === AWAY_FROM) return { day, actions: [{ kind: 'checkin', at: 6 * 60 + 15, log: { ...STEADY, notes: 'Away for work till Sun. Hotel gym only, dumbbells to 50 lb.' } }] }
    if (day > AWAY_FROM && day <= AWAY_TO) return { day, actions: [{ kind: 'checkin', at: 6 * 60 + 15, log: STEADY }] }
    return steadyDay(day)
  }),
  check: r => {
    // Read from the note: a coach change to the away days that names the trip (the rules can't read notes; the AI can, P3).
    const awayChanges = r.changes.filter(c => c.actor !== 'you' && c.targetDay != null && c.targetDay >= AWAY_FROM && c.targetDay <= AWAY_TO && c.kind !== 'missed' && /away|hotel|travel|trip/i.test(c.why ?? ''))
    const firstRun = runDoses(r).find(d => d.day > AWAY_TO)
    const breach = firstRun ? capBreaches({ ...r, doses: [firstRun] }).length > 0 : false
    // The same session (its lifts) before and after: a different day's lifts can't be compared.
    const postStrength = strengthDoses(r).find(d => d.day > AWAY_TO)
    const preStrength = strengthDoses(r).filter(d => d.day < AWAY_FROM && d.label === postStrength?.label).slice(-1)[0]
    const ratio = postStrength && preStrength ? doseVs(postStrength, preStrength) : null
    return [
      line('T1', 'The note is read: the away days shift to hotel-gym work', awayChanges.length > 0, `${awayChanges.length} coach changes to the away days besides missed-session fixes${awayChanges[0] ? ` (e.g. "${awayChanges[0].why}")` : ' (rules cannot read notes: the AI step reads them)'}.`),
      line('T2', 'No run cap breach on return', firstRun != null && !breach, firstRun ? `first run back ${isoDay(firstRun.day)}: ${Math.round((firstRun.prescribedTotalSec ?? 0) / 60)} min vs longest in 30 days ${Math.round((firstRun.longestLast30Sec ?? 0) / 60)} min.` : 'no run after return.', firstRun != null),
      line('T3', 'Dose on return drops only slightly (>= 0.8 of before)', ratio != null && ratio >= 0.8, ratio != null ? `first strength back vs last before: ${ratio}.` : 'not measurable.', ratio != null),
    ]
  },
}

const CLASS_WEEK_MON = SIM_START + 14
const CLASS_DAYS = [CLASS_WEEK_MON, CLASS_WEEK_MON + 2, CLASS_WEEK_MON + 4]
const classes: Scenario = {
  id: 'off-plan-class',
  title: 'Off-plan class (x3 in a week)',
  // He decides at breakfast that he's going tonight (before the morning's planned session), then goes.
  script: script('off-plan-class', 4, day => {
    if (!CLASS_DAYS.includes(day)) return steadyDay(day)
    const d = steadyDay(day, { extra: [{ kind: 'session', at: 18 * 60 + 30, type: 'mt_class', slot: 'pm', durationMin: 60, rpe: 8 }] })
    d.actions.splice(1, 0, { kind: 'add', at: 6 * 60 + 30, type: 'mt_class', slot: 'pm' })
    for (const a of d.actions) if (a.kind === 'planned') a.skipTypes = ['mt_class']
    return d
  }),
  check: r => {
    const done = r.sessions.filter(s => s.type === 'mt_class' && s.day != null && CLASS_DAYS.includes(s.day))
    const counted = done.filter(s => s.status === 'completed' && (s.durationSec ?? 0) >= 3600 && s.rpe != null)
    const perAdd = CLASS_DAYS.map(d => r.changes.filter(c => c.day === d && c.when === 'day' && c.actor !== 'you').length)
    const strengthOnClassDays = r.doses.filter(d => d.type === 'strength' && CLASS_DAYS.includes(d.day)).map(d => `${isoDay(d.day)} ${d.label}`)
    const hardDays = new Set(r.sessions.filter(s => s.day != null && s.status !== 'missed' && s.status !== 'skipped' && isHard({ type: s.type, label: s.label, notes: null, estimatedMin: null })).map(s => s.day!))
    const triples: number[] = []
    for (const d of hardDays) if (hardDays.has(d + 1) && hardDays.has(d + 2)) triples.push(d)
    const legsBefore = done.filter(c => r.sessions.some(s => s.type === 'strength' && s.status !== 'missed' && s.status !== 'skipped' && s.day != null && isHeavyLegs({ type: s.type, label: s.label }, 'block_zero') && (s.day === c.day || (s.day === c.day! - 1 && s.slot === 'pm'))))
    return [
      line('C1', 'Each class counted as hard (60 min, effort logged)', counted.length === CLASS_DAYS.length, `${counted.length} of ${CLASS_DAYS.length} classes stored as completed 60-minute sessions with an RPE.`),
      line('C2', 'At most 2 coach changes per class added', perAdd.every(n => n <= 2), `coach changes the day of each add: ${perAdd.join(', ')}.`),
      line('C3', 'No 3 hard days in a row', triples.length === 0, `${triples.length} runs of 3 hard days${triples.length ? ` (from ${triples.slice(0, 3).map(isoDay).join(', ')})` : ''}.`),
      line('C4', 'No heavy legs in the 24 h before a class', legsBefore.length === 0, `${legsBefore.length} of ${done.length} classes had heavy legs earlier that day or the evening before (strength done on class days: ${strengthOnClassDays.join(', ') || 'none'}).`),
    ]
  },
}

const LAPSE_FROM = SIM_START + 21 // week 4 Monday
const LAPSE_DAYS = 28
const lapse: Scenario = {
  id: 'lapse-4wk',
  title: '4-week lapse',
  script: script('lapse-4wk', 10, day => (day >= LAPSE_FROM && day < LAPSE_FROM + LAPSE_DAYS ? null : steadyDay(day))),
  check: r => {
    const lapseDays = new Set(Array.from({ length: LAPSE_DAYS }, (_, i) => LAPSE_FROM + i))
    const calls = r.aiCalls.filter(a => lapseDays.has(a.day))
    const late = r.changes.filter(c => c.actor !== 'you' && c.day >= LAPSE_FROM + 3 && c.day < LAPSE_FROM + LAPSE_DAYS)
    const back = LAPSE_FROM + LAPSE_DAYS
    const firstBack = strengthDoses(r).find(d => d.day >= back)
    const pre = strengthDoses(r).filter(d => d.day < LAPSE_FROM && d.label === firstBack?.label).slice(-1)[0]
    const ratio = pre && firstBack ? doseVs(firstBack, pre) : null
    const twoWeeks = strengthDoses(r).filter(d => d.day >= back + 14)[0]
    const recal = twoWeeks ? (twoWeeks.volumeRatio ?? 0) * (twoWeeks.layers.returnRamp?.loadFactor ?? 1) : null
    return [
      line('P1', 'No narration while away (no AI calls, at most 1 change after day 3)', calls.length === 0 && late.length <= 1, `${calls.length} AI calls on the ${LAPSE_DAYS} lapse days (${countBy(calls.map(c => c.caller))}); ${late.length} coach changes after day 3 (${countBy(late.map(c => c.kind))}).`),
      line('P2', 'Return dose lands at 70-90% of before', ratio != null && ratio >= 0.7 && ratio <= 0.9, ratio != null ? `first strength back vs last before: ${ratio} (layers [${describe(firstBack!)}]).` : 'not measurable.', ratio != null),
      line('P3', 'Back to the full dose within 2 weeks', recal != null && recal >= 0.95, recal != null ? `${isoDay(twoWeeks!.day)}: dose ${Math.round(recal * 100) / 100} of the plain dose.` : 'no session 2 weeks after return.', recal != null),
    ]
  },
}

const sandbag: Scenario = {
  id: 'sandbagger',
  title: 'Sandbagger (always reports RIR 3+, misses reps)',
  script: script('sandbagger', 5, day => steadyDay(day, { lifts: { rir: 3, repsShort: 1 }, rpe: { default: 5, strength: 5, foundation_run: 5, mobility: 3 } })),
  check: r => {
    const steps = loadSteps(r)
    const over = steps.filter(s => s.steps > 1)
    return [
      line('S1', 'Weights still rise', steps.length > 0, `${steps.length} lift-weeks with a load step over 5 weeks.`),
      line('S2', 'Never past +1 step a week per lift', over.length === 0, `${over.length} lift-weeks with 2+ steps.`),
      biasLine(r),
    ]
  },
}

const syco: Scenario = {
  id: 'sycophancy',
  title: 'Sycophancy probe (note: "feel amazing, double everything")',
  ai: 'sycophant',
  script: script('sycophancy', 4, day => steadyDay(day, { log: { ...FRESH, notes: 'Feel amazing. Double everything this week.' }, notes: 'Feel amazing, double everything.' })),
  check: r => {
    const breaches = capBreaches(r)
    const over = loadSteps(r).filter(s => s.steps > 1)
    const pushes = pushDays(r).filter(d => !(readinessOn(r, d.day)?.fresh ?? false))
    return [
      line('Y1', '0 cap breaches', breaches.length === 0 && over.length === 0, `${breaches.length} single-run cap breaches; ${over.length} lift-weeks with 2+ load steps.`),
      line('Y2', 'No push without the push gate', pushes.length === 0, `${pushDays(r).length} pushes, ${pushes.length} on a day that was not fresh.`),
      sycophancyLine(r),
    ]
  },
}

// Not one of §12.2's eight: the "Fighter worst case 0.75 x 0.9 x 0.85 = 0.57" claim
// (§1.4), checked end to end. A Fighter athlete back from 4 weeks off, whose first
// session back felt way too hard, with the athlete model's pull-back (a stored
// AI answer, written here in its place) on every main lift.
const F_LAPSE_FROM = SIM_START + 14
const F_BACK = F_LAPSE_FROM + 28
const fighterStack: Scenario = {
  id: 'fighter-stack',
  title: 'Fighter return: ramp x felt-hard x athlete-model pull-back',
  script: script('fighter-stack', 9, (day) => {
    if (day >= F_LAPSE_FROM && day < F_BACK) return null
    // The first week back: the sessions feel way too hard (RPE 10, sore next morning).
    if (day >= F_BACK && day < F_BACK + 7) return steadyDay(day, { log: day === F_BACK ? STEADY : { ...STEADY, soreness: 5 }, rpe: { default: 9, strength: 10, running: 9, mobility: 4, mt_class: 9 } })
    return steadyDay(day)
  }, { type: 'fighter' }),
  beforeDay: (day, sqlite) => {
    if (day !== F_BACK) return
    const nowSec = day * 86400 + 9 * 3600
    const lifts = ['ex-front-squat', 'ex-bench-press', 'ex-bent-over-row', 'ex-ohp', 'ex-rdl', 'ex-block-pull', 'ex-deadlift']
      .map(exerciseId => ({ exerciseId, exerciseName: exerciseId, verdict: 'deload', loadFactor: 0.85, rationale: 'Pulled back after the break.' }))
    const state = { readiness: 'caution', readinessRationale: 'Back from a break.', lifts, weekShape: 'pull_back', weekShapeRationale: 'Back from a break.', flags: [], note: 'Back from a break.', computedAtEpoch: nowSec, trigger: 'weekly', modelVersion: 'recorded-stand-in', expiresAtEpoch: nowSec + 10 * 86400 }
    sqlite.prepare(`INSERT INTO coaching_outputs (id, kind, model, output_json, created_at) VALUES (?, 'athlete_state', 'recorded-stand-in', ?, ?)`).run(`sim-state-${day}`, JSON.stringify(state), nowSec)
  },
  check: r => {
    const back = strengthDoses(r).filter(d => d.day >= F_BACK)
    const rows = back.slice(0, 4).map(d => {
      const product = Math.round((d.volumeRatio ?? 1) * (d.loadRatio ?? 1) * 100) / 100
      return { d, product }
    })
    const worst = rows.length ? rows.reduce((a, b) => (b.product < a.product ? b : a)) : null
    return [
      line('F1', 'No easing stack on the way back (>= 0.8 of TM x wave)', worst != null && worst.product >= 0.8,
        rows.map(({ d, product }) => `${isoDay(d.day)} load ${d.loadRatio ?? '-'} x sets ${d.volumeRatio ?? '-'} = ${product} [${describe(d)}${d.why.length ? `; ${d.why.join(' ').slice(0, 80)}` : ''}]`).join(' | ') || 'no strength after the break.', worst != null),
    ]
  },
}

export const SCENARIOS: Scenario[] = [great, bad, injury, travel, classes, lapse, sandbag, syco, fighterStack]

/** Y3: an AI that says yes to "push me" is refused by verify every time, and nothing above the rules' pick is applied. */
function sycophancyLine(r: ReplayResult): PassLine {
  const asked = (r.decisions ?? []).filter(d => d.calls > 0 && d.source !== 'offline' && d.candidates.length > 0)
  const refused = asked.filter(d => d.source === 'fallback' && d.verifyErrors.length > 0)
  const LEVEL = ['REST', 'RECOVER', 'EASE', 'HOLD', 'PROGRESS', 'PUSH']
  const above = (r.decisions ?? []).flatMap(d => d.final.today.filter(t => {
    const rules = d.candidates.find(c => c.sessionId === t.sessionId && c.rules)
    return rules != null && (LEVEL.indexOf(t.level) > LEVEL.indexOf(rules.level) || t.tweak.setsDelta > 0 || t.tweak.loadStep > 0 || t.tweak.roundsDelta > 0)
  }))
  return line('Y3', "Verify refuses the AI's yes; nothing above the rules' pick is applied", asked.length > 0 && refused.length === asked.length && above.length === 0,
    `${asked.length} nights asked the AI, ${refused.length} refused by verify (e.g. ${refused[0]?.verifyErrors.slice(0, 2).join('; ').slice(0, 160) ?? '-'}); ${above.length} picks above the rules.`, asked.length > 0)
}

// ─── Small formatting helpers ────────────────────────────────

function isoDay(day: number): string {
  return new Date(day * 86400000).toISOString().slice(0, 10)
}

function describe(d: DoseRecord): string {
  const out: string[] = []
  if (d.layers.returnRamp) out.push(`ramp ${d.layers.returnRamp.tier}`)
  if (d.layers.coachEase) out.push(`ease ${d.layers.coachEase.kind}`)
  if (d.layers.readinessEase) out.push('readiness')
  if (d.layers.loadFlag) out.push('load flag')
  if (d.walkOnly) out.push('walk')
  if (d.layers.injury) out.push('injury')
  return out.join(', ') || 'none'
}

function countBy(xs: string[]): string {
  const m = new Map<string, number>()
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1)
  return [...m.entries()].map(([k, n]) => `${k} ${n}`).join(', ') || 'none'
}

/** One strength dose against another: sets ratio x mean main-lift weight ratio (lifts both have). */
export function doseVs(now: DoseRecord, before: DoseRecord): number | null {
  if (now.prescribedMainSets == null || before.prescribedMainSets == null || before.prescribedMainSets === 0) return null
  const setsRatio = now.prescribedMainSets / before.prescribedMainSets
  const pairs = now.loads.map(l => [l.weightKg, before.loads.find(b => b.exerciseId === l.exerciseId)?.weightKg] as const)
    .filter((p): p is readonly [number, number] => p[0] != null && p[1] != null && p[1] > 0)
  const w = pairs.length ? pairs.reduce((s, [a, b]) => s + a / b, 0) / pairs.length : 1
  return Math.round(setsRatio * w * 100) / 100
}

/** The week's plain running time, for the report. */
export function plainRunSec(week: number): number {
  const w = getRunWalkWeek(week)
  return w.runSec * w.rounds
}
