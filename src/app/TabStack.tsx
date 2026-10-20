import { Activity, startTransition, useContext, useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react'
import { Outlet, UNSAFE_LocationContext, useLocation } from 'react-router-dom'

import { ErrorBoundary } from '../components/ui/ErrorBoundary'
import { arrivePane, riseDelayMs, sinkPane, SWITCH } from '../design/choreography'
import { useReducedMotion } from '../design/motion'
import { HistoryPage } from '../features/history/HistoryPage'
import { LibraryPage } from '../features/library/LibraryPage'
import { ProgramPage } from '../features/program/ProgramPage'
import { TodayPage } from '../features/today/TodayPage'
import { SPLASH_LEAVING_EVENT } from '../world/splashSkip'
import { prefetchTabs, tabForPath, type TabKey } from './tabPrefetch'

// The four tabs stay alive (page 59 §6 item 4): each tab's page is kept,
// hidden, once visited (React's <Activity>), with its state, its scroll and its
// data, so coming back shows real boards at once and refreshes in the
// background. A hidden tab's effects are paused and it keeps the location it
// last had, so it never reacts to another tab's route.
//
// The switch is option A, "World first" (design/choreography.ts): the old
// boards sink, the camera glides, then the new boards rise and flip in.

const TABS: ReadonlyArray<{ key: TabKey; page: ComponentType }> = [
  { key: 'today', page: TodayPage },
  { key: 'program', page: ProgramPage },
  { key: 'library', page: LibraryPage },
  { key: 'history', page: HistoryPage },
]

/** The first open: the clearing shows on its own, then Today's boards rise. */
const FIRST_RISE_MS = 600
/** The splash lifting (page 38 A): Today's boards rise into the fading crest. */
const AFTER_SPLASH_RISE_MS = 250
/** Once Today has settled this long, the other tabs' first reads are fetched. */
const PREFETCH_AFTER_MS = 2500

type LocationValue = React.ContextType<typeof UNSAFE_LocationContext>

const worldShown = () => typeof document !== 'undefined' && document.querySelector('.wm-world.is-ready') != null
const scroller = () => document.querySelector<HTMLElement>('main.waymark-scroll')

export function TabStack() {
  const location = useLocation()
  const live = useContext(UNSAFE_LocationContext)
  const active = tabForPath(location.pathname)
  const reduced = useReducedMotion()
  const [shown, setShown] = useState<TabKey | null>(active)
  const [visited, setVisited] = useState<ReadonlySet<TabKey>>(() => new Set(active ? [active] : []))
  // Each tab's location: live while it is the tab, frozen at its last one otherwise.
  const [frozen, setFrozen] = useState<Partial<Record<TabKey, LocationValue>>>({})
  if (active && frozen[active] !== live) setFrozen(f => ({ ...f, [active]: live }))
  if (shown && !visited.has(shown)) setVisited(v => new Set(v).add(shown))

  const panes = useRef(new Map<TabKey, HTMLElement>())
  const scrolls = useRef(new Map<TabKey, number>())
  const tapAt = useRef(0)
  const land = useRef<(() => void) | null>(null)
  const firstArrival = useRef(true)
  const reducedRef = useRef(reduced)
  useEffect(() => { reducedRef.current = reduced }, [reduced])

  // A tab tapped: the old boards sink (140 ms), then the new tab is shown.
  useLayoutEffect(() => {
    if (!active || active === shown) return
    tapAt.current = performance.now()
    land.current?.()
    const old = shown ? panes.current.get(shown) : null
    const main = scroller()
    if (shown && main) scrolls.current.set(shown, main.scrollTop)
    const go = () => startTransition(() => setShown(active))
    const sink = old ? sinkPane(old, reduced) : null
    if (!sink) { go(); return }
    const t = window.setTimeout(go, SWITCH.sinkMs)
    return () => { window.clearTimeout(t); sink.cancel() }
  }, [active, shown, reduced])

  // The shown tab arrives: its scroll back, then its boards rise and flip in.
  useLayoutEffect(() => {
    if (!shown) return
    const pane = panes.current.get(shown)
    if (!pane) return
    const main = scroller()
    if (main) main.scrollTop = scrolls.current.get(shown) ?? 0
    const first = firstArrival.current
    firstArrival.current = false
    const riseAt = first ? performance.now() + FIRST_RISE_MS : tapAt.current + riseDelayMs(worldShown())
    land.current = arrivePane(pane, { riseAt, reduced: reducedRef.current, replay: !first })
    return () => { land.current?.(); land.current = null }
  }, [shown])

  // The splash lifting: Today's boards rise again into it (they rose unseen behind the crest).
  useEffect(() => {
    const onSplash = () => {
      const pane = shown ? panes.current.get(shown) : null
      if (!pane) return
      land.current?.()
      land.current = arrivePane(pane, { riseAt: performance.now() + AFTER_SPLASH_RISE_MS, reduced: reducedRef.current, replay: true })
    }
    window.addEventListener(SPLASH_LEAVING_EVENT, onSplash)
    return () => window.removeEventListener(SPLASH_LEAVING_EVENT, onSplash)
  }, [shown])

  // Once the first tab has settled, fetch the others' first reads in the background.
  const prefetched = useRef(false)
  useEffect(() => {
    if (prefetched.current || !shown) return
    const t = window.setTimeout(() => {
      prefetched.current = true
      prefetchTabs(TABS.map(t => t.key).filter(k => k !== shown))
    }, PREFETCH_AFTER_MS)
    return () => window.clearTimeout(t)
  }, [shown])

  return (
    <>
      {TABS.filter(t => visited.has(t.key) || t.key === shown).map(({ key, page: Page }) => (
        <Activity key={key} mode={key === shown ? 'visible' : 'hidden'}>
          <UNSAFE_LocationContext.Provider value={(key === active ? live : frozen[key]) ?? live}>
            <div
              className="wm-pane"
              data-tab-pane={key}
              ref={el => { if (el) panes.current.set(key, el); else panes.current.delete(key) }}
            >
              <ErrorBoundary level="page"><Page /></ErrorBoundary>
            </div>
          </UNSAFE_LocationContext.Provider>
        </Activity>
      ))}
      {/* the redirects (/ and unknown paths) */}
      <Outlet />
    </>
  )
}
