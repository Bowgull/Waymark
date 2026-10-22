import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { showPop } from '@/design'
import { REPLACE_WHY_TILES, SKIP_WHY_TILES } from '@/components/ui/departures'
import { apiFetch } from '@/lib/api'
import { submitBoardPick, submitReplace, submitSkip, submitSkipReason } from '@/lib/boardPick'
import { getTodayISO } from '@/lib/dates'
import { sessionDisplayName, type DayBoardSession } from '@/features/dayboard/rowState'
import type { ChangeViewIn } from '@/features/coach/changeView'
import type { PickAction } from '@/lib/coach'

import { ActBody, Cmd, PicksBody, RuneBody, WhyBody, type PickRow, type ReasonChoice } from './CommandWindow'

// The command windows' flow (page 73), the same on Program and Today: hold a
// session → REPLACE / SKIP (or UNDO SKIP); REPLACE and + add → COACH PICKS
// (the new brain's 1-3, then everything else), a tap only previews, SWAP IN /
// ADD changes the day; after a replace the optional TIME / BODY / JUST
// BECAUSE, after a skip TIME / BODY / SICK / PAIN; a coach change's rune →
// KEEP / UNDO, then REDO. Backing out changes nothing.

/** After a replace / a skip (page 73): the brain's own reason codes (departures.ts). */
const REPLACE_WHY: ReadonlyArray<ReasonChoice> = REPLACE_WHY_TILES.map(t => ({ label: t.label, code: t.value }))
const SKIP_WHY: ReadonlyArray<ReasonChoice> = SKIP_WHY_TILES.map(t => ({ label: t.label, code: t.value }))

interface CoachPickJson extends PickRow { timeSlot: 'am' | 'pm'; flexibleTimeSlot: boolean; action?: PickAction }

type Win =
  | { kind: 'act'; s: DayBoardSession; anchor: DOMRect }
  | { kind: 'why'; mode: 'skip' | 'replace'; sessionId: string; changeId: string | null; anchor: DOMRect | null; contextJson?: string | null }
  | { kind: 'rune'; change: ChangeViewIn; say: ReactNode; back: string; undone: boolean; canUndo: boolean; anchor: DOMRect | null }
  | { kind: 'pick'; mode: 'replace' | 'add'; s: DayBoardSession | null; date: string; day3: string; view: 'picks' | 'all'; cur: number; picks: CoachPickJson[] | null; all: CoachPickJson[] | null }

export interface PlanMenuDeps {
  onSessionUpdate: (id: string, patch: Partial<DayBoardSession>) => void
  onSessionAdded: (s: DayBoardSession) => void
  /** His change landed: the week's changes are read again. */
  onChanged: () => void
  /** The day's sessions read again (after an UNDO / REDO). */
  reload: () => void
  undo: (changeId: string) => Promise<boolean>
  markSeen: (ids: string[]) => void
  /** His SKIP's change id for a session (UNDO SKIP), from the week's changes. */
  skipChangeFor: (sessionId: string) => string | null
  /** The cursor moves to a session and its lines open. */
  focus: (sessionId: string) => void
  /** Today: the weather at the session's hour, when it crosses a line. */
  weatherFor?: (s: DayBoardSession) => { kind: string; hour: string } | null
  /** After noon on the day itself: + add offers PM. */
  pmOnly?: (date: string) => boolean
}

const DAY3 = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
/** A row's lines open in this long (page 59 Expand); the WHY? window waits for them. */
const LINES_OPEN_MS = 360

/** His reason on the swapped-in session's context (context_json.replaced.userSkipReason), as the server writes it. */
function withSwapReason(contextJson: string | null | undefined, code: string): string {
  let ctx: Record<string, unknown> = {}
  try { ctx = contextJson ? JSON.parse(contextJson) as Record<string, unknown> : {} } catch { ctx = {} }
  return JSON.stringify({ ...ctx, replaced: { ...((ctx.replaced as Record<string, unknown> | undefined) ?? {}), userSkipReason: code } })
}
const rectOf = (id: string) => document.querySelector(`[data-sid="${CSS.escape(id)}"]`)?.getBoundingClientRect() ?? null

