// The coach picks on REPLACE and + add (page 73, approved 2026-10-22): one to
// three sessions the coach would put on that day instead, each with one short
// reason, then everything else. The new brain decides, not the old board
// rules: today's readiness (the night's ceiling, the morning's read), the
// week's spacing and limits (outline.ts: violations and spacing costs), the
// week so far (days trained in a row, the domain kept in the week), his own
// eases and his skips for time, a knee or shin flag, and the weather at the
// session's hour when the phone sent it. Nothing is refused: every option is
// still on the list, the picks only lead it. Pure.

import { isHard, type BlockKind } from '../coach/sessions'
import { spacingCosts, violations, type OutlineSession } from './outline'
import type { ReadinessState } from './readiness'
import type { OwnEase } from './types'

export interface PickOption {
  /** type, or type:runCategory. */
  key: string
  type: string
  label: string
  runCategory?: string
}

export interface PickWeather {
  kind: 'rain' | 'cold' | 'heat' | 'storm'
  /** "6 PM": the session's hour. */
  hour: string
}

export interface PicksIn {
  mode: 'replace' | 'add'
  day: number
  today: number
  slot: 'am' | 'pm'
  /** The session REPLACE swaps out. */
  replacing: { id: string; type: string; label: string | null; notes: string | null } | null
  /** The week's sessions (Sunday before to Monday after). */
  week: OutlineSession[]
  monday: number
  blockType: BlockKind
  state: ReadinessState
  stateWhy: string | null
  ownEases: readonly OwnEase[]
  /** Skips and cuts for time in the last days (adherence.scheduleSkips.recent). */
  scheduleSkips: ReadonlyArray<{ day: number; type: string }>
  /** Days before `day` with a done key session (to count days in a row). */
  trainedDays: ReadonlySet<number>
  options: readonly PickOption[]
  /** About how long each option takes (minutes), by key. */
  minutes: Readonly<Record<string, number | null>>
  weather?: PickWeather | null
  /** A knee, ankle or shin flag (or one on watch). */
  kneeFlag?: boolean
}

export interface RankedOption {
  key: string
  score: number
  /** One short line: the coach's reason for a pick. */
  reason: string
  /** It would break one of the week's limits. */
  breaks: boolean
  /** Every reason it has, strongest first (the plain line last). */
  reasons: string[]
}

export interface PicksOut {
  picks: RankedOption[]
  rest: RankedOption[]
}

/** How hard each kind of session is, 0 (easy) to 3 (a class). */
const EFFORT: Readonly<Record<string, number>> = {
  mobility: 0, active_recovery: 0, foundation_run: 1, skip_rope: 1, running: 2, bag_work: 2, strength: 2, mt_class: 3,
}
const effortOf = (type: string) => EFFORT[type] ?? 1
const domainOf = (type: string): OwnEase['domain'] | null => (type === 'strength' ? 'strength' : type === 'running' || type === 'foundation_run' ? 'run' : type === 'bag_work' ? 'bag' : null)
const OUTDOOR = new Set(['running', 'foundation_run'])
const INDOOR = new Set(['bag_work', 'skip_rope', 'strength', 'mobility'])
const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const dow = (day: number) => ((day % 7) + 11) % 7

/** The line when nothing else says more. */
const PLAIN: Readonly<Record<string, string>> = {
  mobility: 'Easier on the body today.',
  active_recovery: 'An easy day: walk or bike.',
  foundation_run: 'Easy aerobic, low cost.',
  running: 'Keeps the week moving.',
  bag_work: 'Same effort, indoors.',
  skip_rope: 'Short and light on the joints.',
  strength: 'Keeps strength in the week.',
  mt_class: 'A class, if the time works.',
}

/** At most this many picks; the first is always there when anything is. */
export const MAX_PICKS = 3

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const trimDot = (s: string) => s.trim().replace(/[.!]+$/, '')

