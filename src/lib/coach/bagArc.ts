// Bag sessions planned three ways (page 80, approved by Josh 2026-10-23).
//
// COACH: the coach plans every round on a kru's arc: a warm-up round of
// basics; technique rounds while he's fresh (a combo he just added goes here
// first, alone, then with one more combo he's still learning); pressure rounds
// with his hardest and longest combos at pace (then elbows and knees); a
// finisher of kicks and knees, the last 30 s all out. No two rounds are the
// same. HYBRID: the coach sets the rounds, their length and rest; the rounds
// he filled stay his, the coach fills the rest on the same arc. CUSTOM: every
// round, its length, the rest and the combos are his; the coach changes
// nothing. Hybrid and Custom can be saved as routines.
//
// Pure: the builder on the phone and the start route on the server both run
// it. The coach only ever picks from his own combos: it never makes one up.

import { categoryOf, comboLevel, expandStrike, splitComboText, type ComboLevel } from '../classCombos'
import type { BagRoundType } from './bag'

export type BagStage = 'warmup' | 'technique' | 'pressure' | 'finisher'
export type BagMode = 'coach' | 'hybrid' | 'custom'

/** The round labels (the only words on the builder's rounds). */
export const STAGE_WORDS: Readonly<Record<BagStage, string>> = { warmup: 'WARM-UP', technique: 'TECHNIQUE', pressure: 'PRESSURE', finisher: 'FINISHER' }
/** The finisher's line in the builder. */
export const FINISHER_LINE = 'KICKS · LAST 30 S ALL OUT'
/** Each stage as the round types the bag rounds already carry. */
export const STAGE_ROUND_TYPE: Readonly<Record<BagStage, BagRoundType>> = { warmup: 'warmup', technique: 'technical_flow', pressure: 'combo_practice', finisher: 'conditioning' }

/** The coach's own round and rest (the app's bag rounds: 3 min, 1 min rest). */
export const COACH_ROUND_SEC = 180
export const COACH_REST_SEC = 60
/** Custom's − / + limits (page 80): rounds 1-12, round and rest 1-5 min. */
export const LIMITS = { rounds: [1, 12], roundMin: [1, 5], restMin: [1, 5] } as const

/** A combo in his pool (unlocked, switched on in Settings). */
export interface PoolCombo {
  id: string
  text: string
  tier: string
  difficultyOverride?: string | null
  masteryScore: number
  /** Unix seconds. */
  createdAt: number
  source?: string | null
  isFavourite?: number
}

/** Days a combo he added (typed or from class) counts as new. */
export const NEW_DAYS = 14
/** Mastered at 9 of 15 (the Library's MASTERED_AT); close from 6. */
export const MASTERED_AT = 9
export const CLOSE_AT = 6

export type PoolTag = 'new' | 'close' | null

/** NEW: one he added in the last two weeks, not mastered yet. CLOSE: 6-8 of 15. */
export function poolTag(c: PoolCombo, nowSec: number): PoolTag {
  const his = c.source === 'mine' || c.source === 'class'
  if (his && nowSec - c.createdAt <= NEW_DAYS * 86400 && c.masteryScore < MASTERED_AT) return 'new'
  if (c.masteryScore >= CLOSE_AT && c.masteryScore < MASTERED_AT) return 'close'
  return null
}

export const strikeCount = (c: Pick<PoolCombo, 'text'>) => splitComboText(c.text).flatMap(expandStrike).length

/**
 * The picker's list, sorted for him (page 80): NEW (newest first), CLOSE TO
 * MASTERED (closest first), then ALL (easiest first). `q` searches the strikes.
 */
export function pickerGroups(pool: ReadonlyArray<PoolCombo>, nowSec: number, q = ''): { new: PoolCombo[]; close: PoolCombo[]; all: PoolCombo[] } {
  const needle = q.trim().toLowerCase().replace(/\s+/g, ' ')
  const hit = (c: PoolCombo) => !needle || splitComboText(c.text).join(' ').toLowerCase().includes(needle)
  const list = pool.filter(hit)
  return {
    new: list.filter(c => poolTag(c, nowSec) === 'new').sort((a, b) => b.createdAt - a.createdAt),
    close: list.filter(c => poolTag(c, nowSec) === 'close').sort((a, b) => b.masteryScore - a.masteryScore),
    all: list.filter(c => poolTag(c, nowSec) == null).sort((a, b) => comboLevel(a) - comboLevel(b) || strikeCount(a) - strikeCount(b) || a.text.localeCompare(b.text)),
  }
}

