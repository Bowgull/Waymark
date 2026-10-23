import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { Board, FlapLabel, SessionIcon, showPop, useDismissLayer } from '@/design'
import { comboLevel } from '@/lib/classCombos'
import {
  COACH_REST_SEC,
  COACH_ROUND_SEC,
  FINISHER_LINE,
  LIMITS,
  STAGE_WORDS,
  builderFromRoutine,
  kruArc,
  pickerGroups,
  planCoachRounds,
  type BagMode,
  type BagRoutine,
  type BagSpec,
  type PoolCombo,
} from '@/lib/coach/bagArc'
import { ComboFlaps, ComboLine, Slate } from '@/features/combos/ComboPieces'
import { NewComboWindow } from '@/features/combos/NewComboWindow'
import { poolNow, prefetchBagPool, saveBagRoutine, subscribePool } from '@/features/combos/combosClient'

import { Cmd, CmdLine } from './CommandWindow'
import './bagBuilder.css'

// Bag Work (page 80, approved by Josh 2026-10-23): + add or REPLACE → Bag
// Work asks COACH / HYBRID / CUSTOM, with his saved routines under them.
// COACH: the coach's rounds on the kru's arc (rounds, length and rest are the
// coach's). HYBRID: the coach's rounds, length and rest; he taps a round and
// adds combos from his list; empty rounds say "coach fills". CUSTOM: rounds,
// round length and rest with − / +, his combos in each round, "—" when empty;
// the coach says nothing. SAVE ROUTINE names Hybrid or Custom. His pool and
// routines were read when the picks opened: nothing loads after a tap.

const MODES: ReadonlyArray<{ key: BagMode; word: string }> = [{ key: 'coach', word: 'COACH' }, { key: 'hybrid', word: 'HYBRID' }, { key: 'custom', word: 'CUSTOM' }]

interface Builder {
  mode: BagMode
  rounds: number
  /** Minutes. */
  len: number
  rest: number
  picked: Record<number, string[]>
  routine: { id: string; name: string } | null
}

