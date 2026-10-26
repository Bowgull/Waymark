import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

import { FlapLabel } from '@/design'
import { GrassZone, RoundClock, SessionFrame, type TimerTrack } from '@/components/timers'
import { playClips } from '@/lib/cuePlayer'
import { intervalIsNative, intervalNative } from '@/lib/intervalNative'
import { deactivateSessionAudio } from '@/lib/sessionAudio'
import { isStaleCue, type EngineState } from '@/lib/sessionResume'
import { intervalActivityState } from '@/lib/timers/intervalActivity'
import { backTargetSec, clockAt, elapsedSec, pauseClock, positionAt, resumeClock, skipTargetSec, startClock, type IntervalClock } from '@/lib/timers/intervalTimer'
import { backStep } from '@/lib/timers/timerLook'
import { useWakeLock } from '@/lib/wakeLock'
import { bagComboSize } from '@/lib/timers/bagRound'
import {
  MOVES,
  condEnded,
  condJumped,
  condRanTo,
  conditioningCues,
  conditioningParts,
  newConditioningLog,
  nextMove,
  type ConditioningLog,
  type ConditioningPlan,
  type MoveKey,
} from '@/lib/coach/bagConditioning'

import { useSessionLiveActivity, type LiveActivityConfig } from './useSessionLiveActivity'

import './bagRound.css'
import './bagConditioning.css'

/** DONE shows this long (the done chime), then the effort card. */
const DONE_SHOW_MS = 2600
/** A move's cue shows for the first 10 s of its part (bag-workouts.md section 5). */
const CUE_SEC = 10

type ClockState = Extract<EngineState, { kind: 'finisher' }>

interface BagConditioningViewProps {
  plan: ConditioningPlan
  /** Saved state to come back to (session resume): the timer's wall clock. */
  resume?: ClockState | null
  /** Called on every change so the session can be resumed exactly here. */
  onPersist?: (state: ClockState) => void
  /** DONE has been read: on to the effort card. */
  onDone: () => void
  /** The × held: leave the session (kept in progress, resumable). */
  onExit?: () => void
  /** The log so far (kept on the phone until the session is finished). */
  log?: ConditioningLog | null
  onLog?: (log: ConditioningLog) => void
}

/** A move's words, split where it shows them one under another ("BODY KICKS · RIGHT", "SQUAT › STAND › KICK"). */
function moveWords(key: MoveKey | null | undefined): { words: string[]; sep: '·' | '›' } {
  if (!key) return { words: [], sep: '·' }
  const name = MOVES[key].name
  return name.includes(' › ') ? { words: name.split(' › '), sep: '›' } : { words: name.split(' · '), sep: '·' }
}

/**
 * Bag Conditioning (page 93): page 81's interval timer with one move big at a
 * time. GET READY (teal) shows the first move; WORK (gold, orange the last
 * 10 s) the move stacked big with its effort word over it and its cue on the
 * teal flap for the first 10 s, ROUND n OF N beside the clock in the main
 * blocks; REST (teal) what's next. The warm-up and cool-down are blocks on the
 * same timer, not extra screens. The grass does everything, no buttons: tap
 * to pause, swipe up for the next part, swipe down to restart it (again within
 * 3 s: the part before), hold 3 s to end. Each part is logged done or skipped
 * as it goes; at the end DONE, then the built effort card.
 */
