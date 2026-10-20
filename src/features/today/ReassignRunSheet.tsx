import { useEffect, useRef, useState } from 'react'

import { AmPmFlap, CentredCard, FlapLabel, SessionIcon } from '@/design'
import { iconFor, sessionDisplayName } from '@/features/dayboard/rowState'
import { apiFetch } from '@/lib/api'
import { getTodayISO } from '@/lib/dates'
import { selectHaptic } from '@/lib/haptics'

// Page 40, phone 3 ("Change: reassign"): a centred board of this week's runs
// not done yet, as departure rows (the painted icon, the day and slot on a
// flap, the run's name, its AM / PM), plus CANCEL. Picking one lights it gold
// and moves the activity there; Today then says "Reassigned."

interface WeekRunSession {
  id: string
  type: string
  label?: string | null
  timeSlot: string | null
  status: string
  scheduledDate: number | null
  notes: string | null
}

const DAY_SHORT = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

/** "WED PM" on the flap, "Zone 2" under it. */
function reassignRowText(s: WeekRunSession): { day: string; name: string } {
  const day = s.scheduledDate != null ? DAY_SHORT[new Date(s.scheduledDate * 86400 * 1000).getUTCDay()] : ''
  const slot = s.timeSlot === 'am' || s.timeSlot === 'pm' ? s.timeSlot.toUpperCase() : ''
  const name = sessionDisplayName({ type: s.type, label: s.label ?? null, notes: s.notes })
  return { day: [day, slot].filter(Boolean).join(' '), name: name.charAt(0).toUpperCase() + name.slice(1).toLowerCase() }
}

interface ReassignRunSheetProps {
  open: boolean
  onClose: () => void
  onSelect: (sessionId: string) => void
  excludeSessionId?: string
}

/** How long the picked row shows gold before the board closes (the "move" speed). */
const PICK_MS = 320

export function ReassignRunSheet({ open, onClose, onSelect, excludeSessionId }: ReassignRunSheetProps) {
  const [runs, setRuns] = useState<WeekRunSession[] | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (!open) return
    apiFetch<WeekRunSession[]>(`/api/sessions/week-runs?date=${getTodayISO()}`)
      .then(setRuns)
      .catch(() => setRuns([]))
  }, [open])

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])
  // Today mounts the board fresh each time it opens, so nothing carries over.

  if (!open) return null

  const pickable = (runs ?? []).filter(r =>
    r.id !== excludeSessionId
    && r.status !== 'completed'
    && r.status !== 'skipped',
  )

  const pick = (id: string) => {
    if (picked) return
    selectHaptic()
    setPicked(id)
    timer.current = window.setTimeout(() => { timer.current = null; onSelect(id) }, PICK_MS)
  }

  return (
    <CentredCard label="Reassign run" head="Reassign" sub="Pick the run this activity belongs to." onDismiss={onClose} className="td-rr">
      {runs === null && <p className="wm-card-sub">Loading…</p>}
      {runs !== null && pickable.length === 0 && <p className="wm-card-sub">No other runs scheduled this week.</p>}
      {pickable.map(r => {
        const { day, name } = reassignRowText(r)
        const on = picked === r.id
        return (
          <button key={r.id} type="button" className={`td-opt is-rr${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => pick(r.id)}>
            <SessionIcon kind={iconFor({ type: r.type, notes: r.notes })} size={44} />
            <span className="tx">
              <FlapLabel text={day} size="sm" tone={on ? 'gold' : 'ink'} />
              <small>{name}</small>
            </span>
            {(r.timeSlot === 'am' || r.timeSlot === 'pm') && <AmPmFlap slot={r.timeSlot} />}
          </button>
        )
      })}
    </CentredCard>
  )
}
