import { useState } from 'react'
import { getSessionLabel } from '@/lib/weeklyTemplate'
import { TimelineRow } from './TimelineRow'

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

interface DayTimelineProps {
  sessions: Session[]
  onStart: (id: string) => void
  onSkip: (id: string) => void
}

export function DayTimeline({ sessions, onStart, onSkip }: DayTimelineProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const amSessions = sessions.filter(s => s.timeSlot === 'am')
  const pmSessions = sessions.filter(s => s.timeSlot === 'pm')
  const otherSessions = sessions.filter(s => s.timeSlot !== 'am' && s.timeSlot !== 'pm')

  function renderSection(label: string, labelColor: string, items: Session[], baseDelay: number) {
    if (items.length === 0) return null
    return (
      <div>
        <p className={`text-label ${labelColor} mb-1 px-1`}>{label}</p>
        <div className="flex flex-col gap-px">
          {items.map((session, i) => (
            <div
              key={session.id}
              className="animate-fade-in-up"
              style={{ animationDelay: `${(baseDelay + i) * 60}ms` }}
            >
              <TimelineRow
                session={session}
                onStart={onStart}
                onSkip={onSkip}
                expanded={expandedId === session.id}
                onToggle={() => setExpandedId(expandedId === session.id ? null : session.id)}
                label={getSessionLabel(session.type)}
              />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {renderSection('AM', 'text-gold', amSessions, 0)}
      {renderSection('PM', 'text-teal', pmSessions, amSessions.length)}
      {otherSessions.length > 0 && renderSection('Sessions', 'text-muted-foreground', otherSessions, amSessions.length + pmSessions.length)}
    </div>
  )
}