export function BagBuilder({ add, dayName, dose, busy, closing, onLeft, onDismiss, onTake }: {
  add: boolean
  /** "Thursday". */
  dayName: string
  /** The coach's rounds that day and whether a finisher is on (the pick's dose). */
  dose: { rounds: number; finishers: boolean }
  busy: boolean
  closing: boolean
  onLeft: () => void
  onDismiss: () => void
  onTake: (spec: BagSpec) => void
}) {
  const data = useSyncExternalStore(subscribePool, poolNow)
  useEffect(() => { if (!poolNow()) void prefetchBagPool() }, [])
  const pool = useMemo(() => data?.combos ?? [], [data])
  const routines = data?.routines ?? []
  const byId = useMemo(() => new Map(pool.map(c => [c.id, c])), [pool])
  // the moment the window opened: "new" is read against it (stable across renders)
  const [nowSec] = useState(() => Math.floor(Date.now() / 1000))

  const [view, setView] = useState<'modes' | 'board'>('modes')
  const [cur, setCur] = useState(0)
  const [b, setB] = useState<Builder>({ mode: 'coach', rounds: dose.rounds, len: COACH_ROUND_SEC / 60, rest: COACH_REST_SEC / 60, picked: {}, routine: null })
  const [picking, setPicking] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAs, setSavedAs] = useState<string | null>(null)

  function choose(mode: BagMode, i: number) {
    setCur(i)
    setSavedAs(null)
    setB({ mode, rounds: Math.max(LIMITS.rounds[0], dose.rounds), len: COACH_ROUND_SEC / 60, rest: COACH_REST_SEC / 60, picked: {}, routine: null })
    setView('board')
  }

  function startRoutine(r: BagRoutine) {
    const s = builderFromRoutine(r)
    setSavedAs(r.name)
    setB({ mode: s.mode, rounds: s.rounds, len: Math.round(s.roundSec / 60), rest: Math.round(s.restSec / 60), picked: s.picked, routine: { id: r.id, name: r.name } })
    setView('board')
  }

  function step(k: 'rounds' | 'len' | 'rest', d: 1 | -1) {
    const [lo, hi] = k === 'rounds' ? LIMITS.rounds : k === 'len' ? LIMITS.roundMin : LIMITS.restMin
    setB(x => {
      const v = Math.max(lo, Math.min(hi, x[k] + d))
      // fewer rounds: the picks past the end go
      const picked = k === 'rounds' ? Object.fromEntries(Object.entries(x.picked).filter(([i]) => Number(i) < v)) : x.picked
      return { ...x, [k]: v, picked }
    })
    setSavedAs(null)
  }

  function toggle(round: number, id: string) {
    setB(x => {
      const list = x.picked[round] ?? []
      const next = list.includes(id) ? list.filter(y => y !== id) : [...list, id]
      const picked = { ...x.picked }
      if (next.length > 0) picked[round] = next
      else delete picked[round]
      return { ...x, picked }
    })
    setSavedAs(null)
  }

  const spec = (): BagSpec => ({
    mode: b.mode,
    rounds: b.rounds,
    roundSec: b.mode === 'custom' ? b.len * 60 : COACH_ROUND_SEC,
    restSec: b.mode === 'custom' ? b.rest * 60 : COACH_REST_SEC,
    picked: b.mode === 'coach' ? {} : b.picked,
    routineId: b.routine?.id ?? null,
  })

  // ── the mode menu ──
  if (view === 'modes') {
    return (
      <Cmd anchor={null} place="bottom" closing={closing} onLeft={onLeft} onDismiss={onDismiss} label="Bag work" className="bb-modes">
        <div className="pl-hdr"><FlapLabel text="BAG WORK" size="xs" tone="gold" animate={false} /><small>for {dayName.toLowerCase()}</small></div>
        {MODES.map((m, i) => (
          <CmdLine key={m.key} on={i === cur} onClick={() => choose(m.key, i)} label={m.word.charAt(0) + m.word.slice(1).toLowerCase()}>
            <SessionIcon kind="bag" size={30} label="" />
            <span className="grow"><FlapLabel text={m.word} size="sm" animate={false} /></span>
            <span className="gt">›</span>
          </CmdLine>
        ))}
        {routines.length > 0 && (
          <>
            <div className="bb-grp"><FlapLabel text="YOUR ROUTINES" size="xs" tone="dim" animate={false} /></div>
            {routines.map(r => (
              <CmdLine key={r.id} on={false} onClick={() => startRoutine(r)} label={`Routine: ${r.name}`}>
                <SessionIcon kind="bag" size={30} label="" />
                <span className="grow">
                  <FlapLabel text={r.name.toUpperCase().slice(0, 16)} size="sm" animate={false} />
                  <span className="bb-sub">{r.mode === 'custom' ? 'Custom' : 'Hybrid'} · {r.rounds.length} rounds</span>
                </span>
                <span className="gt">›</span>
              </CmdLine>
            ))}
          </>
        )}
      </Cmd>
    )
  }

  // ── the rounds ──
  const arc = kruArc(b.rounds, dose.finishers)
  const coachPlan = b.mode === 'custom' ? [] : planCoachRounds(pool, { rounds: b.rounds, finishers: dose.finishers, nowSec, keep: b.mode === 'hybrid' ? b.picked : undefined })
  const flaps = (ids: ReadonlyArray<string>) => ids.map(id => byId.get(id)).filter((c): c is PoolCombo => c != null).map(c => <ComboFlaps key={c.id} text={c.text} />)
  const rows = Array.from({ length: b.rounds }, (_, i) => {
    const stage = b.mode === 'custom' ? null : arc[i] ?? null
    const mine = b.mode !== 'coach' ? b.picked[i] ?? [] : []
    let cs: ReactNode
    if (mine.length > 0) cs = flaps(mine)
    else if (b.mode === 'custom') cs = <span className="fill">—</span>
    else if (stage === 'finisher') cs = <span className="note">{FINISHER_LINE}</span>
    else if (b.mode === 'hybrid') cs = <span className="fill">coach fills</span>
    else cs = flaps(coachPlan[i]?.comboIds ?? [])
    const tap = b.mode !== 'coach'
    return (
      <div key={i} className={`bb-rnd${mine.length > 0 ? ' is-mine' : ''}${tap ? ' is-tap' : ''}`} data-round={i}
        role={tap ? 'button' : undefined} tabIndex={tap ? 0 : undefined} aria-label={tap ? `Round ${i + 1}` : undefined}
        onClick={tap ? () => setPicking(i) : undefined}
        onKeyDown={tap ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPicking(i) } } : undefined}>
        <div className="rl">
          <FlapLabel text={`ROUND ${i + 1}`} size="xs" animate={false} />
          {stage && <span className="stage">{STAGE_WORDS[stage]}</span>}
        </div>
        <div className="cs">{cs}</div>
      </div>
    )
  })
  const modeWord = b.mode.toUpperCase()
  const setup = b.mode === 'custom'
    ? ([['ROUNDS', `${b.rounds}`, 'rounds'], ['ROUND', `${b.len}:00`, 'len'], ['REST', `${b.rest}:00`, 'rest']] as const).map(([lb, v, k]) => (
      <div key={k} className="bb-step">
        <span className="lb">{lb}</span>
        <button type="button" className="cmb-nudge" aria-label={`${lb.charAt(0) + lb.slice(1).toLowerCase()}: less`} onClick={() => step(k, -1)}>−</button>
        <span className="val"><FlapLabel text={v} size="sm" animate={false} /></span>
        <button type="button" className="cmb-nudge" aria-label={`${lb.charAt(0) + lb.slice(1).toLowerCase()}: more`} onClick={() => step(k, 1)}>+</button>
      </div>
    ))
    : <div className="bb-setup">{b.rounds} rounds · {COACH_ROUND_SEC / 60} min · {COACH_REST_SEC / 60} min rest</div>

  return (
    <>
      <BoardSheet closing={closing} onLeft={onLeft} onDismiss={onDismiss} label={`Bag work: ${b.mode}`} top={picking == null && !saving}>
        <Board head={dayName} headRight={<FlapLabel text={modeWord} size="xs" tone={b.mode === 'coach' ? 'gold' : 'teal'} animate={false} />}>
          {setup}
          {rows}
          <div className="bb-btns">
            {b.mode === 'coach'
              ? (
                <button type="button" className="wm-btn" aria-label="Back" onClick={() => setView('modes')}>
                  <FlapLabel text="‹ BACK" size="xs" animate={false} />
                </button>
              )
              : (
                <button type="button" className="wm-btn" aria-label={savedAs ? 'Saved' : 'Save routine'} onClick={() => setSaving(true)}>
                  <FlapLabel text={savedAs ? 'SAVED ✓' : 'SAVE ROUTINE'} size="xs" animate={false} />
                </button>
              )}
            <button type="button" className="wm-btn is-primary" aria-label={add ? 'Add' : 'Swap in'} disabled={busy} onClick={() => onTake(spec())}>
              <FlapLabel text={add ? 'ADD' : 'SWAP IN'} size="sm" tone="gold" animate={false} />
            </button>
          </div>
        </Board>
      </BoardSheet>
      {picking != null && (
        <PickWindow
          round={picking}
          pool={pool}
          nowSec={nowSec}
          chosen={b.picked[picking] ?? []}
          onToggle={id => toggle(picking, id)}
          onDone={() => setPicking(null)}
        />
      )}
      {saving && (
        <SaveWindow
          initial={b.routine?.name ?? ''}
          onClose={() => setSaving(false)}
          onSave={async name => {
            try {
              const r = await saveBagRoutine({
                ...(b.routine ? { id: b.routine.id } : {}),
                name,
                mode: b.mode === 'custom' ? 'custom' : 'hybrid',
                rounds: Array.from({ length: b.rounds }, (_, i) => [...(b.picked[i] ?? [])]),
                roundSec: b.mode === 'custom' ? b.len * 60 : COACH_ROUND_SEC,
                restSec: b.mode === 'custom' ? b.rest * 60 : COACH_REST_SEC,
              })
              setB(x => ({ ...x, routine: { id: r.id, name: r.name } }))
              setSavedAs(r.name)
              return true
            } catch {
              showPop("Couldn't save. Check your connection.", 'bad')
              return false
            }
          }}
        />
      )}
    </>
  )
}

