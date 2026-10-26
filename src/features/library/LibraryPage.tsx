import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode, type TouchEvent } from 'react'

import { useNavigate, useSearchParams } from 'react-router-dom'
import { Board, Crest, FlapLabel, SceneWindow, SessionIcon, showPop, useEdgeBack } from '@/design'
import { apiFetch } from '@/lib/api'
import type { LibraryHintData } from '@/lib/libraryHints'
import { markWaybookOpen, requireUnlock, setWaybookShown } from '@/lib/waybookGate'
import { comboLevel, type ComboLevel } from '@/lib/classCombos'
import { ComboLine, LevelFlap } from '@/features/combos/ComboPieces'
import { NewComboWindow, type NewCombo } from '@/features/combos/NewComboWindow'
import { refreshBagLibrary } from '@/features/combos/combosClient'

import {
  EXERCISE_GROUPS,
  GROUPS,
  bagCount,
  bagShelves,
  bookPages,
  comboStrikes,
  entryDateLine,
  entryParagraphs,
  equipmentName,
  exerciseCounts,
  isGroupKey,
  isMorningNote,
  combosUsing,
  listed,
  matchCombo,
  matchEntry,
  matchExercise,
  matchRun,
  muscleBadges,
  techniqueHits,
  techniqueFor,
  type BookPage,
  type GroupKey,
  type LibraryCombo,
  type LibraryExercise,
  type LibraryJournalEntry,
  type LibraryRun,
  type LibraryTechnique,
} from './libraryModel'
import { ComboPage, ExercisePage, RunPage, Strikes, TechniquePage } from './LibraryItems'
import { useWaybookUnlocked } from './useWaybookUnlocked'
import './library.css'

// The Library (page 21 + page 39, approved): over the rune arch. The list is
// page 39's six groups (painted icon, flap name, count); a group opens on its
// own board (page 21 "An exercise, opened"); Bagwork opens mine first, by type
// (page 93: HANDS, KICKS, TEEPS, KNEES and ELBOWS when on, then one folded
// LOCKED head by level); the Waybook opens as an old book
// page (page 21 B), behind Face ID when that's on (page 21 "Locked").
// The Library holds no history and no PRs; combos unlock only after a bag
// session, never from here; the Waybook is read-only.

/** The whole book: every reflection, one page per month. */
const BOOK_DAYS = 3650

/** A group open (page 46 "Getting back"): ‹ LIBRARY in gold, top left, back to the list; on an item, ‹ and its kind (page 52). */
function BackHeader({ onBack, label = 'LIBRARY' }: { onBack: () => void; label?: string }) {
  return (
    <header className="lib-head is-back wm-scene-hd">
      <button type="button" className="lib-bk" onClick={onBack} aria-label={label === 'LIBRARY' ? 'Back to the Library' : `Back to ${label.toLowerCase()}`}>‹ {label}</button>
    </header>
  )
}

/** The header: the small crest and LIBRARY on a flap. On the Waybook, the crest goes back to the list. */
function LibraryHeader({ onBack }: { onBack?: () => void }) {
  const inner = (
    <>
      <span className="lib-crest"><Crest width={52} /></span>
      <FlapLabel text="LIBRARY" size="sm" />
    </>
  )
  return (
    <header className="lib-head wm-scene-hd">
      {onBack
        ? <button type="button" className="lib-brand" onClick={onBack} aria-label="Library">{inner}</button>
        : <span className="lib-brand">{inner}</span>}
    </header>
  )
}

// ─── pieces ───────────────────────────────────────────────────

/**
 * A combo in its tier (page 80): only the strikes and the difficulty in plain
 * words on one flap. How close he is to mastering it, the favourite and where
 * it came from stay on the combo's own page. A tap opens that page (page 52).
 */
