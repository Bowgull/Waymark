// Readiness read from the daily check-in. R10 (Saw 2016; Hooper 1995;
// McLean 2010): act on trend shifts, not single days. Flag when 2+ items are
// >= 1 point worse than the athlete's own 7-day mean for 2+ consecutive days.
// The thresholds are rules of thumb, not validated cut-offs.
//
// Every field is optional so today's sleep + soreness-only check-in already
// works; the extra items light up when Phase B adds them.
//
// Oversleep (soft rule, weak evidence): sleep 1.5 h or more above the
// athlete's own 7-day mean counts as worse when energy is low or soreness is
// high that day (a fatigue or illness cue, eased like poor sleep). Long sleep
// with good energy is recovery: neutral, never "better". The same read feeds
// the "fresh" day used by the ramp-up ask (better than the 7-day mean).

export interface CheckIn {
  epochDay: number
  sleepHours?: number | null
  sleepQuality?: number | null
  energy?: number | null
  soreness?: number | null
  stress?: number | null
  mood?: number | null
  backToday?: number | null
  alcohol?: number | null
  cannabis?: number | null
}

export type ReadinessItem = Exclude<keyof CheckIn, 'epochDay'>

interface ItemRule {
  /** +1: higher is better. -1: higher is worse. */
  polarity: 1 | -1
  /** How far past the mean counts as "worse". */
  threshold: number
}

export const READINESS_ITEMS: Readonly<Record<ReadinessItem, ItemRule>> = {
  sleepHours: { polarity: 1, threshold: 1 },
  sleepQuality: { polarity: 1, threshold: 1 },
  energy: { polarity: 1, threshold: 1 },
  mood: { polarity: 1, threshold: 1 },
  backToday: { polarity: 1, threshold: 1 },
  soreness: { polarity: -1, threshold: 1 },
  stress: { polarity: -1, threshold: 1 },
  alcohol: { polarity: -1, threshold: 1 },
  // Grams, not a 1-5 scale. Half a gram over the usual is the "point".
  cannabis: { polarity: -1, threshold: 0.5 },
}

export const BASELINE_DAYS = 7
/** An item needs this many values in the 7 days before to have a baseline. */
export const MIN_BASELINE_VALUES = 4
export const MIN_WORSE_ITEMS = 2
export const MIN_CONSECUTIVE_DAYS = 2
/** Hours above the 7-day sleep mean that count as a long sleep. */
export const OVERSLEEP_HOURS = 1.5
/** Energy at or below this (1-5) is low. */
export const LOW_ENERGY = 2
/** Soreness at or above this (1-5) is high. */
export const HIGH_SORENESS = 4
/** A fresh day: no item worse and this many items better than the mean. */
export const MIN_BETTER_ITEMS = 2
/** "Better" is half an item's worse-threshold the other way. */
export const BETTER_FRACTION = 0.5

export type OversleepRead = 'fatigue' | 'recovery' | null

/**
 * Long sleep read for one day. 'fatigue': long sleep with low energy or high
 * soreness (energy/soreness also count against their own mean). 'recovery':
 * long sleep with good energy. Null: not a long sleep, or no sleep baseline.
 */
export function oversleepRead(input: {
  sleepHours: number | null | undefined
  sleepMean: number | null
  energy?: number | null
  energyWorseBy?: number | null
  soreness?: number | null
  sorenessWorseBy?: number | null
}): OversleepRead {
  if (input.sleepHours == null || input.sleepMean == null) return null
  if (input.sleepHours < input.sleepMean + OVERSLEEP_HOURS) return null
  const lowEnergy = input.energy != null && (input.energy <= LOW_ENERGY || (input.energyWorseBy ?? 0) >= 1)
  const sore = input.soreness != null && (input.soreness >= HIGH_SORENESS || (input.sorenessWorseBy ?? 0) >= 1)
  return lowEnergy || sore ? 'fatigue' : 'recovery'
}

