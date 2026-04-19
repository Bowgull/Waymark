import { useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'

import { SessionBackground } from '@/components/backgrounds/SessionBackground'
import { GoldDivider } from '@/components/ui/GoldDivider'
import { getMarkAsset, getSessionAccent, getSessionLabel } from '@/lib/markAssets'
import { cn } from '@/lib/utils'

interface ProgressSpec {
  /** Number of steps completed so far */
  completed: number
  /** Index of the currently-active step (0-based) */
  active?: number
  /** Total number of steps */
  total: number
}

interface SessionShellProps {
  /** Session engine type — drives accent + mark watermark */
  sessionType: string
  /** Override the top-bar title. Defaults to the session type's brand label. */
  title?: string
  /** Right-side counter string (e.g. "3 of 7", "Round 2", "Rest") */
  counter?: string
  /** Persistent progress bar spec. Omit to hide the progress row. */
  progress?: ProgressSpec
  /**
   * Optional one-line "moment" microcopy. Rendered between the header and
   * the body in muted italic Geist. Short fragments only, period-terminated.
   */
  moment?: string | null
  /** Body content */
  children: ReactNode
  /** Footer content (primary action, skip/replace links). Stuck to the bottom safe-area. */
  footer?: ReactNode
  /** Exit handler for the back button. Defaults to navigate('/today'). */
  onExit?: () => void
  /** Back-button label. Defaults to "Back". */
  exitLabel?: string
  /** Hide the back button entirely (e.g. during irreversible phases). */
  hideExit?: boolean
  /** Body container className override */
  bodyClassName?: string
  /** Skip the default body padding (for timers that center their own layout). */
  noBodyPadding?: boolean
}

/**
 * SessionShell — the shared frame for every guided workout engine.
 *
 * Same frame on every engine:
 *   - Deep-forest ambient bg + mark watermark
 *   - Cinzel top bar (brand label + counter)
 *   - Persistent progress dots
 *   - Optional microcopy moment line
 *   - Footer sticky to the safe-area inset
 *
 * Different per engine: the body. Timers, set inputs, round cards, checklists,
 * journals — each engine owns its body. The shell owns the chrome.
 */
export function SessionShell({
  sessionType,
  title,
  counter,
  progress,
  moment,
  children,
  footer,
  onExit,
  exitLabel = 'Back',
  hideExit = false,
  bodyClassName,
  noBodyPadding = false,
}: SessionShellProps) {
  const navigate = useNavigate()
  const accent = getSessionAccent(sessionType)
  const mark = getMarkAsset(sessionType)
  const resolvedTitle = title ?? getSessionLabel(sessionType)

  function handleExit() {
    if (onExit) onExit()
    else navigate('/today')
  }

  return (
    <div className="relative flex min-h-[100dvh] flex-col bg-near-black text-foreground">
      {/* Ambient */}
      <SessionBackground accentColor={accent} />
      <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
        <img
          src={mark.png}
          alt=""
          width={320}
          height={320}
          className="h-80 w-80 object-contain opacity-[0.035]"
        />
      </div>

      {/* Header */}
      <header
        className="relative z-10 flex shrink-0 items-center justify-between px-4 pb-2"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 0.75rem)' }}
      >
        {hideExit ? (
          <span className="w-12" aria-hidden />
        ) : (
          <button
            onClick={handleExit}
            className="min-h-[44px] -ml-2 px-2 text-sm font-medium text-muted-foreground active:text-teal"
          >
            {exitLabel}
          </button>
        )}
        <h1
          className="font-cinzel text-sm font-semibold uppercase tracking-[0.22em]"
          style={{ color: accent }}
        >
          {resolvedTitle}
        </h1>
        <span
          className="min-w-[3rem] text-right font-cinzel text-xs uppercase tracking-[0.18em]"
          style={{ color: accent, opacity: counter ? 0.7 : 0 }}
        >
          {counter ?? '\u00a0'}
        </span>
      </header>

      {/* Progress dots */}
      {progress && progress.total > 0 && (
        <div className="relative z-10 shrink-0 px-4 pb-3">
          <div className="flex items-center gap-1.5">
            {Array.from({ length: progress.total }).map((_, i) => {
              const state =
                i < progress.completed
                  ? 'done'
                  : i === (progress.active ?? progress.completed)
                    ? 'active'
                    : 'upcoming'
              return (
                <div
                  key={i}
                  className={cn(
                    'h-[3px] flex-1 rounded-full transition-all duration-500',
                    state === 'done' && 'opacity-90',
                    state === 'active' && 'opacity-100',
                    state === 'upcoming' && 'opacity-25',
                  )}
                  style={{
                    backgroundColor:
                      state === 'upcoming' ? 'var(--color-border)' : accent,
                    boxShadow:
                      state === 'active'
                        ? `0 0 8px ${accent}60`
                        : undefined,
                  }}
                />
              )
            })}
          </div>
        </div>
      )}

      <GoldDivider className="relative z-10 shrink-0" />

      {/* Moment line */}
      {moment && (
        <div className="relative z-10 shrink-0 px-5 pt-3">
          <p className="font-body text-[13px] italic leading-relaxed text-muted-foreground/80">
            {moment}
          </p>
        </div>
      )}

      {/* Body */}
      <main
        className={cn(
          'relative z-10 flex-1 overflow-auto',
          !noBodyPadding && 'px-4 py-4',
          bodyClassName,
        )}
      >
        {children}
      </main>

      {/* Footer */}
      {footer && (
        <footer
          className="relative z-10 shrink-0 border-t border-gold/10 bg-near-black/70 px-4 pt-3 backdrop-blur-sm"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)' }}
        >
          {footer}
        </footer>
      )}
    </div>
  )
}
