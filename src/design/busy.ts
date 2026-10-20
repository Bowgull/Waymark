// "The UI is moving": the flap engine and the tab choreography mark it while
// they run; the world's quality ladder reads it so a busy main thread during a
// switch never costs the forest its sharpness (page 59 §6 item 6). Pure and
// tiny, so the world's own chunk shares this one copy with the app.

let until = 0

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** Something is animating for at least the next `ms`. */
export function markBusy(ms = 250): void {
  until = Math.max(until, now() + ms)
}

/** True while the UI said it is moving. */
export function motionBusy(at: number = now()): boolean {
  return at < until
}
