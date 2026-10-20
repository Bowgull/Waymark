import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'

import { FlapLabel, closeAll } from '@/design'
import { TAB_ICON_SRC, type TabKey } from '@/design/tabIcons'
import { useNetworkStatus } from '@/lib/network'
import { onOutboxChange, pendingWrites } from '@/lib/outboxSync'

// The tab bar (page 42, A, approved): the world's places as painted icons.
// Active: full colour, lifted, a soft glow, a small brass light above, a gold
// flap label. Others: dimmed, dim flap labels. The world itself sits behind
// the whole shell (WorldLayer, mounted once in AppRoutes).

const TABS: ReadonlyArray<{ to: string; key: TabKey; label: string; end?: boolean }> = [
  { to: '/today', key: 'today', label: 'TODAY', end: true },
  { to: '/program', key: 'program', label: 'PROGRAM' },
  { to: '/library', key: 'library', label: 'LIBRARY' },
  { to: '/history', key: 'ledger', label: 'LEDGER' },
]

function NavTab({ to, tab, label, end }: { to: string; tab: TabKey; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => `wm-tab${isActive ? ' is-on' : ''}`}
      aria-label={label.toLowerCase()}
      onClick={e => {
        // Tapping the tab you're on (page 61 rule 7): close any open board, back to the top.
        if (!e.currentTarget.classList.contains('is-on')) return
        closeAll()
        document.querySelector('main.waymark-scroll')?.scrollTo({ top: 0, behavior: 'smooth' })
      }}
    >
      {({ isActive }) => (
        <>
          <img src={TAB_ICON_SRC[tab]} width={40} height={40} alt="" draggable={false} decoding="async" />
          <FlapLabel text={label} size="xs" tone={isActive ? 'gold' : 'dim'} animate={false} />
        </>
      )}
    </NavLink>
  )
}

/**
 * Offline (design-decisions "Offline", drawn on page 31 "Offline, mid-session"):
 * a quiet flap, "OFFLINE · 2 SAVED", low on the left; the world rains. Over
 * the tab bar on the tab screens, 70 px off the bottom where there is none.
 */
export function OfflinePill({ overTabs }: { overTabs: boolean }) {
  const online = useNetworkStatus()
  const [saved, setSaved] = useState(() => pendingWrites())
  useEffect(() => onOutboxChange(setSaved), [])
  if (online) return null
  return (
    <div className={`wm-offline-pill${overTabs ? ' is-over-tabs' : ''}`} role="status" aria-live="polite">
      <FlapLabel text={saved > 0 ? `OFFLINE · ${saved} SAVED` : 'OFFLINE'} size="xs" animate={false} />
    </div>
  )
}

export function ShellLayout() {
  return (
    <div className="waymark-preview-root relative z-[1] min-h-dvh text-foreground">
      <div className="waymark-mobile-shell mx-auto flex h-dvh w-full max-w-[430px] flex-col">
        <main className="waymark-scroll min-h-0 flex-1 overflow-auto px-4 pb-4">
          <Outlet />
        </main>
        <nav className="wm-tabs" aria-label="Main">
          {TABS.map(t => <NavTab key={t.key} to={t.to} tab={t.key} label={t.label} end={t.end} />)}
        </nav>
      </div>
    </div>
  )
}
