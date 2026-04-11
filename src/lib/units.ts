export function kgToLbs(kg: number): number {
  return Math.round(kg * 2.20462)
}

export function lbsToKg(lbs: number): number {
  return lbs / 2.20462
}

export function formatWeight(kg: number | null): string {
  if (kg == null) return '—'
  return `${kgToLbs(kg)} lbs`
}
