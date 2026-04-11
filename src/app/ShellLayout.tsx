import { NavLink, Outlet } from 'react-router-dom'
import { ApiHealthDevBadge } from '../components/dev/ApiHealthDevBadge'
import { HistoryIcon, LibraryIcon, ProgramIcon, SettingsIcon, TodayIcon } from '../components/icons/NavIcons'

function NavTab({ to, label, icon, end }: { to: string; label: string; icon: React.ReactNode; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex flex-1 flex-col items-center gap-0.5 pb-[env(safe-area-inset-bottom)] pt-2 text-[10px] font-medium transition-colors ${
          isActive ? 'text-[#E8C860]' : 'text-zinc-500'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <div className="absolute top-0 h-0.5 w-8 rounded-b bg-[#E8C860]" />}
          <div className="relative">
            {icon}
          </div>
          <span>{label}</span>
        </>
      )}
    </NavLink>
  )
}

export function ShellLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="shrink-0 border-b border-zinc-800 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <h1 className="text-lg font-semibold tracking-tight">
          <span className="text-[#E8C860]">W</span>aymark
        </h1>
      </header>
      <main className="min-h-0 flex-1 overflow-auto px-4 py-4">
        <Outlet />
      </main>
      <ApiHealthDevBadge />
      <nav
        className="relative flex shrink-0 border-t border-zinc-800 bg-zinc-900/90"
        aria-label="Main"
      >
        <NavTab to="/today" label="Today" icon={<TodayIcon />} end />
        <NavTab to="/program" label="Program" icon={<ProgramIcon />} />
        <NavTab to="/library" label="Library" icon={<LibraryIcon />} />
        <NavTab to="/history" label="History" icon={<HistoryIcon />} />
        <NavTab to="/settings" label="Settings" icon={<SettingsIcon />} />
      </nav>
    </div>
  )
}
