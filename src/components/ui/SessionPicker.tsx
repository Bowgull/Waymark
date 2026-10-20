import { useState } from 'react'

import { AmPmFlap, CentredCard, FlapLabel, SessionIcon } from '@/design'
import '@/design/pickers.css'
import { mediumHaptic, selectHaptic } from '@/lib/haptics'
import type { SuggestionsResponse } from '@/lib/sessionSuggestions'
import { TRAINING_TARGETS } from '@/lib/trainingTargets'
import { ReasonTiles } from '@/features/coach/ReasonTiles'

import {
  buildDepartures,
  pickerOptions,
  selectionFor,
  type DepartureRow,
  type ReasonTile,
  type SessionOption,
  type Slot,
} from './departures'

export type { SessionOption }

// Built from the training targets (single source of truth), MT Class included (page 56 item 15).
const SESSION_OPTIONS = pickerOptions(TRAINING_TARGETS)

interface SessionPickerProps {
  onSelect: (option: SessionOption) => void
  onClose: () => void
  filter?: (option: SessionOption) => boolean
  suggestions?: SuggestionsResponse | null
  title?: string
  /** REPLACE (page 56 item 1): the optional reason tiles on top of the same list. */
  reasons?: { tiles: ReadonlyArray<ReasonTile>; value: string | null; onChange: (next: string | null) => void }
  /** Today after the morning: every row is PM (the AM slot has gone). */
  pmOnly?: boolean
}

/**
 * Add Session, and REPLACE (page 56): a departures board on a centred card
 * (design-decisions.md, "Pickers and flows"). Coach picks first, lit by the
 * lantern, with their reason; everything else plain. Every row can be picked:
 * nothing is refused or greyed out. Each row: its painted icon, the name on a
 * flap and an AM / PM slot (tap the slot to flip it, tap the row to pick).
 */
export function SessionPicker({ onSelect, onClose, filter, suggestions, title, reasons, pmOnly }: SessionPickerProps) {
  const base = filter ? SESSION_OPTIONS.filter(filter) : SESSION_OPTIONS
  const board = buildDepartures(base, suggestions, { pmOnly })
  const heading = title ?? 'Add Session'
  const grouped = board.picks.length > 0

  return (
    <CentredCard
      label={heading}
      onDismiss={onClose}
      head={heading}
      className={reasons ? 'wm-repb' : ''}
    >
      {reasons && <ReasonTiles tiles={reasons.tiles} value={reasons.value} onChange={reasons.onChange} />}
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
  const [on, setOn] = useState(false)

  function pick() {
    mediumHaptic()
    setOn(true)
    onSelect(selectionFor(row, slot))
  }

  function flip(next: Slot) {
    selectHaptic()
    setSlot(next)
  }

  const shownSlot = row.flexibleTimeSlot ? slot : row.timeSlot
  const spoken = [row.tone === 'pick' ? `Coach pick: ${row.label}` : row.label, row.reason, shownSlot.toUpperCase()].filter(Boolean).join(', ')

  return (
    <div className={`wm-dep${row.tone === 'pick' ? ' is-pick' : ''}${on ? ' is-on' : ''}`} role="listitem" onClick={pick}>
      <button type="button" className="wm-dep-main" aria-label={`Pick ${spoken}`}>
        <SessionIcon kind={row.icon} size={38} label="" />
        <span className="wm-dep-text">
          <FlapLabel text={row.label.toUpperCase()} size="sm" len={len} fit />
          {row.reason && <span className="wm-dep-why">{row.reason}</span>}
        </span>
      </button>
      <AmPmFlap slot={shownSlot} onChange={row.flexibleTimeSlot ? flip : undefined} />
    </div>
  )
}
