import { getMarkAsset } from '@/lib/markAssets'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getEstimatedMin, getSessionLabel, getTypeAccentColor } from '@/lib/weeklyTemplate'

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

interface SessionCardProps {
  session: Session
  onStart: (id: string) => void
  onSkip: (id: string) => void
  index: number
}

function formatDuration(sec: number): string {
  const min = Math.round(sec / 60)
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h ${min % 60}m`
}

export function SessionCard({ session, onStart, onSkip, index }: SessionCardProps) {
  const accent = getTypeAccentColor(session.type)
  const label = getSessionLabel(session.type, new Date().getDay())
  const estMin = getEstimatedMin(session.type)
  const isCompleted = session.status === 'completed'
  const isSkipped = session.status === 'skipped'
  const isPlanned = session.status === 'planned'
  const isInProgress = session.status === 'in_progress'

  return (
    <div
      className={`animate-fade-in-up rounded-xl border border-border border-l-4 bg-card p-4 transition-all ${accent} ${
        isSkipped ? 'opacity-40' : ''
      } ${isInProgress ? 'ring-1 ring-teal/30' : ''}`}
      style={{ animationDelay: `${index * 80}ms` }}
    >
      {/* Top row */}
      <div className="mb-2 flex items-center justify-between">
        {session.timeSlot && (
          <Badge variant={session.timeSlot === 'am' ? 'inscription-gold' : 'inscription-teal'}>
            {session.timeSlot === 'am' ? 'AM' : 'PM'}
          </Badge>
        )}
        {isInProgress && (
          <Badge variant="teal" className="gap-1">
            <span className="inline-block h-1.5 w-1.5 animate-pulse-glow rounded-full bg-teal" />
            In Progress
          </Badge>
        )}
        {isCompleted && <Badge variant="forest">Done</Badge>}
        {isSkipped && <Badge variant="muted">Skipped</Badge>}
      </div>

      {/* Session name with icon */}
      <h3
        className={`flex items-center gap-2 text-lg font-semibold ${
          isSkipped ? 'text-muted-foreground line-through' : 'text-foreground'
        }`}
      >
        <img
          src={getMarkAsset(session.type).png}
          alt=""
          className={`h-7 w-7 shrink-0 object-contain ${
            isSkipped ? 'opacity-20 saturate-0' : ''
          }`}
        />
        {label}
      </h3>

      {/* Bottom row */}
      <div className="mt-3 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {isCompleted && session.durationSec
            ? formatDuration(session.durationSec)
            : `~${estMin} min`}
          {isCompleted && session.rpe != null && (
            <span className="ml-2 text-muted-foreground">RPE {session.rpe}</span>
          )}
        </p>

        {isPlanned && (
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onSkip(session.id)}>
              Skip
            </Button>
            <Button size="sm" onClick={() => onStart(session.id)}>
              Start
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
