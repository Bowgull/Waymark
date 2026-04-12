import { NavLink, Outlet } from 'react-router-dom'
import { ApiHealthDevBadge } from '../components/dev/ApiHealthDevBadge'
import { HistoryIcon, LibraryIcon, ProgramIcon, SettingsIcon, TodayIcon } from '../components/icons/NavIcons'
import logoPng from '@/assets/brand/Logo.png'

/** Stylized W with winged serif tips — gold brand mark */
function BrandW() {
  return (
    <svg
      width="20"
      height="17"
      viewBox="0 0 40 34"
      fill="#E8C860"
      xmlns="http://www.w3.org/2000/svg"
      className="relative -mr-0.5"
      style={{ top: '1px' }}
      aria-hidden="true"
    >
      {/* Solid W letterform with angular serifs */}
      <path d="
        M0 3 L1.5 0 L7 3
        L7 5 L14 30 L20 12 L26 30 L33 5 L33 3
        L38.5 0 L40 3
        L38 5 L30 32 L26 32 L20 16 L14 32 L10 32 L2 5
        Z
      " />
    </svg>
  )
}

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
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="shrink-0 border-b border-border px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <div className="flex items-center gap-1.5">
          <img src={logoPng} alt="" className="h-6 w-6 object-contain" />
          <h1 className="flex items-baseline gap-0 text-display-sm tracking-tight text-foreground">
            <BrandW />
            <span>aymark</span>
          </h1>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-auto px-4 py-4">
        <Outlet />
      </main>
      <ApiHealthDevBadge />
      <nav
        className="relative flex shrink-0 border-t border-border bg-near-black/90"
        aria-label="Main"
      >
        <NavTab to="/today" label="Today" icon={<TodayIcon />} end />
        <NavTab to="/program" label="Program" icon={<ProgramIcon />} />
        <NavTab to="/library" label="Library" icon={<LibraryIcon />} />
        <NavTab to="/history" label="Ledger" icon={<HistoryIcon />} />
        <NavTab to="/settings" label="Settings" icon={<SettingsIcon />} />
      </nav>
    </div>
  )
}
