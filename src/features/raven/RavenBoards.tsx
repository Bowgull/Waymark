import { useState, type CSSProperties } from 'react'

import { CloseWord, FlapButton, FlapLabel, SessionIcon, useDismissLayer, usePullDown } from '@/design'
import { iconFor } from '@/features/dayboard/rowState'
import { mediumHaptic } from '@/lib/haptics'
import type { AskView, BoardView } from '@/lib/coach/bodyWatch'

import { RavenMark } from './Raven'
import './raven.css'

/** Rows flip in one after another (page 58: "rows flip in"). */
const flip = (i: number): CSSProperties => ({ animationDelay: `${i * 55}ms` })

/**
 * The raven's note (page 58 §4): a centred board, its rows flipping in. The
 * small raven in the corner, FROM THE COACH and the place on a flap; what the
 * coach noticed (his dates), why it matters, the plan with its set length,
 * exactly what it changes on his week, then GOT IT and DO IT. The same board
 * brings plan 2, the physio board and the good news.
 */
export function RavenNote({ view, onClose, onGot, onDoIt, onBetter }: {
  view: BoardView
  onClose: () => void
  onGot: () => Promise<void> | void
  onDoIt: () => Promise<void> | void
  onBetter: () => Promise<void> | void
}) {
  const [busy, setBusy] = useState(false)
  const centred = view.recs.length === 0
  const run = (fn: () => Promise<void> | void) => async () => {
    if (busy) return
    mediumHaptic()
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }
  useDismissLayer(true, onClose)
  const pull = usePullDown(onClose)
  let row = 0
  return (
    <>
      <div className="rv-veil" onClick={onClose} aria-hidden />
      <div className={`wm-board rv-adv${centred ? ' is-ask' : ''}`} role="dialog" aria-modal="true" aria-label={`From the raven: ${view.head}`} data-board={view.key} style={pull.dy ? { translate: `0 ${pull.dy}px` } : undefined}>
        <span className="wm-grab" aria-hidden {...pull.handlers} />
        <div className="rv-advt" style={flip(row++)} {...pull.handlers}>
          <RavenMark settled={view.settled} />
          <div className="tt">
            <span className="from">{view.from}</span>
            <FlapLabel text={view.head} size="sm" animate={false} />
          </div>
          <CloseWord onClose={onClose} className="rv-x" />
        </div>
        <div className="rv-scr">
          <div className="rv-sl" style={flip(row++)}>{view.sl1}</div>
          <div className="rv-recl" style={flip(row++)}>
            {view.rec.map((l, i) => (
              <div key={i} className={`ln${l.mine ? ' is-mine' : ''}`}>
                <span className="d">{l.d}</span>
                <span className="x">{l.x}{l.q != null && <q>{l.q}</q>}{l.tail ?? ''}</span>
              </div>
            ))}
          </div>
          {view.ctx && <p className="rv-voice is-dim" style={flip(row++)}>{view.ctx}</p>}
          <div className="rv-sl" style={flip(row++)}>{view.sl2}</div>
          <p className="rv-voice" style={flip(row++)}>{view.why}</p>
          {view.recs.length > 0 && view.sl3 && (
            <>
              <div className="rv-sl" style={flip(row++)}>{view.sl3}</div>
              <ol className="rv-recs" style={flip(row++)}>
                {view.recs.map((r, i) => <li key={i}><b>{r.b}</b>{r.rest}</li>)}
              </ol>
            </>
          )}
          {view.chg.length > 0 && (
            <>
              <div className="rv-sl" style={flip(row++)}>On your week</div>
              {view.chg.map((c, i) => (
                <div key={i} className="rv-chg" style={flip(row++)}>
                  <SessionIcon kind={iconFor({ type: c.type, notes: c.notes })} size={30} />
                  <div className="cx">
                    <span className="dd2">{c.days}</span>
                    <span className="ba2">
                      <span className="old"><FlapLabel text={c.before} size="xs" animate={false} /></span>
                      <span className="arr">→</span>
                      <FlapLabel text={c.after} size="xs" tone="gold" animate={false} />
                    </span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
        <p className="rv-clr" style={flip(row++)}>{view.foot}</p>
        <div className="rv-gotb" style={flip(row++)}>
          {view.btns.map((b, i) => {
            const last = i === view.btns.length - 1 && view.btns.length > 1
            const label = b === 'got' ? 'GOT IT' : b === 'doit' ? 'DO IT' : 'FEELS BETTER'
            const fn = b === 'got' ? onGot : b === 'doit' ? onDoIt : onBetter
            return <FlapButton key={b} label={label} primary={last} size={label.length > 8 ? 'xs' : 'sm'} tone={last ? 'gold' : 'ink'} className={`is-${b}`} disabled={busy} onClick={() => { void run(fn)() }} />
          })}
        </div>
      </div>
    </>
  )
}

/**
 * The raven's return (page 58 §4): one question. FEELS BETTER clears the sky
 * and steps the plan back up; STILL SORE gets one more plan (once). "Not
 * now" waits a day; the plan carries on as written.
 */
export function RavenAsk({ ask, onBetter, onSore, onNotNow, onClose }: {
  ask: AskView
  onBetter: () => Promise<void> | void
  onSore: () => Promise<void> | void
  onNotNow: () => Promise<void> | void
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const run = (fn: () => Promise<void> | void) => async () => {
    if (busy) return
    mediumHaptic()
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }
  useDismissLayer(true, onClose)
  const pull = usePullDown(onClose)
  return (
    <>
      <div className="rv-veil" onClick={onClose} aria-hidden />
      <div className="wm-board rv-adv is-ask" role="dialog" aria-modal="true" aria-label={`The raven: ${ask.head}`} data-board="ask" style={pull.dy ? { translate: `0 ${pull.dy}px` } : undefined}>
        <span className="wm-grab" aria-hidden {...pull.handlers} />
        <div className="rv-advt" style={flip(0)} {...pull.handlers}>
          <RavenMark />
          <div className="tt">
            <span className="from">The raven · {ask.when}</span>
            <FlapLabel text={ask.head} size="sm" animate={false} />
          </div>
          <CloseWord onClose={onClose} className="rv-x" />
        </div>
        <p className="rv-voice" style={flip(1)}>{ask.line}</p>
        <div className="rv-atiles" style={flip(2)}>
          <FlapButton label="FEELS BETTER" size="sm" tone="teal" className="is-fb" disabled={busy} onClick={() => { void run(onBetter)() }} />
          <FlapButton label="STILL SORE" size="sm" tone="clay" className="is-ss" disabled={busy} onClick={() => { void run(onSore)() }} />
        </div>
        <button type="button" className="wm-label rv-notnow" style={flip(3)} disabled={busy} onClick={() => { void run(onNotNow)() }}>Not now · ask me tomorrow</button>
      </div>
    </>
  )
}
