import { Button } from '@/components/ui/button'
import { getSessionLabel } from '@/lib/weeklyTemplate'

interface SessionSummary {
  id: string
  type: string
  timeSlot: string | null
  status: string
  scheduledDate: number | null
}

interface WeekViewProps {
  sessions: SessionSummary[]
  weekStatus: string
  onApprove: () => void
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function getStatusColor(status: string): string {
  switch (status) {
    case 'completed': return 'bg-[#2D6B4F]/20 text-[#4ABA8A]'
    case 'in_progress': return 'bg-[#4ACAAA]/15 text-[#4ACAAA]'
    case 'skipped': return 'bg-border text-muted-foreground'
    default: return 'bg-border text-muted-foreground'
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'completed': return 'Done'
    case 'in_progress': return 'Active'
    case 'skipped': return 'Skipped'
    default: return 'Planned'
  }
}

export function WeekView({ sessions, weekStatus, onApprove }: WeekViewProps) {
  // Group sessions by epoch day
  const dayMap = new Map<number, SessionSummary[]>()
  for (const s of sessions) {
    const date = s.scheduledDate ?? 0
    if (!dayMap.has(date)) dayMap.set(date, [])
    dayMap.get(date)!.push(s)
  }

  // Sort days
  const days = Array.from(dayMap.entries()).sort(([a], [b]) => a - b)

  return (
    <div>
      {weekStatus === 'draft' && (
        <div className="mb-4 border border-[#E8C860]/30 bg-[#E8C860]/5 p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[#E8C860]">Week plan ready for review</p>
            <Button size="sm" onClick={onApprove}>
              Approve
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {days.map(([epochDay, daySessions]) => {
          const date = new Date(epochDay * 86400 * 1000)
          const dayName = DAY_NAMES[date.getUTCDay()]
          const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

          return (
            <div key={epochDay} className="border border-border bg-card p-3">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-sm font-semibold text-foreground">{dayName}</span>
                <span className="text-xs text-muted-foreground">{dateStr}</span>
              </div>
              <div className="space-y-1.5">
                {daySessions
                  .sort((a, b) => (a.timeSlot === 'am' ? -1 : 1) - (b.timeSlot === 'am' ? -1 : 1))
                  .map((s) => (
                    <div key={s.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          s.timeSlot === 'am' ? 'bg-[#C8A030]/15 text-[#E8C860]' : 'bg-[#1E8A68]/15 text-[#4ACAAA]'
                        }`}>
                          {s.timeSlot === 'am' ? 'AM' : 'PM'}
                        </span>
                        <span className={`text-sm ${s.status === 'skipped' ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                          {getSessionLabel(s.type)}
                        </span>
                      </div>
                      <span className={`px-2 py-0.5 text-[10px] font-medium ${getStatusColor(s.status)}`}>
                        {getStatusLabel(s.status)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
