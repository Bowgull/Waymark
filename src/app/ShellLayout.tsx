import { NavLink, Outlet } from 'react-router-dom'
import { ApiHealthDevBadge } from '../components/dev/ApiHealthDevBadge'

function navClass({ isActive }: { isActive: boolean }) {
  return [
    'flex-1 py-3 text-center text-sm font-medium transition-colors',
    isActive ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
  ].join(' ')
}

export function ShellLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="shrink-0 border-b border-zinc-800 px-4 py-3">
        <h1 className="text-lg font-semibold tracking-tight">Waymark</h1>
      </header>
      <main className="min-h-0 flex-1 overflow-auto px-4 py-4">
        <Outlet />
      </main>
      <ApiHealthDevBadge />
      <nav
        className="flex shrink-0 border-t border-zinc-800 bg-zinc-900/90"
        aria-label="Main"
      >
        <NavLink to="/today" className={navClass} end>
          Today
        </NavLink>
        <NavLink to="/history" className={navClass}>
          History
        </NavLink>
        <NavLink to="/settings" className={navClass}>
          Settings
        </NavLink>
      </nav>
    </div>
  )
}
