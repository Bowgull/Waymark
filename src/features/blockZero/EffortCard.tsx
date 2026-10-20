import { CentredCard, FlapButton, FlapLabel } from '@/design'

import { EFFORT_TILES } from './effort'

/**
 * After LOG SET: how many reps were left? (page 17, "Effort after a set").
 * Four tiles, each a big flap and its word (3+ EASY, 2 SOLID, 1 HARD,
 * 0 LIMIT, 0 always clay); one tap and rest starts. Page 17 draws it as a
 * tray; every selection sits centre-screen (design-decisions rule), so the
 * same board is a centred card. A stray tap outside does nothing (page 61):
 * PASS (or CLOSE) moves on with no RIR saved.
 */
export function EffortCard({ setLabel, onPick, onSkip }: { setLabel?: string; onPick: (rir: 0 | 1 | 2 | 3) => void; onSkip: () => void }) {
  return (
    <CentredCard label={setLabel ? `How many reps were left? ${setLabel}` : 'How many reps were left?'} head="How many reps were left?" onDismiss={onSkip} closeOnOutside={false} className="wm-effort-card">
      <div className="wm-effort" role="group" aria-label="Reps left">
        {EFFORT_TILES.map(t => (
          <button key={t.rir} type="button" className="wm-effort-tile" aria-label={`${t.label}, ${t.sub}`} onClick={() => onPick(t.rir)}>
            <FlapLabel text={t.label} size="lg" tone={t.rir === 0 ? 'clay' : 'ink'} animate={false} />
            <span className="wm-label">{t.sub}</span>
          </button>
        ))}
      </div>
      <p className="wm-prose is-dim">One tap and rest starts.</p>
      <div className="wm-btns"><FlapButton label="PASS" size="xs" onClick={onSkip} /></div>
    </CentredCard>
  )
}
