import { useEffect, useMemo, useState } from 'react'

import { apiFetch } from '@/lib/api'
import { getTodayISO } from '@/lib/dates'
import { temperatureUnit } from '@/lib/units'

import type { CoachHours } from './plannedHours'
import { weatherForRun, type WhereSession } from './runPlace'
import { useWeather } from './useWeather'

/**
 * Program's runs: the weather at each run's planned hour, from the weather the
 * phone already reads for Today. Only the weather: where he runs is his call.
 * Null where the forecast doesn't reach.
 */
export function useRunWeather(enabled = true): (s: WhereSession) => string | null {
  const weather = useWeather(enabled)
  const [hours, setHours] = useState<CoachHours | null>(null)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    apiFetch<CoachHours>(`/api/coach/hours?today=${getTodayISO()}`).then(h => { if (!cancelled) setHours(h) }).catch(() => {})
    return () => { cancelled = true }
  }, [enabled])
  return useMemo(() => weatherForRun(weather, hours, temperatureUnit()), [weather, hours])
}
