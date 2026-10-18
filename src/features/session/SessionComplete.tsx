import { useEffect, useState } from 'react'

import { FlapLabel } from '@/design'
import { SessionButton } from '@/components/timers'
import { completeHaptic } from '@/lib/haptics'
import { endLiveActivity } from '@/lib/liveActivity'
import { effortWord } from '@/lib/timers/timerLook'

import './session.css'

interface SessionCompleteProps {
  sessionType: string
  onFinish: (rpe: number, notes: string) => void
  submitting: boolean
}

/**
 * Closing, effort (page 19 #6 "Effort · ten flap tiles"): SESSION CLOSED and
 * "How was it?" on the dark, then a centred card: Effort with its word on a
 * gold flap (HARD), ten 64 px flap tiles (the pick gold), Very light … Max
 * effort, CLOSE SESSION. One tap, with wraps on. The moment follows the save.
 */
export function SessionComplete({ onFinish, submitting }: SessionCompleteProps) {
  const [rpe, setRpe] = useState(7)

  useEffect(() => {
    const now = Date.now()
    void endLiveActivity(
      {
        phase: 'complete',
        label: 'Session complete',
        startedAt: now,
        endsAt: now,
        isPaused: false,
        completeMessage: 'Tap to rate',
      },
      10_000,
    )
  }, [])

  function handleFinish() {
    completeHaptic()
    onFinish(rpe, '')
  }

  return (
    <div className="tm-screen ss-close">
      <div className="tm-ground" aria-hidden />
      <div className="tm-ui">
        <div className="ss-close-top">
          <FlapLabel text="SESSION CLOSED" size="md" tone="gold" />
          <p className="wm-prose" style={{ marginTop: 10 }}>How was it?</p>
        </div>
      </div>
      <div className="ss-veil" aria-hidden />
      <div className="wm-board is-solid ss-ccard" role="dialog" aria-modal="true" aria-label="Effort">
        <div className="wm-board-head">
          <span>Effort</span>
          <FlapLabel text={effortWord(rpe)} size="xs" tone="gold" len={11} />
        </div>
        <div className="ss-etiles" role="radiogroup" aria-label="Effort, 1 to 10">
          {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
            <button key={n} type="button" role="radio" aria-checked={rpe === n} aria-label={`${n}, ${effortWord(n).toLowerCase()}`} className="ss-etile" onClick={() => setRpe(n)}>
              <FlapLabel text={String(n)} size="md" len={2} tone={rpe === n ? 'gold' : 'ink'} />
            </button>
          ))}
        </div>
        <div className="ss-row" style={{ marginTop: 10 }}>
          <span className="wm-label">Very light</span>
          <span className="ss-grow" />
          <span className="wm-label">Max effort</span>
        </div>
        <div style={{ marginTop: 10 }}>
          <SessionButton label={submitting ? 'SAVING' : 'CLOSE SESSION'} primary disabled={submitting} onClick={handleFinish} />
        </div>
      </div>
    </div>
  )
}
