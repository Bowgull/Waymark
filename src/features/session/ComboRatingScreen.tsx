import { useEffect, useState } from 'react'

import { CentredCard, FlapLabel } from '@/design'
import { ComboStrikes, Pips, SessionButton } from '@/components/timers'
import { apiFetch, idempotencyHeaders } from '@/lib/api'
import { useToast } from '@/components/ui/Toast'
import { logger } from '@/lib/logger'
import { setWorldBackdrop } from '@/world/worldStore'

import './session.css'

interface ComboForRating {
  comboId: string
  roundId: string
  text: string
}

interface ComboRatingScreenProps {
  sessionId: string
  combos: ComboForRating[]
  /** The session's combo letters (A, B, C…), as on the preview and the timer. */
  letters?: Map<string, string>
  onComplete: (newFavourites: string[]) => void
}

const OPTIONS = [
  { value: 1, label: 'STRUGGLED', cls: 'is-low', tone: 'clay' as const },
  { value: 2, label: 'SOLID', cls: '', tone: 'gold' as const },
  { value: 3, label: 'SHARP', cls: 'is-hi', tone: 'teal' as const },
]

/** Pause on the lit tile before the next combo flips in. */
const NEXT_MS = 260

/**
 * Rate your combos, one at a time (page 31 "Rating · one at a time (approved)"):
 * a centred card per combo over the forest, its strike tiles and letter, then
 * STRUGGLED (clay) / SOLID (brass, already lit) / SHARP (teal). A tap on any tile
 * (SOLID included) rates it and flips the next combo in; pips show where you
 * are. After the last, the ratings are saved as before (mastery, favourites,
 * future picks, unlocks).
 */
export function ComboRatingScreen({ sessionId, combos, letters, onComplete }: ComboRatingScreenProps) {
  // Deduplicate combos (same combo might appear in multiple rounds)
  const uniqueCombos = Array.from(
    combos.reduce((map, c) => {
      if (!map.has(c.comboId)) map.set(c.comboId, c)
      return map
    }, new Map<string, ComboForRating>()).values()
  )
  // Default all to 'solid' (2)
  const [ratings, setRatings] = useState<Map<string, number>>(() => new Map(combos.map(c => [c.comboId, 2])))
  const [idx, setIdx] = useState(0)
  const [lit, setLit] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const { show: showToast, ToastContainer } = useToast()

  useEffect(() => {
    setWorldBackdrop('clearing')
    return () => setWorldBackdrop(null)
  }, [])

  async function submit(final: Map<string, number>) {
    setSubmitting(true)
    setSaveError(null)
    try {
      const ratingData = combos.map(c => ({
        roundId: c.roundId,
        comboId: c.comboId,
        rating: final.get(c.comboId) ?? 2,
      }))
      const result = await apiFetch<{ success: boolean; newFavourites: string[] }>(
        `/api/sessions/${sessionId}/rate-combos`,
        { method: 'POST', headers: idempotencyHeaders(), body: JSON.stringify({ ratings: ratingData }) }
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

  function continueUnrated() {
    logger.warn('session', 'combo ratings skipped after failure', { sessionId }, 'Combo ratings skipped after save failure. Session finished without them.')
    onComplete([])
  }

  // No combos to rate: straight on.
  const empty = uniqueCombos.length === 0
  useEffect(() => {
    if (empty) void submit(new Map())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empty])

  const current = uniqueCombos[Math.min(idx, uniqueCombos.length - 1)]
  const done = idx >= uniqueCombos.length

  function rate(value: number) {
    if (!current || lit != null || submitting) return
    const next = new Map(ratings)
    next.set(current.comboId, value)
    setRatings(next)
    setLit(value)
    window.setTimeout(() => {
      setLit(null)
      setIdx(i => i + 1)
      if (idx + 1 >= uniqueCombos.length) void submit(next)
    }, NEXT_MS)
  }

  if (empty) return <ToastContainer />

  if (done && saveError) {
    return (
      <>
        <CentredCard label="Rate your combos" head="Rate your combos" className="ss-card">
          <p className="wm-prose is-dim">Couldn't save the ratings.</p>
          <SessionButton label={submitting ? 'SAVING' : 'RETRY SAVE'} primary disabled={submitting} onClick={() => void submit(ratings)} />
          <SessionButton label="CONTINUE WITHOUT SAVING" disabled={submitting} onClick={continueUnrated} />
        </CentredCard>
        <ToastContainer />
      </>
    )
  }

  const shown = current
  const value = lit ?? ratings.get(shown.comboId) ?? 2
  return (
    <>
      <CentredCard
        label="Rate your combos"
        head="Rate your combos"
        headRight={<FlapLabel text={`${Math.min(idx, uniqueCombos.length - 1) + 1} OF ${uniqueCombos.length}`} size="xs" />}
        className="ss-card ss-rate"
      >
        <div className="ss-rate-combo">
          <ComboStrikes key={shown.comboId} text={shown.text} letter={letters?.get(shown.comboId)} size="sm" />
        </div>
        <div role="radiogroup" aria-label="How did it go?">
          {OPTIONS.map(o => {
            const on = value === o.value
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={on}
                className={`ss-big3 ${o.cls}${on ? ' is-on' : ''}`}
                disabled={submitting}
                onClick={() => rate(o.value)}
              >
                <FlapLabel text={o.label} size="md" tone={on ? o.tone : 'ink'} />
              </button>
            )
          })}
        </div>
        <Pips total={uniqueCombos.length} now={Math.min(idx, uniqueCombos.length - 1)} small />
      </CentredCard>
      <ToastContainer />
    </>
  )
}
