import { Fragment, useEffect, useMemo, useRef, useState, type TouchEvent } from 'react'

import { useSearchParams } from 'react-router-dom'
import { Board, Crest, FlapLabel, SessionIcon, showPop } from '@/design'
import { apiFetch } from '@/lib/api'

import {
  EXERCISE_GROUPS,
  GROUPS,
  MASTERY_MAX,
  bagCount,
  bookPages,
  comboStrikes,
  currentTier,
  entryDateLine,
  entryParagraphs,
  equipmentName,
  exerciseCounts,
  isGroupKey,
  isMastered,
  isMorningNote,
  masteryDots,
  matchCombo,
  matchEntry,
  matchExercise,
  muscleBadges,
  tierViews,
  type BookPage,
  type GroupKey,
  type LibraryCombo,
  type LibraryExercise,
  type LibraryJournalEntry,
} from './libraryModel'
import { useWaybookUnlocked } from './useWaybookUnlocked'
import { WaybookLockedCard } from './WaybookGate'
import './library.css'

// The Library (page 21 + page 39, approved): over the rune arch. The list is
// page 39's six groups (painted icon, flap name, count); a group opens on its
// own board (page 21 "An exercise, opened"); Bagwork opens to its tiers with
// mastery A (five brass dots, the anvil); the Waybook opens as an old book
// page (page 21 B), behind Face ID when that's on (page 21 "Locked").
// The Library holds no history and no PRs; combos unlock only after a bag
// session, never from here; the Waybook is read-only.

/** The whole book: every reflection, one page per month. */
const BOOK_DAYS = 3650

/** A group open (page 46 "Getting back"): ‹ LIBRARY in gold, top left, back to the list. */
function BackHeader({ onBack }: { onBack: () => void }) {
  return (
    <header className="lib-head is-back">
      <button type="button" className="lib-bk" onClick={onBack} aria-label="Back to the Library">‹ LIBRARY</button>
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
    <header className="lib-head">
      {onBack
        ? <button type="button" className="lib-brand" onClick={onBack} aria-label="Library">{inner}</button>
        : <span className="lib-brand">{inner}</span>}
    </header>
  )
}

// ─── pieces ───────────────────────────────────────────────────

/** A combo: each strike its own tile, joined by ›. */
function ComboStrikes({ text }: { text: string }) {
  const strikes = comboStrikes(text)
  return (
    <span className="lib-strikes" aria-label={strikes.join(', ')}>
      {strikes.map((s, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="lib-arr" aria-hidden>›</span>}
          <span className="lib-stk"><FlapLabel text={s} size="xs" /></span>
        </Fragment>
      ))}
    </span>
  )
}

function Dots({ score }: { score: number }) {
  const n = masteryDots(score)
  return (
    <span className="lib-dots" aria-label={`Mastery ${score} of ${MASTERY_MAX}`}>
      {'●'.repeat(n)}<i>{'●'.repeat(5 - n)}</i>
    </span>
  )
}

function Anvil({ combo, onToggle }: { combo: LibraryCombo; onToggle: () => void }) {
  const fav = combo.isFavourite === 1
  const cls = ['lib-anvil', fav ? 'is-fav' : '', isMastered(combo) ? 'is-mastered' : ''].filter(Boolean).join(' ')
  return (
    <button
      type="button"
      className={cls}
      aria-pressed={fav}
      aria-label={fav ? 'Favourite' : 'Make favourite'}
      onClick={e => { e.stopPropagation(); onToggle() }}
    >
      <svg viewBox="0 0 26 20" aria-hidden><path d="M2 5h16c0 3 2 4 6 4v1c-4 0-6 1-7 3l1 3H7l1-3c-1-2-3-3-6-3z" /></svg>
    </button>
  )
}

function ComboRow({ combo, open, onOpen, onFavourite }: { combo: LibraryCombo; open: boolean; onOpen: () => void; onFavourite: () => void }) {
  if (!combo.unlocked) {
    return (
      <div className="lib-combo is-locked">
        <ComboStrikes text={combo.text} />
        <span className="lib-lock" aria-label="Locked">⚿</span>
      </div>
    )
  }
  return (
    <div
      className="lib-combo"
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
    >
      <ComboStrikes text={combo.text} />
      <Dots score={combo.masteryScore} />
      <Anvil combo={combo} onToggle={onFavourite} />
      {open && (
        <div className="lib-panel">
          {combo.formTips && <p className="lib-tip">{combo.formTips}</p>}
          <div className="lib-rows">
            <div className="lib-r"><span className="wm-label">Mastery</span><FlapLabel text={`${combo.masteryScore}/${MASTERY_MAX}`} size="sm" tone="gold" /></div>
            <div className="lib-r"><span className="wm-label">Sharp ratings</span><FlapLabel text={String(combo.timesSharp)} size="sm" /></div>
          </div>
          {isMastered(combo) && <div className="lib-mastered"><FlapLabel text="MASTERED" size="xs" tone="gold" /></div>}
        </div>
      )}
    </div>
  )
}

