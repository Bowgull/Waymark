export function kgToLbs(kg: number): number {
  return Math.round(kg * 2.20462)
}

export function lbsToKg(lbs: number): number {
  return lbs / 2.20462
}

/** A weight for people to read: Josh measures in lb ("155 lb"). Data stays in kg. */
export function lbText(kg: number): string {
  return `${kgToLbs(kg)} lb`
}

export function formatWeight(kg: number | null): string {
  if (kg == null) return '-'
  return `${kgToLbs(kg)} lbs`
}
