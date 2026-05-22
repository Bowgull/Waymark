import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { kgToLbs, lbsToKg } from '@/lib/units'
import { mediumHaptic } from '@/lib/haptics'
import { calculatePlates } from '@/lib/plateMath'
import { assessStrengthSet, shouldShowStrengthRealityMark } from '@/lib/trainingReality'

interface SetTrackerProps {
  setNumber: number
  totalSets: number
  isWarmup: boolean
  suggestedWeightKg: number | null
  targetReps: number
  prescribedBandColor?: string | null
  equipment?: string | null
  lastSessionData?: { weightLbs: number; reps: number }
  suggestion?: { weightLbs: number; message: string }
  onComplete: (weightKg: number | null, reps: number, meta?: { bandColor?: string | null }) => void
  /** Emits the current input values (kg + reps) whenever they change.
   *  WorkoutPage uses this to push live values into the Live Activity
   *  so a lock-screen "Complete Set" tap logs what the user sees. */
  onLiveValuesChange?: (weightKg: number | null, reps: number) => void
}

function formatPlate(weight: number): string {
  return weight === Math.floor(weight) ? String(weight) : weight.toFixed(1)
}

export function SetTracker({
  setNumber,
  totalSets,
  isWarmup,
  suggestedWeightKg,
  targetReps,
  prescribedBandColor,
  equipment,
  lastSessionData,
  suggestion,
  onComplete,
  onLiveValuesChange,
}: SetTrackerProps) {
  const suggestedLbs = suggestedWeightKg != null ? kgToLbs(suggestedWeightKg) : ''
  const [weight, setWeight] = useState(String(suggestedLbs))
  const [reps, setReps] = useState(targetReps > 0 ? String(targetReps) : '')
  const [bandColor, setBandColor] = useState<string | null>(prescribedBandColor ?? null)

  useEffect(() => {
    const w = weight ? parseFloat(weight) : NaN
    const r = parseInt(reps)
    const kg = Number.isFinite(w) ? lbsToKg(w) : null
    onLiveValuesChange?.(kg, Number.isFinite(r) ? r : 0)
  }, [weight, reps, onLiveValuesChange])

  const isBarbell = equipment?.toLowerCase().includes('barbell') ?? false
  const isBand = equipment?.toLowerCase().includes('band') ?? false
  const prescribedBand = BAND_COLORS.find(band => band.value === bandColor)
  const actualWeight = weight ? lbsToKg(parseFloat(weight)) : null
  const actualReps = parseInt(reps) || 0
  const inferredStatus = assessStrengthSet({
    plannedWeightKg: suggestedWeightKg,
    plannedReps: targetReps,
    actualWeightKg: actualWeight,
    actualReps,
  })
  const showRealityMark = shouldShowStrengthRealityMark(inferredStatus)
  const liveLoading = useMemo(() => {
    if (!isBarbell) return null
    const lbs = parseFloat(weight)
    if (!Number.isFinite(lbs) || lbs <= 0) return null
    const result = calculatePlates(lbs)
    if (result.plateCounts.length === 0) return 'Bar only'
    return result.plateCounts
      .map(p => `${p.count}× ${formatPlate(p.weight)}`)
      .join('  ·  ')
  }, [weight, isBarbell])

  function handleDone() {
    if (actualReps <= 0) return
    const actualWeightKg = weight ? lbsToKg(parseFloat(weight)) : null
    mediumHaptic()
    onComplete(actualWeightKg, actualReps, { bandColor })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleDone()
    }
  }

  function handleUseSuggestion() {
    if (!suggestion) return
    setWeight(String(suggestion.weightLbs))
  }

  return (
    <div className="mt-6 rounded-md border border-gold/20 bg-deep-forest p-4 shadow-[inset_0_1px_0_rgba(232,200,96,0.06)]">
      <p className="mb-3 font-cinzel text-xs uppercase tracking-wider text-gold/50">
        {isWarmup ? `Warmup ${setNumber}` : `Set ${setNumber}`} of {totalSets}
      </p>

      {lastSessionData && !isWarmup && (
        <div className="mb-3 flex items-baseline gap-3">
          <p className="text-xs text-muted-foreground">
            Last: {lastSessionData.weightLbs}lb × {lastSessionData.reps}
          </p>
          {suggestion && (
            <button
              onClick={handleUseSuggestion}
              className="rounded-full border border-gold/30 bg-gold/10 px-2.5 py-0.5 text-xs font-medium text-gold active:bg-gold/20"
            >
              Try {suggestion.weightLbs}lb?
            </button>
          )}
        </div>
      )}

      <div className="flex items-end gap-4">
        {isBand ? (
          <div className="flex-1">
            <label className="text-label mb-1 block text-muted-foreground">Band</label>
            <div className="flex min-h-[44px] items-center justify-center rounded-md border border-gold/10 bg-deep-forest px-3 py-2 text-center text-sm text-foreground shadow-[inset_0_1px_3px_rgba(0,0,0,0.3)]">
              {prescribedBand ? prescribedBand.label : 'Choose'}
            </div>
          </div>
        ) : (
          <div className="flex-1">
            <label className="text-label mb-1 block text-muted-foreground">Weight (lbs)</label>
            <input
              type="number"
              inputMode="decimal"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="-"
              className="min-h-[44px] w-full rounded-md border border-gold/10 bg-deep-forest px-3 py-2 text-center text-stat text-foreground placeholder-muted-foreground shadow-[inset_0_1px_3px_rgba(0,0,0,0.3)] focus:border-gold/40 focus:shadow-[inset_0_1px_3px_rgba(0,0,0,0.3),0_0_0_1px_rgba(232,200,96,0.15)] focus:outline-none"
            />
          </div>
        )}
        <div className="flex-1">
          <label className="text-label mb-1 block text-muted-foreground">
            Reps{targetReps === 0 ? ' (max)' : ''}
          </label>
          <input
            type="number"
            inputMode="numeric"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={targetReps === 0 ? 'Max' : String(targetReps)}
            className="min-h-[44px] w-full rounded-md border border-gold/10 bg-deep-forest px-3 py-2 text-center text-stat text-foreground placeholder-muted-foreground shadow-[inset_0_1px_3px_rgba(0,0,0,0.3)] focus:border-gold/40 focus:shadow-[inset_0_1px_3px_rgba(0,0,0,0.3),0_0_0_1px_rgba(232,200,96,0.15)] focus:outline-none"
          />
        </div>
        <Button onClick={handleDone} size="sm" className="min-h-[44px] px-5">
          Done
        </Button>
      </div>

      {(showRealityMark || isBand) && (
        <div className="mt-3 flex items-center justify-between gap-3">
          {showRealityMark ? (
            <p className="font-cinzel text-[11px] uppercase tracking-[0.18em] text-gold/60">
              ◇ Noted
            </p>
          ) : (
            <span />
          )}
          {isBand && (
            <div className="flex items-center gap-1.5">
              {BAND_COLORS.map((band) => (
                <button
                  key={band.value}
                  type="button"
                  aria-label={`${band.label} band`}
                  onClick={() => setBandColor(band.value)}
                  className={`h-5 w-5 rounded-full border transition ${
                    bandColor === band.value ? 'border-gold scale-110' : 'border-gold/20'
                  }`}
                  style={{ backgroundColor: band.color }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {liveLoading && (
        <p className="mt-2.5 font-cinzel text-xs tracking-wider text-teal/70">
          {liveLoading}
        </p>
      )}
    </div>
  )
}

const BAND_COLORS = [
  { value: 'yellow', label: 'Yellow', color: '#E8D942' },
  { value: 'orange', label: 'Orange', color: '#E28D37' },
  { value: 'red', label: 'Red', color: '#C9473F' },
  { value: 'blue', label: 'Blue', color: '#315BC7' },
  { value: 'purple', label: 'Purple', color: '#6541A5' },
] as const
