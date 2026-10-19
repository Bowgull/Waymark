import { Board, FlapButton, FlapLabel } from '@/design'
import { NARUTO_EPISODES } from '@/lib/naruto'

import { narutoWatchedLine } from './narutoCard'
import './naruto.css'

/**
 * After an indoor run with Naruto (page 46 "Naruto: now on ep N?"): a centred
 * board on the veil. NOW ON EP 33?, one line, the episode on drums (fix it if
 * wrong), YES. One tap normally. Tapping the veil leaves the episode as it was
 * (the run is already saved).
 */
export function NarutoEpisodeCard({ proposed, watched, minutes, saving, onStep, onYes, onSkip }: {
  proposed: number
  watched: number
  minutes: number
  saving: boolean
  onStep: (delta: number) => void
  onYes: () => void
  onSkip: () => void
}) {
  return (
    <div className="ss-naruto" onClick={e => { if (e.target === e.currentTarget && !saving) onSkip() }}>
      <div className="ss-naruto-col" role="dialog" aria-modal="true" aria-label="Naruto episode">
        <Board className="ss-naruto-bd" head="Naruto" headRight={<FlapLabel text={`${minutes} MIN`} size="xs" animate={false} />}>
          <FlapLabel text={`NOW ON EP ${proposed}?`} size="md" tone="gold" />
          <p className="ss-q ss-naruto-q">{narutoWatchedLine(watched)}</p>
          <div className="ss-drum2" role="group" aria-label="Episode">
            <button type="button" className="ss-ar" aria-label="Earlier episode" disabled={saving || proposed <= 1} onClick={() => onStep(-1)}>▼</button>
            <span className="ss-v" aria-live="polite"><FlapLabel text={String(proposed)} size="xl" tone="gold" /><span className="ss-u">ep</span></span>
            <button type="button" className="ss-ar" aria-label="Later episode" disabled={saving || proposed >= NARUTO_EPISODES} onClick={() => onStep(1)}>▲</button>
          </div>
          <div className="wm-btns" style={{ marginTop: 10 }}>
            <FlapButton label="YES" primary size="sm" disabled={saving} onClick={onYes} />
          </div>
        </Board>
      </div>
    </div>
  )
}
