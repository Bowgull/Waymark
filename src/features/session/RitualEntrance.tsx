import { useEffect, useRef, useState } from 'react'

import { FlapLabel, SESSION_ICON_NAME, SessionIcon, sessionIconFor, useReducedMotion } from '@/design'
import { setWorldBare } from '@/world/worldStore'

interface RitualEntranceProps {
  sessionType: string
  runCategory?: string | null
  onComplete: () => void
}

// The session entrance (design-decisions.md "Session icons"): the session's own
// painted icon over the dimmed, blurred forest, swaying slowly like the crest,
// with the session name (never WAYMARK). Fade in 0.4 s, hold about 1.2 s, fade
// out 0.4 s. Tap skips.
export const ENTRANCE_MS = { fadeIn: 400, hold: 1200, fadeOut: 400 } as const

export function RitualEntrance({ sessionType, runCategory, onComplete }: RitualEntranceProps) {
  const reduced = useReducedMotion()
  const [phase, setPhase] = useState<'in' | 'hold' | 'out'>('in')
  const doneRef = useRef(false)
  const icon = sessionIconFor(sessionType, runCategory)
  const name = SESSION_ICON_NAME[icon].toUpperCase()

  const finish = useRef(onComplete)
  useEffect(() => { finish.current = onComplete }, [onComplete])

  useEffect(() => {
    setWorldBare(true)
    const t1 = window.setTimeout(() => setPhase('hold'), ENTRANCE_MS.fadeIn)
    const t2 = window.setTimeout(() => setPhase('out'), ENTRANCE_MS.fadeIn + ENTRANCE_MS.hold)
    const t3 = window.setTimeout(() => { if (!doneRef.current) { doneRef.current = true; finish.current() } }, ENTRANCE_MS.fadeIn + ENTRANCE_MS.hold + ENTRANCE_MS.fadeOut)
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); window.clearTimeout(t3); setWorldBare(false) }
  }, [])

  const skip = () => { if (doneRef.current) return; doneRef.current = true; finish.current() }

  return (
    <div
      className={`wm-entrance is-${phase}`}
      role="button"
      tabIndex={0}
      aria-label={`${SESSION_ICON_NAME[icon]}. Tap to skip.`}
      onClick={skip}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') skip() }}
    >
      <div className={`wm-entrance-icon${reduced ? '' : ' is-sway'}`}>
        <SessionIcon kind={icon} size={168} />
      </div>
      <FlapLabel text={name} size="lg" tone="gold" animate={reduced ? false : 'mount'} />
    </div>
  )
}
