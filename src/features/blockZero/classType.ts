// Class types asked at log time (quick add leaves the type open). Pure.

/** The class types asked at log time. Block Zero uses its own names (technique, pads, bag, clinch, sparring). */
export type ClassTypeValue = 'technique' | 'pads' | 'bag' | 'clinch' | 'sparring' | 'general'

export const CLASS_TYPE_TILES: ReadonlyArray<{ value: ClassTypeValue; label: string; sub: string }> = [
  { value: 'technique', label: 'TECH', sub: 'technique' },
  { value: 'pads', label: 'PADS', sub: 'pad rounds' },
  { value: 'bag', label: 'BAG', sub: 'bag work' },
  { value: 'clinch', label: 'CLINCH', sub: 'light clinch' },
  { value: 'sparring', label: 'SPARRING', sub: 'hard sparring' },
]

/** What the log form's chips call each type (mtClassMicrocopy names). */
export function formTypeFor(v: ClassTypeValue): 'technical' | 'padwork' | 'clinch' | 'sparring' | 'general' {
  if (v === 'technique') return 'technical'
  if (v === 'pads' || v === 'bag') return 'padwork'
  return v
}
