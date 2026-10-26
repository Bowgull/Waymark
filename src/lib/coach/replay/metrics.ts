// What a replay shows (coach-brain §12.1): the ease stack on every session
// and the pass lines, measured on what the driver wrote down. Pure.

import { isLandmine } from '../../landmine'
import { isHeavyLegs, isoOf, KEY_TYPES } from '../index'
import { RESTART_SESSION_SEC, SINGLE_RUN_CAP_RATIO } from '../../blockZero/running'
import type { DoseRecord, ReplayResult } from './types'

export interface PassLine {
  id: string
  title: string
  /** False when the replay has nothing to measure it on (e.g. no classes). */
  measured: boolean
  pass: boolean
  evidence: string
}

export interface StackRow {
  day: number
  type: string
  label: string | null
  layers: string[]
  volumeRatio: number | null
  loadFactor: number
  /** volume x load against the plain dose for the week. */
  product: number | null
  red: boolean
}

/** The layers that eased one session, by name. */
export function activeLayers(d: DoseRecord): string[] {
  const out: string[] = []
  if (d.layers.leadIn) out.push('lead-in')
  if (d.layers.returnRamp) out.push(`return ramp ${d.layers.returnRamp.tier} (load ${d.layers.returnRamp.loadFactor}, volume ${d.layers.returnRamp.volumeFactor})`)
  if (d.layers.coachEase) out.push(`coach ease ${d.layers.coachEase.kind}`)
  if (d.layers.readinessEase) out.push('readiness ease')
  if (d.layers.loadFlag) out.push('daily load flag')
  if (d.layers.injury) out.push(`injury ${d.layers.injury.split(':')[0]}`)
  if (d.walkOnly) out.push('run became walk')
  return out
}

/** Every started key session with its ease layers and the combined dose against the week's plain dose. */
export function easeStack(doses: DoseRecord[]): StackRow[] {
  return doses.filter(d => d.type === 'strength' || d.type === 'foundation_run' || d.type === 'running').map(d => {
    const rampLoad = d.layers.returnRamp?.loadFactor ?? 1
    // Fighter loads are measured against TM x wave; Block Zero's RIR loads have no plain value, so the ramp's factor stands in.
    const loadFactor = d.type === 'strength' ? d.loadRatio ?? rampLoad : 1
    const product = d.volumeRatio == null ? null : Math.round(d.volumeRatio * loadFactor * 100) / 100
    return { day: d.day, type: d.type, label: d.label, layers: activeLayers(d), volumeRatio: d.volumeRatio, loadFactor, product, red: d.layers.readinessEase }
  })
}

const BANNED = /\b(load|trend|acwr)\b|coach read|you missed/i

function inactiveRuns(r: ReplayResult): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = []
  let start: number | null = null
  for (const d of r.days) {
    if (!d.active) { if (start == null) start = d.day }
    else if (start != null) { out.push({ from: start, to: d.day - 1 }); start = null }
  }
  if (start != null) out.push({ from: start, to: r.toDay })
  return out
}

