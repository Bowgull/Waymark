// The landmine in the plan (rebuild Phase 5, landmine.md, page 93 approved
// 2026-10-25). Pure.
//
// - The weight is what slides onto the bar end (bar only is 0), one plate a
//   step (2.5 lb until he says his gym's smallest is bigger), shown the same
//   as the barbell: the number, then the plates to grab under it. The coach
//   assumes a corner setup (the bar can slide) until he says otherwise.
// - Strength moves (the press, the reverse lunge): double progression, reps
//   first (8, 10, 12 a side), then a plate and back to 8. A clearly easy
//   session (every set 3+) takes the plate at once. A hard one holds; two in
//   a row take a plate off.
// - The power move (the landmine punch): short sets, the normal reps-left
//   card, no bar-speed tap. Slow and crisp while he learns it, fast once he
//   has it. A plate only after two sessions in a row with every set 2+ left,
//   never over 25 lb for months.
// - Learned in stages over about 8 weeks, a stage per two weeks of practice
//   (each landmine lift comes once a week); a sore back holds the stage.
// - Kept apart from the barbell numbers: no e1RM, not "known", not in the
//   Block Zero strength part, not in the simulator's lift ratio.

export const LANDMINE_PRESS = 'ex-landmine-press'
export const LANDMINE_PRESS_STANDING = 'ex-lm-press-standing'
export const LANDMINE_PUNCH = 'ex-lm-punch'
export const LANDMINE_LUNGE = 'ex-lm-reverse-lunge'
export const LANDMINE_RDL = 'ex-lm-rdl'

/** Every landmine move in the Library (0058). */
export const LANDMINE_IDS: ReadonlySet<string> = new Set([
  LANDMINE_PRESS, LANDMINE_PRESS_STANDING, LANDMINE_LUNGE, 'ex-lm-sl-rdl', LANDMINE_RDL, 'ex-lm-lateral-lunge', 'ex-lm-rainbow',
  LANDMINE_PUNCH, 'ex-lm-rotational-press', 'ex-lm-push-press', 'ex-lm-squat', 'ex-lm-meadows-row', 'ex-lm-rotation', 'ex-lm-thruster', 'ex-lm-calf-raise',
])

/** Power moves: short sets, a plate only rarely. */
export const POWER_IDS: ReadonlySet<string> = new Set([LANDMINE_PUNCH, 'ex-lm-rotational-press', 'ex-lm-push-press'])

/** One arm or one leg at a time: the plan line says "each" and the reps are a side. */
export const EACH_SIDE_IDS: ReadonlySet<string> = new Set([
  LANDMINE_PRESS, LANDMINE_PRESS_STANDING, LANDMINE_LUNGE, 'ex-lm-sl-rdl', 'ex-lm-lateral-lunge', 'ex-lm-rainbow', LANDMINE_PUNCH,
  'ex-lm-rotational-press', 'ex-lm-meadows-row', 'ex-lm-rotation',
])

/** The press slot on Strength A: the coach's pick of the two (page 93: one PRESS line, a tap says why). */
export const PRESS_IDS: ReadonlySet<string> = new Set([LANDMINE_PRESS, LANDMINE_PRESS_STANDING, 'ex-ohp'])

/** The fighter arm block (page 93): one ARMS line on the plan. */
export const ARM_BLOCK_IDS: ReadonlySet<string> = new Set(['ex-chin-up-band', 'ex-chin-up-negative', 'ex-chin-up', 'ex-dips', 'ex-close-grip-bench', 'ex-hammer-curl', 'ex-suitcase-carry', 'ex-wrist-curl'])

export const isLandmine = (exerciseId: string) => LANDMINE_IDS.has(exerciseId)
export const isPower = (exerciseId: string) => POWER_IDS.has(exerciseId)

const LB = 0.45359237
/** A plate on the bar end (kg): 2.5 lb. */
export const LANDMINE_STEP_KG = 2.5 * LB
/** The power move's top for months (kg): 25 lb. */
export const POWER_CAP_KG = 25 * LB
export const LANDMINE_REPS = { from: 8, to: 12, step: 2 } as const

/** What he did last time with one landmine move. */
export interface LandmineLast {
  day: number
  /** Kg on the bar end (0: bar only). */
  kg: number
  /** Reps on the last set, the planned reps, and whether every set hit them. */
  reps: number
  plannedReps: number
  allReps: boolean
  lastRir: number | null
  minRir: number | null
}

/** The learning stage, 1 to 4, from the landmine sessions so far (a stage per two), held back by a sore back. */
export function landmineStage(sessions: number, backSore: boolean): 1 | 2 | 3 | 4 {
  const s = Math.min(4, 1 + Math.floor(sessions / 2))
  return (backSore ? Math.max(1, s - 1) : s) as 1 | 2 | 3 | 4
}

/** The first time: the coach assumes a corner setup until he says the gym has a landmine post. */
export const CORNER_NOTE = 'No landmine post? Wedge the bar end into a corner with a towel round it.'

export interface LandmineDose {
  kg: number
  reps: number
  change: 'start' | 'increase' | 'hold' | 'decrease'
  why: string | null
  note: string
}

const lbText = (kg: number) => (kg < 0.1 ? 'bar only' : `${Math.round(kg / LB * 2) / 2} lb`)

/**
 * A landmine strength move's weight and reps from the last two sessions
 * (`prev` the one before `last`). Nothing yet: the bar only at the plan's reps.
 */
