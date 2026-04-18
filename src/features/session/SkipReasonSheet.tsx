import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { mediumHaptic, selectHaptic } from '@/lib/haptics'

const REASONS = [
  { value: 'too_sore', label: 'Too sore' },
  { value: 'low_sleep', label: 'Low on sleep' },
  { value: 'schedule', label: 'Schedule conflict' },
  { value: 'low_drive', label: 'Not feeling it' },
  { value: 'illness', label: 'Sick or injured' },
  { value: 'other', label: 'Other' },
]

const REASON_LABELS: Record<string, string> = Object.fromEntries(
  REASONS.map(r => [r.value, r.label]),
)

interface SkipReasonSheetProps {
  onCommit: (reason: string) => void
  onClose: () => void
}

export function SkipReasonSheet({ onCommit, onClose }: SkipReasonSheetProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState('')

  function handleSelect(value: string) {
    selectHaptic()
    setSelected(value)
  }

  function handleCommit() {
    if (!selected) return
    const label = REASON_LABELS[selected] ?? selected
    const reason = detail.trim() ? `${label}. ${detail.trim()}` : label
    mediumHaptic()
    onCommit(reason)
  }

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

      {selected === 'other' && (
        <textarea
          value={detail}
          onChange={e => setDetail(e.target.value)}
          rows={2}
          placeholder="What happened."
          className="mb-3 w-full resize-none rounded-md border border-gold/10 bg-deep-forest px-3 py-2 text-sm text-foreground placeholder-muted-foreground/50 focus:border-gold/40 focus:outline-none"
          autoFocus
        />
      )}

      <div className="flex gap-2">
        <Button
          onClick={handleCommit}
          disabled={!selected || (selected === 'other' && !detail.trim())}
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
