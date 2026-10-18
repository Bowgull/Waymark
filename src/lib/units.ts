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

/**
 * A ceiling in whole lb, rounded down, so a number at the ceiling converts
 * back to kg at or under it (the guardrails compare in kg).
 */
export function kgToLbsFloor(kg: number): number {
  return Math.floor(kg * 2.20462 + 1e-9)
}

/** A weight the model gave in lb, as the kg the app stores (2 decimals). */
export function lbsToKgStored(lbs: number): number {
  return Math.round((lbs / 2.20462) * 100) / 100
}