export function usePlanMenu(deps: PlanMenuDeps) {
  const [win, setWin] = useState<Win | null>(null)
  const [closing, setClosing] = useState(false)
  const [busy, setBusy] = useState(false)
  const next = useRef<(() => void) | null>(null)
  const skipIds = useRef(new Map<string, string | null>())
  const d = useRef(deps)
  useEffect(() => { d.current = deps })

  // While COACH PICKS is open the rows' cursor steps aside (the window has its own).
  useEffect(() => {
    document.body.classList.toggle('pl-pickopen', win?.kind === 'pick' && !closing)
    return () => document.body.classList.remove('pl-pickopen')
  }, [win, closing])

  /** Close the window (the leave plays), then run `then`. */
  const close = useCallback((then?: () => void) => {
    next.current = then ?? null
    setClosing(true)
  }, [])
  const left = useCallback(() => {
    setClosing(false)
    setWin(null)
    const then = next.current
    next.current = null
    then?.()
  }, [])

  const loadPicks = useCallback((w: Extract<Win, { kind: 'pick' }>) => {
    const wx = w.s ? d.current.weatherFor?.(w.s) ?? null : null
    const q = w.mode === 'replace' && w.s
      ? `mode=replace&sessionId=${encodeURIComponent(w.s.id)}`
      : `mode=add&date=${w.date}${d.current.pmOnly?.(w.date) ? '&pm=1' : ''}`
    apiFetch<{ picks: CoachPickJson[]; all: CoachPickJson[] }>(`/api/sessions/coach-picks?${q}&today=${getTodayISO()}${wx ? `&wx=${wx.kind}&wxHour=${encodeURIComponent(wx.hour)}` : ''}`)
      .then(r => setWin(cur => (cur && cur.kind === 'pick' && cur.date === w.date && cur.mode === w.mode ? { ...cur, picks: r.picks, all: r.all } : cur)))
      .catch(() => {
        showPop("Couldn't reach the coach. Check your connection.", 'bad')
        setWin(cur => (cur && cur.kind === 'pick' ? { ...cur, picks: [], all: [] } : cur))
      })
  }, [])

  const openPicks = useCallback((mode: 'replace' | 'add', s: DayBoardSession | null, date: string) => {
    const day = new Date(`${date}T12:00:00Z`).getUTCDay()
    const w: Extract<Win, { kind: 'pick' }> = { kind: 'pick', mode, s, date, day3: DAY3[day], view: 'picks', cur: 0, picks: null, all: null }
    setClosing(false)
    setWin(w)
    loadPicks(w)
  }, [loadPicks])

  /** Hold a to-do (or a skipped) session. */
  const openAct = useCallback((s: DayBoardSession, el: HTMLElement) => {
    setClosing(false)
    setWin({ kind: 'act', s, anchor: el.getBoundingClientRect() })
  }, [])

  /** + add session on a day (YYYY-MM-DD). */
  const openAdd = useCallback((date: string) => openPicks('add', null, date), [openPicks])

  /** A coach change's rune (Program's day row). */
  const openRune = useCallback((change: ChangeViewIn, say: ReactNode, back: string, canUndo: boolean, el: HTMLElement | null) => {
    setClosing(false)
    setWin({ kind: 'rune', change, say, back, undone: false, canUndo, anchor: el?.getBoundingClientRect() ?? null })
  }, [])

  // ── the actions ──
  async function skip(s: DayBoardSession) {
    const prev = s.status
    d.current.onSessionUpdate(s.id, { status: 'skipped', skipReason: null })
    d.current.focus(s.id)
    skipIds.current.set(s.id, null)
    // the WHY? window under the struck row, once its lines have opened (page 59: 320 ms)
    window.setTimeout(() => { setClosing(false); setWin({ kind: 'why', mode: 'skip', sessionId: s.id, changeId: skipIds.current.get(s.id) ?? null, anchor: rectOf(s.id) }) }, LINES_OPEN_MS)
    try {
      const out = await submitSkip<DayBoardSession>(s.id, getTodayISO())
      skipIds.current.set(s.id, out.changeId)
      setWin(cur => (cur && cur.kind === 'why' && cur.sessionId === s.id ? { ...cur, changeId: out.changeId } : cur))
      d.current.onChanged()
    } catch (e) {
      console.error('Failed to skip session:', e)
      d.current.onSessionUpdate(s.id, { status: prev })
      showPop("Couldn't save. Check your connection.", 'bad')
      setWin(null)
    }
  }

  async function unskip(s: DayBoardSession) {
    const id = skipIds.current.get(s.id) ?? d.current.skipChangeFor(s.id)
    if (!id) { showPop("Couldn't put it back. It may have started.", 'bad'); return }
    const ok = await d.current.undo(id)
    if (ok) { skipIds.current.delete(s.id); d.current.onSessionUpdate(s.id, { status: 'planned', skipReason: null }); d.current.reload() }
    else showPop("Couldn't put it back. It may have started.", 'bad')
  }

  async function reason(w: Extract<Win, { kind: 'why' }>, code: string) {
    const changeId = w.changeId ?? skipIds.current.get(w.sessionId) ?? null
    if (w.mode === 'skip') d.current.onSessionUpdate(w.sessionId, { skipReason: code })
    else d.current.onSessionUpdate(w.sessionId, { contextJson: withSwapReason(w.contextJson, code) })
    if (!changeId) return
    try {
      await submitSkipReason(changeId, code, null, getTodayISO())
      d.current.onChanged()
    } catch (e) {
      console.warn('Failed to save the reason:', e)
    }
  }

  async function take(w: Extract<Win, { kind: 'pick' }>, row: CoachPickJson) {
    setBusy(true)
    try {
      if (w.mode === 'replace' && w.s) {
        const result = await submitReplace<DayBoardSession>(w.s.id, { type: row.type, label: row.label, timeSlot: row.timeSlot, runCategory: row.runCategory }, null, getTodayISO()) as { original: DayBoardSession; replacement: DayBoardSession; changeId?: string | null }
        d.current.onSessionUpdate(result.original.id, result.original)
        d.current.onSessionAdded(result.replacement)
        close(() => {
          d.current.focus(result.replacement.id)
          window.setTimeout(() => setWin({ kind: 'why', mode: 'replace', sessionId: result.replacement.id, changeId: result.changeId ?? null, anchor: rectOf(result.replacement.id), contextJson: result.replacement.contextJson ?? null }), LINES_OPEN_MS)
        })
        d.current.onChanged()
      } else {
        const out = await submitBoardPick<DayBoardSession>({ type: row.type, label: row.label, timeSlot: row.timeSlot, runCategory: row.runCategory, action: row.action }, w.date, getTodayISO())
        if (out.kind === 'added') d.current.onSessionAdded(out.session)
        else { d.current.onSessionUpdate(out.session.id, out.session); for (const x of out.displaced) d.current.onSessionUpdate(x.id, x) }
        close(() => d.current.focus(out.session.id))
        d.current.onChanged()
      }
    } catch (e) {
      console.error('Failed to change the day:', e)
      showPop("Couldn't save. Check your connection.", 'bad')
    } finally {
      setBusy(false)
    }
  }

  async function undoRune(w: Extract<Win, { kind: 'rune' }>) {
    const ok = await d.current.undo(w.change.id)
    if (!ok) { showPop("Couldn't put it back. It may have started.", 'bad'); return }
    setWin(cur => (cur && cur.kind === 'rune' ? { ...cur, undone: true } : cur))
    d.current.reload()
    d.current.onChanged()
  }

  async function redoRune(w: Extract<Win, { kind: 'rune' }>) {
    try {
      await apiFetch(`/api/changes/${w.change.id}/redo`, { method: 'POST', body: JSON.stringify({ today: getTodayISO() }) })
      close(() => { d.current.reload(); d.current.onChanged() })
    } catch {
      showPop("Couldn't bring it back. It may have started.", 'bad')
    }
  }

  // ── the window on screen ──
  let node: ReactNode = null
  const dismiss = () => close()
  if (win?.kind === 'act') {
    node = (
      <Cmd anchor={win.anchor} place="side" closing={closing} onLeft={left} onDismiss={dismiss} label={`${sessionDisplayName(win.s)}: replace or skip`}>
        <ActBody
          skipped={win.s.status === 'skipped'}
          onReplace={() => { const s = win.s; close(() => openPicks('replace', s, new Date((s.scheduledDate ?? 0) * 86400000).toISOString().slice(0, 10))) }}
          onSkip={() => { const s = win.s; close(() => { void skip(s) }) }}
          onUnskip={() => { const s = win.s; close(() => { void unskip(s) }) }}
        />
      </Cmd>
    )
  } else if (win?.kind === 'why') {
    node = (
      <Cmd anchor={win.anchor} place="below" closing={closing} onLeft={left} onDismiss={dismiss} label="Why, optional">
        <WhyBody tiles={win.mode === 'skip' ? SKIP_WHY : REPLACE_WHY} two={win.mode === 'skip'} onPick={code => { const w = win; close(() => { void reason(w, code) }) }} />
      </Cmd>
    )
  } else if (win?.kind === 'rune') {
    node = (
      <Cmd anchor={win.anchor} place="below" closing={closing} onLeft={left} onDismiss={dismiss} label="What the coach changed">
        <RuneBody
          say={win.undone ? win.back : win.say}
          undone={win.undone}
          canUndo={win.canUndo}
          canRedo={win.undone && (win.change.kind === 'ease' || win.change.kind === 'move' || win.change.kind === 'skip')}
          onKeep={() => { const w = win; close(() => d.current.markSeen([w.change.id])) }}
          onUndo={() => { void undoRune(win) }}
          onRedo={() => { void redoRune(win) }}
        />
      </Cmd>
    )
  } else if (win?.kind === 'pick') {
    const add = win.mode === 'add'
    node = (
      <Cmd anchor={null} place="bottom" closing={closing} onLeft={left} onDismiss={dismiss} label={add ? 'Coach picks: add' : 'Coach picks: replace'}>
        <PicksBody
          view={win.view}
          picks={win.picks}
          all={win.all}
          cur={win.cur}
          add={add}
          busy={busy}
          forWhat={win.s ? `for ${sessionDisplayName(win.s).toLowerCase()}` : `add to ${win.day3.toLowerCase()}`}
          onPoint={i => setWin(cur => (cur && cur.kind === 'pick' ? { ...cur, cur: i } : cur))}
          onTake={row => { void take(win, row as CoachPickJson) }}
          onView={v => setWin(cur => (cur && cur.kind === 'pick' ? { ...cur, view: v, cur: 0 } : cur))}
        />
      </Cmd>
    )
  }

  return { openAct, openAdd, openRune, node, open: win != null }
}
