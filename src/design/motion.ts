import { useSyncExternalStore } from 'react'

// Motion rules (mockups index, "Calm, big moments"): motion reports a change;
// four speeds; split flap runs once and lands within 0.9 s; big moments are
// earned. iOS Reduce Motion: flaps land at once, crossfades only.

const QUERY = '(prefers-reduced-motion: reduce)'

function mediaQuery(): MediaQueryList | null {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null
  } catch {
    return null
  }
}

/** True when iOS (or the OS) asks for reduced motion. Safe outside a browser. */
export function prefersReducedMotion(): boolean {
  return mediaQuery()?.matches ?? false
}

function subscribe(onChange: () => void): () => void {
  const mq = mediaQuery()
  if (!mq) return () => {}
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

/** React hook: re-renders when Reduce Motion is switched. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false)
}
