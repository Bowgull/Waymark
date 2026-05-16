import { getSessionLabel } from '@/lib/weeklyTemplate'

interface Session {
  id: string
  type: string
  status: string
  completedAt: number | null
  durationSec: number | null
  rpe: number | null
  scheduledDate: number | null
  review: string | null
  reviewFlag: string | null
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

function reviewFlagLabel(flag: string | null): string | null {
  switch (flag) {
    case 'intensity_mismatch':
      return 'Heart ran high'
    case 'wellness_concern':
      return 'Watch'
    case 'form_note':
      return 'Form'
    case 'pr_hit':
      return 'Mark'
    default:
      return null
  }
}

export function SessionList({ sessions }: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No completed sessions yet.
      </p>
    )
  }

  return (
    <div>
      <div className="space-y-2">
        {sessions.map((s) => {
          const flagLabel = reviewFlagLabel(s.reviewFlag)
          return (
            <div
              key={s.id}
              className={`flex items-start justify-between rounded-md border border-border bg-card p-3 ${
                s.status === 'skipped' || s.status === 'missed' ? 'opacity-50' : ''
              }`}
            >
              <div className="min-w-0 pr-3">
                <p className={`text-sm font-medium ${s.status === 'skipped' || s.status === 'missed' ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                  {getSessionLabel(s.type)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {s.completedAt ? formatDate(s.completedAt) : s.scheduledDate ? formatDate(s.scheduledDate * 86400) : '-'}
                  {s.durationSec ? ` \u00B7 ${formatDuration(s.durationSec)}` : ''}
                </p>
                {s.review && (
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground/80">
                    {s.review}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {flagLabel && (
                  <span className="rounded-sm border border-border/60 px-2 py-0.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground/80">
                    {flagLabel}
                  </span>
                )}
                {s.rpe != null && <RpeBadge rpe={s.rpe} />}
                {(s.status === 'skipped' || s.status === 'missed') && (
                  <span className="bg-secondary px-2 py-0.5 text-[13px] text-muted-foreground">Passed</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
