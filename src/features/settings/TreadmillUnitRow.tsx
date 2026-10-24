import { FlapLabel } from '@/design'
import { tapHaptic } from '@/lib/haptics'
import { logger } from '@/lib/logger'
import type { TreadmillUnit } from '@/lib/runSpeed'
import { saveTreadmillUnit, useTreadmillUnit } from '@/lib/treadmillUnit'

import { SRow } from './settingsParts'
import './treadmillUnit.css'

const PLATES: ReadonlyArray<{ u: Exclude<TreadmillUnit, null>; text: string; len?: number }> = [
  { u: 'kmh', text: 'KM/H' },
  { u: 'mph', text: 'MPH', len: 4 },
]

/**
 * Settings › Training › Treadmill speed (page 76 §7): two plates, KM/H and
 * MPH. Tap one and it lights gold; every speed and pace follows it. Tap the
 * lit one again and neither is picked: both units show. The plate answers as
 * the finger lands; no letter flip.
 */
export function TreadmillUnitRow() {
  const unit = useTreadmillUnit()
  const pick = (u: Exclude<TreadmillUnit, null>) => {
    void tapHaptic()
    saveTreadmillUnit(unit === u ? null : u).catch(e => {
      logger.warn('system', 'treadmill unit save failed', { message: e instanceof Error ? e.message : String(e) }, 'PATCH /settings treadmillUnit failed. The phone shows the pick; the server has the old one.')
    })
  }
  return (
    <SRow label="Treadmill speed">
      <span className="st-useg" role="group" aria-label="Treadmill speed">
        {PLATES.map(p => {
          const on = unit === p.u
          return (
            <button key={p.u} type="button" className={`st-ubtn${on ? ' is-on' : ''}`} aria-pressed={on} aria-label={p.text === 'KM/H' ? 'Kilometres per hour' : 'Miles per hour'} onClick={() => pick(p.u)}>
              <FlapLabel text={p.text} size="xs" tone={on ? 'gold' : 'ink'} len={p.len} animate={false} />
            </button>
          )
        })}
      </span>
    </SRow>
  )
}
