// Coach brain: the candidate list for one of today's sessions (coach-brain.md
// §5.2), pure so the Worker and the dev-side eval set (evals/) build it the
// same way. Every level from RECOVER up to the rules' own pick, plus (approved
// 2026-10-21, item 12) the levels ABOVE the rules' default up to the safe
// ceiling, offered only when the numbers already support a push:
//
//   - never on a RECOVER / REST / EASE day, an AMBER or RED morning, a back,
//     injury or raven flag, a short or bad night, his own skip or lighter swap
//     still holding, a model that is still guessing, or no check-in read;
//   - each above candidate carries the fact ids that support it (evidenceIds:
//     reps left on the last session, a run held under the line, an easy bag
//     session). The AI must cite one of them; a note alone never counts.
//
// The ceiling stays absolute: the readiness state's level, one load step a
// week, one run rung a week, the run caps, felt-hard, AMBER. verify refuses an
// above pick that cites no evidence id; the dose code clamps the rest.

import { CEILING, LEVELS, levelAbove, ownHold, PUSH_MAX_U, tweakBag, tweakRun, tweakStrength, type BagDose, type Level, type RunDose, type StrengthDose, type Tweak } from './doses'
import { doseWords, type Candidate, type TweakRange } from './decision'
import type { LoadEquipment } from '../strengthLoads'
import type { ReadConfidence, ReadinessState } from './readiness'
import type { AthleteModel, ModelCheckIn } from './types'
import { itemBaseline } from './athleteModel'

export interface DoseLike { level: Level; strength?: StrengthDose; run?: RunDose; bag?: BagDose }

export const ZERO_RANGE: TweakRange = { setsDelta: [0, 0], loadStep: [0, 0], roundsDelta: [0, 0] }

export function rangeFor(d: DoseLike, equipment: Readonly<Record<string, LoadEquipment>>): TweakRange {
  if (d.level === 'RECOVER' || d.level === 'REST') return ZERO_RANGE
  if (d.strength) {
    const sets = d.strength.lifts.some(l => l.sets > (l.workUp ? 2 : 1))
    const load = d.strength.lifts.some(l => !l.workUp && l.weightKg != null && l.weightKg > 0 && (equipment[l.exerciseId] ?? 'none') !== 'none')
    return { setsDelta: [sets ? -1 : 0, 0], loadStep: [load ? -1 : 0, 0], roundsDelta: [0, 0] }
  }
  if (d.run) return { setsDelta: [0, 0], loadStep: [0, 0], roundsDelta: [!d.run.walkOnly && (d.run.rounds > 2 || d.run.rounds <= 1) ? -1 : 0, 0] }
  if (d.bag) return { setsDelta: [0, 0], loadStep: [0, 0], roundsDelta: [d.bag.rounds > 1 ? -1 : 0, 0] }
  return ZERO_RANGE
}

export function tweaked<T extends DoseLike>(d: T, t: Tweak, equipment: Readonly<Record<string, LoadEquipment>>): T {
  const x: T = { ...d }
  if (x.strength) x.strength = tweakStrength(x.strength, t, equipment)
  if (x.run) x.run = tweakRun(x.run, t)
  if (x.bag) x.bag = tweakBag(x.bag, t)
  x.level = x.strength?.level ?? x.run?.level ?? x.bag?.level ?? x.level
  return x
}

export function tweakedWords(d: DoseLike, range: TweakRange, equipment: Readonly<Record<string, LoadEquipment>>): Candidate['tweaked'] {
  const out: NonNullable<Candidate['tweaked']> = {}
  const words = (t: Tweak) => doseWords(tweaked(d, t, equipment))
  if (range.setsDelta[0] < 0) out.setsDelta = words({ setsDelta: -1, loadStep: 0, roundsDelta: 0 })
  if (range.loadStep[0] < 0) out.loadStep = words({ setsDelta: 0, loadStep: -1, roundsDelta: 0 })
  if (range.roundsDelta[0] < 0) out.roundsDelta = words({ setsDelta: 0, loadStep: 0, roundsDelta: -1 })
  if (range.setsDelta[0] < 0 && range.loadStep[0] < 0) out.setsDelta = `${out.setsDelta} | both: ${words({ setsDelta: -1, loadStep: -1, roundsDelta: 0 })}`
  return Object.keys(out).length ? out : undefined
}