export interface ReadinessDay {
  epochDay: number
  /** Signed: positive = worse than the 7-day mean, in that item's units. Null = no value or no baseline. */
  deltas: Partial<Record<ReadinessItem, number | null>>
  worseItems: ReadinessItem[]
  /** Items at least half a threshold better than the mean. */
  betterItems: ReadinessItem[]
  flagged: boolean
  /** Flagged today and on each of the previous MIN_CONSECUTIVE_DAYS - 1 days. */
  ease: boolean
  /** No item worse and MIN_BETTER_ITEMS or more better: above the athlete's own baseline. */
  fresh: boolean
  /** Long sleep read (soft rule). */
  oversleep: OversleepRead
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * Per-day readiness for every check-in day. The baseline for a day is the
 * mean of the previous 7 calendar days (that day excluded), per item.
 */
export function evaluateReadiness(checkIns: CheckIn[]): ReadinessDay[] {
  const byDay = new Map<number, CheckIn>()
  for (const c of checkIns) byDay.set(c.epochDay, c)
  const days = [...byDay.keys()].sort((a, b) => a - b)
  const items = Object.keys(READINESS_ITEMS) as ReadinessItem[]

  const out: ReadinessDay[] = []
  const flaggedDays = new Set<number>()
  const oversleepFatigueDays = new Set<number>()
  for (const day of days) {
    const today = byDay.get(day) as CheckIn
    const deltas: Partial<Record<ReadinessItem, number | null>> = {}
    const means: Partial<Record<ReadinessItem, number>> = {}
    for (const item of items) {
      const value = today[item]
      if (value == null) continue
      const window: number[] = []
      for (let d = day - BASELINE_DAYS; d < day; d++) {
        // A long sleep read as fatigue never pulls the sleep baseline up.
        if (item === 'sleepHours' && oversleepFatigueDays.has(d)) continue
        const v = byDay.get(d)?.[item]
        if (v != null) window.push(v)
      }
      if (window.length < MIN_BASELINE_VALUES) {
        deltas[item] = null
        continue
      }
      const m = mean(window)
      means[item] = m
      deltas[item] = Math.round((m - value) * READINESS_ITEMS[item].polarity * 100) / 100
    }
    // Oversleep: long sleep is worse with low energy or high soreness, else neutral.
    const oversleep = oversleepRead({
      sleepHours: today.sleepHours,
      sleepMean: means.sleepHours ?? null,
      energy: today.energy,
      energyWorseBy: deltas.energy ?? null,
      soreness: today.soreness,
      sorenessWorseBy: deltas.soreness ?? null,
    })
    if (oversleep === 'fatigue' && today.sleepHours != null && means.sleepHours != null) {
      oversleepFatigueDays.add(day)
      deltas.sleepHours = Math.round((today.sleepHours - means.sleepHours) * 100) / 100
    } else if (oversleep === 'recovery') {
      deltas.sleepHours = 0
    }
    const worseItems: ReadinessItem[] = []
    const betterItems: ReadinessItem[] = []
    for (const item of items) {
      const delta = deltas[item]
      if (delta == null) continue
      const rule = READINESS_ITEMS[item]
      if (delta >= rule.threshold) worseItems.push(item)
      else if (-delta >= rule.threshold * BETTER_FRACTION) betterItems.push(item)
    }
    const flagged = worseItems.length >= MIN_WORSE_ITEMS
    if (flagged) flaggedDays.add(day)
    let ease = flagged
    for (let k = 1; ease && k < MIN_CONSECUTIVE_DAYS; k++) ease = flaggedDays.has(day - k)
    const fresh = worseItems.length === 0 && betterItems.length >= MIN_BETTER_ITEMS
    out.push({ epochDay: day, deltas, worseItems, betterItems, flagged, ease, fresh, oversleep })
  }
  return out
}

const ITEM_WORDS: Record<ReadinessItem, string> = {
  sleepHours: 'sleep',
  sleepQuality: 'sleep quality',
  energy: 'energy',
  soreness: 'soreness',
  stress: 'stress',
  mood: 'mood',
  backToday: 'your back',
  alcohol: 'alcohol',
  cannabis: 'cannabis',
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

export interface ReadinessVerdict {
  ease: boolean
  epochDay: number | null
  worseItems: ReadinessItem[]
  reason: string | null
}

/** The read for the latest check-in day, with a one-line reason when easing. */
export function latestReadiness(checkIns: CheckIn[]): ReadinessVerdict {
  const days = evaluateReadiness(checkIns)
  const last = days[days.length - 1]
  if (!last) return { ease: false, epochDay: null, worseItems: [], reason: null }
  if (!last.ease) return { ease: false, epochDay: last.epochDay, worseItems: last.worseItems, reason: null }
  const words = joinWords(last.worseItems.map(i => i === 'sleepHours' && last.oversleep === 'fatigue' ? 'long sleep' : ITEM_WORDS[i]))
  const text = `${words.charAt(0).toUpperCase()}${words.slice(1)} are off your 7-day trend for ${MIN_CONSECUTIVE_DAYS} days.`
  return { ease: true, epochDay: last.epochDay, worseItems: last.worseItems, reason: text }
}
