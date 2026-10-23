import { useEffect, useMemo, useState } from 'react'

import { FlapLabel, showPop } from '@/design'
import { applyFix, comboTextFor, deriveTechniques, gradeLevel, leaveOut, LEVEL_KEYS, nudgeLevel, readStrikes, readTypedCombo, type ComboLevel, type ReadToken } from '@/lib/classCombos'
import { Cmd } from '@/features/plan/CommandWindow'

import { LevelFlap, ReadFlaps, Slate } from './ComboPieces'
import { addTypedCombo, cachedBagLibrary, refreshBagLibrary, type AddedCombo } from './combosClient'

export interface NewCombo {
  /** As the library writes combos: "Jab → Cross → Switch Kick". */
  text: string
  level: ComboLevel
  /** The saved row (null while it waits in the outbox). */
  combo: AddedCombo | null
}

/**
 * NEW COMBO (page 80): the same window from the Library's + COMBO, the
 * + COMBO beside his class notes and the bag builder's + NEW COMBO. He types
 * it in words on the slate; READ IT shows it back as the app's strike flaps
 * (the class parser's techniques and lookup); a word it doesn't know is clay
 * and one tap offers likely fixes and LEAVE IT OUT; the grade is the Library's
 * tiers in plain words, ▼ ▲ nudge it one level ("set by you" after a nudge);
 * ADD waits until nothing unknown is left.
 */
export function NewComboWindow({ source, sessionId = null, noTabs = false, onAdded, onClose }: {
  source: 'mine' | 'class'
  sessionId?: string | null
  /** In a session (no tab bar): the window sits lower. */
  noTabs?: boolean
  onAdded: (c: NewCombo) => void
  onClose: () => void
}) {
  const [closing, setClosing] = useState(false)
  const [typed, setTyped] = useState('')
  const [read, setRead] = useState<ReadToken[] | null>(null)
  const [level, setLevel] = useState<ComboLevel>(1)
  const [nudged, setNudged] = useState(false)
  const [fixAt, setFixAt] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [lib, setLib] = useState(cachedBagLibrary)

  // the bag's techniques for reading it, offline too (kept fresh, never waited on)
  useEffect(() => { void refreshBagLibrary().then(l => { if (l) setLib(l) }) }, [])
  const techniques = useMemo(() => deriveTechniques((lib?.combos ?? []).map(c => c.text)), [lib])
  const enabled = useMemo(() => new Set(lib?.enabled ?? ['boxing', 'kicks', 'defensive']), [lib])

  const graded = (tokens: ReadonlyArray<ReadToken>) => gradeLevel(tokens.filter(t => t.kind === 'strike').map(t => (t.kind === 'strike' ? t.name : '')))
  const close = () => setClosing(true)

  function readIt() {
    if (!typed.trim()) return
    const tokens = readTypedCombo(typed, techniques, enabled)
    setRead(tokens)
    setLevel(graded(tokens))
    setNudged(false)
    setFixAt(null)
  }

  function fix(next: ReadToken[]) {
    setRead(next)
    setFixAt(null)
    if (!nudged) setLevel(graded(next))
  }

  async function add() {
    const strikes = read ? readStrikes(read) : null
    if (!strikes || busy) return
    setBusy(true)
    try {
      const difficulty = nudged && level !== gradeLevel(strikes) ? LEVEL_KEYS[level] : null
      const combo = await addTypedCombo(strikes, { source, sessionId, difficulty })
      onAdded({ text: combo?.text ?? comboTextFor(strikes), level, combo })
      close()
    } catch {
      showPop("Couldn't add it. Check your connection.", 'bad')
    } finally {
      setBusy(false)
    }
  }

  const unk = fixAt != null && read?.[fixAt]?.kind === 'unknown' ? read[fixAt] : null
  const blocked = !read || readStrikes(read) == null
  return (
    <Cmd anchor={null} place="bottom" closing={closing} onLeft={onClose} onDismiss={close} label="New combo" stayOnScroll className={`cmb-win${noTabs ? ' is-notabs' : ''}`}>
      <div className="pl-hdr"><FlapLabel text="NEW COMBO" size="xs" tone="gold" animate={false} /></div>
      {!read
        ? (
          <>
            <Slate value={typed} onChange={setTyped} label="Type the combo" onEnter={readIt} autoFocus />
            <div className="cmb-take">
              <button type="button" className="wm-btn is-primary" aria-label="Read it" disabled={!typed.trim()} onClick={readIt}>
                <FlapLabel text="READ IT" size="sm" tone="gold" animate={false} />
              </button>
            </div>
          </>
        )
        : (
          <div className="cmb-swap">
            <div className="cmb-read"><ReadFlaps tokens={read} onUnknown={i => setFixAt(fixAt === i ? null : i)} /></div>
            {unk && unk.kind === 'unknown' && fixAt != null && (
              <div className="cmb-fixes" role="group" aria-label="Fixes">
                {unk.fixes.map(f => (
                  <button key={f.name} type="button" className="cmb-chip" aria-label={f.name} onClick={() => fix(applyFix(read, fixAt, f))}>
                    <FlapLabel text={f.name.toUpperCase()} size="xs" animate={false} />
                  </button>
                ))}
                <button type="button" className="cmb-chip" aria-label="Leave it out" onClick={() => fix(leaveOut(read, fixAt))}>
                  <FlapLabel text="LEAVE IT OUT" size="xs" animate={false} />
                </button>
              </div>
            )}
            <div className="cmb-grade">
              <button type="button" className="cmb-nudge" aria-label="Easier" disabled={level <= 0} onClick={() => { setLevel(l => nudgeLevel(l, -1)); setNudged(true) }}>▼</button>
              <LevelFlap level={level} />
              <button type="button" className="cmb-nudge" aria-label="Harder" disabled={level >= 3} onClick={() => { setLevel(l => nudgeLevel(l, 1)); setNudged(true) }}>▲</button>
              {nudged && <span className="cmb-by">set by you</span>}
            </div>
            <div className="cmb-take">
              <button type="button" className="wm-btn" aria-label="Edit" onClick={() => { setRead(null); setFixAt(null) }}>
                <FlapLabel text="EDIT" size="sm" animate={false} />
              </button>
              <button type="button" className="wm-btn is-primary" aria-label="Add" disabled={blocked || busy} onClick={() => void add()}>
                <FlapLabel text="ADD" size="sm" tone="gold" animate={false} />
              </button>
            </div>
          </div>
        )}
    </Cmd>
  )
}
