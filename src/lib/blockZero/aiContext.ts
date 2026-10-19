// Compact Block Zero context for the week planner and the reactive coach.
// Training data only: week, targets, caps, readiness, load, lifts, back
// score, muay thai ramp, and the hard limits stated plainly. Goes in the user
// message, after the cached system blocks, so prompt caching is untouched.
// Target: under 350 tokens.

import type { BackTrend } from './endGate'
import { allowedClassTypes, mtRampWeek, weeklyClassCap } from './muayThai'
import type { ReadinessItem } from './readiness'
import { RESTART_SESSION_SEC, SINGLE_RUN_CAP_RATIO, getRunWalkWeek, runWalkTotalSec, weeklyRunAllowanceSec } from './running'
import { getStrengthWeekTarget } from './strength'
import { blockZeroPhase } from './weeks'
import { kgToLbs } from '../units'

export interface AiContextLift {
  name: string
  topSet: { weightKg: number; reps: number; rir: number } | null
  next: { weightKg: number; change: 'increase' | 'hold' | 'decrease' } | null
}

export interface AiContextReadinessItem {
  item: ReadinessItem
  today: number | null
  mean7: number | null
  worse: boolean
}

export interface BlockZeroAiContextInput {
  weekNumber: number
  totalWeeks: number
  readiness: {
    checkedIn: boolean
    items: AiContextReadinessItem[]
    readinessEase: boolean
    reason: string | null
  } | null
  load: { last7: number; prev7: number; change: number | null; flagged: boolean; applies: boolean } | null
  lifts: AiContextLift[]
  /** "Back today" scores, oldest first, last 7 days. Null = no check-in. */
  backScores: Array<number | null>
  backTrend: BackTrend | null
  run: { longestLast30Sec: number | null; lastWeekRunSec: number } | null
  hrCeilingBpm: number | null
  mt: { weeksSinceFirstClass: number | null; classesThisWeek: number; profileCap: number | null }
}

const PHASE_WORD = { test: 'start', build: 'build', consolidate: 'consolidate', extension: 'extension' } as const

const ITEM_WORD: Record<ReadinessItem, string> = {
  sleepHours: 'sleepH',
  sleepQuality: 'sleepQ',
  energy: 'energy',
  soreness: 'soreness',
  stress: 'stress',
  mood: 'mood',
  backToday: 'back',
  alcohol: 'alcohol',
  cannabis: 'cannabis',
}

const CHANGE_WORD = { increase: 'up', hold: 'hold', decrease: 'down' } as const

const CLASS_WORD: Record<string, string> = { technical: 'technique', padwork: 'pads/bag', clinch: 'light clinch', general: 'general (light)' }

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function minutes(sec: number): number {
  return Math.floor(sec / 60)
}

function secText(sec: number): string {
  return sec >= 60 && sec % 60 === 0 ? `${sec / 60}m` : `${sec}s`
}

/** Single-run and weekly run caps in minutes, from the history the rules read. */
export function runCapsMin(run: BlockZeroAiContextInput['run']): { single: number; weekly: number } {
  const longest = run?.longestLast30Sec ?? 0
  const last = run?.lastWeekRunSec ?? 0
  return {
    single: minutes(longest > 0 ? longest * SINGLE_RUN_CAP_RATIO : RESTART_SESSION_SEC),
    weekly: minutes(weeklyRunAllowanceSec(last)),
  }
}