/** The §12.1 pass lines, measured on today's coach. */
export function replayLines(r: ReplayResult): PassLine[] {
  const lines: PassLine[] = []
  const inactive = new Set(r.days.filter(d => !d.active).map(d => d.day))
  const coachChanges = r.changes.filter(c => c.actor !== 'you')
  // Only the replay's own days (a copied backup also holds older history).
  const inRange = r.sessions.filter(s => s.day != null && s.day >= r.fromDay && s.day <= r.toDay)

  // 1. Invariants.
  const capBreaches = r.doses.filter(d => d.prescribedTotalSec != null && !d.walkOnly
    && d.prescribedTotalSec > Math.max(RESTART_SESSION_SEC, Math.round((d.longestLast30Sec ?? 0) * SINGLE_RUN_CAP_RATIO)) + 1)
  const perNight = new Map<number, number>()
  for (const c of coachChanges.filter(c => c.when === 'nightly')) perNight.set(c.day, (perNight.get(c.day) ?? 0) + 1)
  const busyNights = [...perNight.entries()].filter(([, n]) => n > 2)
  const banned = [...coachChanges.map(c => c.why ?? ''), ...r.doses.flatMap(d => d.why)].filter(w => BANNED.test(w))
  const done = inRange.filter(s => s.status === 'completed' || s.status === 'planned' || s.status === 'in_progress')
  const classes = done.filter(s => s.type === 'mt_class' && s.day != null)
  const legsBeforeClass = classes.filter(c => done.some(s => s.type === 'strength' && s.day != null && isHeavyLegs({ type: s.type, label: s.label }, 'block_zero')
    && (s.day === c.day || (s.day === c.day! - 1 && s.slot === 'pm'))))
  const keyByDay = new Map<number, number>()
  for (const s of inRange.filter(s => KEY_TYPES.has(s.type) && s.type !== 'mt_class' && s.source !== 'ad_hoc' && s.status !== 'missed' && s.status !== 'skipped')) keyByDay.set(s.day!, (keyByDay.get(s.day!) ?? 0) + 1)
  const crammed = [...keyByDay.entries()].filter(([, n]) => n > 1)
  const bad = capBreaches.length + busyNights.length + banned.length + legsBeforeClass.length + crammed.length
  lines.push({
    id: 'L1', title: 'Invariants (caps, spacing, cramming, 2 a night, banned words)', measured: true, pass: bad === 0,
    evidence: `single-run cap breaches ${capBreaches.length}; nights with >2 coach changes ${busyNights.length}; banned words ${banned.length}${banned.length ? ` (e.g. "${banned[0].slice(0, 90)}")` : ''}; heavy legs within 24 h before a class ${legsBeforeClass.length} of ${classes.length} classes; days with 2+ planned key sessions besides a class ${crammed.length}. Why-numbers in the facts: not measurable (no fact packet yet).`,
  })

  // 2. No AI calls on inactive days.
  const idleCalls = r.aiCalls.filter(a => inactive.has(a.day))
  const idleDays = new Set(idleCalls.map(a => a.day))
  lines.push({
    id: 'L2', title: 'No AI calls on inactive days', measured: inactive.size > 0, pass: idleCalls.length === 0,
    evidence: `${idleCalls.length} AI calls on ${idleDays.size} of ${inactive.size} inactive days (${summarizeCallers(idleCalls)}); ${r.aiCalls.length} AI calls in all.`,
  })

  // 3. No easing stack.
  const stack = easeStack(r.doses)
  const deep = stack.filter(s => s.product != null && s.product < 0.8 && !s.red)
  lines.push({
    id: 'L3', title: 'No easing stack (every session >= 0.8 of the plain dose unless RED)', measured: stack.length > 0, pass: deep.length === 0,
    evidence: `${deep.length} of ${stack.length} started sessions under 0.8${deep.length ? `; lowest ${Math.min(...deep.map(s => s.product!))}` : ''}.`,
  })

  // 4. Evenings.
  const pmMissed = inRange.filter(s => s.slot === 'pm' && s.status === 'missed' && s.type !== 'mt_class').sort((a, b) => a.day! - b.day!)
  const second = pmMissed[1]?.day
  const pmAfter = second == null ? [] : inRange.filter(s => s.slot === 'pm' && s.type !== 'mt_class' && s.source !== 'ad_hoc' && s.day != null && s.day > second)
  lines.push({
    id: 'L4', title: 'After 2 missed PM sessions, no non-class sessions placed in PM', measured: second != null, pass: second == null || pmAfter.length === 0,
    evidence: second == null ? `${pmMissed.length} PM sessions missed: nothing to measure.` : `${pmAfter.length} non-class PM sessions planned after the 2nd PM miss.`,
  })

  // 5. Runs over the line move the rung back.
  const runs = r.doses.filter(d => d.type === 'foundation_run' || d.type === 'running').sort((a, b) => a.day - b.day)
  const overLine = runs.filter(d => d.loggedAvgHr != null && d.hrCeilingBpm != null && d.loggedAvgHr > d.hrCeilingBpm)
  const forward = overLine.filter(d => {
    const next = runs.find(n => n.day > d.day)
    return next != null && next.prescribedRunSec != null && d.prescribedRunSec != null && next.prescribedRunSec > d.prescribedRunSec
  })
  lines.push({
    id: 'L5', title: 'Runs over the HR line move the run rung back, never forward', measured: overLine.length > 0, pass: overLine.length > 0 && forward.length === 0,
    evidence: `${overLine.length} runs averaged over their ceiling; after ${forward.length} of them the next run's running time went up.`,
  })

  // 6. Strength without RIR holds.
  const noRir = r.doses.filter(d => d.type === 'strength' && !d.rirOnFile)
  const ups = noRir.flatMap(d => d.loads.filter(l => l.change === 'increase').map(l => ({ day: d.day, ...l })))
  lines.push({
    id: 'L6', title: 'Strength with no RIR logged: HOLD, never PROGRESS', measured: noRir.length > 0, pass: noRir.length > 0 && ups.length === 0,
    evidence: `${noRir.length} strength sessions started with no RIR on file; ${ups.length} load increases among them. Athlete model (shadow): ${modelLiftStates(r)}.`,
  })

  // 7. The lapse: after the 3rd quiet day, one re-entry offer, then silence.
  const lapses = inactiveRuns(r).filter(x => x.to - x.from + 1 >= 4)
  let noisy = 0
  const detail: string[] = []
  for (const l of lapses) {
    const late = (d: number) => d >= l.from + 3 && d <= l.to
    const calls = r.aiCalls.filter(a => late(a.day)).length
    const ch = coachChanges.filter(c => late(c.day)).length
    if (calls + ch > 1) noisy++
    detail.push(`${l.to - l.from + 1}-day lapse: ${calls} AI calls and ${ch} coach changes after day 3`)
  }
  lines.push({
    id: 'L7', title: 'A lapse: after the 3rd quiet day, one re-entry offer, then silence', measured: lapses.length > 0, pass: lapses.length > 0 && noisy === 0,
    evidence: lapses.length ? detail.join('; ') : 'no lapse of 4+ days.',
  })
  return lines
}