/**
 * The kru's arc for n rounds: round 1 the warm-up; the finisher last (when the
 * day allows one); the first half of what's between is technique, the rest
 * pressure.
 */
export function kruArc(n: number, finishers = true): BagStage[] {
  if (n <= 0) return []
  if (n === 1) return ['warmup']
  const fin = finishers && n >= 3
  const mid = n - 1 - (fin ? 1 : 0)
  const tech = Math.ceil(mid / 2)
  const out: BagStage[] = ['warmup']
  for (let i = 0; i < mid; i++) out.push(i < tech ? 'technique' : 'pressure')
  if (fin) out.push('finisher')
  return out
}

export interface PlannedRound {
  /** Null in Custom (no labels). */
  stage: BagStage | null
  comboIds: string[]
  /** He filled it (the gold edge). */
  mine: boolean
}

const setKey = (ids: ReadonlyArray<string>) => [...ids].sort().join('|')
const hasClose = (c: PoolCombo) => splitComboText(c.text).some(s => { const k = categoryOf(s); return k === 'knees' || k === 'elbows' })
const hasKick = (c: PoolCombo) => splitComboText(c.text).some(s => { const k = categoryOf(s); return k === 'kicks' || k === 'knees' || /\bteep\b/i.test(s) })

/** Each stage's rounds, in the order the coach hands them out. */
function stageQueues(pool: ReadonlyArray<PoolCombo>, nowSec: number): Record<BagStage, string[][]> {
  const byLevel = (a: PoolCombo, b: PoolCombo) => comboLevel(a) - comboLevel(b) || strikeCount(a) - strikeCount(b)
  const fresh = pool.filter(c => poolTag(c, nowSec) === 'new').sort((a, b) => b.createdAt - a.createdAt)
  const freshIds = new Set(fresh.map(c => c.id))
  const learning = pool.filter(c => !freshIds.has(c.id) && c.masteryScore < MASTERED_AT).sort((a, b) => a.masteryScore - b.masteryScore || byLevel(a, b))
  const known = pool.filter(c => !freshIds.has(c.id) && c.masteryScore >= MASTERED_AT).sort(byLevel)
  const learnList = learning.length > 0 ? learning : known

  // Warm-up: the basics, easiest and best known first.
  // (a new combo waits for its technique round: not in the warm-up, not at pace yet)
  const settled = pool.filter(c => !freshIds.has(c.id))
  const base = settled.length > 0 ? settled : [...pool]
  const basics = [...base].sort((a, b) => comboLevel(a) - comboLevel(b) || b.masteryScore - a.masteryScore || strikeCount(a) - strikeCount(b))
  const warmup = [basics.slice(0, 3).map(c => c.id)]

  // Technique: each new combo alone, then with one more he's learning; then the learning ones in pairs.
  const technique: string[][] = []
  let li = 0
  const nextLearn = (not: string) => {
    for (let k = 0; k < learnList.length; k++) {
      const c = learnList[(li + k) % learnList.length]
      if (c.id !== not) { li = (li + k + 1) % Math.max(1, learnList.length); return c.id }
    }
    return null
  }
  for (const f of fresh) {
    technique.push([f.id])
    const l = nextLearn(f.id)
    if (l) technique.push([f.id, l])
  }
  for (let k = 0; k + 1 < learnList.length; k += 2) technique.push([learnList[k].id, learnList[k + 1].id])
  for (const c of learnList) technique.push([c.id])

  // Pressure: the hardest and longest at pace, two a round, then elbows and knees, then the rest.
  const hard = [...base].sort((a, b) => comboLevel(b) - comboLevel(a) || strikeCount(b) - strikeCount(a) || b.masteryScore - a.masteryScore)
  const pressure: string[][] = []
  const used = new Set<string>()
  const pairFrom = (list: PoolCombo[]) => {
    const free = list.filter(c => !used.has(c.id)).slice(0, 2)
    if (free.length === 0) return
    free.forEach(c => used.add(c.id))
    pressure.push(free.map(c => c.id))
  }
  pairFrom(hard)
  pairFrom(hard.filter(hasClose))
  for (let k = 0; k < hard.length; k++) pairFrom(hard)
  for (let k = 0; k + 1 < hard.length; k++) pressure.push([hard[k].id, hard[k + 1].id])

  // Finisher: kicks and knees, short ones first.
  const kicks = pool.filter(hasKick).sort((a, b) => strikeCount(a) - strikeCount(b) || comboLevel(a) - comboLevel(b))
  const finisher = kicks.length > 0 ? [kicks.slice(0, 2).map(c => c.id), ...kicks.slice(2).map(c => [c.id])] : [hard.slice(0, 1).map(c => c.id)]

  return { warmup, technique, pressure, finisher }
}

