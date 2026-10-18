import { useState } from 'react'

import { REPLACE_REASONS, replaceCommit } from '@/components/ui/departures'
import { CentredCard, FlapButton } from '@/design'
import '@/design/pickers.css'
import { mediumHaptic, selectHaptic } from '@/lib/haptics'

interface ReplaceReasonSheetProps {
  /** Receives the reason's label (what the server gets) and the fast path for "Changing it up". */
  onCommit: (reason: string, fastPath: boolean) => void
  onClose: () => void
}

/**
 * Why swap (page 20 r2): a centred board with the six real reasons as word tiles.
 * SEE OPTIONS wakes up once one is picked.
 */
export function ReplaceReasonSheet({ onCommit, onClose }: ReplaceReasonSheetProps) {
  const [selected, setSelected] = useState<string | null>(null)

  function handleSelect(value: string) {
    selectHaptic()
    setSelected(value)
  }

  function handleContinue() {
    if (!selected) return
    const { reason, fastPath } = replaceCommit(selected)
    mediumHaptic()
    onCommit(reason, fastPath)
  }

  return (
    <CentredCard label="Why swap" onDismiss={onClose} head="Why swap" sub="Coach uses this to pick the right session.">
      <div className="wm-reason-grid" role="radiogroup" aria-label="Why swap">
        {REPLACE_REASONS.map(r => {
          const on = selected === r.value
          return (
            <button
              key={r.value}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={r.label}
              className={`wm-opt${on ? ' is-on' : ''}`}
              onClick={() => handleSelect(r.value)}
            >
              {r.label}
            </button>
          )
        })}
      </div>
      <div className="wm-btns">
        <FlapButton label="SEE OPTIONS" primary disabled={!selected} onClick={handleContinue} />
        <FlapButton label="CLOSE" onClick={onClose} />
      </div>
    </CentredCard>
  )
}
