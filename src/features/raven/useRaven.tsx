import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { layerCount, showPop } from '@/design'
import { getTodayISO } from '@/lib/dates'
import { useReducedMotion } from '@/design/motion'
import { getItem, setItem } from '@/lib/safeStorage'
import type { MorningRaven } from '@/features/blockZero/TodayPieces'

import { bodyAct, useBodyWatch, type BodyWatchViewIn } from './bodyWatch'
import type { RavenState } from './Raven'
import { RavenAsk, RavenNote } from './RavenBoards'

const LANDED_KEY = 'waymark_raven_landed'
const LEFT_KEY = 'waymark_raven_left'
/** The question asks once a day on its own (page 61), not on every visit to Today. */
const ASKED_KEY = 'waymark_raven_asked'
const FLY_MS = 1950
const ASK_AFTER_MS = 2300

/**
 * The raven on Today (page 58): it flies in once on the day it lands (and on
 * each return morning), looks round until its note is read, then sits still.
 * A tap opens its board; on a return morning the question opens on its own,
 * on top (the morning alarm's I'M UP lands here too). The day after it
 * clears, it flies off. `onChanged`: the week changed (DO IT, FEELS BETTER):
 * read the day and its runes again.
 */
export function useRavenOnToday(onChanged: () => void): { raven: MorningRaven | null; overlay: ReactNode } {
  const watch = useBodyWatch()
  const a = watch?.alert ?? null
  const reduced = useReducedMotion()
  const [open, setOpen] = useState<'note' | 'ask' | null>(null)
  const [phase, setPhase] = useState<{ key: string; state: RavenState | null } | null>(null)
  const askedFor = useRef<string | null>(null)

  const key = a ? `${a.id}:${a.arrivedOn}` : null
  // Arrival (once per landing on this phone) and leaving (once): the timeline runs on timers.
  const [, setTick] = useState(0)
  const landed = key != null && getItem(LANDED_KEY) === key
  const flying = !!a && a.raven === 'watch' && !landed && !reduced
  useEffect(() => {
    if (!a || !key) return
    const timers: number[] = []
    if (a.raven === 'leave' && getItem(LEFT_KEY) !== a.id) {
      timers.push(window.setTimeout(() => setPhase({ key, state: reduced ? null : 'leave' }), reduced ? 0 : 1200))
      timers.push(window.setTimeout(() => { setItem(LEFT_KEY, a.id); setPhase({ key, state: null }) }, reduced ? 10 : 2800))
    } else if (a.raven === 'watch' && getItem(LANDED_KEY) !== key) {
      timers.push(window.setTimeout(() => { setItem(LANDED_KEY, key); setTick(t => t + 1) }, reduced ? 0 : FLY_MS))
    } else if (getItem(LANDED_KEY) !== key) {
      setItem(LANDED_KEY, key)
    }
    return () => timers.forEach(t => window.clearTimeout(t))
  }, [a?.id, a?.raven, key, reduced]) // eslint-disable-line react-hooks/exhaustive-deps

  // The return morning: the question opens on top, after the raven lands. Once a day by
  // itself (page 61), and never over another board: it waits until that one is closed.
  useEffect(() => {
    if (!a?.askDue || !key || askedFor.current === key) return
    const askedToday = `${key}:${getTodayISO()}`
    if (getItem(ASKED_KEY) === askedToday) return
    askedFor.current = key
    let poll: number | null = null
    const tryOpen = () => {
      if (layerCount() > 0) return false
      setItem(ASKED_KEY, askedToday)
      setOpen('ask')
      return true
    }
    const t = window.setTimeout(() => {
      if (!tryOpen()) poll = window.setInterval(() => { if (tryOpen() && poll != null) window.clearInterval(poll) }, 500)
    }, reduced || getItem(LANDED_KEY) === key ? 300 : ASK_AFTER_MS)
    return () => { window.clearTimeout(t); if (poll != null) window.clearInterval(poll) }
  }, [a?.askDue, key, reduced])

  let pose: RavenState | null = null
  if (a) {
    if (phase && phase.key === key) pose = phase.state
    else if (a.raven === 'leave') pose = getItem(LEFT_KEY) === a.id ? null : 'settled'
    else pose = flying ? 'fly' : a.raven
  }

  const close = useCallback(() => setOpen(null), [])
  const pop = (t: { title: string; text: string } | null) => { if (t) showPop(t.text, 'good', { title: t.title }) }
  const fail = () => showPop("Couldn't reach the coach. Check your connection.", 'bad')

  const openBoard = useCallback((v: BodyWatchViewIn) => {
    if (v.stage === 'ask1' || v.stage === 'ask2') { setOpen('ask'); return }
    if (!v.board) return
    setOpen('note')
    if (!v.seen) void bodyAct(v.id, { kind: 'seen' }).catch(() => {})
  }, [])

  let overlay: ReactNode = null
  if (a && open === 'note' && a.board) {
    overlay = (
      <RavenNote
        view={a.board}
        onClose={close}
        onGot={async () => { try { await bodyAct(a.id, { kind: 'got' }); close() } catch { fail() } }}
        onDoIt={async () => { try { pop(await bodyAct(a.id, { kind: 'apply' })); close(); onChanged() } catch { fail() } }}
        onBetter={async () => { try { pop(await bodyAct(a.id, { kind: 'answer', answer: 'better' })); close(); onChanged() } catch { fail() } }}
      />
    )
  } else if (a && open === 'ask' && a.ask) {
    overlay = (
      <RavenAsk
        ask={a.ask}
        onClose={close}
        onBetter={async () => { try { pop(await bodyAct(a.id, { kind: 'answer', answer: 'better' })); close(); onChanged() } catch { fail() } }}
        // STILL SORE: the next board lands at once (plan 2, or the physio board).
        onSore={async () => { try { await bodyAct(a.id, { kind: 'answer', answer: 'sore' }); setOpen('note'); onChanged() } catch { fail() } }}
        onNotNow={async () => { try { await bodyAct(a.id, { kind: 'answer', answer: 'not_now' }); close() } catch { fail() } }}
      />
    )
  }

  const raven: MorningRaven | null = a && (pose != null || a.line) ? { state: pose, line: a.line, place: a.place, onOpen: () => openBoard(a) } : null
  return { raven, overlay }
}