// ─── Room above the rules' default (item 12) ─────────────────

export interface PushGateIn {
  sessionType: string
  rulesDose: DoseLike
  state: ReadinessState
  confidence: ReadConfidence
  model: AthleteModel
  checkIns: readonly ModelCheckIn[]
  today: number
  /** Back today at 2 or less, a back plan, or a back-day swap on the session. */
  backFlag: boolean
  /** An injury flag, a raven plan or a body plan touching the session. */
  injuryFlag: boolean
}

export interface PushRoom {
  /** Levels above the rules' default the AI may pick, lowest first (empty: none). */
  levels: Level[]
  /** Fact ids that support a push; an above pick must cite at least one. */
  evidenceIds: string[]
  /** Why there is no room (for the record), null when there is. */
  blocked: string | null
}

/** A short or bad night: under 6 h, or 1 h+ under his usual, yesterday or this morning. */
export function badSleep(checkIns: readonly ModelCheckIn[], today: number): boolean {
  for (const d of [today, today - 1]) {
    const c = checkIns.find(x => x.day === d)
    if (c?.sleepHours == null) continue
    if (c.sleepHours < 6) return true
    const b = itemBaseline(checkIns as ModelCheckIn[], 'sleepHours', d)
    if (b && c.sleepHours <= b.mean - 1) return true
  }
  return false
}

const RANK = (l: Level) => LEVELS.indexOf(l)

export function pushRoom(g: PushGateIn): PushRoom {
  const none = (blocked: string): PushRoom => ({ levels: [], evidenceIds: [], blocked })
  const rules = g.rulesDose.level
  if (rules !== 'HOLD' && rules !== 'PROGRESS') return none(`rules pick is ${rules}`)
  if (g.state !== 'GREEN' && g.state !== 'FRESH') return none(`state ${g.state}`)
  if (g.confidence === 'none') return none('no check-in read')
  if (g.backFlag) return none('back flag')
  if (g.injuryFlag) return none('injury or raven flag')
  if (badSleep(g.checkIns, g.today)) return none('short or bad night')
  const m = g.model
  const evidence: string[] = []
  if (g.rulesDose.strength) {
    if (ownHold(m, 'strength')) return none('his own ease holds strength')
    for (const l of g.rulesDose.strength.lifts) {
      const est = m.lifts[l.exerciseId]
      if (!est?.last || l.workUp || l.level !== 'HOLD' || est.u > PUSH_MAX_U) continue
      const e = est.last
      if (e.lastRir != null && e.lastRir >= 3 && e.allReps !== false && !e.lowered && !e.incomplete) evidence.push(`f.lift.${l.exerciseId}.lastRir`)
    }
  } else if (g.rulesDose.run) {
    if (ownHold(m, 'run')) return none('his own ease holds runs')
    const last = m.run.recent[m.run.recent.length - 1]
    if (m.run.u <= PUSH_MAX_U && last?.handled && last.u != null && last.u >= 0.9 && (last.rpe == null || last.rpe <= 4) && last.hasHr) evidence.push('f.run.last.U', 'f.run.handledStreak')
  } else if (g.rulesDose.bag) {
    if (ownHold(m, 'bag')) return none('his own ease holds bag work')
    if (m.bag.u <= PUSH_MAX_U && m.bag.lastEffort != null && m.bag.lastEffort <= 5 && m.bag.wristShinFlags === 0) evidence.push('f.bag.lastEffort')
  }
  if (evidence.length === 0) return none('no numbers support a push')
  const ceiling = CEILING[g.state]
  const levels = LEVELS.filter(l => levelAbove(l, rules) && RANK(l) <= RANK(ceiling) && (g.rulesDose.run ? l !== 'PUSH' : true))
  return levels.length ? { levels, evidenceIds: evidence, blocked: null } : none('rules pick is already at the ceiling')
}