export function landmineStrength(label: string, plannedReps: number, last: LandmineLast | null, prev: LandmineLast | null, canAdd: boolean): LandmineDose {
  const note = 'Each side. Reps first, then a plate.'
  if (!last) return { kg: 0, reps: plannedReps, change: 'start', why: null, note: `Start with the bar only. ${note} ${CORNER_NOTE}` }
  const hard = !last.allReps || (last.lastRir != null && last.lastRir <= 1)
  if (hard) {
    const prevHard = prev != null && (!prev.allReps || (prev.lastRir != null && prev.lastRir <= 1))
    if (prevHard && last.kg > 0.1) return { kg: Math.max(0, last.kg - LANDMINE_STEP_KG), reps: LANDMINE_REPS.from, change: 'decrease', why: `${label}: hard two sessions running. A plate off.`, note }
    return { kg: last.kg, reps: last.reps, change: 'hold', why: null, note }
  }
  if (!canAdd || last.lastRir == null || last.lastRir < 2) return { kg: last.kg, reps: last.reps, change: 'hold', why: null, note }
  // Every set clearly easy: the plate at once (the set screen's "3+").
  if ((last.minRir ?? 0) >= 3) return { kg: last.kg + LANDMINE_STEP_KG, reps: last.reps, change: 'increase', why: `${label}: 3+ left on every set. A plate on: ${lbText(last.kg + LANDMINE_STEP_KG)}.`, note }
  if (last.reps < LANDMINE_REPS.to) return { kg: last.kg, reps: Math.min(LANDMINE_REPS.to, last.reps + LANDMINE_REPS.step), change: 'hold', why: `${label}: every rep in. ${Math.min(LANDMINE_REPS.to, last.reps + LANDMINE_REPS.step)} a side today.`, note }
  return { kg: last.kg + LANDMINE_STEP_KG, reps: LANDMINE_REPS.from, change: 'increase', why: `${label}: 12 a side done. A plate on, back to 8.`, note }
}

/** The power move: slow and crisp while he learns it (stages 1-2), fast after; a plate only after two clean sessions. */
export function landminePower(label: string, plannedReps: number, stage: number, last: LandmineLast | null, prev: LandmineLast | null, canAdd: boolean): LandmineDose {
  const note = stage <= 2
    ? 'Each side. Slow and crisp: every rep a single, reset, then go. The hip turns first, the arm finishes.'
    : 'Each side. Fast now: drive it and make the bar rattle at the top. Every rep a single. Stop a set if it slows.'
  if (!last) return { kg: 0, reps: plannedReps, change: 'start', why: null, note: `Bar only. ${note} ${CORNER_NOTE}` }
  const clean = (e: LandmineLast | null) => e != null && e.allReps && e.minRir != null && e.minRir >= 2
  // Two clean sessions at this weight (a plate resets the count), and never past the cap.
  if (canAdd && clean(last) && clean(prev) && Math.abs(prev!.kg - last.kg) < 0.1 && last.kg + LANDMINE_STEP_KG <= POWER_CAP_KG + 0.01) {
    return { kg: last.kg + LANDMINE_STEP_KG, reps: plannedReps, change: 'increase', why: `${label}: two crisp sessions. A plate on.`, note }
  }
  return { kg: Math.min(last.kg, POWER_CAP_KG), reps: plannedReps, change: 'hold', why: null, note }
}

/** A logged set as the model events carry it. */
export interface LandmineSetIn { exerciseId: string; sessionId: string; day: number; weightKg: number | null; reps: number; plannedReps: number | null; rir: number | null; isWarmup: boolean; logged: boolean }

/** The last two sessions of each landmine move before `before` (newest first), from completed sessions. */
export function landmineHistory(sets: ReadonlyArray<LandmineSetIn>, doneSessionIds: ReadonlySet<string>, before: number): Record<string, LandmineLast[]> {
  const by = new Map<string, Map<string, LandmineSetIn[]>>()
  for (const s of sets) {
    if (!isLandmine(s.exerciseId) || s.isWarmup || !s.logged || s.day >= before || !doneSessionIds.has(s.sessionId)) continue
    const m = by.get(s.exerciseId) ?? new Map<string, LandmineSetIn[]>()
    m.set(s.sessionId, [...(m.get(s.sessionId) ?? []), s])
    by.set(s.exerciseId, m)
  }
  const out: Record<string, LandmineLast[]> = {}
  for (const [id, m] of by) {
    out[id] = [...m.values()].map(list => {
      const last = list[list.length - 1]
      const rirs = list.map(x => x.rir).filter((r): r is number => r != null)
      return {
        day: last.day, kg: Math.max(0, ...list.map(x => x.weightKg ?? 0)), reps: last.reps, plannedReps: last.plannedReps ?? last.reps,
        allReps: list.every(x => x.reps >= (x.plannedReps ?? x.reps)), lastRir: last.rir, minRir: rirs.length ? Math.min(...rirs) : null,
      }
    }).sort((a, b) => b.day - a.day).slice(0, 2)
  }
  return out
}

/** Landmine sessions so far (the most any one move was done): the learning stage counts these. */
export function landmineSessions(sets: ReadonlyArray<LandmineSetIn>, doneSessionIds: ReadonlySet<string>, before: number): number {
  const by = new Map<string, Set<string>>()
  for (const s of sets) if (isLandmine(s.exerciseId) && !s.isWarmup && s.logged && s.day < before && doneSessionIds.has(s.sessionId)) by.set(s.exerciseId, (by.get(s.exerciseId) ?? new Set()).add(s.sessionId))
  return Math.max(0, ...[...by.values()].map(x => x.size))
}
