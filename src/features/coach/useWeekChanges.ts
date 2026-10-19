import { useCallback, useEffect, useState } from 'react'

import { apiFetch } from '@/lib/api'
import { getTodayISO } from '@/lib/dates'

import type { WeekChangesIn } from './changeView'

function isoOf(epochDay: number): string {
  return new Date(epochDay * 86400000).toISOString().slice(0, 10)
}

/**
 * The week's changes and runes (GET /api/weeks/:monday/changes), with the day's
 * back actions: mark seen (the rune dims) and UNDO. `monday` is an epoch day;
 * null waits. `version` re-reads after his own change.
 */
export function useWeekChanges(monday: number | null, version = 0) {
  const [week, setWeek] = useState<WeekChangesIn | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (monday == null) return
    let cancelled = false
    apiFetch<WeekChangesIn>(`/api/weeks/${isoOf(monday)}/changes?today=${getTodayISO()}`)
      .then(w => { if (!cancelled) setWeek(w) })
      .catch(() => { if (!cancelled) setWeek(null) })
    return () => { cancelled = true }
  }, [monday, version, tick])

  const refresh = useCallback(() => setTick(t => t + 1), [])

  /** The day's back opened: its changes are seen; the runes dim at once. */
  const markSeen = useCallback((ids: string[]) => {
    const fresh = ids.filter(id => week?.changes.some(c => c.id === id && (c.rune === 'new' || c.rune === 'miss')))
    if (fresh.length === 0) return
    setWeek(prev => prev && ({
      changes: prev.changes.map(c => (fresh.includes(c.id) ? { ...c, rune: c.rune === 'miss' ? 'missseen' : c.rune === 'new' ? 'seen' : c.rune } : c)),
      runes: Object.fromEntries(Object.entries(prev.runes).map(([d, r]) => {
        const left = prev.changes.filter(c => String(c.day) === d && c.rune && !fresh.includes(c.id)).map(c => c.rune)
        if (r === 'miss' && !left.includes('miss')) return [d, left.includes('new') ? 'new' : 'missseen']
        if (r === 'new' && !left.includes('new')) return [d, prev.changes.some(c => String(c.day) === d && c.kind === 'missed' && c.rune) ? 'missseen' : 'seen']
        return [d, r]
      })),
    }))
    apiFetch('/api/changes/seen', { method: 'POST', body: JSON.stringify({ ids: fresh }) }).catch(() => {})
  }, [week])

  /** UNDO: one tap, no "are you sure". Resolves true when it was put back. */
  const undo = useCallback(async (id: string): Promise<boolean> => {
    try {
      await apiFetch(`/api/changes/${id}/undo`, { method: 'POST', body: JSON.stringify({ today: getTodayISO() }) })
      setTick(t => t + 1)
      return true
    } catch {
      setTick(t => t + 1)
      return false
    }
  }, [])

  return { week, refresh, markSeen, undo }
}
