import { useEffect, useMemo, useState } from 'react'

import { apiFetch } from '@/lib/api'
import { getTodayISO } from '@/lib/dates'
import { temperatureUnit } from '@/lib/units'

import type { CoachHours } from './plannedHours'
import { whereForRun, type RunPlace, type WhereSession } from './runPlace'
import { useWeather } from './useWeather'

/**
 * Program's runs (page 76 §2): inside or outside at each run's planned hour,
 * from the weather the phone already reads for Today. Null where the forecast
 * doesn't reach (no WHERE line then).
 */
export function useRunWhere(enabled = true): (s: WhereSession) => RunPlace | null {
  const weather = useWeather(enabled)
  const [hours, setHours] = useState<CoachHours | null>(null)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    apiFetch<CoachHours>(`/api/coach/hours?today=${getTodayISO()}`).then(h => { if (!cancelled) setHours(h) }).catch(() => {})
    return () => { cancelled = true }
  }, [enabled])
  return useMemo(() => whereForRun(weather, hours, temperatureUnit()), [weather, hours])
}
