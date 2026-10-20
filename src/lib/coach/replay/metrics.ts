// What a replay shows (coach-brain §12.1): the ease stack on every session
// and the pass lines, measured on what the driver wrote down. Pure.

import { isHeavyLegs, KEY_TYPES } from '../index'
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
  for (const s of inRange.filter(s => KEY_TYPES.has(s.type) && s.source !== 'ad_hoc' && s.status !== 'missed' && s.status !== 'skipped')) keyByDay.set(s.day!, (keyByDay.get(s.day!) ?? 0) + 1)
  const crammed = [...keyByDay.entries()].filter(([, n]) => n > 1)
  const bad = capBreaches.length + busyNights.length + banned.length + legsBeforeClass.length + crammed.length
  lines.push({
    id: 'L1', title: 'Invariants (caps, spacing, cramming, 2 a night, banned words)', measured: true, pass: bad === 0,
    evidence: `single-run cap breaches ${capBreaches.length}; nights with >2 coach changes ${busyNights.length}; banned words ${banned.length}${banned.length ? ` (e.g. "${banned[0].slice(0, 90)}")` : ''}; heavy legs within 24 h before a class ${legsBeforeClass.length} of ${classes.length} classes; days with 2+ planned key sessions ${crammed.length}. Why-numbers in the facts: not measurable (no fact packet yet).`,
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
    evidence: `${noRir.length} strength sessions started with no RIR on file; ${ups.length} load increases among them. (No confidence state exists to say GUESS: not measurable.)`,
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
