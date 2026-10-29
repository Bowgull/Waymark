import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'
import { useEffect, useState } from 'react'

import { getItem, setItem } from '@/lib/safeStorage'

import { loadWeather, type Weather } from './weatherData'

/** Fresh on opening Today, then every 5 minutes while it shows (page 72). Nothing in the background. */
export const WEATHER_REFRESH_MS = 5 * 60_000

const LOC_KEY = 'waymark_wx_loc'
const DENIED_KEY = 'waymark_wx_denied'

/** About 1 km: two decimals. Nothing finer leaves the phone. */
export function roundLoc(v: number): number {
  return Math.round(v * 100) / 100
}

function cachedLoc(): { lat: number; lon: number } | null {
  try {
    const v = JSON.parse(getItem(LOC_KEY) ?? 'null') as { lat?: unknown; lon?: unknown } | null
    return v && typeof v.lat === 'number' && typeof v.lon === 'number' ? { lat: v.lat, lon: v.lon } : null
  } catch {
    return null
  }
}

const LOC_OPTIONS = { enableHighAccuracy: false, maximumAge: 30 * 60_000, timeout: 10_000 }

function keepLoc(lat: number, lon: number): { lat: number; lon: number } {
  const loc = { lat: roundLoc(lat), lon: roundLoc(lon) }
  setItem(LOC_KEY, JSON.stringify(loc))
  return loc
}

/**
 * In the app, iOS itself asks, once: it remembers the answer. The web view's
 * own ask (navigator.geolocation) forgot it on every launch.
 */
async function nativeLoc(): Promise<{ lat: number; lon: number } | null> {
  try {
    let state = (await Geolocation.checkPermissions()).location
    if (state === 'prompt' || state === 'prompt-with-rationale') state = (await Geolocation.requestPermissions({ permissions: ['location'] })).location
    if (state !== 'granted') return null
    const p = await Geolocation.getCurrentPosition(LOC_OPTIONS)
    return keepLoc(p.coords.latitude, p.coords.longitude)
  } catch {
    return null
  }
}

/** The phone's location, asked once; null when there is none. */
function phoneLoc(): Promise<{ lat: number; lon: number } | null> {
  if (Capacitor.isNativePlatform()) return nativeLoc()
  if (getItem(DENIED_KEY) === '1' || typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null)
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      p => resolve(keepLoc(p.coords.latitude, p.coords.longitude)),
      e => {
        if (e.code === 1) setItem(DENIED_KEY, '1')
        resolve(null)
      },
      LOC_OPTIONS,
    )
  })
}

/**
 * Today's weather (page 72), or null: no location or no signal, and the strip
 * hides. Read when Today opens, then every 5 minutes while the page shows.
 */
export function useWeather(enabled = true): Weather | null {
  const [weather, setWeather] = useState<Weather | null>(null)
  useEffect(() => {
    if (!enabled) return
    let stopped = false
    let ctrl: AbortController | null = null
    const read = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      ctrl?.abort()
      ctrl = new AbortController()
      const loc = (await phoneLoc()) ?? cachedLoc()
      if (stopped) return
      if (!loc) { setWeather(null); return }
      const w = await loadWeather(loc.lat, loc.lon, ctrl.signal).catch(() => null)
      if (!stopped) setWeather(w)
    }
    void read()
    const t = window.setInterval(() => { void read() }, WEATHER_REFRESH_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void read() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      ctrl?.abort()
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled])
  return weather
}