/**
 * The coach's rounds on the arc. `keep` holds rounds already filled (Hybrid:
 * his); the coach fills the others so that no two rounds hold the same combos
 * (when his pool has enough of them).
 */
export function planCoachRounds(pool: ReadonlyArray<PoolCombo>, opts: { rounds: number; finishers: boolean; nowSec: number; keep?: Readonly<Record<number, ReadonlyArray<string>>> }): PlannedRound[] {
  const arc = kruArc(opts.rounds, opts.finishers)
  const q = stageQueues(pool, opts.nowSec)
  const keep = opts.keep ?? {}
  const taken = new Set<string>()
  arc.forEach((_, i) => { const k = keep[i]; if (k && k.length > 0) taken.add(setKey(k)) })
  const next: Record<BagStage, number> = { warmup: 0, technique: 0, pressure: 0, finisher: 0 }
  const fallback = [...pool].sort((a, b) => a.masteryScore - b.masteryScore)
  return arc.map((stage, i) => {
    const mineIds = keep[i]
    if (mineIds && mineIds.length > 0) return { stage, comboIds: [...mineIds], mine: true }
    if (pool.length === 0) return { stage, comboIds: [], mine: false }
    const queue = q[stage]
    let pick: string[] | null = null
    while (next[stage] < queue.length) {
      const cand = queue[next[stage]++]
      if (cand.length > 0 && !taken.has(setKey(cand))) { pick = cand; break }
    }
    // the stage ran out: any one or two of his combos not used as a round yet
    if (!pick) {
      outer: for (const a of fallback) {
        if (!taken.has(setKey([a.id]))) { pick = [a.id]; break }
        for (const b of fallback) if (b.id !== a.id && !taken.has(setKey([a.id, b.id]))) { pick = [a.id, b.id]; break outer }
      }
    }
    // a pool too small to keep every round different: the stage's first again
    pick ??= queue[0] ?? [fallback[0].id]
    taken.add(setKey(pick))
    return { stage, comboIds: pick, mine: false }
  })
}

/** Hybrid: his rounds kept as he filled them; the coach fills the empty ones on the arc. */
export function planHybridRounds(pool: ReadonlyArray<PoolCombo>, opts: { rounds: number; finishers: boolean; nowSec: number; picked: Readonly<Record<number, ReadonlyArray<string>>> }): PlannedRound[] {
  return planCoachRounds(pool, { rounds: opts.rounds, finishers: opts.finishers, nowSec: opts.nowSec, keep: opts.picked })
}

/** Custom: exactly his rounds; an empty round stays empty. The coach adds nothing. */
export function planCustomRounds(opts: { rounds: number; picked: Readonly<Record<number, ReadonlyArray<string>>> }): PlannedRound[] {
  return Array.from({ length: opts.rounds }, (_, i) => {
    const ids = [...(opts.picked[i] ?? [])]
    return { stage: null, comboIds: ids, mine: ids.length > 0 }
  })
}

// ─── the planned session's choice (context_json.bag) ──────────

export interface BagSpec {
  mode: BagMode
  rounds: number
  roundSec: number
  restSec: number
  /** Round index → his combo ids, in order (Hybrid and Custom). */
  picked: Record<number, string[]>
  /** Started from a saved routine. */
  routineId?: string | null
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)))

/** The rounds he picked, cleaned: whole indexes inside the rounds, string ids, no repeats in a round, at most 8 a round. */
export function cleanPicked(raw: unknown, rounds: number): Record<number, string[]> {
  const out: Record<number, string[]> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const i = Number(k)
    if (!Number.isInteger(i) || i < 0 || i >= rounds || !Array.isArray(v)) continue
    const ids = [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 80))].slice(0, 8)
    if (ids.length > 0) out[i] = ids
  }
  return out
}