export function serializeBlockZeroContext(input: BlockZeroAiContextInput): string {
  const week = input.weekNumber
  const phase = PHASE_WORD[blockZeroPhase(week)]
  const t = getStrengthWeekTarget(week)
  const rw = getRunWalkWeek(week)
  const caps = runCapsMin(input.run)
  const plannedRun = Math.round(runWalkTotalSec(rw) / 60)
  const lines: string[] = ['# Block Zero rules']

  lines.push(`Week ${week} of ${input.totalWeeks}. Phase: ${phase}.`)

  const check = t.checkSet ? ` Plus a ${t.checkSet.repRange[0]}-${t.checkSet.repRange[1]} rep check set at RPE ${t.checkSet.rpe}.` : ''
  const strength = week <= 1
    ? `Strength: work up to a set of ${t.reps} at RPE ${t.rpe[0]}-${t.rpe[1]} (${t.rir[0]}-${t.rir[1]} left). That is the starting load.`
    : `Strength: ${t.mainSets} x ${t.reps} at RPE ${t.rpe[0]}-${t.rpe[1]} (${t.rir[0]}-${t.rir[1]} left).${check}`
  lines.push(`${strength} Never to failure.`)

  const hr = input.hrCeilingBpm != null ? `, HR <= ${input.hrCeilingBpm}` : ''
  const longest = input.run?.longestLast30Sec ? `${minutes(input.run.longestLast30Sec)}` : 'none'
  const lastWeek = input.run?.lastWeekRunSec ? `${minutes(input.run.lastWeekRunSec)}` : 'none'
  lines.push(`Run-walk: ${rw.rounds} x (${secText(rw.runSec)} run / ${secText(rw.walkSec)} walk) after ${secText(rw.warmupSec)} walk, ${plannedRun} min${hr}. Caps: single <= ${caps.single} min (30-day longest ${longest}), week <= ${caps.weekly} min (last week ${lastWeek}).`)

  const r = input.readiness
  if (!r || !r.checkedIn) {
    lines.push('Readiness: no check-in today.')
  } else {
    // Items a point or more worse than their mean are listed; the rest are counted.
    const read = r.items.filter(i => i.today != null && i.mean7 != null)
    const worse = read.filter(i => i.worse).map(i => `${ITEM_WORD[i.item]} ${fmt(i.today as number)} vs ${fmt(i.mean7 as number)}`)
    const rest = read.length - worse.length
    const body = read.length === 0
      ? 'no baseline yet'
      : `${worse.length > 0 ? `worse: ${worse.join(', ')}` : 'nothing worse'}${rest > 0 ? `; ${rest} other${rest === 1 ? '' : 's'} within a point` : ''}`
    lines.push(`Readiness vs 7-day mean: ${body}. Ease: ${r.readinessEase ? 'on' : 'off'}.`)
  }

  const l = input.load
  if (!l || !l.applies) {
    lines.push('Load (sRPE): under 2 weeks of data.')
  } else {
    const change = l.change != null ? ` (${l.change >= 0 ? '+' : ''}${Math.round(l.change * 100)}%)` : ''
    lines.push(`sRPE load 7 days: ${Math.round(l.last7)} vs ${Math.round(l.prev7)}${change}. Flag: ${l.flagged ? 'on' : 'off'}.`)
  }

  if (input.lifts.length > 0) {
    const lifts = input.lifts.slice(0, 6).map(x => {
      const top = x.topSet ? `${kgToLbs(x.topSet.weightKg)}x${x.topSet.reps} @${x.topSet.rir >= 3 ? '3+' : x.topSet.rir}` : 'no RIR'
      const next = x.next ? ` -> ${kgToLbs(x.next.weightKg)} ${CHANGE_WORD[x.next.change]}` : ''
      return `${x.name} ${top}${next}`
    })
    lines.push(`Lifts (lb x reps @RIR -> next per rules): ${lifts.join('; ')}.`)
  }

  const backs = input.backScores.map(b => (b == null ? '-' : String(b))).join(' ')
  if (input.backScores.some(b => b != null)) {
    lines.push(`Back today, 7 days (1-5, 5 best): ${backs}. Trend: ${input.backTrend ?? 'unknown'}.`)
  }

  const started = input.mt.weeksSinceFirstClass != null
  const ramp = mtRampWeek(input.mt.weeksSinceFirstClass)
  const allowed = allowedClassTypes(ramp).map(c => CLASS_WORD[c]).join(', ')
  const cap = weeklyClassCap(ramp, input.mt.profileCap)
  lines.push(`Muay thai: ${started ? `ramp week ${ramp}` : 'no classes yet, next is ramp week 1'}. Allowed: ${allowed}. Cap ${cap}/week, ${input.mt.classesThisWeek} done. No sparring.`)

  const limits = [
    'no mt_class',
    'Strength A Mon, B Wed, C Fri, labels kept, before any run',
    'run-walk Tue/Thu/Sat (rope ok Tue/Thu)',
    'Foundation daily',
    'Sunday rest',
    `runs <= ${Math.min(caps.single, plannedRun)} min`,
    'loads set by the rules',
  ]
  if (r?.readinessEase) limits.push('ease on: no hard session added today')
  if (l?.flagged) limits.push('load flag on: no hard session added this week')
  lines.push(`HARD LIMITS. You may only choose within these limits: ${limits.join('; ')}. Anything else is clamped.`)
  lines.push('Give each change a one-line why: short sentences, no exclamation marks, no em dashes.')
  return lines.join('\n')
}

/** Rough token count (about 4 characters a token for this kind of text). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
