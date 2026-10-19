// The raven and the injury weather on the phone (page 58, approved
// 2026-10-19). One small store for the whole app: Today reads the raven and
// its boards, Program its week line, the check-in its "<Place> today" card,
// and the world its weather (over Today, the Program road, the Ledger pond
// and the Library arch; Settings has no world). GET /api/body/watch runs the
// morning pass on the server; the answers go to POST /api/body/watch/:id/*.

import { useEffect, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'

import { apiFetch } from '@/lib/api'
import { getTodayISO } from '@/lib/dates'
import type { AskView, BodyRegion, BodyStage, BoardView } from '@/lib/coach/bodyWatch'
import { setWorldWeather } from '@/world/worldStore'
import type { WorldWeather } from '@/world/weather'

export type RavenPose = 'watch' | 'held' | 'settled' | 'leave'

export interface BodyWatchViewIn {
  id: string
  region: BodyRegion
  place: string
  stage: BodyStage
  seen: boolean
  weather: WorldWeather
  raven: RavenPose | null
  arrivedOn: number
  line: { text: string; settled: boolean } | null
  askDue: boolean
  ask: AskView | null
  board: BoardView | null
  programLine: string | null
  planDays: [number, number] | null
}

export interface BodyWatchIn {
  alert: BodyWatchViewIn | null
  weather: WorldWeather
  checkIn: Array<{ region: BodyRegion; label: string }>
}

let payload: BodyWatchIn | null = null
let inflight: Promise<BodyWatchIn | null> | null = null
const listeners = new Set<() => void>()

function set(next: BodyWatchIn | null) {
  payload = next
  // Offline (nothing came back): the last weather stays; the grey rain shows on top of it.
  if (next) setWorldWeather(next.weather)
  for (const l of listeners) l()
}

export function getBodyWatch(): BodyWatchIn | null {
  return payload
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

/** Read the watch again (the server runs its morning pass first). */
export function refreshBodyWatch(): Promise<BodyWatchIn | null> {
  inflight ??= apiFetch<BodyWatchIn>(`/api/body/watch?today=${getTodayISO()}`, { timeoutMs: 8000 })
    .then(p => { set(p); return p })
    .catch(() => payload)
    .finally(() => { inflight = null })
  return inflight
}

export type BodyAction =
  | { kind: 'apply' }
  | { kind: 'got' }
  | { kind: 'seen' }
  | { kind: 'answer'; answer: 'better' | 'sore' | 'not_now' }

/** One answer to the raven. Resolves with the pop-up's words (DO IT, FEELS BETTER) or null. */
export async function bodyAct(id: string, action: BodyAction): Promise<{ title: string; text: string } | null> {
  const path = action.kind === 'answer' ? 'answer' : action.kind
  const out = await apiFetch<{ ok: boolean; toast: { title: string; text: string } | null }>(`/api/body/watch/${encodeURIComponent(id)}/${path}`, {
    method: 'POST',
    body: JSON.stringify({ today: getTodayISO(), ...(action.kind === 'answer' ? { answer: action.answer } : {}) }),
  })
  await refreshBodyWatch()
  return out?.toast ?? null
}

export function useBodyWatch(): BodyWatchIn | null {
  return useSyncExternalStore(subscribe, getBodyWatch, () => null)
}

const WORLD_ROUTES = /^\/(today|program|library|history)?(\/|$)/

/** Keeps the watch fresh: on open, on each world tab, and back in the app. Renders nothing. */
export function BodyWatchSync() {
  const { pathname } = useLocation()
  useEffect(() => {
    if (WORLD_ROUTES.test(pathname)) void refreshBodyWatch()
  }, [pathname])
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') void refreshBodyWatch() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])
  return null
}
