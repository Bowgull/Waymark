import { FlapLabel } from '@/design'
import { selectHaptic } from '@/lib/haptics'
import { toggleTile, type ReasonTile } from '@/components/ui/departures'

import './coach.css'

/**
 * Optional reason tiles (page 56 items 1-3): "WHY · optional", then one-tap
 * flap tiles. One lights (gold); a tap on the lit one clears it. No step of
 * their own: REPLACE and SKIP never wait on them.
 */
export function ReasonTiles({ tiles, value, onChange, label = true }: { tiles: ReadonlyArray<ReasonTile>; value: string | null; onChange: (next: string | null) => void; label?: boolean }) {
  return (
    <>
      {label && <div className="wm-whyl">Why <i>optional</i></div>}
      <div className="wm-rtiles" role="radiogroup" aria-label="Why, optional">
        {tiles.map(t => {
          const on = value === t.value
          return (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={t.label}
              className={`wm-rtile${on ? ' is-on' : ''}`}
              onClick={e => { e.stopPropagation(); selectHaptic(); onChange(toggleTile(value, t.value)) }}
            >
              <FlapLabel text={t.label} size="xs" tone={on ? 'gold' : 'ink'} animate={false} />
            </button>
          )
        })}
      </div>
    </>
  )
}