function ComboRow({ combo, onOpen }: { combo: LibraryCombo; onOpen: () => void }) {
  const keys = (e: { key: string; preventDefault: () => void }) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }
  if (!combo.unlocked) {
    return (
      <div className="lib-combo is-locked" role="button" tabIndex={0} onClick={onOpen} onKeyDown={keys}>
        <Strikes text={combo.text} />
        <span className="lib-lock" aria-label="Locked">⚿</span>
      </div>
    )
  }
  return (
    <div className="lib-combo" role="button" tabIndex={0} onClick={onOpen} onKeyDown={keys}>
      <Strikes text={combo.text} />
      <LevelFlap level={comboLevel(combo)} />
    </div>
  )
}

/** A list row (page 21 / 52): name, equipment, muscle badges, ▶ when it has a video, ›. */
function ExerciseRow({ ex, onOpen }: { ex: LibraryExercise; onOpen: () => void }) {
  const badges = muscleBadges(ex.muscleGroups)
  const eq = equipmentName(ex.equipment)
  return (
    <div
      className="lib-ex is-row"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
    >
      <div className="t">
        <div className="lib-ex-top">
          <span className="lib-ex-nm">{ex.name}</span>
          {eq && <span className="lib-ex-eq">{eq}</span>}
        </div>
        {badges.length > 0 && <div className="lib-badges">{badges.map(b => <span key={b} className="lib-badge">{b}</span>)}</div>}
      </div>
      {ex.formVideoUrl && <span className="lib-play" aria-label="has a video">▶</span>}
      <span className="lib-chev2" aria-hidden>›</span>
    </div>
  )
}

/** A technique or a run in its list: name, one line, ›. */
function PlainRow({ name, sub, onOpen }: { name: string; sub: string; onOpen: () => void }) {
  return (
    <div className="lib-ex is-row" role="button" tabIndex={0} onClick={onOpen} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}>
      <div className="t"><div className="lib-ex-nm">{name}</div><div className="lib-ex-sub">{sub}</div></div>
      <span className="lib-chev2" aria-hidden>›</span>
    </div>
  )
}

/** A group's head when it's open (page 21): ▾, the name on a padded flap, the count. */
function GroupHead({ name, count, len, size = 'md', open = true, locked = false, className, onClick }: { name: string; count?: string; len: number; size?: 'md' | 'sm'; open?: boolean; locked?: boolean; className?: string; onClick?: () => void }) {
  return (
    <button type="button" className={`lib-grp${className ? ` ${className}` : ''}`} onClick={onClick} disabled={!onClick} aria-expanded={open}>
      <span className="lib-chev" aria-hidden>{open ? '▾' : '▸'}</span>
      <FlapLabel text={name} size={size} len={len} />
      {/* page 93: a locked head shows the lock and its count (an older locked tier: the lock alone) */}
      {locked && <span className="lib-lock" aria-label="Locked">⚿</span>}
      {count != null && <span className="lib-cnt">{count}</span>}
    </button>
  )
}

/** One page of the Waybook (page 21 B): the month, dated entries, a gold drop cap. */
function BookEntries({ page }: { page: Pick<BookPage, 'head' | 'entries'> }) {
  return (
    <>
      <h2 className="lib-book-h">{page.head}</h2>
      {page.entries.map(e => (
        <div key={e.id} className="lib-book-e">
          <div className="lib-book-d">{entryDateLine(e)}{isMorningNote(e) && <span className="lib-book-tg">MORNING</span>}</div>
          {entryParagraphs(e.content).map((p, i) => (
            <p key={i} className={`lib-book-p${i === 0 ? ' has-cap' : ''}`}>{p}</p>
          ))}
        </div>
      ))}
    </>
  )
}

