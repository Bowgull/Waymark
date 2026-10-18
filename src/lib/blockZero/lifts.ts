// Main-lift identity for Block Zero calibration and the Fighter hand-off.
// Matching is by exercise id first. Names are only a fallback for AI output
// (the assessment returns names like "Squat" or "Barbell Row").

/**
 * Every lift the Fighter templates load off a training max. The deadlift
 * family is phased (RDL wk1-2, Block Pull wk3-4, Deadlift wk5-6), so Fighter
 * Block 1 week 1 needs an RDL max, not just a deadlift max.
 */
export const FIGHTER_MAIN_LIFT_IDS = [
  'ex-front-squat',
  'ex-bench-press',
  'ex-bent-over-row',
  'ex-ohp',
  'ex-rdl',
  'ex-block-pull',
  'ex-deadlift',
] as const

export type FighterMainLiftId = typeof FIGHTER_MAIN_LIFT_IDS[number]

const MAIN_LIFT_ID_SET = new Set<string>(FIGHTER_MAIN_LIFT_IDS)

export function isFighterMainLift(exerciseId: string): boolean {
  return MAIN_LIFT_ID_SET.has(exerciseId)
}

// Common names an AI or a person uses for a lift, normalised (lowercase,
// letters and digits only). Values are seed exercise ids.
const LIFT_NAME_ALIASES: Record<string, string> = {
  squat: 'ex-front-squat',
  backsquat: 'ex-front-squat',
  frontsquat: 'ex-front-squat',
  barbellsquat: 'ex-front-squat',
  gobletsquat: 'ex-goblet-squat',
  deadlift: 'ex-deadlift',
  conventionaldeadlift: 'ex-deadlift',
  barbelldeadlift: 'ex-deadlift',
  trapbardeadlift: 'ex-trap-bar-deadlift',
  trapbar: 'ex-trap-bar-deadlift',
  hexbardeadlift: 'ex-trap-bar-deadlift',
  blockpull: 'ex-block-pull',
  rackpull: 'ex-block-pull',
  rdl: 'ex-rdl',
  romaniandeadlift: 'ex-rdl',
  dbrdl: 'ex-db-rdl',
  dumbbellrdl: 'ex-db-rdl',
  bench: 'ex-bench-press',
  benchpress: 'ex-bench-press',
  barbellbenchpress: 'ex-bench-press',
  overheadpress: 'ex-ohp',
  ohp: 'ex-ohp',
  press: 'ex-ohp',
  militarypress: 'ex-ohp',
  shoulderpress: 'ex-ohp',
  barbellrow: 'ex-bent-over-row',
  bentoverrow: 'ex-bent-over-row',
  row: 'ex-bent-over-row',
  pendlayrow: 'ex-bent-over-row',
}

function normaliseName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Resolve a free-text lift name to an exercise id that exists in `exerciseRows`.
 * Exact name match first, then the alias table. Null when nothing matches or
 * the matched id isn't in the library.
 */
export function resolveLiftId(name: string, exerciseRows: Array<{ id: string; name: string }>): string | null {
  const key = normaliseName(name)
  if (!key) return null
  const known = new Set(exerciseRows.map(e => e.id))
  const exact = exerciseRows.find(e => normaliseName(e.name) === key)
  if (exact) return exact.id
  const alias = LIFT_NAME_ALIASES[key]
  return alias && known.has(alias) ? alias : null
}

/**
 * Assessment calibrationStarts → training-max writes. Names resolve to ids in
 * the library; unknown names and non-positive weights are dropped, and the
 * first estimate for an id wins.
 */
export function resolveCalibrationStarts(
  starts: Array<{ exerciseName: string; startingWeightKg: number }>,
  exerciseRows: Array<{ id: string; name: string }>,
): Array<{ exerciseId: string; weightKg: number }> {
  const out: Array<{ exerciseId: string; weightKg: number }> = []
  const seen = new Set<string>()
  for (const s of starts) {
    if (!(s.startingWeightKg > 0)) continue
    const id = resolveLiftId(s.exerciseName, exerciseRows)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ exerciseId: id, weightKg: s.startingWeightKg })
  }
  return out
}

/** The Fighter main lifts present in the library, in FIGHTER_MAIN_LIFT_IDS order. */
export function selectMainLifts<T extends { id: string }>(exerciseRows: T[]): T[] {
  const byId = new Map(exerciseRows.map(e => [e.id, e]))
  return FIGHTER_MAIN_LIFT_IDS.map(id => byId.get(id)).filter((e): e is T => e != null)
}
