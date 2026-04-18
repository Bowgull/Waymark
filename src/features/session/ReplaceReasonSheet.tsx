import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { mediumHaptic, selectHaptic } from '@/lib/haptics'

const REASONS = [
  { value: 'too_sore', label: 'Too sore' },
  { value: 'low_sleep', label: 'Low on sleep' },
  { value: 'schedule', label: 'Short on time' },
  { value: 'low_drive', label: 'Not feeling it' },
  { value: 'illness', label: 'Body signal' },
  { value: 'variety', label: 'Changing it up' },
]

const REASON_LABELS: Record<string, string> = Object.fromEntries(
  REASONS.map(r => [r.value, r.label]),
)

interface ReplaceReasonSheetProps {
  onCommit: (reason: string, fastPath: boolean) => void
  onClose: () => void
}

export function ReplaceReasonSheet({ onCommit, onClose }: ReplaceReasonSheetProps) {
  const [selected, setSelected] = useState<string | null>(null)

  function handleSelect(value: string) {
    selectHaptic()
    setSelected(value)
  }

  function handleContinue() {
    if (!selected) return
    const label = REASON_LABELS[selected] ?? selected
    mediumHaptic()
    onCommit(label, selected === 'variety')
  }

  return (
    <BottomSheet open onClose={onClose} ariaLabel="Why swap">
      <div className="mb-3">
        <p className="font-cinzel text-display-sm text-gold">Why swap</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Coach uses this to pick the right session.
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

      <div className="flex gap-2">
        <Button
          onClick={handleContinue}
          disabled={!selected}
          className="flex-1"
        >
          See options
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
