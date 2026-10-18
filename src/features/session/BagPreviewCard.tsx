import { useEffect } from 'react'

import { CentredCard, FlapLabel, SessionIcon } from '@/design'
import { ComboStrikes, SessionButton } from '@/components/timers'
import { setWorldBackdrop } from '@/world/worldStore'

import './session.css'

interface PreviewRound {
  id: string
  roundNumber: number
  combos: { id: string; combo: { id: string; text: string } | null }[]
}

/**
 * Bag Work Preview (page 31): one centred board over the forest, like the
 * departures. The round count in brass ("6 ROUNDS") with "Tonight's combos",
 * then the numbered rounds with their combos as strike tiles and letters, and
 * BEGIN SESSION. Tapping outside returns to Today (the session stays open).
 */
export function BagPreviewCard({ rounds, letters, onBegin, onBack }: { rounds: PreviewRound[]; letters: Map<string, string>; onBegin: () => void; onBack?: () => void }) {
  useEffect(() => {
    setWorldBackdrop('clearing')
    return () => setWorldBackdrop(null)
  }, [])
  return (
    <CentredCard label="Bag Work Preview" head="Bag Work" headRight={<SessionIcon kind="bag" size={34} />} onDismiss={onBack} className="ss-card ss-preview">
      <div className="ss-preview-top">
        <FlapLabel text={`${rounds.length} ROUND${rounds.length === 1 ? '' : 'S'}`} size="md" tone="gold" />
        <span className="tm-note">Tonight&apos;s combos</span>
      </div>
      {rounds.map((r, i) => (
        <div key={r.id} className="ss-brow">
          <span className="ss-num">{String(i + 1).padStart(2, '0')}</span>
          <div className="ss-rcombos">
            {r.combos.filter(rc => rc.combo).map(rc => (
              <ComboStrikes key={rc.id} text={rc.combo!.text} letter={letters.get(rc.combo!.id)} size="xs" />
            ))}
          </div>
        </div>
      ))}
      <div className="wm-btns" style={{ marginTop: 12 }}>
        <SessionButton label="BEGIN SESSION" primary onClick={onBegin} />
      </div>
    </CentredCard>
  )
}
