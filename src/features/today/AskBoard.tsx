import { useEffect, useRef, useState } from 'react'

import { AmPmFlap, CentredCard, FlapButton, FlapLabel, SessionIcon } from '@/design'
import { kgToLbs } from '@/lib/units'
import { stepTm, type AskChoice, type AskView } from './askView'

// The coach's ask as a centred flap board (page 36, approved): the question on
// a flap (a big icon for a session ask), one line of why, the proof as teal
// flap tiles, the choices as departure rows, flap buttons. Tap outside to
// leave it for later.

export interface AskBoardProps {
  view: AskView
  busy?: boolean
  /** Accept with a choice's body (option / slot / values). */
  onAccept: (body: Record<string, unknown>) => void
  /** NOT THIS WEEK / KEEP THE OLD ONES: changes nothing. */
  onDecline: () => void
  onLater: () => void
}

const HOLD_MS = 1200

export function AskBoard({ view, busy = false, onAccept, onDecline, onLater }: AskBoardProps) {
  const [picked, setPicked] = useState(0)
  const [pickDay, setPickDay] = useState(false)
  const [tm, setTm] = useState<Record<string, number>>(() => Object.fromEntries((view.tm ?? []).map(l => [l.exerciseId, l.proposedKg])))
  const choice: AskChoice | undefined = view.choices[picked]
  const go = () => {
    if (!choice) return
    if (choice.body) { onAccept(choice.body); return }
    if (choice.pick && choice.pick.length > 1) setPickDay(true)
  }

  // ANOTHER DAY, then DONE: which safe day (departure rows, as every picker).
  if (pickDay && choice?.pick) {
    return (
      <CentredCard label="Pick a safe day" head="Pick a safe day" onDismiss={busy ? undefined : () => setPickDay(false)} className="td-ask">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {choice.pick.map(p => (
            <button key={p.key} type="button" className="td-opt" disabled={busy} onClick={() => onAccept(p.body)}>
              {view.hero ? <SessionIcon kind={view.hero} size={44} /> : <span className="nok" aria-hidden>✕</span>}
              <span className="tx"><FlapLabel text={p.title} size="sm" fit /><small>Every week</small></span>
              {p.slot && <AmPmFlap slot={p.slot} size="xs" />}
            </button>
          ))}
        </div>
        <FlapButton label="BACK" size="xs" onClick={() => setPickDay(false)} disabled={busy} />
      </CentredCard>
    )
  }

  if (view.kind === 'tm_update' && view.tm) {
    // Page 36 #5: the board's heading, the why in plain prose, old → new per lift, − / +, hold to approve.
    return (
      <CentredCard label={view.flap} head={view.head ?? 'New targets'} headRight={<span className="wm-label">new targets</span>} onDismiss={busy ? undefined : onLater} className="td-tmcard">
        <p className="wm-prose" style={{ margin: 0 }}>{view.line}</p>
        <div>
          {view.tm.map(l => (
            <div key={l.exerciseId} className="td-tm">
              <span className="ln">{l.name}</span>
              <span className="old">{kgToLbs(l.currentKg)}</span>
              <span className="arr" aria-hidden>→</span>
              <button type="button" className="td-stp" aria-label={`${l.name} lower`} onClick={() => setTm(v => ({ ...v, [l.exerciseId]: stepTm(l, v[l.exerciseId], -1) }))}>−</button>
              <span className="nw" aria-live="polite">{kgToLbs(tm[l.exerciseId])}</span>
              <button type="button" className="td-stp" aria-label={`${l.name} higher`} onClick={() => setTm(v => ({ ...v, [l.exerciseId]: stepTm(l, v[l.exerciseId], 1) }))}>+</button>
            </div>
          ))}
        </div>
        <p className="td-lim">lbs · use − and + to adjust any of them</p>
        <div className="wm-btns"><HoldButton label="HOLD TO APPROVE" disabled={busy} onDone={() => onAccept({ option: 0, values: tm })} /></div>
        {view.decline && <div className="wm-btns"><FlapButton label={view.decline.title} size="xs" onClick={onDecline} disabled={busy} /></div>}
      </CentredCard>
    )
  }

  return (
    <CentredCard label={view.flap} onDismiss={busy ? undefined : onLater} className="td-ask">
      <div className="hero">
        {view.hero && <SessionIcon kind={view.hero} size={96} />}
        <FlapLabel text={view.flap} size="md" tone="gold" animate="mount" fit />
        <p className="q">{view.line}</p>
        {view.proof.length > 0 && (
          <div className="td-proof">
            {view.proof.map(p => <span key={p} className="td-pf"><FlapLabel text={p} size="sm" tone="teal" /></span>)}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }} role="radiogroup" aria-label="Choices">
        {view.choices.map((c, i) => (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={i === picked}
            className={`td-opt${i === picked ? ' is-on' : ''}`}
            onClick={() => setPicked(i)}
          >
            {c.icon ? <SessionIcon kind={c.icon} size={44} /> : <span className="nok" aria-hidden>✕</span>}
            <span className="tx">
              <FlapLabel text={c.title} size="sm" tone={i === picked ? 'gold' : 'ink'} fit />
              {c.sub && <small>{c.sub}</small>}
            </span>
            {c.slot && <AmPmFlap slot={c.slot} size="xs" />}
          </button>
        ))}
      </div>
      <div className="wm-btns">
        <FlapButton label={busy ? 'ONE MOMENT' : view.go} primary disabled={busy || !choice || (!choice.body && !(choice.pick && choice.pick.length > 1))} onClick={go} />
        {view.decline && <FlapButton label={view.decline.title} size="xs" onClick={onDecline} disabled={busy} />}
      </div>
    </CentredCard>
  )
}

/** Hold 1.2 s to approve (page 36): a brass fill runs along the button. */
function HoldButton({ label, onDone, disabled }: { label: string; onDone: () => void; disabled?: boolean }) {
  const [holding, setHolding] = useState(false)
  const timer = useRef<number | null>(null)
  const done = useRef(onDone)
  useEffect(() => { done.current = onDone }, [onDone])
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])
  const start = () => { if (disabled) return; setHolding(true); timer.current = window.setTimeout(() => { setHolding(false); done.current() }, HOLD_MS) }
  const stop = () => { if (timer.current) window.clearTimeout(timer.current); timer.current = null; setHolding(false) }
  return (
    <button
      type="button"
      className={`wm-btn is-primary td-hold${holding ? ' is-holding' : ''}`}
      disabled={disabled}
      aria-label={`${label}. Press and hold.`}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') done.current() }}
      onContextMenu={e => e.preventDefault()}
    >
      <FlapLabel text={label} size="md" tone="gold" fit />
    </button>
  )
}
