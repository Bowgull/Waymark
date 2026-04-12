import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { kgToLbs, lbsToKg } from '@/lib/units'
import { mediumHaptic } from '@/lib/haptics'

interface SetTrackerProps {
  setNumber: number
  totalSets: number
  isWarmup: boolean
  suggestedWeightKg: number | null
  targetReps: number
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
    mediumHaptic()
    onComplete(actualWeightKg, actualReps)
  }

  return (
    <div className="mt-6 border border-border bg-deep-forest p-4">
      <p className="mb-3 text-sm font-medium text-muted-foreground">
        {isWarmup ? `Warmup ${setNumber}` : `Set ${setNumber}`} of {totalSets}
      </p>

      <div className="flex items-end gap-4">
        <div className="flex-1">
          <label className="text-label mb-1 block text-muted-foreground">Weight (lbs)</label>
          <input
            type="number"
            inputMode="decimal"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="—"
            className="min-h-[44px] w-full border border-border bg-surface px-3 py-2 text-center text-stat text-foreground placeholder-muted-foreground focus:border-gold focus:outline-none"
          />
        </div>
        <div className="flex-1">
          <label className="text-label mb-1 block text-muted-foreground">
            Reps{targetReps === 0 ? ' (max)' : ''}
          </label>
          <input
            type="number"
            inputMode="numeric"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            placeholder={targetReps === 0 ? 'Max' : String(targetReps)}
            className="min-h-[44px] w-full border border-border bg-surface px-3 py-2 text-center text-stat text-foreground placeholder-muted-foreground focus:border-gold focus:outline-none"
          />
        </div>
        <Button onClick={handleDone} size="sm" className="min-h-[44px] px-5">
          Done
        </Button>
      </div>
    </div>
  )
}
