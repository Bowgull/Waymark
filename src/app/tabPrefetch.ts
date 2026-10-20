// The other tabs' first reads, fetched once Today has settled (page 59 §6
// item 4), so a tab opened for the first time shows its boards with no wait.
// Program's answer also builds the road's wayposts now, while the camera is
// elsewhere, instead of on landing (page 59 §6 item 6).

import { apiFetch } from '../lib/api'
import { getTodayISO } from '../lib/dates'
import { cycleWeeks, programPath } from '../lib/programWeeks'
import { worldWeekPosts } from '../features/program/weekModel'
import { getWorldState, setWorldWeeks } from '../world/worldStore'

export type TabKey = 'today' | 'program' | 'library' | 'history'

/** The tab a path belongs to (null: not a tab, e.g. the redirect at /). */
export function tabForPath(pathname: string): TabKey | null {
  const m = /^\/(today|program|library|history)(\/|$)/.exec(pathname)
  return m ? (m[1] as TabKey) : null
}

interface ProgramRead {
  block: { totalWeeks: number; blockType: string } | null
  weekNumber: number | null
  week: { sessions: Array<{ status: string }> } | null
  pastDone: Record<string, number>
}

/** The paths each tab reads first (the same strings its page asks for). */
export function tabReads(tab: TabKey, today: string): string[] {
  switch (tab) {
    case 'today': return [`/api/sessions/today?date=${today}`, `/api/daily-logs/today?date=${today}`]
    case 'program': return [programPath(today)]
    case 'library': return ['/api/exercises', '/api/combos']
    case 'history': return [`/api/history/ledger?range=week&today=${today}`, `/api/blocks/current?date=${today}`]
  }
}

/** Program's road from its one read: the six wayposts, notched per session done. */
export function roadFromProgram(p: ProgramRead) {
  if (!p.block || p.weekNumber == null) return null
  const cw = p.weekNumber
  const weeks = cycleWeeks(Math.max(1, cw), p.block.totalWeeks, p.block.blockType)
  const counts = new Map(Object.entries(p.pastDone).map(([w, n]) => [Number(w), n]))
  if (p.week) counts.set(cw, p.week.sessions.filter(s => s.status === 'completed').length)
  return worldWeekPosts(weeks, cw, counts)
}

export function prefetchTabs(tabs: ReadonlyArray<TabKey>): void {
  const today = getTodayISO()
  for (const tab of tabs) {
    for (const path of tabReads(tab, today)) {
      const read = apiFetch<unknown>(path, { prefetch: true })
      if (tab === 'program') {
        read.then(p => {
          const road = roadFromProgram(p as ProgramRead)
          // only while Program hasn't drawn its own road
          if (road && getWorldState().weeks == null) setWorldWeeks(road)
        }).catch(() => {})
      } else read.catch(() => {})
    }
  }
}