/** The week with the option in the replaced session's place (or added on the day). */
function weekWith(inp: PicksIn, o: PickOption): OutlineSession[] {
  if (inp.replacing) {
    return inp.week.map(s => (s.id === inp.replacing!.id ? { ...s, type: o.type, label: o.type === 'strength' ? s.label : o.label, notes: o.runCategory ?? null } : s))
  }
  return [...inp.week, { id: `pick:${o.key}`, type: o.type, label: o.label, day: inp.day, slot: inp.slot, status: 'planned', source: 'ad_hoc', locked: true, notes: o.runCategory ?? null }]
}

function costOf(week: readonly OutlineSession[], inp: PicksIn): { viol: string[]; cost: number } {
  return { viol: violations(week, inp.blockType, inp.monday), cost: spacingCosts(week, inp.blockType, inp.monday).reduce((n, c) => n + c.cost, 0) }
}

/** Days in a row with a done key session, ending the day before. */
function daysInARow(inp: PicksIn): number {
  let n = 0
  for (let d = inp.day - 1; inp.trainedDays.has(d); d--) n++
  return n
}

/** Score every option and pick the coach's 1-3. */
export function rankPicks(inp: PicksIn): PicksOut {
  const base = costOf(inp.week, inp)
  const row = daysInARow(inp)
  const replacedEffort = inp.replacing ? effortOf(inp.replacing.type) : null
  const recentEase = [...inp.ownEases].reverse().find(e => e.day >= inp.today - 7 && (e.kind === 'skipped' || e.kind === 'swapped'))
  const busy = inp.scheduleSkips.some(s => s.day >= inp.today - 7)
  const ranked: RankedOption[] = inp.options.map(o => {
    const e = effortOf(o.type)
    const factors: Array<{ v: number; why?: string }> = []
    // Readiness: the ceiling for the day.
    const stateWhy = inp.stateWhy ? trimDot(inp.stateWhy) : null
    if (inp.state === 'RED') {
      factors.push(e === 0 ? { v: 3, why: `${stateWhy ?? 'A rough morning'}: go gentle.` } : { v: e >= 2 ? -4 : -1 })
    } else if (inp.state === 'AMBER') {
      factors.push(e === 0 ? { v: 1.5, why: `${stateWhy ?? 'Not a green morning'}: go gentle.` } : e === 1 ? { v: 0.5 } : { v: o.type === 'mt_class' ? -2 : -1.5 })
    }
    // Spacing and the week's limits (the night's own solver rules).
    const after = costOf(weekWith(inp, o), inp)
    const added = after.viol.filter(v => !base.viol.includes(v))
    const cleared = base.viol.filter(v => !after.viol.includes(v))
    if (added.length > 0) factors.push({ v: -3 * added.length })
    if (cleared.length > 0) factors.push({ v: 1.5 * cleared.length, why: cleared[0] === 'no rest day' ? 'Leaves the week a rest day.' : `Avoids ${cleared[0]}.` })
    const spacing = after.cost - base.cost
    if (spacing < -0.2) factors.push({ v: -spacing, why: 'Better spaced from the hard days around it.' })
    else if (spacing > 0.2) factors.push({ v: -spacing })
    // The week so far: days trained in a row, the domain kept in the week.
    if (row >= 3 && e === 0) factors.push({ v: 1.2, why: `${cap(['', 'one', 'two', 'three', 'four', 'five', 'six'][row] ?? String(row))} training days in a row: an easy one.` })
    else if (row >= 3 && e >= 2) factors.push({ v: -0.8 })
    if (inp.replacing && replacedEffort != null) {
      const sameDomain = domainOf(o.type) != null && domainOf(o.type) === domainOf(inp.replacing.type)
      if (sameDomain && e < replacedEffort) factors.push({ v: 0.8, why: `Keeps the ${domainOf(o.type) === 'run' ? 'run' : domainOf(o.type)} in the week, easier.` })
      if (e <= replacedEffort) factors.push({ v: 0.3 })
      else factors.push({ v: -0.5 * (e - replacedEffort) })
    } else if (inp.mode === 'add') {
      if (e === 0) factors.push({ v: 0.6, why: inp.minutes[o.key] ? `Fits the day, ${inp.minutes[o.key]} min.` : undefined })
      if (e >= 2) factors.push({ v: -0.6 })
    }
    // His own eases: a domain he just eased off stays light.
    const d = domainOf(o.type)
    if (recentEase && d === recentEase.domain && e >= 1) factors.push({ v: -1 })
    if (recentEase && e === 0) factors.push({ v: 0.5, why: `You eased off on ${DAY[dow(recentEase.day)]}: keep it light.` })
    // Skips for time: something short.
    const min = inp.minutes[o.key] ?? null
    if (busy && min != null && min <= 20) factors.push({ v: 0.8, why: `Short: ${min} min.` })
    // The weather at the session's hour (today only).
    const w = inp.weather && inp.day === inp.today ? inp.weather : null
    if (w) {
      const word = w.kind === 'rain' ? 'Rain' : w.kind === 'storm' ? 'Storms' : w.kind === 'cold' ? 'Bitter cold' : 'Humidex high'
      if (OUTDOOR.has(o.type) && w.kind !== 'heat') factors.push({ v: -2 })
      else if (INDOOR.has(o.type) && (!inp.replacing || OUTDOOR.has(inp.replacing.type))) factors.push({ v: 1.5, why: `${word} ${/^this /.test(w.hour) ? '' : 'at '}${w.hour}: ${e === effortOf(inp.replacing?.type ?? '') ? 'same work, indoors' : 'indoors works'}.` })
      if (w.kind === 'heat' && e >= 2) factors.push({ v: -1 })
    }
    if (inp.kneeFlag) {
      if (o.type === 'skip_rope') factors.push({ v: -3 })
      else if (OUTDOOR.has(o.type)) factors.push({ v: -1 })
      else if (e === 0) factors.push({ v: 0.5, why: 'Easy on the knee.' })
    }
    // A class is the gym's hour: it leads only for a clear reason.
    if (o.type === 'mt_class') factors.push({ v: -1 })
    if (isHard({ type: o.type, label: o.label, notes: o.runCategory ?? null, estimatedMin: null }) && inp.day === inp.today && inp.slot === 'pm' && row >= 2) factors.push({ v: -0.3 })
    const score = factors.reduce((n, f) => n + f.v, 0)
    const reasons = factors.filter(f => f.why && f.v > 0).sort((a, b) => b.v - a.v).map(f => f.why as string)
    return { key: o.key, score: Math.round(score * 100) / 100, reason: reasons[0] ?? PLAIN[o.type] ?? 'A good fit today.', reasons: [...reasons, PLAIN[o.type] ?? 'A good fit today.'], breaks: added.length > 0 }
  })
  const order = [...ranked].sort((a, b) => b.score - a.score || inp.options.findIndex(o => o.key === a.key) - inp.options.findIndex(o => o.key === b.key))
  const fit = order.filter(r => !r.breaks)
  let picks = fit.filter(r => r.score > 0).slice(0, MAX_PICKS)
  if (picks.length === 0 && fit.length > 0) picks = [fit[0]]
  // Each pick its own reason: a reason the pick above already gave steps down to the next one.
  const said = new Set<string>()
  picks = picks.map(p => {
    const why = p.reasons.find(r => !said.has(r)) ?? p.reason
    said.add(why)
    return { ...p, reason: why }
  })
  const chosen = new Set(picks.map(p => p.key))
  // The rest in the list's own order: nothing refused, nothing greyed out.
  return { picks, rest: inp.options.map(o => ranked.find(r => r.key === o.key)!).filter(r => !chosen.has(r.key)) }
}
