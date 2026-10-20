import { useEffect, useState } from 'react'

import { CentredCard, FlapButton, FlapLabel, SessionIcon, showPop } from '@/design'
import { comboLine, unknownLine, type FoundLine } from '@/lib/classCombos'
import { setWorldBackdrop } from '@/world/worldStore'

import { addComboToBag, declineCombo, findCombos, refreshBagLibrary, type FoundResult } from './classCombosClient'
import './classLearned.css'

type LineState = FoundLine & { done?: 'added' | 'notnow' }

interface ClassLearnedFlowProps {
  sessionId: string
  mtLogId: string
  /** DONE, or Skip ›: on to the closing moment (or back to Today). */
  onDone: (outcome: 'saved' | 'skipped') => void
  /** In the session: the class log's forest behind the board (on Today, Today's own world). */
  backdrop?: boolean
}

/**
 * Page 49 sections 1-2: the step after CLOSE SESSION on an MT class. One box
 * (a note, a combo, or both) and a quiet Skip ›. FIND COMBOS saves the note
 * with tonight's class and lists every combo found as "Combo: Jab, Cross,
 * Lead hook": IN YOUR BAG, NEW (NOT NOW / ADD TO BAG) or LOCKED (ADD TO BAG
 * unlocks it). Strikes the app doesn't know are named once in clay. Nothing
 * found: NO COMBOS FOUND with EDIT and DONE.
 */
export function ClassLearnedFlow({ sessionId, mtLogId, onDone, backdrop = true }: ClassLearnedFlowProps) {
  const [note, setNote] = useState('')
  const [phase, setPhase] = useState<'write' | 'finding' | 'found'>('write')
  const [result, setResult] = useState<FoundResult | null>(null)
  const [lines, setLines] = useState<LineState[]>([])
  const [busy, setBusy] = useState<number | null>(null)

  // a fresh copy of the bag for the offline parser
  useEffect(() => { void refreshBagLibrary() }, [])
  useEffect(() => {
    if (!backdrop) return
    setWorldBackdrop('clearing')
    return () => setWorldBackdrop(null)
  }, [backdrop])

  async function find() {
    const text = note.trim()
    if (!text || phase === 'finding') return
    setPhase('finding')
    try {
      const r = await findCombos(sessionId, mtLogId, text)
      setResult(r)
      setLines(r.lines)
      setPhase('found')
    } catch {
      showPop("Couldn't save. Check your connection.", 'bad')
      setPhase('write')
    }
  }

  async function act(i: number, what: 'add' | 'notnow') {
    if (busy != null) return
    const line = lines[i]
    setBusy(i)
    try {
      if (what === 'add') await addComboToBag(sessionId, line.strikes)
      else await declineCombo(sessionId, line.strikes)
      setLines(ls => ls.map((l, j) => (j === i ? { ...l, done: what === 'add' ? 'added' : 'notnow' } : l)))
      if (what === 'add') showPop('ADDED TO BAG', 'good')
    } catch {
      showPop("Couldn't save. Check your connection.", 'bad')
    } finally {
      setBusy(null)
    }
  }

  if (phase !== 'found' || !result) {
    return (
      <CentredCard label="What you learned" head="What you learned" headRight={<SessionIcon kind="mt" size={30} />} className="cl-card">
        <p className="cl-dim">A note, a combo, or both. The coach pulls out the combos.</p>
        <textarea
          className="cl-note"
          aria-label="What you learned"
          value={note}
          maxLength={4000}
          onChange={e => setNote(e.target.value)}
          autoFocus
        />
        <div className="wm-btns cl-btns">
          <FlapButton label={phase === 'finding' ? 'FINDING' : 'FIND COMBOS'} primary size="sm" onClick={() => void find()} disabled={phase === 'finding' || !note.trim()} />
        </div>
        <div className="cl-skip">
          <button type="button" className="cl-lnk" onClick={() => onDone('skipped')}>Skip ›</button>
        </div>
      </CentredCard>
    )
  }

  // ── nothing could be found (page 49 section 2) ──
  if (lines.length === 0) {
    const unknown = [...result.unknown, ...result.off]
    return (
      <CentredCard label="No combos found" className="cl-card cl-none">
        <FlapLabel text="NO COMBOS FOUND" size="md" />
        <p className="cl-q">{unknown.length > 0 ? "These strikes aren't in the app, so there's no combo to add." : "No combo in that note. It's saved with tonight's class."}</p>
        {unknown.length > 0 && <p className="cl-dim cl-out">{unknownLine(unknown)}</p>}
        <div className="wm-btns cl-btns">
          <FlapButton label="EDIT" size="xs" onClick={() => setPhase('write')} />
          <FlapButton label="DONE" primary size="sm" onClick={() => onDone('saved')} />
        </div>
      </CentredCard>
    )
  }

  // ── every combo it found, one line each ──
  return (
    <CentredCard label="From tonight's class" head="From tonight's class" headRight={<FlapLabel text={`${lines.length} FOUND`} size="xs" tone="teal" />} className="cl-card">
      {lines.map((l, i) => (
        <div key={l.strikes.join('|')} className="cl-fl">
          <div className="cl-ln"><b>Combo:</b> {comboLine(l.strikes)}</div>
          <div className="cl-st">
            <span className="cl-stat">
              {l.status === 'in_bag'
                ? <FlapLabel text="IN YOUR BAG" size="xs" tone="teal" />
                : l.done === 'added'
                  ? <FlapLabel text="ADDED" size="xs" tone="teal" />
                  : l.status === 'new' ? <FlapLabel text="NEW" size="xs" tone="gold" /> : <FlapLabel text="LOCKED" size="xs" />}
              {l.done !== 'added' && <small>{l.done === 'notnow' ? 'Not now' : l.sub}</small>}
            </span>
            {l.done === 'added' && <SessionIcon kind="mt" size={24} className="cl-glove" label="From class" />}
          </div>
          {l.status !== 'in_bag' && !l.done && (
            <div className="cl-mini">
              <FlapButton label="NOT NOW" size="xs" onClick={() => void act(i, 'notnow')} disabled={busy != null} />
              <FlapButton label="ADD TO BAG" primary size="xs" onClick={() => void act(i, 'add')} disabled={busy != null} />
            </div>
          )}
        </div>
      ))}
      {result.unknown.length > 0 && <div className="cl-fl is-out"><div className="cl-ln">Not in the app: {result.unknown.map(u => u.toLowerCase()).join(', ')}.</div></div>}
      {result.off.length > 0 && <div className="cl-fl is-out"><div className="cl-ln">Off in Settings: {result.off.map(u => u.toLowerCase()).join(', ')}.</div></div>}
      <div className="wm-btns cl-btns is-done">
        <FlapButton label="DONE" primary size="sm" onClick={() => onDone('saved')} />
      </div>
    </CentredCard>
  )
}
