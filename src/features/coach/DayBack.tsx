import { useLayoutEffect, useRef, useState } from 'react'

import { FlapButton, FlapLabel, SessionIcon } from '@/design'
import { sessionDisplayName, iconFor } from '@/features/dayboard/rowState'
import { mediumHaptic } from '@/lib/haptics'

import { backPut, backUntil, backWho, backWhy, type ChangeViewIn } from './changeView'
import { Rune } from './Rune'
import './coach.css'

/**
 * The day's back (page 56 item 8): tap a day with a rune and it opens in
 * place under the strip, its notch under the tile: who and when, before ->
 * after on flaps, one plain why with real numbers, and UNDO until the
 * session starts. Once undone: PUT BACK and what the coach does now.
 * Render it inside the strip's `position: relative` wrapper; `day` is the
 * tile's epoch day (the tile carries data-day).
 */
export function DayBack({ day, changes, todayDay, onUndo, onClose }: {
  day: number
  changes: ChangeViewIn[]
  todayDay: number
  onUndo: (id: string) => Promise<boolean>
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [notch, setNotch] = useState<number | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useLayoutEffect(() => {
    const back = ref.current
    const wrap = back?.parentElement
    const tile = wrap?.querySelector<HTMLElement>(`[data-day="${day}"]`)
    if (!back || !tile) return
    const b = back.getBoundingClientRect()
    const t = tile.getBoundingClientRect()
    setNotch(t.left + t.width / 2 - b.left - 7)
  }, [day])

  const ember = changes.some(c => c.kind === 'missed')
  return (
    <>
      <div className="wm-veil3 is-lite" onClick={onClose} aria-hidden />
      <div ref={ref} className={`wm-board wm-tback${ember ? ' is-ember' : ''}`} role="dialog" aria-label="What changed this day">
        <span className="notch" style={notch != null ? { left: notch } : { visibility: 'hidden' }} />
        {changes.map((c, i) => {
          const name = sessionDisplayName(c.session)
          const who = backWho(c, name)
          const undone = c.lock === 'undone'
          const put = backPut(c, todayDay)
          return (
            <div key={c.id} className={`wm-tchange${i > 0 ? ' is-ruled' : ''}`}>
              {undone ? (
                <div className="putb">
                  <FlapLabel text="PUT BACK" size="sm" tone="teal" />
                  <p className="voice">{put.line}</p>
                  <p className="voice dim">{put.dim}</p>
                </div>
              ) : (
                <div className="live">
                  <div className="who">
                    <Rune state={c.kind === 'missed' ? 'miss' : 'new'} size="log" />
                    <b className={who.tone === 'ember' ? 'e' : who.tone === 'you' ? 'y' : undefined}>{who.word}</b>&nbsp;· {who.rest}
                  </div>
                  <div className="chx" style={{ marginTop: 8 }}>
                    <SessionIcon kind={iconFor(c.session)} size={40} />
                    <div className="cx">
                      <FlapLabel text={name.toUpperCase()} size="sm" />
                      <span className="ba2">
                        {c.before && <span className="old"><FlapLabel text={c.before} size="xs" /></span>}
                        {c.before && <span className="arr">→</span>}
                        <FlapLabel text={c.after} size="xs" tone="gold" />
                      </span>
                    </div>
                  </div>
                  <p className="voice" style={{ marginTop: 8 }}>{backWhy(c, todayDay)}</p>
                  {c.detail && <p className="voice dim" style={{ marginTop: 4 }}>{c.detail}</p>}
                  <div className="uline" style={{ marginTop: 8 }}>
                    <span className="until">{backUntil(c, todayDay)}</span>
                    {c.lock === 'open' && (
                      <FlapButton
                        label="UNDO"
                        size="xs"
                        tone="gold"
                        disabled={busy === c.id}
                        onClick={async () => { mediumHaptic(); setBusy(c.id); await onUndo(c.id); setBusy(null) }}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
