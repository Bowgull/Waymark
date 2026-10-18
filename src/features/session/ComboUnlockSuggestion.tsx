import { useEffect, useState } from 'react'

import { CentredCard, FlapLabel } from '@/design'
import { ComboStrikes, SessionButton } from '@/components/timers'
import { apiFetch } from '@/lib/api'
import { setWorldBackdrop } from '@/world/worldStore'

import './session.css'

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

/**
 * New Combos Available (page 31): a centred card over the forest, only when the
 * server suggests some. The tier on a gold flap, the server's message, each combo
 * as strike tiles with a tick (all ticked by default), then UNLOCK n or NOT YET.
 */
export function ComboUnlockSuggestion({ suggestions, message, onDone }: ComboUnlockSuggestionProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(suggestions.map(s => s.id)))
  const [unlocking, setUnlocking] = useState(false)

  useEffect(() => {
    setWorldBackdrop('clearing')
    return () => setWorldBackdrop(null)
  }, [])

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
  const tierLabel = TIER_LABELS[tier] ?? tier

  return (
    <CentredCard
      label="New Combos Available"
      head="New Combos Available"
      headRight={tierLabel ? <FlapLabel text={tierLabel} size="xs" tone="gold" /> : undefined}
      className="ss-card"
    >
      <p className="wm-prose is-dim" style={{ margin: '0 0 6px' }}>{message}</p>
      <div role="group" aria-label="Combos to unlock">
        {suggestions.map(s => {
          const on = selected.has(s.id)
          return (
            <button key={s.id} type="button" role="checkbox" aria-checked={on} className="ss-tick" onClick={() => toggle(s.id)}>
              <span className={`ss-bx${on ? ' is-on' : ''}`} aria-hidden>{on ? '✓' : ''}</span>
              <ComboStrikes text={s.text} size="xs" />
            </button>
          )
        })}
      </div>
      <div className="wm-btns">
        <SessionButton label={unlocking ? 'UNLOCKING' : `UNLOCK ${selected.size}`} primary disabled={unlocking} onClick={() => void handleUnlock()} />
        <SessionButton label="NOT YET" disabled={unlocking} onClick={onDone} />
      </div>
    </CentredCard>
  )
}
