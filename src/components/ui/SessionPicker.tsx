import { useState } from 'react'

import { AmPmFlap, CentredCard, FlapLabel, SessionIcon } from '@/design'
import '@/design/pickers.css'
import { mediumHaptic, selectHaptic } from '@/lib/haptics'
import type { SuggestionsResponse } from '@/lib/sessionSuggestions'
import { TRAINING_TARGETS } from '@/lib/trainingTargets'

import {
  buildDepartures,
  pickerOptions,
  selectionFor,
  type DepartureRow,
  type SessionOption,
  type Slot,
} from './departures'

export type { SessionOption }

// Built from the training targets (single source of truth); MT Class stays out.
const SESSION_OPTIONS = pickerOptions(TRAINING_TARGETS)

interface SessionPickerProps {
  onSelect: (option: SessionOption) => void
  onClose: () => void
  filter?: (option: SessionOption) => boolean
  suggestions?: SuggestionsResponse | null
  title?: string
  subtitle?: string
}

/**
 * Add Session and Replace "More options": a departures board on a centred
 * card (design-decisions.md, "Pickers and flows"). Coach picks first, lit by
 * the lantern; cautions as embers; each row has its painted icon, the name
 * on a flap, the reason, and an AM / PM slot (tap the slot to flip it, tap
 * the row to pick).
 */
export function SessionPicker({ onSelect, onClose, filter, suggestions, title, subtitle }: SessionPickerProps) {
  const base = filter ? SESSION_OPTIONS.filter(filter) : SESSION_OPTIONS
  const board = buildDepartures(base, suggestions)
  const heading = title ?? 'Add Session'
  const grouped = board.picks.length > 0

  return (
    <CentredCard
      label={heading}
      onDismiss={onClose}
      head={heading}
      headRight={
        <button type="button" className="wm-pk-cancel" onClick={onClose} aria-label="Cancel">
          Cancel
        </button>
      }
      sub={subtitle}
    >
      {board.flagsLine && <p className="wm-pk-flags">{board.flagsLine}</p>}
      <div className="wm-deps" role="list" aria-label={`${heading} options`}>
        {grouped && <div className="wm-grp is-lit" role="presentation">Coach picks</div>}
        {board.picks.map(row => (
          <DepartureRowView key={`p-${row.key}`} row={row} len={board.labelLen} onSelect={onSelect} />
        ))}
        {grouped && board.rest.length > 0 && <div className="wm-grp" role="presentation">Everything else</div>}
        {board.rest.map(row => (
          <DepartureRowView key={`r-${row.key}`} row={row} len={board.labelLen} onSelect={onSelect} />
        ))}
      </div>
    </CentredCard>
  )
}

function DepartureRowView({ row, len, onSelect }: { row: DepartureRow; len: number; onSelect: (option: SessionOption) => void }) {
  const [slot, setSlot] = useState<Slot>(row.timeSlot)

  function pick() {
    // A refused row says why; it is not a departure.
    if (row.blocked) return
    mediumHaptic()
    onSelect(selectionFor(row, slot))
  }

  function flip(next: Slot) {
    selectHaptic()
    setSlot(next)
  }

  const shownSlot = row.flexibleTimeSlot ? slot : row.timeSlot
  const spoken = [
    row.tone === 'pick' ? `Coach pick: ${row.label}` : row.label,
    row.reason ? (row.tone === 'ember' ? `Caution: ${row.reason}` : row.reason) : null,
    shownSlot.toUpperCase(),
  ].filter(Boolean).join(', ')

  return (
    <div className={`wm-dep${row.tone === 'pick' ? ' is-pick' : ''}`} role="listitem" onClick={pick}>
      <button type="button" className="wm-dep-main" aria-label={row.blocked ? `Not today: ${spoken}` : `Add ${spoken}`} aria-disabled={row.blocked || undefined}>
        <SessionIcon kind={row.icon} size={44} label="" />
        <span className="wm-dep-text">
          <FlapLabel text={row.label} size="sm" len={len} fit />
          {row.reason && <span className={`wm-dep-why${row.tone === 'ember' ? ' is-ember' : ''}`}>{row.reason}</span>}
        </span>
      </button>
      <AmPmFlap slot={shownSlot} onChange={row.flexibleTimeSlot && !row.blocked ? flip : undefined} />
    </div>
  )
}
