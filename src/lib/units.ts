export function kgToLbs(kg: number): number {
  return Math.round(kg * 2.20462)
}

/** Body weight in lb to one decimal (182.4), as he logs it and the Ledger shows it (m13). */
export function bodyLbs(kg: number): number {
  return Math.round(kg * 2.20462 * 10) / 10
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

/**
 * body_metrics.logged_at as unix seconds. The column holds both: the server's
 * default and the demo seed wrote seconds, the Body page used to send ms
 * (e2e major 3). Anything past 1e11 is ms (1e11 s is the year 5138).
 */
export function loggedAtSec(loggedAt: number): number {
  return loggedAt > 1e11 ? Math.floor(loggedAt / 1000) : Math.floor(loggedAt)
}

/**
 * The temperature unit (page 72: °C with km, °F with miles). Settings has no
 * miles choice: Josh reads km, so °C. One place to change when it does.
 */
export function temperatureUnit(): 'C' | 'F' {
  return 'C'
}
