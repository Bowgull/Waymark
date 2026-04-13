import { useState } from 'react'

import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'

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

  function setRating(comboId: string, rating: number) {
    setRatings(prev => {
      const next = new Map(prev)
      next.set(comboId, rating)
      return next
    })
  }

  async function handleSubmit() {
    setSubmitting(true)
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

      onComplete(result.newFavourites ?? [])
    } catch (e) {
      console.error('Failed to rate combos:', e)
      onComplete([])
    }
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
                    className={`flex-1 rounded-md border py-2 text-xs font-medium transition-colors ${
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
        {submitting ? 'Saving...' : 'Continue'}
      </Button>
    </div>
  )
}
