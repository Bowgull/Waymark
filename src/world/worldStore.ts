// The one world behind the app (design-decisions.md "World map"): a tiny
// external store the screens write to and the world layer reads. Pure (no
// three.js, no DOM), so it is cheap to import anywhere and testable in node.
//
//   Today   = the clearing with the lantern     ('clearing')
//   Program = the road with notched wayposts    ('road')
//   Ledger  = the pond                          ('pond')
//   Library = the rune arch                     ('arch')
//   Rest day on Today = the hobbit home         ('home')
//   Offline = rain over whatever place is shown

export type WorldPlace = 'clearing' | 'road' | 'pond' | 'arch' | 'home'

/** One waypost per week on the Program road. A done week's post is lit with a notch per session done. */
export interface WeekPost {
  state: 'done' | 'now' | 'todo'
  notches: number
}

export interface WorldState {
  place: WorldPlace
  /** The lantern's strength, 0..1 (readiness dims it; a finished day brightens it). */
  lantern: number
  /** The Program road's posts (at most 6 are drawn). */
  weeks: WeekPost[] | null
  offline: boolean
  /** A full-screen moment (splash, session entrance) hides the world's UI scrims. */
  bare: boolean
  /** A screen with no place of its own that shows the world behind a centred card (page 31's MT Class Log: the forest). */
  backdrop: WorldPlace | null
  /** How the week has gone, 0..1 (page 32: the pond reacts to the week; brighter water and more fireflies when it's gone well). 0.5 = neutral. */
  pond: number
}

const DEFAULT_WEEKS: WeekPost[] = [
  { state: 'todo', notches: 0 }, { state: 'todo', notches: 0 }, { state: 'todo', notches: 0 },
  { state: 'todo', notches: 0 }, { state: 'todo', notches: 0 }, { state: 'todo', notches: 0 },
]

let state: WorldState = { place: 'clearing', lantern: 1, weeks: null, offline: false, bare: false, backdrop: null, pond: 0.5 }
const listeners = new Set<() => void>()

function emit(next: Partial<WorldState>) {
  const merged = { ...state, ...next }
  const changed = (Object.keys(next) as Array<keyof WorldState>).some(k => merged[k] !== state[k])
  if (!changed) return
  state = merged
  for (const l of listeners) l()
}

export function getWorldState(): WorldState {
  return state
}

export function subscribeWorld(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function setWorldPlace(place: WorldPlace): void {
  emit({ place })
}

export function setWorldLantern(k: number): void {
  emit({ lantern: Math.max(0, Math.min(1, Number.isFinite(k) ? k : 1)) })
}

/** The Ledger: how the week has gone (done of done + skipped), 0..1; null is neutral (0.5). */
export function setWorldPond(k: number | null): void {
  emit({ pond: k == null || !Number.isFinite(k) ? 0.5 : Math.round(Math.max(0, Math.min(1, k)) * 100) / 100 })
}

/** Page 32 C: the water's brightness and the night's pond fireflies for a week's k (0.5 = the look as drawn). */
export function pondLook(k: number): { water: number; flies: number } {
  const c = Math.max(0, Math.min(1, k))
  return { water: 0.75 + 0.5 * c, flies: Math.min(1, 0.4 + 1.2 * c) }
}

/** Program: the block's weeks as wayposts. Same values keep the same reference (no rebuild). */
export function setWorldWeeks(weeks: WeekPost[] | null): void {
  const next = weeks ? weeks.slice(0, 6).map(w => ({ state: w.state, notches: Math.max(0, Math.min(10, Math.round(w.notches))) })) : null
  if (sameWeeks(next, state.weeks)) return
  emit({ weeks: next })
}

export function setWorldOffline(offline: boolean): void {
  emit({ offline })
}

export function setWorldBare(bare: boolean): void {
  emit({ bare })
}

/** Show a place behind a screen that has none of its own (null puts it away). */
export function setWorldBackdrop(place: WorldPlace | null): void {
  emit({ backdrop: place })
}

export function sameWeeks(a: WeekPost[] | null, b: WeekPost[] | null): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  return a.every((w, i) => w.state === b[i].state && w.notches === b[i].notches)
}

/** The posts the road draws when Program hasn't said (six dark posts). */
export function weeksOrDefault(weeks: WeekPost[] | null): WeekPost[] {
  return weeks && weeks.length > 0 ? weeks : DEFAULT_WEEKS
}
