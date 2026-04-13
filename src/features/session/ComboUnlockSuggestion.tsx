import { useState } from 'react'

import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'

interface Suggestion {
  id: string
  text: string
  tier: string
  techniques: string
}

interface ComboUnlockSuggestionProps {
  suggestions: Suggestion[]
  message: string
  onDone: () => void
}

const TIER_LABELS: Record<string, string> = {
  foundation: 'Fundamentals',
  weapons: 'Weapons',
  flow: 'Flow',
  deception: 'Deception',
  mastery: 'Mastery',
}

export function ComboUnlockSuggestion({ suggestions, message, onDone }: ComboUnlockSuggestionProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(suggestions.map(s => s.id)))
  const [unlocking, setUnlocking] = useState(false)

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleUnlock() {
    if (selected.size === 0) { onDone(); return }
    setUnlocking(true)
    try {
      await apiFetch('/api/combos/unlock', {
        method: 'POST',
        body: JSON.stringify({ comboIds: Array.from(selected) }),
      })
      onDone()
    } catch (e) {
      console.error('Failed to unlock combos:', e)
      onDone()
    }
  }

  const tier = suggestions[0]?.tier ?? ''

  return (
    <div className="animate-fade-in space-y-5">
      <div className="text-center">
        <p className="font-cinzel text-xl tracking-wider text-gold">New Combos Available</p>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      </div>

      <div className="rounded-md border border-gold/30 bg-deep-forest p-4">
        <p className="mb-3 text-xs font-cinzel tracking-wider text-gold/70">
          {TIER_LABELS[tier] ?? tier}
        </p>
        <div className="space-y-2">
          {suggestions.map(s => (
            <button
              key={s.id}
              onClick={() => toggle(s.id)}
              className={`flex w-full items-center gap-3 rounded-md border p-3 text-left transition-colors ${
                selected.has(s.id)
                  ? 'border-gold/40 bg-gold/5'
                  : 'border-border bg-surface'
              }`}
            >
              <span className={`h-4 w-4 rounded-sm border ${
                selected.has(s.id) ? 'border-gold bg-gold' : 'border-border'
              }`}>
                {selected.has(s.id) && (
                  <svg viewBox="0 0 16 16" className="h-4 w-4 text-near-black">
                    <path fill="currentColor" d="M6.5 12L2 7.5 3.5 6l3 3 7-7L15 3.5z" />
                  </svg>
                )}
              </span>
              <span className="text-sm text-foreground">{s.text}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <Button variant="secondary" onClick={onDone} className="flex-1">
          Not Yet
        </Button>
        <Button onClick={handleUnlock} disabled={unlocking} className="flex-1">
          {unlocking ? 'Unlocking...' : `Unlock ${selected.size}`}
        </Button>
      </div>
    </div>
  )
}
