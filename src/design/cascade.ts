// The screen-open cascade's switch (page 17): a screen opening arms it, and the
// flap labels that first show while it is armed flip in row by row (FlapLabel).
// It stays armed for a short while so labels that arrive with the screen's data
// still cascade; the first touch or key press after the open disarms it, so a
// label that appears because you did something just flips the normal way.

const WINDOW_MS = 3000

let armedAt = Number.NEGATIVE_INFINITY
let lastScreen: string | null = null
let listening = false

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

function disarm() { armedAt = Number.NEGATIVE_INFINITY }

function listen() {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('pointerdown', disarm, true)
  window.addEventListener('keydown', disarm, true)
}

/** A screen just opened (or a session screen just appeared after its entrance): cascade what shows next. */
export function armCascade(): void {
  listen()
  armedAt = now()
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

/** True while a label showing for the first time should cascade in. */
export function cascadeArmed(): boolean {
  return now() - armedAt < WINDOW_MS
}
