// The simulated-athlete scoreboard as a ratchet: a pass line that passed in
// the committed baseline must keep passing; a newly passing line is an
// improvement to record. Lines that fail today are expected to (the P0
// baseline of the current coach); later phases flip them. Pure.

import type { PassLine } from './metrics'

/** scenario id -> line id -> 'pass' | 'fail' | 'na'. */
export type Baseline = Record<string, Record<string, 'pass' | 'fail' | 'na'>>

export interface Comparison {
  total: number
  passing: number
  regressions: string[]
  improvements: string[]
  next: Baseline
}

export function statusOf(l: PassLine): 'pass' | 'fail' | 'na' {
  return !l.measured ? 'na' : l.pass ? 'pass' : 'fail'
}

export function compareToBaseline(baseline: Baseline, results: Record<string, PassLine[]>): Comparison {
  const next: Baseline = { ...baseline }
  const regressions: string[] = []
  const improvements: string[] = []
  let total = 0
  let passing = 0
  for (const [scenario, lines] of Object.entries(results)) {
    next[scenario] = {}
    for (const l of lines) {
      const now = statusOf(l)
      next[scenario][l.id] = now
      if (now !== 'na') total++
      if (now === 'pass') passing++
      const was = baseline[scenario]?.[l.id]
      if (was === 'pass' && now !== 'pass') regressions.push(`${scenario} ${l.id} ${l.title}: ${l.evidence}`)
      if (was !== undefined && was !== 'pass' && now === 'pass') improvements.push(`${scenario} ${l.id} ${l.title}`)
    }
  }
  return { total, passing, regressions, improvements, next }
}
