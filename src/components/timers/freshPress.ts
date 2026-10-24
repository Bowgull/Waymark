// A double tap mid-workout (a glove bounce, a nervous second press) must not
// land on whatever the first tap just put under the finger: LOG SET's second
// tap pausing the rest, DONE counting the next set, START RUN's second tap
// pausing the run. A press is ignored when another control was pressed a
// moment ago and this one only just appeared (or, on the grass, at all).

/** A second press this soon after another control's is a bounce, not a choice. */
const BOUNCE_MS = 350

const bornAt = new WeakMap<Node, number>()
let lastPress: { at: number; el: Element | null } = { at: -1e9, el: null }
let wired = false

function controlOf(t: EventTarget | null): Element | null {
  return t instanceof Element ? t.closest('button, [role="button"], a') : null
}

/** Born within the bounce window: the control or anything above it was just put in. */
function fresh(el: Element, now: number): boolean {
  for (let n: Node | null = el; n; n = n.parentNode) {
    const b = bornAt.get(n)
    if (b != null && now - b < BOUNCE_MS) return true
  }
  return false
}

/**
 * Once, app-wide: remember each press (capture phase, before React sees it)
 * and swallow a click that lands on a just-appeared control right after
 * another one.
 */
function wire() {
  if (wired || typeof document === 'undefined') return
  wired = true
  document.addEventListener('click', e => {
    const now = performance.now()
    const el = controlOf(e.target)
    if (el && el !== lastPress.el && now - lastPress.at < BOUNCE_MS && fresh(el, now)) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    lastPress = { at: now, el }
  }, { capture: true })
}

/**
 * Watch a session screen: every control put into it is timed, so a bounce onto it can be told
 * apart from a real press. Returns the cleanup.
 */
export function watchFreshControls(root: HTMLElement): () => void {
  wire()
  const now = performance.now()
  bornAt.set(root, now)
  if (typeof MutationObserver === 'undefined') return () => {}
  const mo = new MutationObserver(records => {
    const t = performance.now()
    for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) bornAt.set(n, t)
  })
  mo.observe(root, { childList: true, subtree: true })
  return () => mo.disconnect()
}

/** The grass: a tap right after a press on some other control is that press bouncing. */
export function grassBounce(grass: Element | null): boolean {
  return lastPress.el != null && lastPress.el !== grass && performance.now() - lastPress.at < BOUNCE_MS
}
