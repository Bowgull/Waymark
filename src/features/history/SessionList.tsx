import { getSessionLabel } from '@/lib/weeklyTemplate'

interface Session {
  id: string
  type: string
  status: string
  completedAt: number | null
  durationSec: number | null
  rpe: number | null
  scheduledDate: number | null
}

interface SessionListProps {
  sessions: Session[]
}

function formatDate(epochSec: number): string {
  const d = new Date(epochSec * 1000)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatDuration(sec: number): string {
  const min = Math.round(sec / 60)
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${min % 60}m`
}

function RpeBadge({ rpe }: { rpe: number }) {
  const color = rpe <= 3 ? 'text-forest-light' : rpe <= 6 ? 'text-gold' : 'text-clay'
  return <span className={`text-xs font-medium ${color}`}>RPE {rpe}</span>
}

export function SessionList({ sessions }: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No completed sessions yet. Get after it.
      </p>
    )
  }

  return (
    <div>
      <p className="text-display-sm mb-3 text-foreground">Recent Sessions</p>
      <div className="space-y-2">
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`flex items-center justify-between border border-border bg-card p-3 ${
              s.status === 'skipped' ? 'opacity-50' : ''
            }`}
          >
            <div>
              <p className={`text-sm font-medium ${s.status === 'skipped' ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                {getSessionLabel(s.type)}
              </p>
              <p className="text-xs text-muted-foreground">
                {s.completedAt ? formatDate(s.completedAt) : s.scheduledDate ? formatDate(s.scheduledDate * 86400) : '—'}
                {s.durationSec ? ` \u00B7 ${formatDuration(s.durationSec)}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {s.rpe != null && <RpeBadge rpe={s.rpe} />}
              {s.status === 'skipped' && (
                <span className="bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">Passed</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
