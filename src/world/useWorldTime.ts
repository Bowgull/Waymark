import { useEffect, useState, useSyncExternalStore } from 'react'

import { getItem, setItem } from '@/lib/safeStorage'
import { TIME_OVERRIDE_EVENT, TIME_OVERRIDE_KEY, msUntilNextChange, parseOverride, resolveMode, type TimeOverride, type WorldMode } from './timeOfDay'

// The Settings time-of-day override is a look on this phone, so it lives in
// local storage (no server setting needed).

export function getTimeOverride(): TimeOverride {
  return parseOverride(getItem(TIME_OVERRIDE_KEY))
}

export function setTimeOverride(value: TimeOverride): void {
  setItem(TIME_OVERRIDE_KEY, value)
  window.dispatchEvent(new Event(TIME_OVERRIDE_EVENT))
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(TIME_OVERRIDE_EVENT, cb)
  window.addEventListener('storage', cb)
  return () => { window.removeEventListener(TIME_OVERRIDE_EVENT, cb); window.removeEventListener('storage', cb) }
}

export function useTimeOverride(): TimeOverride {
  return useSyncExternalStore(subscribe, getTimeOverride, () => 'clock' as TimeOverride)
}

/** The world's light now: the override, or the clock (re-checked when the hour band changes and on return to the app). */
export function useWorldMode(): WorldMode {
  const override = useTimeOverride()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (override !== 'clock') return
    let timer = window.setTimeout(function tick() { setNow(new Date()); timer = window.setTimeout(tick, msUntilNextChange(new Date()) + 500) }, msUntilNextChange(new Date()) + 500)
    const onVis = () => { if (document.visibilityState === 'visible') setNow(new Date()) }
    document.addEventListener('visibilitychange', onVis)
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVis) }
  }, [override])
  return resolveMode(override, now)
}
