import { NavLink, Outlet } from 'react-router-dom'
import { OfflineBanner } from '../components/ui/OfflineBanner'
import { HistoryIcon, LibraryIcon, ProgramIcon, TodayIcon } from '../components/icons/NavIcons'
import { TourProvider } from '../components/tour/TourProvider'
import { TourButton } from '../components/tour/TourButton'

function NavTab({ to, label, icon, end }: { to: string; label: string; icon: React.ReactNode; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `relative flex flex-1 flex-col items-center justify-center gap-0.5 pb-[max(env(safe-area-inset-bottom),0.375rem)] pt-2 text-label transition-colors ${
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
    <TourProvider>
      <div className="waymark-preview-root min-h-dvh bg-background text-foreground">
        <div className="waymark-mobile-shell mx-auto flex h-dvh w-full max-w-[430px] flex-col bg-background">
          <OfflineBanner />
          <TourButton />
          <main className="waymark-scroll min-h-0 flex-1 overflow-auto px-4 pb-4">
            <Outlet />
          </main>
          {/* <ApiHealthDevBadge /> */}
          <nav
            className="z-30 flex min-h-[64px] shrink-0 border-t border-gold/10 bg-nav/90 backdrop-blur-md"
            aria-label="Main"
          >
            <NavTab to="/today" label="Today" icon={<TodayIcon />} end />
            <NavTab to="/program" label="Program" icon={<ProgramIcon />} />
            <NavTab to="/library" label="Library" icon={<LibraryIcon />} />
            <NavTab to="/history" label="Ledger" icon={<HistoryIcon />} />
          </nav>
        </div>
      </div>
    </TourProvider>
  )
}
