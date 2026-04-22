import { NavLink, Outlet } from 'react-router-dom'
import { OfflineBanner } from '../components/ui/OfflineBanner'
import { HistoryIcon, LibraryIcon, ProgramIcon, TodayIcon } from '../components/icons/NavIcons'

function NavTab({ to, label, icon, end }: { to: string; label: string; icon: React.ReactNode; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex flex-1 flex-col items-center gap-0.5 pb-[env(safe-area-inset-bottom)] pt-2 text-label transition-colors ${
          isActive ? 'text-gold' : 'text-muted-foreground'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <div className="absolute top-0 h-0.5 w-8 bg-gold" />}
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
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <OfflineBanner />
      <main className="min-h-0 flex-1 overflow-auto px-4 pb-4">
        <Outlet />
      </main>
      {/* <ApiHealthDevBadge /> */}
      <nav
        className="sticky bottom-0 z-30 flex shrink-0 border-t border-gold/10 bg-nav/90 backdrop-blur-md"
        aria-label="Main"
      >
        <NavTab to="/today" label="Today" icon={<TodayIcon />} end />
        <NavTab to="/program" label="Program" icon={<ProgramIcon />} />
        <NavTab to="/library" label="Library" icon={<LibraryIcon />} />
        <NavTab to="/history" label="Ledger" icon={<HistoryIcon />} />
      </nav>
    </div>
  )
}