export function summarizeCallers(calls: Array<{ caller: string }>): string {
  const by = new Map<string, number>()
  for (const c of calls) by.set(c.caller, (by.get(c.caller) ?? 0) + 1)
  return [...by.entries()].map(([k, n]) => `${k} ${n}`).join(', ') || 'none'
}

/** The athlete model's lift states at the end (P1, shadow): "ex-db-rdl GUESS u=1, ...". */
function modelLiftStates(r: ReplayResult): string {
  const lifts = (r.model?.final ?? []).filter(x => x.kind === 'lift')
  if (!r.model) return 'not run'
  if (lifts.length === 0) return 'no lifts logged'
  return lifts.map(l => `${l.key} ${l.state} u=${l.u}`).join(', ')
}

// ─── The 24-week report (rebuild plan, Phase 1) ──────────────

/** A week's row in the 24-week table. */
export interface WeekRow {
  week: number
  /** Days with a planned key session (Foundation and recovery don't count), and days with one done. */
  trainingDays: number
  /** Key sessions the plan held (a doubled morning packs two into one day). */
  keySessions: number
  doneDays: number
  hardDays: number
  longestHardStreak: number
  restDays: number
  runs: number
  runKm: number
  longRunMin: number | null
  hardRuns: number
  tests: number
  /** The true athlete's 5K that Monday, seconds. */
  true5kSec: number | null
  /** Prescribed main-lift weight against the weight that would leave 2 reps at 8 (1 = right on). */
  liftRatio: number | null
  bag: number
  classes: number
  longestMin: number | null
  /** Sessions planned over 60 minutes (started ones, warm-ups and ramps in); the week's longer run over 75. */
  over60: number
  /** Spacing breaks: a hard run under 48 h after heavy legs; 3 hard days in a row. */
  breaks: string[]
}

const SLOT_H: Record<string, number> = { am: 8, pm: 18 }
const RUNS = new Set(['foundation_run', 'running'])
const HARD_RUN = new Set(['tempo', 'intervals', '5k_test'])
/** Bag Conditioning (built by the Muay Thai track): its own type key. */
export const BAG_SESSION_TYPES: ReadonlySet<string> = new Set(['bag_work', 'bag_conditioning'])

