// Block Zero results as the end gate reads them (block_tests rows). There is
// no test week and no test screen (design-decisions "Block Zero tests",
// 2026-10-18): the talk-test HR comes from the run log on the first easy
// run-walk of weeks 1 and 6 (src/lib/blockZero/talkTest.ts), and the front
// squat estimate is worked out from logged sets. Pure.

import { lbText } from '@/lib/units'

export interface TestRowIn {
  week: number
  testKey: string
  value: number
  unit?: string | null
}

/** "ex-trap-bar-deadlift" -> "Trap bar deadlift". */
export function liftNameFromId(exerciseId: string): string {
  const words = exerciseId.replace(/^ex-/, '').split('-').filter(Boolean)
  if (words.length === 0) return exerciseId
  const s = words.join(' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** A result for people to read. Weights are stored in kg and read in lb (Josh measures in lb). */
export function formatTestValue(value: number, unit: string | null | undefined): string {
  const n = Number.isInteger(value) ? String(value) : value.toFixed(1)
  switch (unit) {
    case 'bpm': return `${n} bpm`
    case 's': return `${n} s`
    case 'kg': return lbText(value)
    case 'score': return `${n}/5`
    case 'cm': return `${n} cm`
    case 'deg': return `${n}°`
    default: return n
  }
}
