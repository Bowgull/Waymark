import { useState } from 'react'

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
    <div className="mb-4 rounded-xl border border-zinc-800 border-l-4 border-l-[#4ACAAA] bg-zinc-900 p-4">
      <p className="mb-4 text-base font-medium text-zinc-300">
        How are you feeling?
      </p>

      {/* Sleep + Weed + Alcohol row */}
      <div className="mb-4 flex gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-xs text-zinc-500">Sleep (hrs)</label>
          <input
            type="number"
            inputMode="decimal"
            placeholder="—"
            min="0"
            max="24"
            step="0.5"
            value={sleep}
            onChange={(e) => setSleep(e.target.value)}
            className="min-h-[44px] w-full rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-2 text-center text-sm text-zinc-100 placeholder-zinc-600 focus:border-[#4ACAAA] focus:outline-none"
          />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-xs text-zinc-500">Weed (g)</label>
          <input
            type="number"
            inputMode="decimal"
            placeholder="—"
            min="0"
            step="0.5"
            value={weed}
            onChange={(e) => setWeed(e.target.value)}
            className="min-h-[44px] w-full rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-2 text-center text-sm text-zinc-100 placeholder-zinc-600 focus:border-[#4ACAAA] focus:outline-none"
          />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-xs text-zinc-500">Alcohol</label>
          <input
            type="number"
            inputMode="numeric"
            placeholder="1-10"
            min="0"
            max="10"
            value={alcohol}
            onChange={(e) => setAlcohol(e.target.value)}
            className="min-h-[44px] w-full rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-2 text-center text-sm text-zinc-100 placeholder-zinc-600 focus:border-[#4ACAAA] focus:outline-none"
          />
        </div>
      </div>

      {/* Soreness */}
      <div className="mb-4">
        <label className="mb-2 block text-xs text-zinc-500">Soreness</label>
        <div className="flex gap-1.5">
          {[1, 2, 3, 4, 5].map((s) => (
            <button
              key={s}
              onClick={() => setSoreness(s)}
              className={`flex-1 rounded-lg py-2 text-xs font-medium ${
                soreness === s
                  ? 'bg-[#4ACAAA] text-zinc-950'
                  : 'bg-zinc-800 text-zinc-400 active:bg-zinc-700'
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
        className="mb-3 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-[#4ACAAA] focus:outline-none"
      />

      <button
        onClick={handleSubmit}
        disabled={submitting || !hasAnyData}
        className="min-h-[44px] w-full rounded-lg bg-[#1E8A68] py-2 text-sm font-semibold text-zinc-100 active:bg-[#4ACAAA] disabled:opacity-40"
      >
        Log Wellness
      </button>
    </div>
  )
}
