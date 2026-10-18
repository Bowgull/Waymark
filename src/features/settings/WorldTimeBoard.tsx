import { Board, FlapLabel } from '@/design'
import { TIME_OVERRIDES } from '@/world/timeOfDay'
import { setTimeOverride, useTimeOverride } from '@/world/useWorldTime'

/**
 * Settings · World · Time of day (page 37, approved): FOLLOW THE CLOCK /
 * ALWAYS MISTY / ALWAYS DAY / ALWAYS NIGHT. A look on this phone, kept on it.
 */
export function WorldTimeBoard() {
  const value = useTimeOverride()
  return (
    <Board head="World" solid>
      <p className="wm-label" style={{ marginBottom: 8 }}>Time of day</p>
      <div className="wm-tiles" role="radiogroup" aria-label="Time of day" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
        {TIME_OVERRIDES.map(o => {
          const on = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={o.label.toLowerCase()}
              className={`wm-choice${on ? ' is-on' : ''}`}
              style={{ minHeight: 52, padding: '8px 6px' }}
              onClick={() => setTimeOverride(o.value)}
            >
              <FlapLabel text={o.label} size="xs" tone={on ? 'gold' : 'ink'} fit />
            </button>
          )
        })}
      </div>
    </Board>
  )
}
