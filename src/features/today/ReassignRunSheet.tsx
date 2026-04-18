import { useEffect, useState } from 'react'

import { BottomSheet } from '@/components/ui/BottomSheet'
import { apiFetch } from '@/lib/api'
import { getTodayISO } from '@/lib/dates'
import { selectHaptic } from '@/lib/haptics'

interface WeekRunSession {
  id: string
  type: string
  timeSlot: string | null
  status: string
  scheduledDate: number | null
  notes: string | null
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface ReassignRunSheetProps {
  open: boolean
  onClose: () => void
  onSelect: (sessionId: string) => void
  excludeSessionId?: string
}

function formatRunLabel(s: WeekRunSession): { day: string; tag: string } {
  const date = s.scheduledDate != null
    ? new Date(s.scheduledDate * 86400 * 1000)
    : null
  const day = date ? DAY_SHORT[date.getUTCDay()] : ''
  const slot = s.timeSlot ? s.timeSlot.toUpperCase() : ''
  const tag = (s.notes ?? 'run').replace(/_/g, ' ')
  return { day: [day, slot].filter(Boolean).join(' '), tag }
}

export function ReassignRunSheet({ open, onClose, onSelect, excludeSessionId }: ReassignRunSheetProps) {
  const [runs, setRuns] = useState<WeekRunSession[] | null>(null)

  useEffect(() => {
    if (!open) return
    const today = getTodayISO()
    apiFetch<WeekRunSession[]>(`/api/sessions/week-runs?date=${today}`)
      .then(setRuns)
      .catch(() => setRuns([]))
  }, [open])

  const pickable = (runs ?? []).filter(r =>
    r.id !== excludeSessionId
    && r.status !== 'completed'
    && r.status !== 'skipped',
  )

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel="Reassign run">
      <div className="pb-4">
        <p className="mb-1 font-cinzel text-[11px] uppercase tracking-[0.2em] text-gold/50">Reassign</p>
        <p className="mb-3 text-[13px] text-muted-foreground italic leading-relaxed">
          Pick the run this activity belongs to.
        </p>

        {runs === null && (
          <p className="py-4 text-sm text-muted-foreground">Loading...</p>
        )}

        {runs !== null && pickable.length === 0 && (
          <p className="py-4 text-[13px] text-muted-foreground italic">
            No other runs scheduled this week.
          </p>
        )}

        <div className="flex flex-col gap-2">
          {pickable.map(r => {
            const { day, tag } = formatRunLabel(r)
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  selectHaptic()
                  onSelect(r.id)
                }}
                className="flex min-h-[48px] items-center justify-between rounded-md border border-gold/10 bg-near-black/40 px-3 py-2 text-left active:bg-surface/60"
              >
                <span className="text-sm text-foreground">{day}</span>
                <span className="text-xs uppercase tracking-wider text-muted-foreground/70">{tag}</span>
              </button>
            )
          })}
        </div>
      </div>
    </BottomSheet>
  )
}
