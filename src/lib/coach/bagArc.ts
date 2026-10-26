// Bag sessions planned three ways (page 80, approved 2026-10-23; the
// round plan inside them from page 93, approved 2026-10-25).
//
// COACH: the coach plans every round the way a kru teaches a bag session
// (research: bag-round-structure.md). Two focus combos, A and B, drilled for
// the whole session and kept about 3 sessions, or until both rate SHARP:
//   WARM-UP    rhythm: jab, lead teep, a light body kick (the basics he owns)
//   TECHNIQUE  learn A, slow and clean, the whole round; then learn B
//   TECHNIQUE  further in (A and B 3 strikes or more): A and B as one string
//   PRESSURE   A and B at pace, the last 30 s all out; then a free round
// The app's four stage words stay; the round's focus is in its round type and
// its one cue (the teal flap). A NEW combo (one he added, or one the coach's
// unlock card opened, in the last two weeks) is always A: it is learnt slow
// before it is thrown at pace. The page 86 finisher (counted kick and teep
// sets) follows the last round; it is not a round. HYBRID: the coach sets the
// rounds, their length and rest; the rounds he filled stay his, the coach fills
// the rest on the same plan. CUSTOM: every round, its length, the rest and the
// combos are his; the coach changes nothing. Hybrid and Custom can be saved as
// routines.
//
// Pure: the builder on the phone and the start route on the server both run
// it. The coach only ever picks from his own combos: it never makes one up.

import { comboLevel, expandStrike, splitComboText, type ComboLevel } from '../classCombos'
import type { BagRoundType } from './bag'

export type BagStage = 'warmup' | 'technique' | 'pressure' | 'finisher'
export type BagMode = 'coach' | 'hybrid' | 'custom'

/** The round labels (the only words on the builder's rounds). */
export const STAGE_WORDS: Readonly<Record<BagStage, string>> = { warmup: 'WARM-UP', technique: 'TECHNIQUE', pressure: 'PRESSURE', finisher: 'FINISHER' }

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
  /** Unix seconds: when the coach's unlock card opened it (0060). */
  unlockedAt?: number | null
}

/** Days a combo he added (typed or from class), or the coach opened, counts as new. */
export const NEW_DAYS = 14
/** Mastered at 9 of 15 (the Library's MASTERED_AT); close from 6. */
export const MASTERED_AT = 9
export const CLOSE_AT = 6

export type PoolTag = 'new' | 'close' | null

