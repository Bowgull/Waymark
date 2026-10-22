import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { Board, FlapButton, FlapLabel, useDismissLayer } from '@/design'
import { HeartContainer, type HeartState } from '@/components/heart/HeartContainer'
import { useToast } from '@/components/ui/Toast'
import { runRecorder, strapLine, type StrapStatus } from '@/lib/runRecorder'

// Settings' Connections board (page 74 §1, approved): it holds only the heart
// rate strap. One button, CONNECT HEART RATE STRAP; tapped, the heart shimmers
// while it looks ("Looking for it…"), then the row reads "COOSPO H9Z ·
// connected" and the heart beats. Tap the connected row for one small line in
// a command window (page 73): FORGET STRAP. No pairing list, no other screen.
// After that every run links it by itself.

/** The pixel cursor beside the command window's line (page 74 CURSOR). */
const CURSOR = (
  <svg viewBox="0 0 7 11" shapeRendering="crispEdges" aria-hidden className="st-hcur">
    <path fill="#f0d27a" d="M0 0h1v1h1v1h1v1h1v1h1v1h1v1H5v1H4v1H3v1H2v1H1v1H0z" />
    <path fill="#a87e2c" d="M1 2h1v1h1v1h1v1h1v1H4v1H3v1H2v1H1z" />
  </svg>
)

export function StrapBoard() {
  const { show: showToast } = useToast()
  const [status, setStatus] = useState<StrapStatus | null>(null)
  const [menu, setMenu] = useState(false)

  useEffect(() => {
    const rec = runRecorder()
    let alive = true
    rec.strapStatus().then(s => { if (alive) setStatus(s) }).catch(() => { if (alive) setStatus({ link: 'none', name: null }) })
    const off = rec.onStrap(s => setStatus(s))
    return () => { alive = false; off() }
  }, [])

  async function connect() {
    setStatus(s => ({ link: 'searching', name: s?.name ?? null }))
    try {
      setStatus(await runRecorder().connectStrap())
    } catch (e) {
      setStatus(await runRecorder().strapStatus().catch(() => ({ link: 'none' as const, name: null })))
      showToast(e instanceof Error && e.message ? e.message : 'No strap found. Try again.', 'warning')
    }
  }

  async function forget() {
    setMenu(false)
    await runRecorder().forgetStrap().catch(() => {})
    setStatus({ link: 'none', name: null })
  }

  const link = status?.link ?? 'none'
  const searching = link === 'searching'
  const known = link !== 'none' && !searching
  const heart: HeartState = searching ? 'search' : known ? 'under' : 'idle'

  return (
    <Board head="Connections" solid className="st-board">
      {known ? (
        <StrapRowConnected status={status} heart={heart} open={menu} onOpen={() => setMenu(true)} onClose={() => setMenu(false)} onForget={() => void forget()} />
      ) : (
        <>
          <div className="st-row st-strap">
            <span className="st-hcell"><HeartContainer size={18} state={heart} /></span>
            <div className="st-sl">
              <b>Heart rate strap</b>
              <small>{strapLine(status)}</small>
            </div>
          </div>
          {!searching && (
            <div className="st-sbtnrow">
              <FlapButton label="CONNECT HEART RATE STRAP" size="xs" className="st-wide" onClick={() => void connect()} />
            </div>
          )}
        </>
      )}
    </Board>
  )
}

function StrapRowConnected({ status, heart, open, onOpen, onClose, onForget }: { status: StrapStatus | null; heart: HeartState; open: boolean; onOpen: () => void; onClose: () => void; onForget: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null)
  useDismissLayer(open, onClose)
  // The window sits under the row, flush with its right edge (page 74 placeForget), in view.
  useLayoutEffect(() => {
    if (open) menuRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [open])
  return (
    <div className="st-strapwrap">
      <div
        className="st-row is-tap st-strap"
        role="button"
        tabIndex={0}
        aria-label={`Heart rate strap, ${strapLine(status)}. Options`}
        aria-expanded={open}
        onClick={onOpen}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      >
        <span className="st-hcell"><HeartContainer size={18} state={heart} bpm={status?.hr ?? 64} /></span>
        <div className="st-sl">
          <b>Heart rate strap</b>
          <small>{strapLine(status)}</small>
        </div>
        <span className="st-chev" aria-hidden>›</span>
      </div>
      {open && (
        <>
          <div className="st-hveil" onClick={onClose} aria-hidden />
          <div ref={menuRef} className="st-hmenu" role="menu" aria-label="Heart rate strap">
            <i className="pc a" /><i className="pc b" /><i className="pc c" /><i className="pc d" />
            <button type="button" role="menuitem" className="st-hline" onClick={onForget} aria-label="FORGET STRAP">
              {CURSOR}
              <FlapLabel text="FORGET STRAP" size="sm" />
            </button>
          </div>
        </>
      )}
    </div>
  )
}
