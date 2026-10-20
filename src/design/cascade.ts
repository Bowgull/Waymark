// The screen-open switch (page 59 §5.1, approved 2026-10-19). A screen opening
// arms it, with the moment its boards rise; the flap labels that first show
// while it is armed flip in with their board (FlapLabel, flapEngine). It stays
// armed a short while after the rise so labels that come with the screen's
// data still flip in. The first touch or key press lands everything still
// flipping and disarms it, so a label that appears because you did something
// just flips the normal way.

/** How long after the boards rise a label showing for the first time still flips in. */
const WINDOW_MS = 1600

let armedAt = Number.NEGATIVE_INFINITY
let riseAt = 0
let lastScreen: string | null = null
let listening = false
const onLand = new Set<() => void>()

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

function disarm() {
  armedAt = Number.NEGATIVE_INFINITY
}

function touched() {
  disarm()
  for (const fn of onLand) fn()
}

function listen() {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('pointerdown', touched, true)
  window.addEventListener('keydown', touched, true)
}

/**
 * A screen just opened (or a session screen just appeared after its entrance):
 * flip in what shows next. `rise` is when its boards start rising (performance
 * time); now when omitted.
 */
export function armCascade(rise?: number): void {
  listen()
  const t = now()
  armedAt = t
  riseAt = Math.max(t, rise ?? t)
}

/**
 * Called with the open screen's key on every render (idempotent): a new key arms
 * the cascade; null (a screen the mockups don't cascade) disarms it.
 */
export function cascadeForScreen(key: string | null): void {
  if (key === lastScreen) return
  lastScreen = key
  if (key) armCascade()
  else disarm()
}

/** True while a label showing for the first time should flip in. */
export function cascadeArmed(): boolean {
  return now() < Math.max(armedAt, riseAt) + WINDOW_MS && armedAt > Number.NEGATIVE_INFINITY
}

/** When the open screen's boards rise (performance time). */
export function cascadeRiseAt(): number {
  return riseAt
}

/** Run `fn` when a touch or key lands the screen (the flaps and the boards' rise). */
export function onCascadeLand(fn: () => void): () => void {
  listen()
  onLand.add(fn)
  return () => { onLand.delete(fn) }
}