/** context_json.bag as stored, or null when it isn't one. */
export function parseBagSpec(raw: unknown): BagSpec | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.mode !== 'coach' && r.mode !== 'hybrid' && r.mode !== 'custom') return null
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  const rounds = clamp(num(r.rounds, 4), LIMITS.rounds[0], LIMITS.rounds[1])
  return {
    mode: r.mode,
    rounds,
    roundSec: clamp(num(r.roundSec, COACH_ROUND_SEC), LIMITS.roundMin[0] * 60, LIMITS.roundMin[1] * 60),
    restSec: clamp(num(r.restSec, COACH_REST_SEC), LIMITS.restMin[0] * 60, LIMITS.restMin[1] * 60),
    picked: r.mode === 'coach' ? {} : cleanPicked(r.picked, rounds),
    routineId: typeof r.routineId === 'string' ? r.routineId : null,
  }
}

/** The rounds to write when the session starts, from his choice (Coach without a choice is the AI's or the arc). */
export function roundsForSpec(spec: BagSpec, pool: ReadonlyArray<PoolCombo>, opts: { finishers: boolean; nowSec: number }): Array<PlannedRound & { roundType: BagRoundType; durationSec: number; restSec: number }> {
  const known = new Set(pool.map(c => c.id))
  // only his own combos that are still in his pool
  const picked = Object.fromEntries(Object.entries(spec.picked).map(([k, ids]) => [k, ids.filter(id => known.has(id))]))
  const rounds = spec.mode === 'custom'
    ? planCustomRounds({ rounds: spec.rounds, picked })
    : spec.mode === 'hybrid'
      ? planHybridRounds(pool, { rounds: spec.rounds, finishers: opts.finishers, nowSec: opts.nowSec, picked })
      : planCoachRounds(pool, { rounds: spec.rounds, finishers: opts.finishers, nowSec: opts.nowSec })
  return rounds.map(r => ({
    ...r,
    roundType: r.stage ? STAGE_ROUND_TYPE[r.stage] : 'combo_practice',
    durationSec: spec.mode === 'coach' && r.stage === 'warmup' ? 150 : spec.roundSec,
    restSec: spec.restSec,
  }))
}

// ─── routines (Hybrid and Custom, saved with his name) ────────

export interface BagRoutine {
  id: string
  name: string
  mode: 'hybrid' | 'custom'
  /** One entry per round: its combo ids (empty: coach fills / nothing). */
  rounds: string[][]
  roundSec: number
  restSec: number
}

/** A builder's state as a routine to save. */
export function routineFromBuilder(id: string, name: string, b: Pick<BagSpec, 'mode' | 'rounds' | 'roundSec' | 'restSec' | 'picked'>): BagRoutine | null {
  const n = name.trim().replace(/\s+/g, ' ').slice(0, 40)
  if (!n || b.mode === 'coach') return null
  return {
    id,
    name: n,
    mode: b.mode,
    rounds: Array.from({ length: clamp(b.rounds, LIMITS.rounds[0], LIMITS.rounds[1]) }, (_, i) => [...(b.picked[i] ?? [])]),
    roundSec: b.roundSec,
    restSec: b.restSec,
  }
}

/** A routine started: everything back in the builder, all of it still his to change. */
export function builderFromRoutine(r: BagRoutine): BagSpec {
  const picked: Record<number, string[]> = {}
  r.rounds.forEach((ids, i) => { if (ids.length > 0) picked[i] = [...ids] })
  return { mode: r.mode, rounds: r.rounds.length, roundSec: r.roundSec, restSec: r.restSec, picked, routineId: r.id }
}

/** A stored row (bag_routines) as a routine, or null when it isn't one. */
export function parseRoutineRow(row: { id: string; name: string; mode: string; roundsJson: string; roundSec: number; restSec: number }): BagRoutine | null {
  if (row.mode !== 'hybrid' && row.mode !== 'custom') return null
  let rounds: unknown
  try { rounds = JSON.parse(row.roundsJson) } catch { return null }
  if (!Array.isArray(rounds) || rounds.length === 0) return null
  return {
    id: row.id,
    name: row.name,
    mode: row.mode,
    rounds: rounds.slice(0, LIMITS.rounds[1]).map(r => (Array.isArray(r) ? r.filter((x): x is string => typeof x === 'string') : [])),
    roundSec: row.roundSec,
    restSec: row.restSec,
  }
}

/** The difficulty used for ordering (re-exported for the server's prompt). */
export type { ComboLevel }