/** The rounds' board over the scene: it settles in 180 ms and leaves in 120 ms (page 59). */
function BoardSheet({ closing, onLeft, onDismiss, label, top, children }: { closing: boolean; onLeft: () => void; onDismiss: () => void; label: string; top: boolean; children: ReactNode }) {
  useDismissLayer(!closing && top, onDismiss)
  useEffect(() => {
    if (!closing) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const t = window.setTimeout(onLeft, reduced ? 0 : 120)
    return () => window.clearTimeout(t)
  }, [closing, onLeft])
  return createPortal(
    <>
      <div className="bb-veil" onClick={() => { if (!closing) onDismiss() }} aria-hidden />
      <div className={`bb-sheet${closing ? ' is-out' : ''}`} role="dialog" aria-label={label}>{children}</div>
    </>,
    document.body,
  )
}

/** A round's combos: his list sorted for him (NEW, CLOSE TO MASTERED, ALL), search, + NEW COMBO. */
function PickWindow({ round, pool, nowSec, chosen, onToggle, onDone }: { round: number; pool: PoolCombo[]; nowSec: number; chosen: string[]; onToggle: (id: string) => void; onDone: () => void }) {
  const [closing, setClosing] = useState(false)
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const g = pickerGroups(pool, nowSec, q)
  const done = () => setClosing(true)
  const group = (title: string, list: PoolCombo[]) => list.length === 0 ? null : (
    <>
      <div className="bb-grp"><FlapLabel text={title} size="xs" tone="dim" animate={false} /></div>
      {list.map(c => (
        <div key={c.id} className="bb-pkrow" role="button" tabIndex={0} aria-pressed={chosen.includes(c.id)} aria-label={c.text}
          onClick={() => onToggle(c.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(c.id) } }}>
          <span className="tick" aria-hidden>{chosen.includes(c.id) ? '✓' : ''}</span>
          <span className="pkc"><ComboLine text={c.text} level={comboLevel(c)} /></span>
        </div>
      ))}
    </>
  )
  return (
    <>
      <Cmd anchor={null} place="bottom" closing={closing} onLeft={onDone} onDismiss={done} label={`Round ${round + 1}`} stayOnScroll className="bb-win">
        <div className="pl-hdr">
          <FlapLabel text={`ROUND ${round + 1}`} size="xs" tone="gold" animate={false} />
          <button type="button" className="bb-done" aria-label="Done" onClick={done}><FlapLabel text="DONE" size="xs" tone="dim" animate={false} /></button>
        </div>
        <Slate value={q} onChange={setQ} label="Search your combos" variant="srch" />
        <div className="bb-pickl">
          {group('NEW', g.new)}
          {group('CLOSE TO MASTERED', g.close)}
          {group('ALL', g.all)}
          <button type="button" className="cmb-addline" style={{ marginTop: 6 }} aria-label="+ New combo" onClick={() => setAdding(true)}>
            <FlapLabel text="+ NEW COMBO" size="xs" animate={false} />
          </button>
        </div>
      </Cmd>
      {adding && (
        <NewComboWindow source="mine" onClose={() => setAdding(false)} onAdded={c => { if (c.combo) onToggle(c.combo.id) }} />
      )}
    </>
  )
}

/** SAVE AS ROUTINE: his name on the slate, SAVE. */
function SaveWindow({ initial, onClose, onSave }: { initial: string; onClose: () => void; onSave: (name: string) => Promise<boolean> }) {
  const [closing, setClosing] = useState(false)
  const [name, setName] = useState(initial)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    const ok = await onSave(name.trim())
    setBusy(false)
    if (ok) setClosing(true)
  }
  return (
    <Cmd anchor={null} place="bottom" closing={closing} onLeft={onClose} onDismiss={() => setClosing(true)} label="Save as routine" stayOnScroll className="bb-win">
      <div className="pl-hdr"><FlapLabel text="SAVE AS ROUTINE" size="xs" tone="gold" animate={false} /></div>
      <Slate value={name} onChange={setName} label="Routine name" variant="flat" onEnter={() => void save()} autoFocus />
      <div className="cmb-take">
        <button type="button" className="wm-btn is-primary" aria-label="Save" disabled={!name.trim() || busy} onClick={() => void save()}>
          <FlapLabel text="SAVE" size="sm" tone="gold" animate={false} />
        </button>
      </div>
    </Cmd>
  )
}
