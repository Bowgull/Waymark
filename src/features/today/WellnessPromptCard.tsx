import { useState } from 'react'
import { Button } from '@/components/ui/button'

export interface WellnessData {
  sleepHours?: number
  weedGrams?: number
  alcoholScale?: number
  soreness?: number
  notes?: string
}

interface WellnessPromptCardProps {
  onSubmit: (data: WellnessData) => void
}

const SORENESS_LABELS: Record<number, string> = {
  1: 'Fresh', 2: 'Loose', 3: 'Normal', 4: 'Sore', 5: 'Cooked',
}

export function WellnessPromptCard({ onSubmit }: WellnessPromptCardProps) {
  const [sleep, setSleep] = useState('')
  const [weed, setWeed] = useState('')
  const [alcohol, setAlcohol] = useState('')
  const [soreness, setSoreness] = useState<number | null>(null)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function handleSubmit() {
    setSubmitting(true)
    onSubmit({
      sleepHours: sleep ? parseFloat(sleep) : undefined,
      weedGrams: weed ? parseFloat(weed) : undefined,
      alcoholScale: alcohol ? parseInt(alcohol) : undefined,
      soreness: soreness ?? undefined,
      notes: notes || undefined,
    })
  }

  const hasAnyData = sleep || weed || alcohol || soreness != null

  return (
    <div className="mb-4 border border-gold/10 border-t-gold/20 bg-near-black/50 p-4">
      <p className="text-display mb-4 text-gold">
        Morning Report
      </p>

      {/* Sleep + Weed + Alcohol row */}
      <div className="mb-4 flex gap-3">
        <div className="flex-1">
          <label className="text-label mb-1 block text-muted-foreground">Sleep (hrs)</label>
          <input
            type="number"
            inputMode="decimal"
            placeholder="—"
            min="0"
            max="24"
            step="0.5"
            value={sleep}
            onChange={(e) => setSleep(e.target.value)}
            className="min-h-[44px] w-full border border-gold/10 bg-deep-forest px-2 py-2 text-center text-sm text-foreground placeholder-muted-foreground focus:border-gold/40 focus:outline-none"
          />
        </div>
        <div className="flex-1">
          <label className="text-label mb-1 block text-muted-foreground">Weed (g)</label>
          <input
            type="number"
            inputMode="decimal"
            placeholder="—"
            min="0"
            step="0.5"
            value={weed}
            onChange={(e) => setWeed(e.target.value)}
            className="min-h-[44px] w-full border border-gold/10 bg-deep-forest px-2 py-2 text-center text-sm text-foreground placeholder-muted-foreground focus:border-gold/40 focus:outline-none"
          />
        </div>
        <div className="flex-1">
          <label className="text-label mb-1 block text-muted-foreground">Alcohol</label>
          <input
            type="number"
            inputMode="numeric"
            placeholder="1-10"
            min="0"
            max="10"
            value={alcohol}
            onChange={(e) => setAlcohol(e.target.value)}
            className="min-h-[44px] w-full border border-gold/10 bg-deep-forest px-2 py-2 text-center text-sm text-foreground placeholder-muted-foreground focus:border-gold/40 focus:outline-none"
          />
        </div>
      </div>

      {/* Soreness */}
      <div className="mb-4">
        <label className="text-label mb-2 block text-muted-foreground">Soreness</label>
        <div className="flex gap-1.5">
          {[1, 2, 3, 4, 5].map((s) => (
            <button
              key={s}
              onClick={() => setSoreness(s)}
              className={`flex-1 py-2 text-xs font-medium transition-colors ${
                soreness === s
                  ? 'bg-teal text-near-black'
                  : 'bg-deep-forest text-muted-foreground active:bg-secondary'
              }`}
            >
              {SORENESS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Notes */}
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="Notes (optional)"
        className="mb-3 w-full border border-gold/10 bg-deep-forest px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:border-gold/40 focus:outline-none"
      />

      <Button
        onClick={handleSubmit}
        disabled={submitting || !hasAnyData}
        className="w-full"
      >
        Log
      </Button>
    </div>
  )
}
