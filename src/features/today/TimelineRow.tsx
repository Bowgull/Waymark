import { getMarkAsset } from '@/lib/markAssets'
import { getEstimatedMin } from '@/lib/weeklyTemplate'
import { Button } from '@/components/ui/button'
import { tapHaptic } from '@/lib/haptics'

interface Session {
  id: string
  type: string
  timeSlot: string | null
  status: string
  startedAt: number | null
  completedAt: number | null
  durationSec: number | null
  rpe: number | null
}

interface TimelineRowProps {
  session: Session
  onStart: (id: string) => void
  onSkip: (id: string) => void
  expanded: boolean
  onToggle: () => void
  label: string
}

function formatDuration(sec: number): string {
  const min = Math.round(sec / 60)
  return `${min}min`
}

function statusBorderColor(status: string): string {
  switch (status) {
    case 'completed': return 'border-l-gold'
    case 'in_progress': return 'border-l-teal'
    case 'skipped': return 'border-l-muted-foreground/30'
    default: return 'border-l-border'
  }
}

function statusBg(status: string): string {
  switch (status) {
    case 'completed': return 'bg-surface/40'
    case 'in_progress': return 'bg-teal/5'
    default: return 'bg-transparent'
  }
}

export function TimelineRow({ session, onStart, onSkip, expanded, onToggle, label }: TimelineRowProps) {
  const mark = getMarkAsset(session.type)
  const estMin = getEstimatedMin(session.type)
  const isActionable = session.status === 'planned' || session.status === 'in_progress'
  const isCompleted = session.status === 'completed'
  const isSkipped = session.status === 'skipped'

  return (
    <div
      className={`border-l-[3px] ${statusBorderColor(session.status)} ${statusBg(session.status)} transition-colors`}
    >
      {/* Collapsed row — always visible */}
      <button
        type="button"
        className="flex w-full items-center gap-3 px-3 py-3 text-left active:bg-surface/20"
        onClick={() => {
          tapHaptic()
          onToggle()
        }}
      >
        <img
          src={mark.png}
          alt=""
          className={`h-4 w-4 object-contain ${isSkipped ? 'opacity-30 saturate-0' : isCompleted ? 'opacity-80' : 'opacity-60'}`}
        />
        <div className="flex-1 min-w-0">
          <span className={`text-sm font-semibold ${isSkipped ? 'text-muted-foreground/50 line-through' : isCompleted ? 'text-foreground/80' : 'text-foreground'}`}>
            {label}
          </span>
          {isCompleted && session.rpe != null && (
            <span className="ml-2 text-xs text-muted-foreground">
              RPE {session.rpe}
            </span>
          )}
        </div>
        <span className={`text-xs tabular-nums ${isCompleted ? 'text-gold/70' : 'text-muted-foreground'}`}>
          {isCompleted && session.durationSec
            ? formatDuration(session.durationSec)
            : isSkipped
            ? 'Passed'
            : `~${estMin}min`}
        </span>
        <svg
          className={`h-3.5 w-3.5 text-muted-foreground/50 transition-transform ${expanded ? 'rotate-90' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="animate-fade-in px-3 pb-3 pl-10">
          {isActionable && (
            <div className="flex items-center gap-3 pt-1">
              <Button
                size="sm"
                onClick={() => onStart(session.id)}
              >
                {session.status === 'in_progress' ? 'Resume' : 'Enter'}
              </Button>
              {session.status === 'planned' && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground active:text-foreground"
                  onClick={() => onSkip(session.id)}
                >
                  Pass
                </button>
              )}
            </div>
          )}
          {isCompleted && (
            <div className="flex gap-4 pt-1 text-xs text-muted-foreground">
              {session.durationSec != null && (
                <span>Duration: {formatDuration(session.durationSec)}</span>
              )}
              {session.rpe != null && (
                <span>RPE: {session.rpe}/10</span>
              )}
            </div>
          )}
          {isSkipped && (
            <p className="pt-1 text-xs text-muted-foreground/50">Session passed</p>
          )}
        </div>
      )}
    </div>
  )
}