function WaybookBook({ entries, loaded }: { entries: LibraryJournalEntry[]; loaded: boolean }) {
  const pages = useMemo(() => bookPages(entries), [entries])
  const [index, setIndex] = useState(0)
  const touch = useRef<{ x: number; y: number } | null>(null)
  const page = pages[Math.min(index, Math.max(0, pages.length - 1))]

  // swipe for the next month (left = older, right = newer)
  function onTouchStart(e: TouchEvent) {
    const t = e.touches[0]
    touch.current = { x: t.clientX, y: t.clientY }
  }
  function onTouchEnd(e: TouchEvent) {
    const s = touch.current
    touch.current = null
    if (!s) return
    const t = e.changedTouches[0]
    const dx = t.clientX - s.x
    const dy = t.clientY - s.y
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    setIndex(i => Math.max(0, Math.min(pages.length - 1, i + (dx < 0 ? 1 : -1))))
  }

  return (
    <article key={page?.key ?? 'none'} className="lib-book is-turn" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} aria-label="The Waybook">
      {page
        ? <BookEntries page={page} />
        : loaded && <p className="lib-book-empty">No entries yet.</p>}
    </article>
  )
}

// ─── the page ─────────────────────────────────────────────────

export function LibraryPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const openParam = params.get('open')
  const open: GroupKey | null = isGroupKey(openParam) ? openParam : null
  // page 52: every item opens to its own page (?open=<kind>&item=<id>)
  const itemId = params.get('item')

  const [exercises, setExercises] = useState<LibraryExercise[]>([])
  const [combos, setCombos] = useState<LibraryCombo[]>([])
  const [techniques, setTechniques] = useState<LibraryTechnique[]>([])
  const [runs, setRuns] = useState<LibraryRun[]>([])
  const [loaded, setLoaded] = useState(false)
  // page 60's live hints (his last set, this week's run-walk); the static hint until they load
  const [hints, setHints] = useState<LibraryHintData | null>(null)
  const [entries, setEntries] = useState<LibraryJournalEntry[]>([])
  const [entriesLoaded, setEntriesLoaded] = useState(false)
  const [search, setSearch] = useState('')
  // a search group shown whole (its header was tapped)
  const [allOf, setAllOf] = useState<string | null>(null)
  // page 93: Bagwork's one open group (a weapon, or 'locked'), and the level open under LOCKED; all folded at first
  const [openShelf, setOpenShelf] = useState<string | null>(null)
  const [openLevel, setOpenLevel] = useState<string | null>(null)
  // his Settings switches: KNEES and ELBOWS groups show only when on (read with the list)
  const [enabled, setEnabled] = useState<ReadonlySet<string>>(() => new Set(['boxing', 'kicks', 'defensive']))
  const unlocked = useWaybookUnlocked()
  // page 80: + COMBO's window, and the combos he just added (NEW, at the top, easing in)
  const [adding, setAdding] = useState(false)
  const [fresh, setFresh] = useState<Array<{ key: string; id: string | null; text: string; level: ComboLevel }>>([])
  const freshIds = useMemo(() => new Set(fresh.map(f => f.id).filter(Boolean)), [fresh])

  // the bag's techniques for reading a typed combo, read ahead (nothing loads after a tap)
  useEffect(() => { void refreshBagLibrary() }, [])

  function added(c: NewCombo) {
    setFresh(list => [{ key: `${Date.now()}`, id: c.combo?.id ?? null, text: c.text, level: c.level }, ...list])
    const row = c.combo
    // the server's row is the whole combo: it joins its tier (shown up top as NEW while he's here)
    if (row) setCombos(list => [...list.filter(x => x.id !== row.id), row as unknown as LibraryCombo])
  }

  useEffect(() => {
    let live = true
    Promise.all([
      apiFetch<LibraryExercise[]>('/api/exercises').catch(() => [] as LibraryExercise[]),
      apiFetch<LibraryCombo[]>('/api/combos').catch(() => [] as LibraryCombo[]),
      apiFetch<LibraryTechnique[]>('/api/library/techniques').catch(() => [] as LibraryTechnique[]),
      apiFetch<LibraryRun[]>('/api/library/runs').catch(() => [] as LibraryRun[]),
      apiFetch<{ enabledTechniques?: string | null } | null>('/api/settings').catch(() => null),
    ]).then(([ex, co, te, ru, st]) => {
      if (!live) return
      if (st?.enabledTechniques) setEnabled(new Set(st.enabledTechniques.split(',').filter(Boolean)))
      // an item folded into another (Spiderman + T-Spine) is not listed
      setExercises(Array.isArray(ex) ? ex.filter(listed) : [])
      setCombos(Array.isArray(co) ? co : [])
      setTechniques(Array.isArray(te) ? te : [])
      setRuns(Array.isArray(ru) ? ru : [])
      setLoaded(true)
    })
    apiFetch<LibraryHintData>('/api/library/hints')
      .then(h => { if (live && h && typeof h === 'object' && h.lastSets) setHints(h) })
      .catch(() => { /* the static hints stand */ })
    return () => { live = false }
  }, [])

  // the journal loads only once the Waybook is readable (never behind the lock)
  useEffect(() => {
    if (!unlocked || entriesLoaded) return
    let live = true
    apiFetch<LibraryJournalEntry[]>(`/api/journal/history?days=${BOOK_DAYS}`)
      .then(rows => { if (live) { setEntries(Array.isArray(rows) ? rows : []); setEntriesLoaded(true) } })
      .catch(e => { console.error('Failed to load the Waybook:', e); if (live) setEntriesLoaded(true) })
    return () => { live = false }
  }, [unlocked, entriesLoaded])

  const shelves = useMemo(() => bagShelves(combos.filter(c => !freshIds.has(c.id)), enabled), [combos, freshIds, enabled])
  const counts = useMemo(() => exerciseCounts(exercises), [exercises])
  // page 52: each technique with how many combos use it, most used first
  const techRows = useMemo(() => techniques
    .map(t => ({ t, n: combosUsing(t, combos, techniques).length }))
    .sort((a, b) => b.n - a.n), [techniques, combos])

  const historyIdx = () => ((window.history.state as { idx?: number } | null)?.idx ?? 0)

  function go(key: GroupKey | null) {
    setSearch('')
    setAllOf(null)
    setOpenShelf(null)
    setOpenLevel(null)
    // page 61: a group or the Waybook pages are a step in history, so web back and the edge swipe close them
    if (key) setParams({ open: key })
    else if (historyIdx() > 0 && open) navigate(-1)
    else setParams({}, { replace: true })
  }

  /** An item's page: a step in history too. */
  function openItem(kind: GroupKey, id: string) {
    setParams({ open: kind, item: id })
  }

  /** "and 23 more ›" on a technique's MORE (page 65): the list, searching for it. */
  function searchFor(q: string) {
    setAllOf(null)
    setOpenShelf(null)
    setOpenLevel(null)
    setParams({})
    setSearch(q)
  }

  function closeItem() {
    if (historyIdx() > 0) navigate(-1)
    else if (open) setParams({ open }, { replace: true })
  }

  async function toggleFavourite(id: string) {
    const before = combos
    setCombos(list => list.map(c => (c.id === id ? { ...c, isFavourite: c.isFavourite ? 0 : 1 } : c)))
    try {
      const updated = await apiFetch<LibraryCombo>(`/api/combos/${id}/favourite`, { method: 'PATCH' })
      if (updated && typeof updated === 'object' && 'id' in updated) setCombos(list => list.map(c => (c.id === id ? updated : c)))
    } catch (e) {
      console.error('Failed to toggle favourite:', e)
      setCombos(before)
      showPop("Couldn't save. Check your connection.", 'bad', { title: "COULDN'T SAVE", durationMs: 4000 })
    }
  }

  const back = () => go(null)
  useEdgeBack(itemId ? closeItem : open ? back : null)

  // Tapping Waybook asks Face ID (iOS's own prompt) before the pages open; cancel stays on the list.
  async function openWaybook() {
    if (await requireUnlock('Open the Waybook')) go('waybook')
  }

  // On the pages without a fresh unlock (a link straight in, or back from another app): ask, or back to the list.
  const asking = useRef(false)
  useEffect(() => {
    if (open !== 'waybook' || unlocked || asking.current) return
    asking.current = true
    void requireUnlock('Open the Waybook').then(ok => {
      asking.current = false
      if (!ok) setParams({}, { replace: true })
    })
  }, [open, unlocked, setParams])

  // The 3 minutes count from the last time the pages were open.
  useEffect(() => {
    if (open !== 'waybook' || !unlocked) return
    setWaybookShown(true)
    return () => { markWaybookOpen(); setWaybookShown(false) }
  }, [open, unlocked])

  // ── an item, opened (page 52 / 60) ──
  if (open && itemId) {
    const g = GROUPS.find(x => x.key === open)!
    let body: ReactNode = null
    if (EXERCISE_GROUPS.includes(open)) {
      const ex = exercises.find(e => e.id === itemId)
      if (ex) body = <ExercisePage ex={ex} last={hints?.lastSets[ex.id] ?? null} />
    } else if (open === 'bag') {
      const c = combos.find(x => x.id === itemId)
      if (c) body = <ComboPage combo={c} techniques={techniques} onFavourite={() => void toggleFavourite(c.id)} />
    } else if (open === 'techniques') {
      const t = techniques.find(x => x.id === itemId)
      if (t) body = <TechniquePage t={t} combos={combos} techniques={techniques} onSearch={searchFor} />
    } else if (open === 'runs') {
      const r = runs.find(x => x.id === itemId)
      if (r) body = <RunPage r={r} runWalk={hints?.runWalk ?? null} />
    }
    return (
      <div className="lib-root is-deep">
        <BackHeader onBack={closeItem} label={g.name} />
        <div className="lib-body lib-item">
          {body ?? (loaded && <p className="wm-prose is-dim lib-none">Not in the Library.</p>)}
        </div>
      </div>
    )
  }

  // ── a group opened ──
  if (open && EXERCISE_GROUPS.includes(open)) {
    const g = GROUPS.find(x => x.key === open)!
    const items = exercises.filter(ex => ex.category === open)
    return (
      <div className="lib-root is-deep">
        <BackHeader onBack={back} />
        <div className="lib-body">
          <Board className="lib-bd is-open">
            <GroupHead name={g.name} count={String(items.length)} len={10} onClick={back} />
            {items.map(ex => <ExerciseRow key={ex.id} ex={ex} onOpen={() => openItem(open, ex.id)} />)}
          </Board>
        </div>
      </div>
    )
  }

  if (open === 'bag') {
    return (
      <div className="lib-root is-deep">
        <BackHeader onBack={back} />
        <div className="lib-body">
          <Board className="lib-bd is-open">
            <button type="button" className="cmb-addline lib-addcombo" aria-label="+ Combo" onClick={() => setAdding(true)}>
              <FlapLabel text="+ COMBO" size="sm" animate={false} />
            </button>
            {fresh.map((f, i) => (
              <div key={f.key} className={`cmb-row${i === 0 ? ' cmb-landin' : ''}`} role={f.id ? 'button' : undefined} tabIndex={f.id ? 0 : undefined} onClick={f.id ? () => openItem('bag', f.id!) : undefined}>
                <div className="meta"><FlapLabel text="NEW" size="xs" tone="teal" animate={false} /></div>
                <ComboLine text={f.text} level={f.level} />
              </div>
            ))}
            {/* page 93: mine first, by type; one group open at a time */}
            {shelves.mine.map(g => {
              const isOpen = openShelf === g.key
              return (
                <Fragment key={g.key}>
                  <GroupHead name={g.name} size="sm" len={12} open={isOpen} count={String(g.combos.length)} onClick={() => setOpenShelf(isOpen ? null : g.key)} />
                  {isOpen && g.combos.map(c => <ComboRow key={c.id} combo={c} onOpen={() => openItem('bag', c.id)} />)}
                </Fragment>
              )
            })}
            {shelves.lockedCount > 0 && (
              <>
                <GroupHead name="LOCKED" size="sm" len={12} open={openShelf === 'locked'} locked count={String(shelves.lockedCount)}
                  onClick={() => { setOpenShelf(openShelf === 'locked' ? null : 'locked'); setOpenLevel(null) }} />
                {openShelf === 'locked' && shelves.locked.map(t => {
                  const isOpen = openLevel === t.tier
                  return (
                    <Fragment key={t.tier}>
                      <GroupHead name={t.name} size="sm" len={12} open={isOpen} locked count={String(t.combos.length)} className="is-sub" onClick={() => setOpenLevel(isOpen ? null : t.tier)} />
                      {isOpen && t.combos.map(c => <ComboRow key={c.id} combo={c} onOpen={() => openItem('bag', c.id)} />)}
                    </Fragment>
                  )
                })}
              </>
            )}
          </Board>
        </div>
        {adding && <NewComboWindow source="mine" onAdded={added} onClose={() => setAdding(false)} />}
      </div>
    )
  }

  if (open === 'techniques') {
    return (
      <div className="lib-root is-deep">
        <BackHeader onBack={back} />
        <div className="lib-body">
          <Board className="lib-bd is-open">
            <GroupHead name="TECHNIQUES" count={String(techniques.length)} len={10} onClick={back} />
            {techRows.map(({ t, n }) => <PlainRow key={t.id} name={t.name} sub={`${t.kind} · in ${n} ${n === 1 ? 'combo' : 'combos'}`} onOpen={() => openItem('techniques', t.id)} />)}
          </Board>
        </div>
      </div>
    )
  }

  if (open === 'runs') {
    return (
      <div className="lib-root is-deep">
        <BackHeader onBack={back} />
        <div className="lib-body">
          <Board className="lib-bd is-open">
            <GroupHead name="RUNS" count={String(runs.length)} len={10} onClick={back} />
            {runs.map(r => <PlainRow key={r.id} name={r.name} sub={`Run · ${r.sub ?? ''}`} onOpen={() => openItem('runs', r.id)} />)}
          </Board>
        </div>
      </div>
    )
  }

  if (open === 'waybook') {
    return (
      <div className="lib-root is-deep">
        <LibraryHeader onBack={back} />
        <div className="lib-body is-book">
          {unlocked && <WaybookBook entries={entries} loaded={entriesLoaded} />}
        </div>
      </div>
    )
  }

  // ── the list (page 39 / 52), or one search across every kind ──
  const q = search.trim()
  type Group = { key: string; name: string; rows: ReactNode[] }
  const groups: Group[] = []
  const zero: string[] = []
  if (q) {
    for (const key of EXERCISE_GROUPS) {
      const g = GROUPS.find(x => x.key === key)!
      const items = exercises.filter(ex => ex.category === key && matchExercise(ex, q))
      if (items.length) groups.push({ key, name: g.name, rows: items.map(ex => <ExerciseRow key={ex.id} ex={ex} onOpen={() => openItem(key, ex.id)} />) })
      else zero.push(g.name)
    }
    const hits = techniqueHits(techniques, q)
    if (hits.length) groups.push({ key: 'techniques', name: 'TECHNIQUES', rows: hits.map(h => <PlainRow key={h.label} name={h.label} sub={h.technique.name === h.label ? h.technique.kind : `${h.technique.kind} · ${h.technique.name}`} onOpen={() => openItem('techniques', h.technique.id)} />) })
    else zero.push('TECHNIQUES')
    // combos: by their text, or by a technique the search names
    const named = new Set(hits.map(h => h.technique.id))
    const foundCombos = combos.filter(c => matchCombo(c, q) || comboStrikes(c.text).some(s => { const t = techniqueFor(s, techniques); return t != null && named.has(t.id) && s.toLowerCase().includes(q.toLowerCase()) }))
    if (foundCombos.length) groups.push({ key: 'bag', name: 'COMBOS', rows: foundCombos.map(c => <ComboRow key={c.id} combo={c} onOpen={() => openItem('bag', c.id)} />) })
    else zero.push('COMBOS')
    const foundRuns = runs.filter(r => matchRun(r, q))
    if (foundRuns.length) groups.push({ key: 'runs', name: 'RUNS', rows: foundRuns.map(r => <PlainRow key={r.id} name={r.name} sub={`Run · ${r.sub ?? ''}`} onOpen={() => openItem('runs', r.id)} />) })
    else zero.push('RUNS')
  }
  const foundEntries = q && unlocked ? entries.filter(e => matchEntry(e, q)) : []

  return (
    <div className="lib-root">
      <LibraryHeader />
      {/* page 67 (Scroll reveals): the rune arch in the top 46%; search and the kinds start under it */}
      <SceneWindow />
      <div className="lib-body">
        <input
          type="search"
          className="lib-search"
          value={search}
          onChange={e => { setSearch(e.target.value); setAllOf(null) }}
          placeholder="Search everything"
          aria-label="Search everything"
          enterKeyHint="search"
        />
        {/* page 65: compact rows (46 px, 32 px icons, 17 px flaps) */}
        {!q && (
          <Board className="lib-bd lib-list">
            {GROUPS.map(g => {
              const count = g.key === 'waybook' ? '' : !loaded ? ''
                : g.key === 'bag' ? bagCount(combos)
                : g.key === 'techniques' ? String(techniques.length)
                : g.key === 'runs' ? String(runs.length)
                : String(counts[g.key] ?? 0)
              return (
                <button key={g.key} type="button" className="lib-row" onClick={() => { if (g.key === 'waybook') void openWaybook(); else go(g.key) }} aria-label={g.name.toLowerCase()}>
                  <SessionIcon kind={g.icon} size={32} label="" />
                  <span className="lib-row-n"><FlapLabel text={g.name} size="sm" /></span>
                  {g.key === 'waybook'
                    ? <span className="lib-row-lock" aria-label="Locked">⚿</span>
                    : <span className="lib-row-cnt">{count}{g.key === 'bag' && count && <small>unlocked</small>}</span>}
                  <span className="lib-row-chev" aria-hidden>›</span>
                </button>
              )
            })}
          </Board>
        )}
        {q && (
          <Board className="lib-bd">
            {groups.length === 0 && foundEntries.length === 0 && (
              <p className="wm-prose is-dim lib-none">No results for “{q}”.</p>
            )}
            {groups.map(g => {
              const all = allOf === g.key || g.rows.length <= 3
              return (
                <Fragment key={g.key}>
                  <button type="button" className="lib-rh" onClick={() => setAllOf(all && g.rows.length > 3 ? null : g.key)} disabled={g.rows.length <= 3}>
                    {g.name} · {all ? g.rows.length : `3 of ${g.rows.length}`}
                  </button>
                  {all ? g.rows : g.rows.slice(0, 3)}
                </Fragment>
              )
            })}
            {foundEntries.length > 0 && (
              <>
                <div className="lib-rh">WAYBOOK · {foundEntries.length}</div>
                <div className="lib-book is-inline">
                  <BookEntries page={{ head: 'THE WAYBOOK', entries: foundEntries }} />
                </div>
              </>
            )}
            {groups.length > 0 && zero.length > 0 && <div className="lib-rh is-zero">{zero.map(z => `${z} · 0`).join(' · ')}</div>}
          </Board>
        )}
      </div>
    </div>
  )
}
