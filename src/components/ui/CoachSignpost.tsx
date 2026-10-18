import { AmPmFlap, CentredCard, Crest, FlapButton, FlapLabel, SessionIcon } from '@/design'
import '@/design/pickers.css'
import { mediumHaptic } from '@/lib/haptics'
import type { ReplaceSuggestion } from '@/lib/prompts/tools'

import { signpostRoads } from './departures'

export interface CoachSignpostProps {
  /** The coach is reading: the crest breathes, "Reading the signal." Not dismissable. */
  loading?: boolean
  /** The coach's line, in prose, above the post. */
  coachLine?: string
  /** The coach's suggestions; only the top 3 go on the post. */
  suggestions?: ReplaceSuggestion[]
  /** The Why swap reason, shown as a small flap in the heading (optional). */
  reason?: string
  /** Tap an arm: take that road. Receives the suggestion whole (runCategory kept). */
  onAccept?: (suggestion: ReplaceSuggestion) => void
  /** MORE OPTIONS: open the departures board. */
  onShowMore?: () => void
  onClose: () => void
}

/**
 * Replace, coach suggestions: a signpost, "Three roads" (design-decisions.md;
 * page 22 #rep, page 20 r3). The crest caps a wooden post; the coach's top 3
 * are arms, all pointing right, the first lit. MORE OPTIONS opens the
 * departures board.
 */
export function CoachSignpost({ loading = false, coachLine, suggestions, reason, onAccept, onShowMore, onClose }: CoachSignpostProps) {
  if (loading) {
    return (
      <CentredCard label="Coach is reading" head="Coach">
        <div className="wm-reading" role="status" aria-live="polite">
          <Crest big width={96} still className="wm-breathe" />
          <p className="wm-prose">Reading the signal.</p>
        </div>
      </CentredCard>
    )
  }

  const roads = signpostRoads(suggestions)

  function take(s: ReplaceSuggestion) {
    mediumHaptic()
    onAccept?.(s)
  }

  return (
    <CentredCard
      label="Coach suggestions"
      onDismiss={onClose}
      head="Coach"
      headRight={reason ? <FlapLabel text={reason} size="xs" /> : undefined}
    >
      {coachLine && <p className="wm-prose">{coachLine}</p>}

      {roads.length > 0 && (
        <div className="wm-post" role="group" aria-label="Three roads">
          <span className="wm-post-pole" aria-hidden />
          <Crest width={56} className="wm-post-cap" />
          <div className="wm-post-arms">
            {roads.map(({ suggestion: s, icon, lit }, i) => (
              <div key={`${s.type}-${s.runCategory ?? ''}-${s.timeSlot}-${i}`} className={`wm-arm-wrap${lit ? ' is-lit' : ''}`}>
                {/* a div, not a button: the AM / PM flap inside is itself a (read-only) button */}
                <div
                  role="button"
                  tabIndex={0}
                  className={`wm-arm${lit ? ' is-lit' : ''}`}
                  onClick={() => take(s)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); take(s) } }}
                  aria-label={`${lit ? "Coach's first choice: " : ''}${s.label}, ${s.timeSlot.toUpperCase()}. Swap it in`}
                >
                  <span className="wm-arm-face" aria-hidden>
                    <SessionIcon kind={icon} size={30} label="" />
                    <span className="wm-arm-name">
                      {s.label.trim().split(/\s+/).map((word, k) => (
                        <FlapLabel key={k} text={word} size="xs" />
                      ))}
                    </span>
                    <AmPmFlap slot={s.timeSlot} size="xs" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="wm-btns">
        <FlapButton label="MORE OPTIONS" onClick={onShowMore} />
        <FlapButton label="CLOSE" onClick={onClose} />
      </div>
    </CentredCard>
  )
}
