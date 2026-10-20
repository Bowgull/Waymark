// The MT class log (page 31, "MT Class Log"): type, length, one note. Pure.

/** The class types on the log, in page 31's order (the server's MT class types). */
export type ClassTypeValue = 'technical' | 'sparring' | 'padwork' | 'clinch' | 'general'

export const CLASS_TYPES: ReadonlyArray<{ value: ClassTypeValue; label: string }> = [
  { value: 'technical', label: 'TECHNICAL' },
  { value: 'sparring', label: 'SPARRING' },
  { value: 'padwork', label: 'PADWORK' },
  { value: 'clinch', label: 'CLINCH' },
  { value: 'general', label: 'GENERAL' },
]

const ALIASES: Record<string, ClassTypeValue> = {
  technical: 'technical', technique: 'technical', tech: 'technical',
  sparring: 'sparring',
  padwork: 'padwork', pads: 'padwork', bag: 'padwork',
  clinch: 'clinch',
  general: 'general',
}

/**
 * The type lit when the card opens: the class's own type when it has one,
 * else GENERAL. Nothing is refused by type in any block (coach-brain §14).
 */
export function defaultClassType(saved: string | null | undefined): ClassTypeValue {
  const known = saved ? ALIASES[saved.toLowerCase().replace(/[^a-z]/g, '')] : undefined
  return known ?? 'general'
}

export const CLASS_MIN = { min: 5, max: 300, step: 5 } as const

/** Class length in minutes, on the stepper's 5-minute steps, 5 to 300. */
export function clampClassMinutes(v: number): number {
  if (!Number.isFinite(v)) return 60
  return Math.min(CLASS_MIN.max, Math.max(CLASS_MIN.min, Math.round(v / CLASS_MIN.step) * CLASS_MIN.step))
}

/**
 * The PATCH body for SAVE CLASS LOG. Page 31's one note ("What to work on",
 * e.g. "Guard dropping after combos") is the log's weakness field, which the
 * weekly plan and bag work already read. The other note fields are left as
 * they are (not sent).
 */
export function classLogPatch(input: { classType: ClassTypeValue; minutes: number; note: string }): { classType: ClassTypeValue; durationMin: number; weakness?: string } {
  const note = input.note.trim()
  return { classType: input.classType, durationMin: clampClassMinutes(input.minutes), ...(note ? { weakness: note } : {}) }
}
