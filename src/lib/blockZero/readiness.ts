// Readiness read from the daily check-in. R10 (Saw 2016; Hooper 1995;
// McLean 2010): act on trend shifts, not single days. Flag when 2+ items are
// >= 1 point worse than the athlete's own 7-day mean for 2+ consecutive days.
// The thresholds are rules of thumb, not validated cut-offs.
//
// Every field is optional so today's sleep + soreness-only check-in already
// works; the extra items light up when Phase B adds them.

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

export interface ReadinessDay {
  epochDay: number
  /** Signed: positive = worse than the 7-day mean, in that item's units. Null = no value or no baseline. */
  deltas: Partial<Record<ReadinessItem, number | null>>
  worseItems: ReadinessItem[]
  flagged: boolean
  /** Flagged today and on each of the previous MIN_CONSECUTIVE_DAYS - 1 days. */
  ease: boolean
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
  for (const day of days) {
    const today = byDay.get(day) as CheckIn
    const deltas: Partial<Record<ReadinessItem, number | null>> = {}
    const worseItems: ReadinessItem[] = []
    for (const item of items) {
      const value = today[item]
      if (value == null) continue
      const window: number[] = []
      for (let d = day - BASELINE_DAYS; d < day; d++) {
        const v = byDay.get(d)?.[item]
        if (v != null) window.push(v)
      }
      if (window.length < MIN_BASELINE_VALUES) {
        deltas[item] = null
        continue
      }
      const rule = READINESS_ITEMS[item]
      const delta = (mean(window) - value) * rule.polarity
      deltas[item] = Math.round(delta * 100) / 100
      if (delta >= rule.threshold) worseItems.push(item)
    }
    const flagged = worseItems.length >= MIN_WORSE_ITEMS
    if (flagged) flaggedDays.add(day)
    let ease = flagged
    for (let k = 1; ease && k < MIN_CONSECUTIVE_DAYS; k++) ease = flaggedDays.has(day - k)
    out.push({ epochDay: day, deltas, worseItems, flagged, ease })
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
  const words = joinWords(last.worseItems.map(i => ITEM_WORDS[i]))
  const text = `${words.charAt(0).toUpperCase()}${words.slice(1)} are off your 7-day trend for ${MIN_CONSECUTIVE_DAYS} days.`
  return { ease: true, epochDay: last.epochDay, worseItems: last.worseItems, reason: text }
}
