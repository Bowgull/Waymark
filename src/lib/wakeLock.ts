// Keep the screen on while a round, rest or hold timer runs.
//
// No Capacitor KeepAwake plugin is installed, so this uses the Screen Wake
// Lock API with feature detection (Safari / WKWebView 16.4+; a no-op where
// it is missing). The OS drops the lock when the page is hidden, so it is
// taken again on return to the foreground while still wanted.

import { useEffect } from 'react'

interface WakeLockSentinelLike {
  released: boolean
  release(): Promise<void>
}

interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>
}

function wakeLockApi(): WakeLockLike | null {
  if (typeof navigator === 'undefined') return null
  const wl = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock
  return wl && typeof wl.request === 'function' ? wl : null
}

let holders = 0
let sentinel: WakeLockSentinelLike | null = null
let requesting = false
let listening = false

async function acquire(): Promise<void> {
  const api = wakeLockApi()
  if (!api || requesting || (sentinel && !sentinel.released)) return
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
  requesting = true
  try {
    sentinel = await api.request('screen')
    // Released while the request was in flight: let it go again.
    if (holders === 0) await release()
  } catch {
    sentinel = null // denied (low battery, not visible): try again on next visible
  } finally {
    requesting = false
  }
}

async function release(): Promise<void> {
  const s = sentinel
  sentinel = null
  if (s && !s.released) {
    try {
      await s.release()
    } catch {
      // already gone
    }
  }
}

function onVisibility() {
  if (holders > 0 && document.visibilityState === 'visible') void acquire()
}

/** Hold the screen awake while `active` is true. Several holders share one lock. */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return
    holders += 1
    if (!listening && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility)
      listening = true
    }
    void acquire()
    return () => {
      holders = Math.max(0, holders - 1)
      if (holders === 0) void release()
    }
  }, [active])
}
