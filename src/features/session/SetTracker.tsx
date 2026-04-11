import { useState } from 'react'

import { kgToLbs, lbsToKg } from '@/lib/units'

interface SetTrackerProps {
  setNumber: number
  totalSets: number
  isWarmup: boolean
  suggestedWeightKg: number | null
  targetReps: number // 0 = max reps
  onComplete: (weightKg: number | null, reps: number) => void
}

export function SetTracker({
  setNumber,
  totalSets,
  isWarmup,
  suggestedWeightKg,
  targetReps,
  onComplete,
}: SetTrackerProps) {
  const suggestedLbs = suggestedWeightKg != null ? kgToLbs(suggestedWeightKg) : ''
  const [weight, setWeight] = useState(String(suggestedLbs))
  const [reps, setReps] = useState(targetReps > 0 ? String(targetReps) : '')

  function handleDone() {
    const actualReps = parseInt(reps) || 0
    if (actualReps <= 0) return
    const actualWeightKg = weight ? lbsToKg(parseFloat(weight)) : null
    onComplete(actualWeightKg, actualReps)
  }

  return (
    <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <p className="mb-3 text-sm font-medium text-zinc-400">
        {isWarmup ? `Warmup ${setNumber}` : `Set ${setNumber}`} of {totalSets}
      </p>

      <div className="flex items-end gap-4">
        <div className="flex-1">
          <label className="mb-1 block text-xs text-zinc-500">Weight (lbs)</label>
          <input
            type="number"
            inputMode="decimal"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="—"
            className="min-h-[44px] w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-center text-lg text-zinc-100 placeholder-zinc-600 focus:border-[#E8C860] focus:outline-none"
          />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-xs text-zinc-500">
            Reps{targetReps === 0 ? ' (max)' : ''}
          </label>
          <input
            type="number"
            inputMode="numeric"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            placeholder={targetReps === 0 ? 'Max' : String(targetReps)}
            className="min-h-[44px] w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-center text-lg text-zinc-100 placeholder-zinc-600 focus:border-[#E8C860] focus:outline-none"
          />
        </div>
        <button
          onClick={handleDone}
          className="min-h-[44px] rounded-lg bg-[#E8C860] px-5 py-2 text-sm font-bold text-zinc-950 active:bg-[#C8A030]"
        >
          Done
        </button>
      </div>
    </div>
  )
}
