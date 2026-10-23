// Daily check-in (daily_logs row) → readiness input, and the readiness read
// for one day: each item against the athlete's own 7-day mean (R10), the ease
// trigger, and a one-line reason. Pure: callers pass rows in.

import { BASELINE_DAYS, MIN_BASELINE_VALUES, READINESS_ITEMS, evaluateReadiness, latestReadiness, type CheckIn, type ReadinessItem } from './readiness'
import { weeklyLoadFlag, type LoadEntry, type LoadFlag } from './load'

/** The daily_logs columns readiness reads. */
export interface DailyLogFields {
  logDate: number
  sleepHours?: number | null
  sleepQuality?: number | null
  energy?: number | null
  soreness?: number | null
  stress?: number | null
  mood?: number | null
  backToday?: number | null
  alcoholScale?: number | null
  /** 0-9 scale. Legacy weed_grams is never read: grams can't be converted. */
  herbScale?: number | null
}

export function checkInFromDailyLog(row: DailyLogFields): CheckIn {
  return {
    epochDay: row.logDate,
    sleepHours: row.sleepHours ?? null,
    sleepQuality: row.sleepQuality ?? null,
    energy: row.energy ?? null,
    soreness: row.soreness ?? null,
    stress: row.stress ?? null,
    mood: row.mood ?? null,
    backToday: row.backToday ?? null,
    alcohol: row.alcoholScale ?? null,
    cannabis: row.herbScale ?? null,
  }
}

export interface ReadinessItemRead {
  item: ReadinessItem
  today: number | null
  /** Mean of the 7 days before. Null below MIN_BASELINE_VALUES values. */
  mean7: number | null
  /** Positive = worse than the mean, in the item's units. */
  delta: number | null
  worse: boolean
}

export interface LoadRead extends LoadFlag {
  last7: number
  prev7: number
  /** False until the block has two full weeks behind today to compare. */
  applies: boolean
}

export interface ReadinessReport {
  epochDay: number
  checkedIn: boolean
  items: ReadinessItemRead[]
  worseItems: ReadinessItem[]
  /** 2+ items worse today. */
  flaggedToday: boolean
  /** Readiness ease: flagged today and yesterday. */
  readinessEase: boolean
  load: LoadRead | null
  /** Readiness ease or the load flag: auto-ease today's sessions. */
  ease: boolean
  reason: string | null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Rolling 7-day sRPE load (yesterday and the 6 days before) against the 7
 * days before that. Today's own sessions never count, so the read is the same
 * before and after training. Only applies once both windows sit inside the
 * block: the block's first week has nothing to compare against.
 */
export function rollingLoadRead(entries: LoadEntry[], todayEpochDay: number, blockStartEpochDay: number | null): LoadRead {
  let last7 = 0
  let prev7 = 0
  for (const e of entries) {
    const load = e.rpe != null && e.minutes != null ? e.rpe * e.minutes : 0
    if (e.epochDay >= todayEpochDay - 7 && e.epochDay < todayEpochDay) last7 += load
    else if (e.epochDay >= todayEpochDay - 14 && e.epochDay < todayEpochDay - 7) prev7 += load
  }
  const applies = blockStartEpochDay != null && todayEpochDay - 14 >= blockStartEpochDay
  const flag = weeklyLoadFlag(prev7, last7)
  return { ...flag, flagged: applies && flag.flagged, reason: applies ? flag.reason : null, last7, prev7, applies }
}

/** A check-in counts once at least one answer is in (a blank row is not a check-in). */
export function answered(c: CheckIn | null): boolean {
  if (!c) return false
  return Object.entries(c).some(([k, v]) => k !== 'epochDay' && v != null)
}

export function readinessReport(checkIns: CheckIn[], todayEpochDay: number, load: LoadRead | null = null): ReadinessReport {
  const upToToday = checkIns.filter(c => c.epochDay <= todayEpochDay)
  const byDay = new Map(upToToday.map(c => [c.epochDay, c]))
  const today = byDay.get(todayEpochDay) ?? null
  const day = evaluateReadiness(upToToday).find(d => d.epochDay === todayEpochDay) ?? null

  const items: ReadinessItemRead[] = (Object.keys(READINESS_ITEMS) as ReadinessItem[]).map(item => {
    const window: number[] = []
    for (let d = todayEpochDay - BASELINE_DAYS; d < todayEpochDay; d++) {
      const v = byDay.get(d)?.[item]
      if (v != null) window.push(v)
    }
    const mean7 = window.length >= MIN_BASELINE_VALUES ? round2(window.reduce((a, b) => a + b, 0) / window.length) : null
    const value = today?.[item] ?? null
    return {
      item,
      today: value,
      mean7,
      delta: day?.deltas[item] ?? null,
      worse: day?.worseItems.includes(item) ?? false,
    }
  })

  const verdict = latestReadiness(upToToday)
  const readinessEase = today != null && verdict.epochDay === todayEpochDay && verdict.ease
  const loadFlag = load?.flagged ?? false
  const reasons: string[] = []
  if (readinessEase && verdict.reason) reasons.push(verdict.reason)
  if (loadFlag && load?.reason) reasons.push(load.reason)

  return {
    epochDay: todayEpochDay,
    checkedIn: answered(today),
    items,
    worseItems: day?.worseItems ?? [],
    flaggedToday: day?.flagged ?? false,
    readinessEase,
    load,
    ease: readinessEase || loadFlag,
    reason: reasons.length > 0 ? reasons.join(' ') : null,
  }
}