/** NEW: one he added, or the coach's unlock card opened, in the last two weeks, not mastered yet. CLOSE: 6-8 of 15. */
export function poolTag(c: PoolCombo, nowSec: number): PoolTag {
  const his = c.source === 'mine' || c.source === 'class'
  const since = his ? c.createdAt : c.unlockedAt ?? null
  if (since != null && nowSec - since <= NEW_DAYS * 86400 && c.masteryScore < MASTERED_AT) return 'new'
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

// ─── the round plan (page 93) ─────────────────────────────────

/**
 * What a round asks for. RHYTHM: the warm-up basics. LEARN: one combo slow and
 * clean the whole round, exit after each. LINK: A then B as one string. PACE: A
 * at pace (a 6-round day before the link). PRESSURE: A and B at pace, the last
 * 30 s all out. FREE: a fight round, mix in A and B, check after every combo.
 */
export type RoundFocus = 'rhythm' | 'learn' | 'link' | 'pace' | 'pressure' | 'free'

/** The stage word each focus sits under (the app's four words stay). */
export const FOCUS_STAGE: Readonly<Record<RoundFocus, BagStage>> = { rhythm: 'warmup', learn: 'technique', link: 'technique', pace: 'pressure', pressure: 'pressure', free: 'pressure' }

/** Each focus as the round type the bag rounds carry (bag_work_rounds.round_type). */
export const FOCUS_ROUND_TYPE: Readonly<Record<RoundFocus, BagRoundType>> = { rhythm: 'warmup', learn: 'learn', link: 'link', pace: 'pace', pressure: 'pressure', free: 'free' }

/**
 * The rounds' focus for n rounds (bag-round-structure.md): rhythm, learn A,
 * learn B, link (or A at pace early on), pressure, free. Shorter days drop the
 * link, then the free round; longer ones add free rounds.
 */
export function roundPlan(n: number, linked = false): RoundFocus[] {
  if (n <= 0) return []
  const six: RoundFocus[] = ['rhythm', 'learn', 'learn', linked ? 'link' : 'pace', 'pressure', 'free']
  if (n >= 6) return [...six, ...Array.from({ length: n - 6 }, () => 'free' as const)]
  if (n === 5) return ['rhythm', 'learn', 'learn', 'pressure', 'free']
  if (n === 4) return ['rhythm', 'learn', 'learn', 'pressure']
  return six.slice(0, n)
}

/** The stage words for n rounds (the builder's labels; no finisher round: the finisher is page 86's sets). */
export function kruArc(n: number): BagStage[] {
  return roundPlan(n).map(f => FOCUS_STAGE[f])
}

/** The stage a stored round type sits under (older sessions' types too); null for Custom's rounds (no labels). */
export function stageOfRoundType(t: string | null | undefined): BagStage | null {
  switch (t) {
    case 'warmup': return 'warmup'
    case 'learn': case 'link': case 'technical_flow': case 'drill_isolation': return 'technique'
    case 'pace': case 'pressure': case 'free': case 'combo_practice': case 'power': return 'pressure'
    case 'conditioning': return 'finisher'
    default: return null
  }
}

/** The one cue a round shows on its teal flap (CUE · …): the combo's own on a learn round, the round's job otherwise. */
export function roundCue(roundType: string | null | undefined, comboCue: string): string {
  switch (roundType) {
    case 'warmup': return 'RELAX, BOUNCE'
    case 'link': return 'ONE STRING, NO STOP'
    case 'pace': case 'pressure': return 'LAST 30 S ALL OUT'
    case 'free': return 'CHECK AFTER EACH'
    default: return comboCue
  }
}

export interface PlannedRound {
  /** Null in Custom (no labels). */
  stage: BagStage | null
  comboIds: string[]
  /** He filled it (the gold edge). */
  mine: boolean
  /** What the round asks for (null in Custom). */
  focus?: RoundFocus | null
}

/** A focus pair from an earlier session (newest first): its combo ids and how each was rated. */
export interface FocusHistory {
  ids: string[]
  /** Combo id → that session's rating (1 STRUGGLED, 2 SOLID, 3 SHARP). */
  ratings: Readonly<Record<string, number>>
}

/** A focus pair is kept about this many sessions (or until both rate SHARP), then one is swapped. */
export const FOCUS_SESSIONS = 3

/** A single strike that makes a rhythm warm-up (jab, lead teep, body kick...). */
const RHYTHM_ORDER = [/^jab\b/i, /\bteep\b/i, /\bbody kick\b/i, /\bkick\b/i, /\bcross\b/i, /\bknee\b/i]

/**
 * The session's two focus combos, A then B (page 93): the pair from last time
 * is kept until it has had about 3 sessions or both rated SHARP; then one is
 * swapped (the sharper, then the longer-drilled), the other stays. A NEW combo
 * comes in first, as A. Then the ones he is still learning, easiest first;
 * when everything is mastered, the easiest he knows. A combo just swapped out
 * doesn't come straight back.
 */
export function pickFocus(pool: ReadonlyArray<PoolCombo>, nowSec: number, history: ReadonlyArray<FocusHistory> = []): string[] {
  const inPool = new Set(pool.map(c => c.id))
  const byLevel = (a: PoolCombo, b: PoolCombo) => comboLevel(a) - comboLevel(b) || strikeCount(a) - strikeCount(b) || a.id.localeCompare(b.id)
  const last = history[0]
  const streak = (id: string) => { let n = 0; for (const h of history) { if (!h.ids.includes(id)) break; n++ } return n }
  let keep = (last?.ids ?? []).filter(id => inPool.has(id)).slice(0, 2)
  const out: string[] = []
  const dropped = new Set<string>()
  if (keep.length === 2) {
    const sharp = keep.filter(id => last!.ratings[id] === 3)
    const tired = keep.some(id => streak(id) >= FOCUS_SESSIONS)
    if (sharp.length === 2 || tired) {
      // swap one: the sharper, then the one drilled longer, then the first
      const [go] = [...keep].sort((x, y) => Number(last!.ratings[y] === 3) - Number(last!.ratings[x] === 3) || streak(y) - streak(x) || keep.indexOf(x) - keep.indexOf(y))
      dropped.add(go)
      keep = keep.filter(id => id !== go)
    }
  }
  const fresh = pool.filter(c => poolTag(c, nowSec) === 'new').sort((a, b) => (b.unlockedAt ?? b.createdAt) - (a.unlockedAt ?? a.createdAt) || byLevel(a, b))
  // a NEW combo always gets a learn round: it goes first, ahead of a kept one
  const newFirst = fresh.find(c => !keep.includes(c.id) && !dropped.has(c.id))
  if (newFirst && keep.length >= 2) keep = keep.slice(0, 1)
  if (newFirst) out.push(newFirst.id)
  for (const id of keep) if (out.length < 2 && !out.includes(id)) out.push(id)
  const learning = pool.filter(c => c.masteryScore < MASTERED_AT).sort((a, b) => byLevel(a, b) || a.masteryScore - b.masteryScore)
  const known = pool.filter(c => c.masteryScore >= MASTERED_AT).sort(byLevel)
  for (const list of [fresh, learning, known]) {
    for (const c of list) {
      if (out.length >= 2) break
      if (!out.includes(c.id) && !dropped.has(c.id)) out.push(c.id)
    }
  }
  // a pool of two: the one swapped out comes back rather than a round with nothing
  for (const id of dropped) if (out.length < 2 && !out.includes(id)) out.push(id)
  return out
}

/** The warm-up's basics: up to three single strikes he owns (jab, lead teep, body kick), else his easiest best-known combos. */
function rhythmIds(pool: ReadonlyArray<PoolCombo>, nowSec: number, focus: ReadonlyArray<string>): string[] {
  // a new combo waits for its learn round: not in the warm-up
  const settled = pool.filter(c => poolTag(c, nowSec) !== 'new')
  const base = settled.length > 0 ? settled : [...pool]
  // one strike each ("Jab × 3" is a jab)
  const singles = base.filter(c => splitComboText(c.text).length === 1)
  const picked: PoolCombo[] = []
  for (const re of RHYTHM_ORDER) {
    const hit = singles.find(c => !picked.includes(c) && re.test(c.text))
    if (hit && picked.length < 3) picked.push(hit)
  }
  if (picked.length >= 2) return picked.map(c => c.id)
  const basics = [...base].sort((a, b) => comboLevel(a) - comboLevel(b) || b.masteryScore - a.masteryScore || strikeCount(a) - strikeCount(b))
  const notFocus = basics.filter(c => !focus.includes(c.id))
  return (notFocus.length > 0 ? notFocus : basics).slice(0, 2).map(c => c.id)
}

/**
 * The coach's rounds (page 93). `keep` holds rounds already filled (Hybrid:
 * his); the coach fills the others on the same plan with the session's A and
 * B (`history`: earlier sessions' pairs, newest first, so a pair carries on).
 */
export function planCoachRounds(pool: ReadonlyArray<PoolCombo>, opts: { rounds: number; nowSec: number; keep?: Readonly<Record<number, ReadonlyArray<string>>>; history?: ReadonlyArray<FocusHistory> }): PlannedRound[] {
  const keep = opts.keep ?? {}
  const [a, b] = pickFocus(pool, opts.nowSec, opts.history ?? [])
  const byId = new Map(pool.map(c => [c.id, c]))
  const linked = a != null && b != null && strikeCount(byId.get(a)!) >= 3 && strikeCount(byId.get(b)!) >= 3
  const plan = roundPlan(opts.rounds, linked)
  const rhythm = rhythmIds(pool, opts.nowSec, [a, b].filter(Boolean))
  let learnt = 0
  return plan.map((focus, i) => {
    const stage = FOCUS_STAGE[focus]
    const mineIds = keep[i]
    if (focus === 'learn') learnt++
    if (mineIds && mineIds.length > 0) return { stage, comboIds: [...mineIds], mine: true, focus }
    if (pool.length === 0 || a == null) return { stage, comboIds: [], mine: false, focus }
    const both = b != null ? [a, b] : [a]
    const ids = focus === 'rhythm' ? rhythm
      : focus === 'learn' ? [learnt === 2 && b != null ? b : a]
      : focus === 'pace' ? [a]
      : both
    return { stage, comboIds: ids, mine: false, focus }
  })
}

/** The session's A and B as planned (the combos the coach's learn rounds hold), to keep for next time. */
export function focusOf(rounds: ReadonlyArray<Pick<PlannedRound, 'comboIds' | 'focus' | 'mine'>>): string[] {
  const out: string[] = []
  for (const r of rounds) if (r.focus === 'learn' && !r.mine) for (const id of r.comboIds) if (!out.includes(id)) out.push(id)
  return out.slice(0, 2)
}

/** Hybrid: his rounds kept as he filled them; the coach fills the empty ones on the same plan. */
export function planHybridRounds(pool: ReadonlyArray<PoolCombo>, opts: { rounds: number; nowSec: number; picked: Readonly<Record<number, ReadonlyArray<string>>>; history?: ReadonlyArray<FocusHistory> }): PlannedRound[] {
  return planCoachRounds(pool, { rounds: opts.rounds, nowSec: opts.nowSec, keep: opts.picked, history: opts.history })
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

/** The rounds to write when the session starts, from his choice (Coach: the coach's plan; `history`: earlier sessions' A and B). */
export function roundsForSpec(spec: BagSpec, pool: ReadonlyArray<PoolCombo>, opts: { nowSec: number; history?: ReadonlyArray<FocusHistory> }): Array<PlannedRound & { roundType: BagRoundType; durationSec: number; restSec: number }> {
  const known = new Set(pool.map(c => c.id))
  // only his own combos that are still in his pool
  const picked = Object.fromEntries(Object.entries(spec.picked).map(([k, ids]) => [k, ids.filter(id => known.has(id))]))
  const rounds = spec.mode === 'custom'
    ? planCustomRounds({ rounds: spec.rounds, picked })
    : spec.mode === 'hybrid'
      ? planHybridRounds(pool, { rounds: spec.rounds, nowSec: opts.nowSec, picked, history: opts.history })
      : planCoachRounds(pool, { rounds: spec.rounds, nowSec: opts.nowSec, history: opts.history })
  return rounds.map(r => ({
    ...r,
    roundType: r.focus ? FOCUS_ROUND_TYPE[r.focus] : 'custom',
    durationSec: spec.roundSec,
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
