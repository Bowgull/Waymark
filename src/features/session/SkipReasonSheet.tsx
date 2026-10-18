import { useState } from 'react'

import {
  boardNumber,
  skipCommit,
  skipNeedsWords,
  SKIP_PLACES,
  SKIP_REASONS,
  type SkipReasonCommit,
  type SkipReasonValue,
} from '@/components/ui/departures'
import { CentredCard, FlapButton, FlapLabel } from '@/design'
import '@/design/pickers.css'
import { mediumHaptic, selectHaptic } from '@/lib/haptics'

export type { SkipReasonCommit, SkipReasonValue }

interface SkipReasonSheetProps {
  onCommit: (commit: SkipReasonCommit) => void
  onClose: () => void
  /** The session being skipped, shown on a flap in the heading. */
  sessionName?: string
}

/**
 * Why skip: a numbered departures board of reasons (page 22 k1). The pick
 * is lit by the lantern with a gold flap. Injury / pain opens Where, a plain
 * numbered list of the seven real places. Other asks for a few words. COMMIT
 * stays off until the choice is complete. The codes sent are unchanged.
 */
export function SkipReasonSheet({ onCommit, onClose, sessionName }: SkipReasonSheetProps) {
  const [reason, setReason] = useState<SkipReasonValue | null>(null)
  const [place, setPlace] = useState<string | null>(null)
  const [words, setWords] = useState('')
  const [where, setWhere] = useState(false)

  const commit = skipCommit(reason, place, words)
  const needsWords = skipNeedsWords(reason, place)

  function pickReason(value: SkipReasonValue) {
    selectHaptic()
    if (value !== reason) {
      setPlace(null)
      setWords('')
    }
    setReason(value)
    if (value === 'injury') setWhere(true)
  }

  function pickPlace(value: string) {
    selectHaptic()
    if (value !== place) setWords('')
    setPlace(value)
  }

  function handleCommit() {
    if (!commit) return
    mediumHaptic()
    onCommit(commit)
  }

  const commitButton = <FlapButton label="COMMIT" primary disabled={!commit} onClick={handleCommit} />
  const wordsBox = needsWords && (
    <textarea
      value={words}
      onChange={e => setWords(e.target.value)}
      rows={2}
      placeholder={reason === 'injury' ? 'Where.' : 'What happened.'}
      aria-label={reason === 'injury' ? 'Where it hurts' : 'What happened'}
      className="wm-input wm-words"
      autoFocus
    />
  )

  if (where && reason === 'injury') {
    return (
      <CentredCard
        label="Where"
        onDismiss={onClose}
        head="Where"
        headRight={<FlapLabel text="INJURY / PAIN" size="xs" tone="clay" />}
        sub="Where does it hurt?"
      >
        <div className="wm-brows" role="radiogroup" aria-label="Where">
          {SKIP_PLACES.map((p, i) => (
            <ReasonRow key={p} n={i} label={p} len={12} on={place === p} onPick={() => pickPlace(p)} />
          ))}
        </div>
        {wordsBox}
        <div className="wm-btns">
          {commitButton}
          <FlapButton label="BACK" onClick={() => setWhere(false)} />
        </div>
      </CentredCard>
    )
  }

  return (
    <CentredCard
      label="Why skip"
      onDismiss={onClose}
      head="Why skip"
      headRight={sessionName ? <FlapLabel text={sessionName} size="xs" /> : undefined}
      sub="One tap. The program adapts."
    >
      <div className="wm-brows" role="radiogroup" aria-label="Why skip">
        {SKIP_REASONS.map((r, i) => (
          <ReasonRow
            key={r.value}
            n={i}
            label={r.label}
            on={reason === r.value}
            onPick={() => pickReason(r.value)}
          />
        ))}
      </div>
      {wordsBox}
      <div className="wm-btns">
        {commitButton}
        <FlapButton label="CLOSE" onClick={onClose} />
      </div>
    </CentredCard>
  )
}

// page 22: reasons pad to 14 tiles, places to 12; the lamp sits right after the label
function ReasonRow({ n, label, on, onPick, len = 14 }: { n: number; label: string; on: boolean; onPick: () => void; len?: number }) {
  return (
    <button type="button" role="radio" aria-checked={on} aria-label={label} className={`wm-brow${on ? ' is-on' : ''}`} onClick={onPick}>
      <span className="wm-brow-num" aria-hidden>{boardNumber(n)}</span>
      <span className="wm-brow-label">
        <FlapLabel text={label} size="md" tone={on ? 'gold' : 'ink'} len={len} />
      </span>
      {on && <span className="wm-lamp" aria-hidden>◆</span>}
    </button>
  )
}
