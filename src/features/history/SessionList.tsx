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
  const color = rpe <= 3 ? 'text-[#4ABA8A]' : rpe <= 6 ? 'text-[#E8C860]' : 'text-[#C45A3C]'
  return <span className={`text-xs font-medium ${color}`}>RPE {rpe}</span>
}

export function SessionList({ sessions }: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-zinc-500">
        No completed sessions yet. Get after it.
      </p>
    )
  }

  return (
    <div>
      <p className="mb-3 text-sm font-medium text-zinc-300">Recent Sessions</p>
      <div className="space-y-2">
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 p-3 ${
              s.status === 'skipped' ? 'opacity-50' : ''
            }`}
          >
            <div>
              <p className={`text-sm font-medium ${s.status === 'skipped' ? 'text-zinc-500 line-through' : 'text-zinc-100'}`}>
                {getSessionLabel(s.type)}
              </p>
              <p className="text-xs text-zinc-500">
                {s.completedAt ? formatDate(s.completedAt) : s.scheduledDate ? formatDate(s.scheduledDate * 86400) : '—'}
                {s.durationSec ? ` \u00B7 ${formatDuration(s.durationSec)}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {s.rpe != null && <RpeBadge rpe={s.rpe} />}
              {s.status === 'skipped' && (
                <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500">Skipped</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
