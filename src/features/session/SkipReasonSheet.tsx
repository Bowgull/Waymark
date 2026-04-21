import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { mediumHaptic, selectHaptic } from '@/lib/haptics'

export type SkipReasonValue =
  | 'too_sore'
  | 'tired'
  | 'injury'
  | 'schedule'
  | 'sick'
  | 'low_drive'
  | 'other'

const REASONS: Array<{ value: SkipReasonValue; label: string }> = [
  { value: 'too_sore', label: 'Sore' },
  { value: 'tired', label: 'Tired' },
  { value: 'injury', label: 'Injury / pain' },
  { value: 'schedule', label: 'Time' },
  { value: 'sick', label: 'Sick' },
  { value: 'low_drive', label: 'Low motivation' },
  { value: 'other', label: 'Other' },
]

const BODY_PARTS = ['Lower back', 'Knee', 'Hip', 'Shoulder', 'Ankle', 'Neck', 'Other']

export interface SkipReasonCommit {
  reason: SkipReasonValue
  detail: string | null
}

interface SkipReasonSheetProps {
  onCommit: (commit: SkipReasonCommit) => void
  onClose: () => void
}

export function SkipReasonSheet({ onCommit, onClose }: SkipReasonSheetProps) {
  const [selected, setSelected] = useState<SkipReasonValue | null>(null)
  const [bodyPart, setBodyPart] = useState<string | null>(null)
  const [detail, setDetail] = useState('')

  function handleSelect(value: SkipReasonValue) {
    selectHaptic()
    setSelected(value)
    setBodyPart(null)
    setDetail('')
  }

  function handleBodyPart(part: string) {
    selectHaptic()
    setBodyPart(part)
  }

  function handleCommit() {
    if (!selected) return
    mediumHaptic()
    let finalDetail: string | null = null
    if (selected === 'injury') {
      if (!bodyPart) return
      finalDetail = bodyPart === 'Other' ? (detail.trim() || 'Other') : bodyPart
    } else if (selected === 'other') {
      finalDetail = detail.trim() || null
    }
    onCommit({ reason: selected, detail: finalDetail })
  }

  const needsBodyPart = selected === 'injury'
  const needsOtherText = selected === 'other' || (selected === 'injury' && bodyPart === 'Other')
  const canCommit =
    !!selected &&
    (selected !== 'injury' || !!bodyPart) &&
    (selected !== 'other' || !!detail.trim()) &&
    (!(selected === 'injury' && bodyPart === 'Other') || !!detail.trim())

  return (
    <BottomSheet open onClose={onClose} ariaLabel="Why skip">
      <div className="mb-3">
        <p className="font-cinzel text-display-sm text-gold">Why skip</p>
        <p className="mt-1 text-sm text-muted-foreground">
          One tap. The program adapts.
        </p>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        {REASONS.map(r => (
          <button
            key={r.value}
            onClick={() => handleSelect(r.value)}
            className={`min-h-[44px] rounded-md border px-3 py-2.5 text-left text-sm transition-colors ${
              selected === r.value
                ? 'border-gold/60 bg-secondary text-foreground'
                : 'border-border bg-secondary/50 text-muted-foreground'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {needsBodyPart && (
        <div className="mb-3">
          <p className="mb-2 font-cinzel text-[11px] uppercase tracking-[0.2em] text-gold/50">Where</p>
          <div className="grid grid-cols-3 gap-2">
            {BODY_PARTS.map(part => (
              <button
                key={part}
                onClick={() => handleBodyPart(part)}
                className={`min-h-[40px] rounded-md border px-2 py-2 text-xs transition-colors ${
                  bodyPart === part
                    ? 'border-gold/60 bg-secondary text-foreground'
                    : 'border-border bg-secondary/50 text-muted-foreground'
                }`}
              >
                {part}
              </button>
            ))}
          </div>
        </div>
      )}

      {needsOtherText && (
        <textarea
          value={detail}
          onChange={e => setDetail(e.target.value)}
          rows={2}
          placeholder={selected === 'injury' ? 'Where.' : 'What happened.'}
          className="mb-3 w-full resize-none rounded-md border border-gold/10 bg-deep-forest px-3 py-2 text-sm text-foreground placeholder-muted-foreground/50 focus:border-gold/40 focus:outline-none"
          autoFocus
        />
      )}

      <div className="flex gap-2">
        <Button
          onClick={handleCommit}
          disabled={!canCommit}
          className="flex-1"
        >
          Commit
        </Button>
        <button
          onClick={onClose}
          className="min-h-[44px] px-3 py-2 text-sm text-muted-foreground active:text-foreground"
        >
          Close
        </button>
      </div>
    </BottomSheet>
  )
}
