import { useState } from 'react'

import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/Toast'
import { logger } from '@/lib/logger'

interface ComboForRating {
  comboId: string
  roundId: string
  text: string
}

interface ComboRatingScreenProps {
  sessionId: string
  combos: ComboForRating[]
  onComplete: (newFavourites: string[]) => void
}

export function ComboRatingScreen({ sessionId, combos, onComplete }: ComboRatingScreenProps) {
  // Default all to 'solid' (2)
  const [ratings, setRatings] = useState<Map<string, number>>(
    () => new Map(combos.map(c => [c.comboId, 2]))
  )
  const [submitting, setSubmitting] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const { show: showToast, ToastContainer } = useToast()

  function setRating(comboId: string, rating: number) {
    setRatings(prev => {
      const next = new Map(prev)
      next.set(comboId, rating)
      return next
    })
  }

  async function handleSubmit() {
    setSubmitting(true)
    setSaveError(null)
    try {
      const ratingData = combos.map(c => ({
        roundId: c.roundId,
        comboId: c.comboId,
        rating: ratings.get(c.comboId) ?? 2,
      }))

      const result = await apiFetch<{ success: boolean; newFavourites: string[] }>(
        `/api/sessions/${sessionId}/rate-combos`,
        { method: 'POST', body: JSON.stringify({ ratings: ratingData }) }
      )

      logger.sessionEvent('combo ratings saved', {
        sessionId,
        count: ratingData.length,
        newFavouritesCount: result.newFavourites?.length ?? 0,
      })
      onComplete(result.newFavourites ?? [])
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error('Failed to rate combos:', e)
      logger.error('session', 'combo ratings save failed', { sessionId, message }, 'POST /rate-combos failed. Ratings lost on reload.')
      setSaveError(message)
      showToast("Couldn't save ratings. Tap Retry or continue unrated.", 'warning')
      setSubmitting(false)
    }
  }

  function handleContinueUnrated() {
    logger.warn('session', 'combo ratings skipped after failure', { sessionId }, 'Combo ratings skipped after save failure. Session finished without them.')
    onComplete([])
  }

  // Deduplicate combos (same combo might appear in multiple rounds)
  const uniqueCombos = Array.from(
    combos.reduce((map, c) => {
      if (!map.has(c.comboId)) map.set(c.comboId, c)
      return map
    }, new Map<string, ComboForRating>()).values()
  )

  const ratingOptions = [
    { value: 1, label: 'Struggled', color: 'border-red-400/40 text-red-400' },
    { value: 2, label: 'Solid', color: 'border-gold/40 text-gold' },
    { value: 3, label: 'Sharp', color: 'border-teal/40 text-teal' },
  ]

  return (
    <div className="animate-fade-in space-y-5">
      <div className="text-center">
        <p className="font-cinzel text-xl tracking-wider text-foreground">Rate Your Combos</p>
        <p className="mt-1 text-xs text-muted-foreground">Tap to rate. Default is solid</p>
      </div>

      <div className="space-y-3">
        {uniqueCombos.map(c => {
          const currentRating = ratings.get(c.comboId) ?? 2
          return (
            <div key={c.comboId} className="rounded-md border border-border bg-deep-forest p-3">
              <p className="mb-2 text-sm text-foreground">{c.text}</p>
              <div className="flex gap-2">
                {ratingOptions.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setRating(c.comboId, opt.value)}
                    className={`flex min-h-[44px] flex-1 items-center justify-center rounded-md border px-2 text-xs font-medium transition-colors ${
                      currentRating === opt.value
                        ? opt.color + ' bg-surface'
                        : 'border-border text-muted-foreground'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <Button onClick={handleSubmit} disabled={submitting} size="lg" className="w-full">
        {submitting ? 'Saving...' : saveError ? 'Retry Save' : 'Continue'}
      </Button>

      {saveError && (
        <button
          onClick={handleContinueUnrated}
          className="mt-1 inline-flex min-h-[44px] w-full items-center justify-center px-3 text-center text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground/70 active:text-muted-foreground"
        >
          Continue Without Saving
        </button>
      )}

      <ToastContainer />
    </div>
  )
}