export function BagConditioningView({ plan, resume, onPersist, onDone, onExit, log: savedLog, onLog }: BagConditioningViewProps) {
  const parts = useMemo(() => conditioningParts(plan), [plan])
  const cues = useMemo(() => conditioningCues(plan, parts), [plan, parts])
  // The lock card counts the main rounds (the warm-up as round 1, the cool-down as the last).
  const lockParts = useMemo(() => parts.map(p => {
    const x = p.round > 0 ? plan.parts[p.round - 1] : null
    const b = x ? plan.blocks[x.block] : null
    return { ph: p.ph, len: p.len, round: b?.round ?? (b?.kind === 'cooldown' ? plan.rounds : 1) }
  }), [parts, plan])
  const [clock, setClock] = useState<IntervalClock>(() => resume?.clock ?? startClock(Date.now()))
  const [now, setNow] = useState(() => Date.now())
  const [ended, setEnded] = useState(false)
  const paused = clock.pausedAtMs != null
  const pos = positionAt(parts, elapsedSec(clock, now))
  const done = pos.done || ended

  // The log: each part done (its time ran out) or skipped (swiped past, or held through before it).
  const logRef = useRef<ConditioningLog>(savedLog && savedLog.parts.length === plan.parts.length ? savedLog : newConditioningLog(plan))
  const onLogRef = useRef(onLog)
  useLayoutEffect(() => { onLogRef.current = onLog })
  const writeLog = useCallback((next: ConditioningLog) => { logRef.current = next; onLogRef.current?.(next) }, [])
  const runIdx = pos.done && !ended ? parts.length : pos.index
  useEffect(() => {
    if (ended) return
    const l = logRef.current
    if (runIdx > l.at) writeLog(condRanTo(l, parts, runIdx))
  }, [runIdx, ended, parts, writeLog])

  useEffect(() => () => { void deactivateSessionAudio() }, [])

  // The 10 Hz face clock.
  useEffect(() => {
    if (done) return
    const t = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(t)
  }, [done])

  useEffect(() => { onPersist?.({ kind: 'finisher', clock }) }, [clock, onPersist])
  useWakeLock(!done && !paused)

  // The phone: the native timer keeps the beeps, Poppy and the lock card going with the screen off.
  const nativeStart = useCallback((startedAtMs: number, wasPaused: boolean) => {
    void intervalNative.start({ parts: lockParts, rounds: plan.rounds, cues, startedAtMs }).then(() => (wasPaused ? intervalNative.pause() : undefined))
  }, [cues, lockParts, plan.rounds])
  useEffect(() => {
    nativeStart(clock.startedAtMs + clock.pausedMs, clock.pausedAtMs != null)
    return () => { void intervalNative.stop() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The web: the sounds play here (on the phone the native timer plays them); never a backlog after a long lock.
  const heard = useRef<{ index: number; tick: number }>({ index: pos.index, tick: pos.shown })
  useEffect(() => {
    if (intervalIsNative || done || paused) return
    const h = heard.current
    if (pos.index !== h.index) {
      h.index = pos.index
      h.tick = pos.shown
      const startedWall = clock.startedAtMs + clock.pausedMs + pos.part.startSec * 1000
      if (isStaleCue(startedWall, Date.now())) return
      const cue = cues.find(c => c.kind === 'change' && c.atSec === pos.part.startSec)
      void playClips(cue?.clips ?? ['t_change'])
      return
    }
    if (pos.warn && pos.shown !== h.tick) { h.tick = pos.shown; void playClips(['t_tick']) }
  }, [pos.index, pos.shown, pos.warn, pos.part, done, paused, clock, cues])

  // The end: the done chime, DONE read, then the effort card.
  const onDoneRef = useRef(onDone)
  useLayoutEffect(() => { onDoneRef.current = onDone })
  useEffect(() => {
    if (!done) return
    void intervalNative.stop()
    if (!intervalIsNative || ended) void playClips(ended ? ['chime_done'] : ['chime_done', 't_done'])
    const t = window.setTimeout(() => onDoneRef.current(), DONE_SHOW_MS)
    return () => window.clearTimeout(t)
  }, [done, ended])

  const togglePause = useCallback(() => {
    if (done) return
    const t = Date.now()
    setNow(t)
    const next = clock.pausedAtMs != null ? resumeClock(clock, t) : pauseClock(clock, t)
    setClock(next)
    void (next.pausedAtMs != null ? intervalNative.pause() : intervalNative.resume())
  }, [done, clock])

  /** Moves the clock to `targetSec` in and re-times the native timer there; paused stays paused. */
  const jumpTo = useCallback((targetSec: number, t: number) => {
    const wasPaused = clock.pausedAtMs != null
    setClock(clockAt(targetSec * 1000, wasPaused, t))
    setNow(t)
    nativeStart(t - targetSec * 1000, wasPaused)
  }, [clock, nativeStart])

  /** A swipe up the grass: on to the next part (the one swiped past is skipped). */
  const skip = useCallback(() => {
    if (done) return
    const t = Date.now()
    const el = elapsedSec(clock, t)
    const target = skipTargetSec(parts, el)
    const to = positionAt(parts, target)
    writeLog(condJumped(logRef.current, parts, positionAt(parts, el).index, to.done ? parts.length : to.index, true))
    jumpTo(target, t)
  }, [done, parts, clock, jumpTo, writeLog])

  /** A swipe down (page 85): the part from its full length; again within 3 s, the part before. */
  const lastBackAt = useRef<number | null>(null)
  const back = useCallback(() => {
    if (done) return
    const t = Date.now()
    const step = backStep(lastBackAt.current, t)
    lastBackAt.current = t
    const at = positionAt(parts, elapsedSec(clock, t))
    const target = backTargetSec(parts, elapsedSec(clock, t), step)
    const to = positionAt(parts, target)
    writeLog(condJumped(logRef.current, parts, at.index, to.index, false))
    jumpTo(target, t)
    if (intervalIsNative) return
    heard.current = { index: to.index, tick: to.shown }
    void playClips(['t_change'])
  }, [done, parts, clock, jumpTo, writeLog])

  /** Held through on the grass (3 s): it ends here; what's left is skipped. */
  const endNow = useCallback(() => {
    if (done) return
    writeLog(condEnded(logRef.current, parts, positionAt(parts, elapsedSec(clock, Date.now())).index))
    setEnded(true)
  }, [done, parts, clock, writeLog])

  // ─── the lock card ───
  const { part } = pos
  const x = part.round > 0 ? plan.parts[part.round - 1] : null
  const block = x ? plan.blocks[x.block] : null
  const working = part.ph === 'work'
  const resting = part.ph !== 'work'
  const warn = pos.warn && !paused && !done
  // what the screen names: the move now at work; the next one getting ready and resting
  const shownMove = working ? x?.move ?? null : nextMove(plan, part.round - 1)
  const laConfig: LiveActivityConfig | null = done ? null : {
    sessionType: 'bag_work',
    sessionLabel: 'Bag Conditioning',
    state: {
      ...intervalActivityState({ ...pos, part: { ...part, round: lockParts[pos.index]?.round ?? 1 } }, clock, plan.rounds),
      detail: shownMove ? MOVES[shownMove].name : undefined,
      combo: shownMove ? [MOVES[shownMove].name] : undefined,
    },
  }
  useSessionLiveActivity(laConfig, {
    onPause: () => { if (intervalIsNative) return; if (!paused) togglePause() },
    onResume: () => { if (intervalIsNative) return; if (paused) togglePause() },
    onRestart: () => { if (!done) jumpTo(part.startSec, Date.now()) },
    onEnd: () => onExit?.(),
    onAdvance: skip,
  })

  // One move size for the whole session (page 55's fit): the largest at which every move fits the zone,
  // set by the longest word or the tallest stack, so nothing jumps between parts.
  const zoneRef = useRef<HTMLDivElement>(null)
  const [movePx, setMovePx] = useState<number | null>(null)
  const views = useMemo(() => [...new Set(plan.parts.map(p => p.move).filter((m): m is MoveKey => !!m))].map(m => ({ now: moveWords(m).words, then: [] })), [plan])
  useLayoutEffect(() => {
    const z = zoneRef.current
    if (!z) return
    const fit = () => setMovePx(bagComboSize(views, { width: z.clientWidth, height: z.clientHeight - 20 }, 48))
    fit()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(fit)
    ro.observe(z)
    return () => ro.disconnect()
  }, [views])

  // ─── the face ───
  const shown = done ? 0 : pos.shown
  const track: TimerTrack = {
    durationSec: part.len,
    endsAtMs: paused || done ? null : now + pos.left * 1000,
    remainingMs: (done ? 0 : pos.left) * 1000,
  }
  const sinceStart = part.len - pos.left
  const cue = working && shownMove && sinceStart < CUE_SEC ? MOVES[shownMove].cue ?? null : null
  // The small word over the move: FIRST before the start, NEXT resting, the block's name in the warm-up and
  // cool-down, the effort in the rounds.
  const side = part.ph === 'ready' ? 'FIRST' : resting ? 'NEXT' : block?.round != null ? x?.effort ?? 'STEADY' : block?.name ?? ''
  const { words, sep } = moveWords(shownMove)
  const counted = working && x?.goal != null
  const roundN = block?.round ?? null
  const nextRound = resting ? plan.blocks[plan.parts[Math.min(plan.parts.length - 1, part.round)]?.block ?? 0]?.round ?? null : null
  const pairN = working ? roundN : part.ph === 'rest' ? nextRound : null
  const plate = done ? { text: ended ? 'ENDED' : 'DONE', tone: 'gold' as const }
    : paused ? { text: 'PAUSED', tone: 'dim' as const }
      : { text: part.ph === 'ready' ? 'GET READY' : working ? 'WORK' : 'REST', tone: (working ? (counted ? 'red' : 'gold') : 'teal') as 'gold' | 'teal' | 'red' }

  return (
    <SessionFrame
      title="BAG CONDITIONING"
      onEnd={onExit}
      paused={paused && !done}
      className={`bw bc${resting && !done ? ' is-rest' : ''}`}
      grass={
        <GrassZone
          track={track}
          kind="work"
          mode={working || done ? 'work' : 'rest'}
          red={counted}
          orange={warn}
          band={0.34}
          state={paused && !done ? 'paused' : 'running'}
          onTap={done ? undefined : togglePause}
          onSkip={done ? undefined : skip}
          onBack={done ? undefined : back}
          hold={{ onHeld: endNow, held: ended }}
          holdWords={['HOLD · END', 'ENDING']}
          label={paused ? 'Bag conditioning paused. Tap to go on. Swipe up to skip. Swipe down to go back. Hold for 3 seconds to end.' : 'Bag conditioning. Tap to pause. Swipe up to skip. Swipe down to go back. Hold for 3 seconds to end.'}
        />
      }
    >
      <div ref={zoneRef} className="bw-zone bc-zone" style={{ '--cs': `${movePx ?? 36}px`, visibility: movePx == null ? 'hidden' : undefined } as CSSProperties}>
        {!done && (
          <>
            <div className="bw-side">{side}</div>
            {words.length > 0 && (
              <div className={`bw-stack${warn ? ' is-dim' : ''}`} role="img" aria-label={shownMove ? MOVES[shownMove].name : ''} data-move={shownMove ?? ''}>
                {words.map((w, i) => (
                  <Fragment key={i}>
                    {i > 0 && <span className={`bc-sep${sep === '›' ? ' is-arrow' : ''}`} aria-hidden>{sep}</span>}
                    <FlapLabel text={w} size="xl" className="bw-strike" animate={false} />
                  </Fragment>
                ))}
              </div>
            )}
            <div className={`bw-cue${cue ? '' : ' is-hidden'}`} aria-hidden={!cue}>
              {cue && <FlapLabel text={`CUE · ${cue}`} size="xs" tone="teal" animate={false} />}
            </div>
            {part.ph === 'rest' && x?.task && <div className="bc-task">{x.task}</div>}
          </>
        )}
      </div>
      {/* page 81's plate over the clock: GET READY / REST teal, WORK gold, orange near the end; it settles in, no letter flips */}
      <div className="tm-word" data-conditioning data-phase={done ? 'done' : part.ph} data-part={runIdx} data-warn={warn ? '1' : '0'}>
        <span key={plate.text + plate.tone + (warn ? 'w' : '')} className="tm-settle"><FlapLabel text={plate.text} size="md" tone={warn ? 'ink' : plate.tone} className={warn ? 'bc-orange' : ''} animate={false} /></span>
      </div>
      {!done && (
        <div className="bw-pair">
          {pairN != null && (
            <div className="bw-round" role="img" aria-label={`${working ? 'Round' : 'Next round'} ${pairN} of ${plan.rounds}`}>
              <span className="bw-lab">{working ? 'ROUND' : 'NEXT'}</span>
              <FlapLabel text={String(pairN)} size="xl" tone={working ? 'gold' : 'teal'} className="bw-digit" animate={false} />
              <small>OF {plan.rounds}</small>
            </div>
          )}
          <RoundClock seconds={shown} kind={working ? 'work' : 'rest'} heat={warn ? 'ho' : null} tone={working ? 'ink' : 'teal'} track={track} px={pairN != null ? 76 : 92} />
        </div>
      )}
      {counted && !done && (
        <div className="tm-count fin-goal" role="img" aria-label={`Goal ${x!.goal}`}>
          <span className="tm-count-l">GOAL</span>
          <FlapLabel text={String(x!.goal)} size="xl" className="tm-count-n" animate={false} />
        </div>
      )}
      {done && <div className="tm-next bw-next"><span>NEXT · EFFORT</span></div>}
      <div className="bw-gspace" aria-hidden />
      {paused && !done && <span className="sr-only" role="status">Paused</span>}
    </SessionFrame>
  )
}