type Sess = ReplayResult['sessions'][number]

/** The rebuild's hard list (plan §1 "Hard days"): lifts, hard runs, classes, bag work, a hard Bag Conditioning. */
export function reportHard(s: Pick<Sess, 'type' | 'contextJson'> & { notes?: string | null }): boolean {
  if (s.type === 'strength' || s.type === 'mt_class') return true
  // Bag Work is hard unless the week planned it as technique only (rebuild Phase 2).
  if (s.type === 'bag_work') return !/"plan":\{"hard":false/.test(s.contextJson ?? '')
  if (s.type === 'running') return HARD_RUN.has(s.notes ?? '')
  if (s.type === 'bag_conditioning') return /"plan":\{"hard":true/.test(s.contextJson ?? '')
  return false
}

/** Heavy legs for the 48-hour rule (plan: squat day, hinge day, and the lunge day while lunges are a main lift). */
export function reportHeavyLegs(s: Pick<Sess, 'type' | 'label' | 'blockType'>): boolean {
  if (s.type !== 'strength') return false
  return isHeavyLegs({ type: s.type, label: s.label }, s.blockType === 'block_zero' ? 'block_zero' : 'fighter') || /Strength C\b/.test(s.label ?? '')
}

/** The weight that leaves 2 reps at 8 (a 10-rep max) from a true 8-rep max (Epley both ways). */
export function rir2Weight(true8Kg: number): number {
  return (true8Kg * (1 + 8 / 30)) / (1 + 10 / 30)
}

/**
 * The 24-week table, one row per week from `fromDay` (a Monday). Structure
 * (days, hard days, rest, classes, bag) reads the plan as it stood at the end
 * (every session not taken off or missed, as the coach's own rules read a
 * week); kilometres, lifts and minutes read what was started.
 */
export function weeklyReport(r: ReplayResult, opts: { fiveKOn?: (day: number) => number } = {}): WeekRow[] {
  const rows: WeekRow[] = []
  const weeks = Math.ceil((r.toDay - r.fromDay + 1) / 7)
  const notesOf = new Map<string, string | null>(r.sessions.map(s => [s.id, s.notes ?? null]))
  // What the plan held (taken off excluded), and what filled his days (missed excluded too): counts of
  // runs, bag and classes read the plan; days, hard days, streaks, rest and spacing read the days.
  const plan = r.sessions.filter(s => s.day != null && s.status !== 'skipped')
  const planned = plan.filter(s => s.status !== 'missed')
  const hardOn = (d: number) => planned.some(s => s.day === d && reportHard(s))
  for (let w = 0; w < weeks; w++) {
    const mon = r.fromDay + w * 7
    const days = Array.from({ length: 7 }, (_, i) => mon + i)
    const inPlan = plan.filter(s => s.day! >= mon && s.day! <= mon + 6)
    const inWeek = planned.filter(s => s.day! >= mon && s.day! <= mon + 6)
    const key = inWeek.filter(s => KEY_TYPES.has(s.type) || BAG_SESSION_TYPES.has(s.type))
    // The step's days: what the plan held (missed ones too).
    const trainingDays = new Set(inPlan.filter(s => KEY_TYPES.has(s.type) || BAG_SESSION_TYPES.has(s.type)).map(s => s.day)).size
    const doneDays = new Set(key.filter(s => s.status === 'completed').map(s => s.day)).size
    const hard = days.filter(hardOn)
    let streak = 0
    let best = 0
    for (const d of days) { streak = hardOn(d) ? streak + 1 : 0; best = Math.max(best, streak) }
    const doses = r.doses.filter(d => d.day >= mon && d.day <= mon + 6)
    const runDoses = doses.filter(d => RUNS.has(d.type))
    const ratios: number[] = []
    for (const d of doses.filter(x => x.type === 'strength' && x.trueKg)) {
      for (const l of d.loads) {
        const t = d.trueKg?.[l.exerciseId]
        // The landmine has its own numbers (the bar end, not the hand): not compared with his true barbell strength.
        if (l.weightKg != null && t && !isLandmine(l.exerciseId)) ratios.push(l.weightKg / rir2Weight(t))
      }
    }
    const breaks: string[] = []
    // A lift he missed loaded nothing: the coach may make the next run hard.
    for (const legs of planned.filter(s => s.status !== 'missed' && reportHeavyLegs(s) && s.day! >= mon - 2 && s.day! <= mon + 6)) {
      for (const run of inWeek.filter(s => s.type === 'running' && HARD_RUN.has(notesOf.get(s.id) ?? ''))) {
        const h = (run.day! * 24 + SLOT_H[run.slot ?? 'am']) - (legs.day! * 24 + SLOT_H[legs.slot ?? 'am'])
        if (h > 0 && h < 48) breaks.push(`${isoOf(run.day!)} hard run ${h} h after heavy legs`)
      }
    }
    for (let d = mon - 2; d <= mon + 4; d++) if (d + 2 >= mon && hardOn(d) && hardOn(d + 1) && hardOn(d + 2)) breaks.push(`${isoOf(d)} 3 hard days in a row`)
    const mins = doses.map(d => d.plannedMin).filter((m): m is number => m != null)
    // The week's longer Zone 2 Run may reach about 75 minutes with its warm-up (2026-10-26).
    const longIds = new Set(r.sessions.filter(s => /"long":true/.test(s.contextJson ?? '')).map(s => s.id))
    const over = doses.filter(d => d.plannedMin != null && d.plannedMin > (longIds.has(d.sessionId) && RUNS.has(d.type) ? 75 : 60)).length
    rows.push({
      week: w + 1,
      trainingDays,
      keySessions: inPlan.filter(s => KEY_TYPES.has(s.type) || BAG_SESSION_TYPES.has(s.type)).length,
      doneDays,
      hardDays: hard.length,
      longestHardStreak: best,
      restDays: days.filter(d => !key.some(s => s.day === d)).length,
      runs: inPlan.filter(s => RUNS.has(s.type)).length,
      runKm: Math.round(runDoses.reduce((n, d) => n + (d.loggedKm ?? 0), 0) * 10) / 10,
      longRunMin: runDoses.length ? Math.max(...runDoses.map(d => d.plannedMin ?? 0)) : null,
      hardRuns: inPlan.filter(s => s.type === 'running' && HARD_RUN.has(notesOf.get(s.id) ?? '')).length,
      tests: inWeek.filter(s => s.type === 'running' && notesOf.get(s.id) === '5k_test').length,
      true5kSec: opts.fiveKOn ? opts.fiveKOn(mon) : null,
      liftRatio: ratios.length ? Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100) / 100 : null,
      bag: inPlan.filter(s => BAG_SESSION_TYPES.has(s.type)).length,
      classes: inPlan.filter(s => s.type === 'mt_class').length,
      longestMin: mins.length ? Math.max(...mins) : null,
      over60: over,
      breaks,
    })
  }
  return rows
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`

/** The table as text (scripts/replay-sim.mts --weeks). */
export function weekTable(rows: WeekRow[]): string {
  const head = 'wk  days done hard strk rest runs   km  long hardR test   5k   lift bag cls  max >60 breaks'
  const lines = rows.map(x => [
    String(x.week).padStart(2), String(x.trainingDays).padStart(5), String(x.doneDays).padStart(4), String(x.hardDays).padStart(4), String(x.longestHardStreak).padStart(4),
    String(x.restDays).padStart(4), String(x.runs).padStart(4), x.runKm.toFixed(1).padStart(5), String(x.longRunMin ?? '-').padStart(5), String(x.hardRuns).padStart(5),
    String(x.tests).padStart(4), (x.true5kSec ? mmss(x.true5kSec) : '-').padStart(6), (x.liftRatio?.toFixed(2) ?? '-').padStart(6), String(x.bag).padStart(3), String(x.classes).padStart(3),
    String(x.longestMin ?? '-').padStart(4), String(x.over60).padStart(3), x.breaks.length ? ` ${x.breaks.length}: ${x.breaks[0]}` : '',
  ].join(' '))
  return [head, ...lines].join('\n')
}
