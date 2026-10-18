import { CentredCard, FlapButton, TileChoice } from '@/design'

import { EFFORT_TILES } from './effort'

/**
 * After LOG SET: how many reps were left in the tank? Four big tiles
 * (3+ / 2 / 1 / 0). One tap, then rest starts. A centred card, not a tray.
 */
export function EffortCard({ setLabel, onPick, onSkip }: { setLabel?: string; onPick: (rir: 0 | 1 | 2 | 3) => void; onSkip: () => void }) {
  return (
    <CentredCard label="Reps left in the tank" head="Effort" headRight={setLabel ? <span className="wm-label">{setLabel}</span> : undefined}>
      <p className="wm-prose" style={{ fontSize: 18, fontWeight: 600 }}>How many left in the tank?</p>
      <TileChoice
        label="Reps left"
        columns={4}
        size="lg"
        options={EFFORT_TILES.map(t => ({ value: t.rir, label: t.label, sub: t.sub, tone: t.rir === 0 ? 'clay' : undefined }))}
        onPick={v => onPick(v)}
      />
      <p className="wm-prose is-dim" style={{ textAlign: 'center' }}>One tap. Rest starts.</p>
      <FlapButton label="SKIP" quiet onClick={onSkip} />
    </CentredCard>
  )
}
