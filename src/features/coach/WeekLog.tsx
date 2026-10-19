import { useState } from 'react'

import { CentredCard, FlapButton, FlapLabel, SessionIcon } from '@/design'
import '@/design/pickers.css'
import { iconFor } from '@/features/dayboard/rowState'
import { mediumHaptic } from '@/lib/haptics'

import { logWhen, weekLog, type WeekChangesIn } from './changeView'
import { Rune } from './Rune'
import './coach.css'

/**
 * The week log (page 56 item 11): every change this week by day, his own
 * (no rune) and the coach's (the small rune), each with when, before ->
 * after, why, and UNDO; a started or done one says so instead. Opened from
 * the one quiet "N changes ›" line under Program's week.
 */
export function WeekLog({ week, weekNumber, onUndo, onClose }: { week: WeekChangesIn | null; weekNumber: number; onUndo: (id: string) => Promise<boolean>; onClose: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const days = weekLog(week)
  return (
    <CentredCard
      label={`Week ${weekNumber} changes`}
      onDismiss={onClose}
      head={`Week ${weekNumber} · changes`}
      headRight={<button type="button" className="wm-pk-cancel" onClick={onClose} aria-label="Close">Close</button>}
      className="wm-logb"
    >
      {days.length === 0 && <p className="wm-prose is-dim">No changes this week.</p>}
      {days.map(d => (
        <div key={d.day}>
          <div className="lday">{d.label}</div>
          {d.entries.map(({ change: c, who, tone, why, status }) => (
            <div key={c.id} className={`le${status === 'put back' ? ' is-off' : ''}`}>
              <SessionIcon kind={iconFor(c.session)} size={30} />
              <div className="lt">
                <div className="top2">
                  <span className="who">
                    {tone !== 'you' && <Rune state={c.kind === 'missed' ? 'missseen' : 'seen'} size="log" />}
                    <b className={tone === 'ember' ? 'e' : tone === 'you' ? 'y' : undefined}>{who}</b>&nbsp;· {logWhen(c)}
                  </span>
                  {status === 'undo'
                    ? <FlapButton label="UNDO" size="xs" tone="gold" disabled={busy === c.id} onClick={async () => { mediumHaptic(); setBusy(c.id); await onUndo(c.id); setBusy(null) }} />
                    : <span className="st">{status}</span>}
                </div>
                <span className="ba2">
                  {(c.logBefore ?? c.before) && <span className="old"><FlapLabel text={c.logBefore ?? c.before} size="xs" /></span>}
                  {(c.logBefore ?? c.before) && <span className="arr">→</span>}
                  <FlapLabel text={c.after} size="xs" tone="gold" />
                </span>
                <small>{why}</small>
              </div>
            </div>
          ))}
        </div>
      ))}
    </CentredCard>
  )
}
