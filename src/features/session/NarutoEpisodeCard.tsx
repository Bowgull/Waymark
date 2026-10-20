import { Board, CloseWord, FlapButton, FlapLabel, useDismissLayer } from '@/design'
import { NARUTO_EPISODES } from '@/lib/naruto'

import { narutoWatchedLine } from './narutoCard'
import './naruto.css'

/**
 * After an indoor run with Naruto (page 46 "Naruto: now on ep N?"): a centred
 * board on the veil. NOW ON EP 33?, one line, the episode on drums (fix it if
 * wrong), YES. One tap normally. SKIP or CLOSE leaves the episode as it was
 * (the run is already saved); a stray tap on the veil does nothing (page 61).
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
  useDismissLayer(!saving, onSkip)
  return (
    // page 61: a stray tap outside does nothing; SKIP and CLOSE are the ways past it
    <div className="ss-naruto">
      <div className="ss-naruto-col" role="dialog" aria-modal="true" aria-label="Naruto episode">
        <Board className="ss-naruto-bd" head="Naruto" headRight={<span className="wm-head-right"><FlapLabel text={`${minutes} MIN`} size="xs" animate={false} />{!saving && <CloseWord onClose={onSkip} />}</span>}>
          <FlapLabel text={`NOW ON EP ${proposed}?`} size="md" tone="gold" />
          <p className="ss-q ss-naruto-q">{narutoWatchedLine(watched)}</p>
          <div className="ss-drum2" role="group" aria-label="Episode">
            <button type="button" className="ss-ar" aria-label="Earlier episode" disabled={saving || proposed <= 1} onClick={() => onStep(-1)}>▼</button>
            <span className="ss-v" aria-live="polite"><FlapLabel text={String(proposed)} size="xl" tone="gold" /><span className="ss-u">ep</span></span>
            <button type="button" className="ss-ar" aria-label="Later episode" disabled={saving || proposed >= NARUTO_EPISODES} onClick={() => onStep(1)}>▲</button>
          </div>
          <div className="wm-btns" style={{ marginTop: 10 }}>
            <FlapButton label="SKIP" size="xs" disabled={saving} onClick={onSkip} />
            <FlapButton label="YES" primary size="sm" disabled={saving} onClick={onYes} />
          </div>
        </Board>
      </div>
    </div>
  )
}
