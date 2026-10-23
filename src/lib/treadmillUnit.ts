// The treadmill speed unit he picked in Settings (page 76): KM/H, MPH, or none
// (both show). Read once from /api/settings and remembered on the phone, so
// every speed and pace on Today, Program and the run screen follows it at once.

import { useEffect, useState } from 'react'

import { apiFetch } from './api'
import { parseUnit, type TreadmillUnit } from './runSpeed'
import { getItem, setItem } from './safeStorage'

const KEY = 'waymark_treadmill_unit'
const EVENT = 'waymark:treadmill-unit'

let current: TreadmillUnit = parseUnit(getItem(KEY))
let loaded: Promise<void> | null = null

function publish(u: TreadmillUnit): void {
  current = u
  setItem(KEY, u ?? '')
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT))
}

/** The unit now (the phone's copy). */
export function treadmillUnit(): TreadmillUnit {
  return current
}

function loadOnce(): Promise<void> {
  loaded ??= apiFetch<{ treadmillUnit?: string | null } | null>('/api/settings')
    .then(s => { if (s && 'treadmillUnit' in s) publish(parseUnit(s.treadmillUnit)) })
    .catch(() => { loaded = null })
  return loaded
}

/** Settings' plates: pick one, or null to show both. Saved on the server, shown everywhere at once. */
export async function saveTreadmillUnit(u: TreadmillUnit): Promise<void> {
  publish(u)
  await apiFetch('/api/settings', { method: 'PATCH', body: JSON.stringify({ treadmillUnit: u }) })
}

/** The unit, kept fresh (Settings changes it; another screen follows). */
export function useTreadmillUnit(): TreadmillUnit {
  const [u, setU] = useState<TreadmillUnit>(current)
  useEffect(() => {
    const on = () => setU(current)
    window.addEventListener(EVENT, on)
    void loadOnce().then(on)
    return () => window.removeEventListener(EVENT, on)
  }, [])
  return u
}