function ExerciseRow({ ex, open, onOpen }: { ex: LibraryExercise; open: boolean; onOpen: () => void }) {
  const badges = muscleBadges(ex.muscleGroups)
  const eq = equipmentName(ex.equipment)
  return (
    <div
      className="lib-ex"
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
    >
      <div className="lib-ex-top">
        <span className="lib-ex-nm">{ex.name}</span>
        {eq && <span className="lib-ex-eq">{eq}</span>}
      </div>
      {badges.length > 0 && (
        <div className="lib-badges">{badges.map(b => <span key={b} className="lib-badge">{b}</span>)}</div>
      )}
      {open && (ex.formCues || ex.formVideoUrl) && (
        <div className="lib-panel">
          {ex.formCues && (
            <>
              <div className="wm-mlabel">CUES</div>
              <p className="lib-cue">{ex.formCues}</p>
            </>
          )}
          {ex.formVideoUrl && (
            <a className="lib-watch" href={ex.formVideoUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} aria-label="Watch form">
              <FlapLabel text="WATCH FORM ›" size="xs" tone="gold" />
            </a>
          )}
        </div>
      )}
    </div>
  )
}

/** A group's head when it's open (page 21): ▾, the name on a padded flap, the count. */
function GroupHead({ name, count, len, size = 'md', open = true, locked = false, onClick }: { name: string; count?: string; len: number; size?: 'md' | 'sm'; open?: boolean; locked?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className="lib-grp" onClick={onClick} disabled={!onClick} aria-expanded={open}>
      <span className="lib-chev" aria-hidden>{open ? '▾' : '▸'}</span>
      <FlapLabel text={name} size={size} len={len} />
      {locked ? <span className="lib-lock" aria-label="Locked">⚿</span> : count != null && <span className="lib-cnt">{count}</span>}
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
  const openParam = params.get('open')
  const open: GroupKey | null = isGroupKey(openParam) ? openParam : null

  const [exercises, setExercises] = useState<LibraryExercise[]>([])
  const [combos, setCombos] = useState<LibraryCombo[]>([])
  const [loaded, setLoaded] = useState(false)
  const [entries, setEntries] = useState<LibraryJournalEntry[]>([])
  const [entriesLoaded, setEntriesLoaded] = useState(false)
  const [search, setSearch] = useState('')
  const [openExercise, setOpenExercise] = useState<string | null>(null)
  // undefined: Bagwork opens on the current tier (the highest with an unlocked combo)
  const [openTier, setOpenTier] = useState<string | null | undefined>(undefined)
  const [openCombo, setOpenCombo] = useState<string | null>(null)
  const unlocked = useWaybookUnlocked()

  useEffect(() => {
    let live = true
    Promise.all([
      apiFetch<LibraryExercise[]>('/api/exercises').catch(() => [] as LibraryExercise[]),
      apiFetch<LibraryCombo[]>('/api/combos').catch(() => [] as LibraryCombo[]),
    ]).then(([ex, co]) => {
      if (!live) return
      setExercises(Array.isArray(ex) ? ex : [])
      setCombos(Array.isArray(co) ? co : [])
      setLoaded(true)
    })
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

  const tiers = useMemo(() => tierViews(combos), [combos])
  const counts = useMemo(() => exerciseCounts(exercises), [exercises])

  function go(key: GroupKey | null) {
    setOpenExercise(null)
    setOpenCombo(null)
    setSearch('')
    setOpenTier(undefined)
    setParams(key ? { open: key } : {}, { replace: true })
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

  // ── a group opened ──
  if (open && EXERCISE_GROUPS.includes(open)) {
    const g = GROUPS.find(x => x.key === open)!
    const items = exercises.filter(ex => ex.category === open)
    return (
      <div className="lib-root">
        <BackHeader onBack={back} />
        <div className="lib-body">
          <Board className="lib-bd is-open">
            <GroupHead name={g.name} count={String(items.length)} len={10} onClick={back} />
            {items.map(ex => (
              <ExerciseRow key={ex.id} ex={ex} open={openExercise === ex.id} onOpen={() => setOpenExercise(openExercise === ex.id ? null : ex.id)} />
            ))}
          </Board>
        </div>
      </div>
    )
  }

  if (open === 'bag') {
    const shownTier = openTier === undefined ? currentTier(tiers) : openTier
    return (
      <div className="lib-root">
        <BackHeader onBack={back} />
        <div className="lib-body">
          <Board className="lib-bd is-open">
            {tiers.map(t => {
              const isOpen = !t.locked && shownTier === t.tier
              return (
                <Fragment key={t.tier}>
                  <GroupHead
                    name={t.name}
                    size="sm"
                    len={12}
                    open={isOpen}
                    locked={t.locked}
                    count={`${t.mastered}/${t.unlocked}`}
                    onClick={t.locked ? undefined : () => { setOpenCombo(null); setOpenTier(isOpen ? null : t.tier) }}
                  />
                  {isOpen && t.combos.map(c => (
                    <ComboRow
                      key={c.id}
                      combo={c}
                      open={openCombo === c.id}
                      onOpen={() => setOpenCombo(openCombo === c.id ? null : c.id)}
                      onFavourite={() => toggleFavourite(c.id)}
                    />
                  ))}
                </Fragment>
              )
            })}
          </Board>
        </div>
      </div>
    )
  }

  if (open === 'waybook') {
    return (
      <div className="lib-root">
        <LibraryHeader onBack={back} />
        <div className="lib-body is-book">
          {unlocked
            ? <WaybookBook entries={entries} loaded={entriesLoaded} />
            : <WaybookLockedCard onDismiss={back} />}
        </div>
      </div>
    )
  }

  // ── the list (page 39), or search results ──
  const q = search.trim()
  const foundEx = q ? exercises.filter(ex => matchExercise(ex, q)) : []
  const foundCombos = q ? combos.filter(c => matchCombo(c, q)) : []
  const foundEntries = q && unlocked ? entries.filter(e => matchEntry(e, q)) : []

  return (
    <div className="lib-root">
      <LibraryHeader />
      <div className="lib-body">
        <input
          type="search"
          className="lib-search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search exercises, combos, journal..."
          aria-label="Search exercises, combos, journal"
          enterKeyHint="search"
        />
        {!q && (
          <Board className="lib-bd">
            {GROUPS.map(g => {
              const count = g.key === 'waybook' ? '' : !loaded ? '' : g.key === 'bag' ? bagCount(combos) : String(counts[g.key] ?? 0)
              return (
                <button key={g.key} type="button" className="lib-grp2" onClick={() => go(g.key)} aria-label={g.name.toLowerCase()}>
                  <span className="lib-chev" aria-hidden>›</span>
                  <SessionIcon kind={g.icon} size={40} label="" />
                  <FlapLabel text={g.name} size="md" />
                  <span className="lib-cnt2">{count}</span>
                </button>
              )
            })}
          </Board>
        )}
        {q && (
          <Board className="lib-bd">
            {foundEx.length === 0 && foundCombos.length === 0 && foundEntries.length === 0 && (
              <p className="wm-prose is-dim lib-none">No results for “{q}”.</p>
            )}
            {EXERCISE_GROUPS.map(key => {
              const items = foundEx.filter(ex => ex.category === key)
              if (!items.length) return null
              const g = GROUPS.find(x => x.key === key)!
              return (
                <Fragment key={key}>
                  <GroupHead name={g.name} count={String(items.length)} len={10} />
                  {items.map(ex => (
                    <ExerciseRow key={ex.id} ex={ex} open={openExercise === ex.id} onOpen={() => setOpenExercise(openExercise === ex.id ? null : ex.id)} />
                  ))}
                </Fragment>
              )
            })}
            {foundCombos.length > 0 && (
              <>
                <GroupHead name="BAGWORK" count={String(foundCombos.length)} len={10} />
                {foundCombos.map(c => (
                  <ComboRow key={c.id} combo={c} open={openCombo === c.id} onOpen={() => setOpenCombo(openCombo === c.id ? null : c.id)} onFavourite={() => toggleFavourite(c.id)} />
                ))}
              </>
            )}
            {foundEntries.length > 0 && (
              <>
                <GroupHead name="WAYBOOK" count={String(foundEntries.length)} len={10} />
                <div className="lib-book is-inline">
                  <BookEntries page={{ head: 'THE WAYBOOK', entries: foundEntries }} />
                </div>
              </>
            )}
          </Board>
        )}
      </div>
    </div>
  )
}
