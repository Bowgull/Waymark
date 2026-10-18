import type { ReactNode } from 'react'

import { Board, FlapLabel } from '@/design'
import { TIME_OVERRIDES } from '@/world/timeOfDay'
import { setTimeOverride, useTimeOverride } from '@/world/useWorldTime'
import './settings.css'

/**
 * Settings · World · Time of day (page 37 A, approved): the label and its
 * line, then FOLLOW THE CLOCK / ALWAYS MISTY / ALWAYS DAY / ALWAYS NIGHT as
 * flap chips two to a row. The columns size to their words, as on the page,
 * so no label is cut. A look on this phone, kept on it. The board's other
 * rows (Haptics, Face ID for the Waybook) come in as children.
 */
export function WorldTimeBoard({ children }: { children?: ReactNode } = {}) {
  const value = useTimeOverride()
  return (
    <Board head="World" solid className="st-board">
      <div className="st-block">
        <div className="st-sl">
          <b>Time of day</b>
          <small>The forest follows the clock, or stays one way.</small>
        </div>
        <div className="st-tod" role="radiogroup" aria-label="Time of day">
          {TIME_OVERRIDES.map(o => {
            const on = o.value === value
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={o.label.toLowerCase()}
                className={`st-chip${on ? ' is-on' : ''}`}
                onClick={() => setTimeOverride(o.value)}
              >
                <FlapLabel text={o.label} size="xs" tone={on ? 'gold' : 'ink'} />
              </button>
            )
          })}
        </div>
      </div>
      {children}
    </Board>
  )
}
