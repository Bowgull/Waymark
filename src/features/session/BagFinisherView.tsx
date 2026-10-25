import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { FlapLabel } from '@/design'
import { GrassZone, HeroClock, SessionFrame, TimerColumn, type TimerTrack } from '@/components/timers'
import { heavyHaptic } from '@/lib/haptics'
import { soundFinishWarning, soundRestWarning, soundRoundEnd, soundRoundStart } from '@/lib/sounds'
import { playClips } from '@/lib/cuePlayer'
import { deactivateSessionAudio } from '@/lib/sessionAudio'
import { cancelFinisherCues, cancelRestCues, cancelRoundActiveCues, scheduleFinisherCues } from '@/lib/notifications'
import { isStaleCue, type EngineState } from '@/lib/sessionResume'
import { finisherGlow } from '@/lib/lockGlow'
import { backStep } from '@/lib/timers/timerLook'
import { backTargetSec, clockAt, elapsedSec, pauseClock, positionAt, resumeClock, skipTargetSec, startClock, type IntervalClock } from '@/lib/timers/intervalTimer'
import { FINISHER_DONE_WORD, finisherCues, finisherParts, nextAfterSet, setCount, setLine, setOfPart, type FinisherPlan, type FinisherSet } from '@/lib/coach/bagFinisher'
import { useWakeLock } from '@/lib/wakeLock'

import { bagBack } from './bagBacks'
import { useSessionLiveActivity, type LiveActivityConfig } from './useSessionLiveActivity'

import './bagRound.css'
import './bagFinisher.css'

/** DONE · FINISHER shows this long (the done chime), then the cool-down (page 86). */
const DONE_SHOW_MS = 2600

type FinisherState = Extract<EngineState, { kind: 'finisher' }>

interface BagFinisherViewProps {
  plan: FinisherPlan
  /** When it starts (the last round's rest ran out): its clock runs from here. */
  startAtMs: number
  /** Saved state to come back to (session resume). */
  resume?: FinisherState | null
  /** Called on every change so the session can be resumed exactly here. */
  onPersist?: (state: FinisherState) => void
  /** DONE · FINISHER has been read: on to what follows (the combo ratings). */
  onDone: () => void
  /** The × held: leave the session (kept in progress, resumable). */
  onExit?: () => void
  /** A second swipe down in the first set (page 85): back into the last round's rest. */
  onBackToRounds?: (paused: boolean) => void
}

/**
 * One set where the next combo would sit (page 86 `NSET`): the leg small, the
 * set's name on the finisher's red, its time and goal. `lead` prefixes the
 * leg ("NEXT · LEFT LEG") between sets.
 */
export function FinisherSetCard({ set, lead }: { set: FinisherSet; lead?: string }) {
  return (
    <div className="fin-nset" role="img" aria-label={`${lead ? `${lead}: ` : ''}${set.name}, ${set.side}, ${setLine(set)}`}>
      <div className="fin-side" aria-hidden>{lead ? `${lead} · ` : ''}{set.side}</div>
      <FlapLabel text={set.name} size="md" tone="red" animate={false} />
      <span className="fin-gl" aria-hidden>{setLine(set)}</span>
    </div>
  )
}

/**
 * The bag finisher (page 86, approved 2026-10-25): after the last round, a
 * few timed sets. The top bar says FINISHER on its red and 1 OF 3. In a set:
 * the leg small, the set's name on the red plate, the clock in the red, GOAL
 * 20 under it (the app never counts), NEXT · REST 0:20 · SWITCH KICK. The
 * last 10 s turn orange (plate, clock, grass). A 20 s rest between sets is
 * teal and shows only the next set, where the combo would be (its last 5 s
 * orange). The grass is red through a set. At the end DONE · FINISHER and
 * NEXT · COOL-DOWN, the done chime, then on. Tap the grass to pause, swipe up
 * for the next part, swipe down to restart it (again within 3 s: the part
 * before), hold the grass 3 s to end the finisher; the × leaves as on every
 * timer.
 */
export function BagFinisherView({ plan, startAtMs, resume, onPersist, onDone, onExit, onBackToRounds }: BagFinisherViewProps) {
  const parts = useMemo(() => finisherParts(plan), [plan])
  const cues = useMemo(() => finisherCues(parts), [parts])
  const [clock, setClock] = useState<IntervalClock>(() => resume?.clock ?? startClock(startAtMs))
  const [now, setNow] = useState(() => Date.now())
  /** Held through on the grass: DONE at once. */
  const [ended, setEnded] = useState(false)
  const paused = clock.pausedAtMs != null
  const pos = positionAt(parts, elapsedSec(clock, now))
  const done = pos.done || ended

  // Cues duck other audio only while they play; nothing left ducked when the view goes.
  useEffect(() => () => { void deactivateSessionAudio() }, [])

  // The 10 Hz face clock.
  useEffect(() => {
    if (done) return
    const t = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(t)
  }, [done])

  // Save on every change of the clock (it is wall time: a resume lands on the right second).
  useEffect(() => { onPersist?.({ kind: 'finisher', clock }) }, [clock, onPersist])

  useWakeLock(!done && !paused)

  // The bells with the phone locked: the whole timeline at once (JS sleeps), moved with every pause, skip and back.
  const schedule = useCallback((c: IntervalClock) => {
    if (c.pausedAtMs != null) { void cancelFinisherCues(); return }
    void scheduleFinisherCues(c.startedAtMs + c.pausedMs, cues)
  }, [cues])
  useEffect(() => {
    // The last round's own cues have all played by now; the finisher's take over.
    void cancelRoundActiveCues()
    void cancelRestCues()
    schedule(clock)
    return () => { void cancelFinisherCues() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The bells with the screen on: a set's bell as it starts, the lower one as its rest starts,
  // the finish pulses at 10 s, the rest's heads-up at 5 s; never a backlog after a long lock.
  const heard = useRef<{ index: number; tick: number }>({ index: pos.index, tick: pos.shown })
  useEffect(() => {
    if (done || paused) return
    const h = heard.current
    if (pos.index !== h.index) {
      h.index = pos.index
      h.tick = pos.shown
      const startedWall = clock.startedAtMs + clock.pausedMs + pos.part.startSec * 1000
      if (isStaleCue(startedWall, Date.now())) return
      if (pos.part.ph === 'work') { heavyHaptic(); soundRoundStart() } else soundRoundEnd()
      return
    }
    if (pos.shown !== h.tick) {
      h.tick = pos.shown
      if (pos.part.ph === 'work' && pos.shown === 10) soundFinishWarning()
      if (pos.part.ph === 'rest' && pos.shown === 5) soundRestWarning()
    }
  }, [pos.index, pos.shown, pos.part, done, paused, clock])

  // The end: the done chime, DONE · FINISHER read, then on.
  const onDoneRef = useRef(onDone)
  useLayoutEffect(() => { onDoneRef.current = onDone })
  const endWall = clock.startedAtMs + clock.pausedMs + (parts[parts.length - 1].startSec + parts[parts.length - 1].len) * 1000
  const endWallRef = useRef(endWall)
  useLayoutEffect(() => { endWallRef.current = endWall })
  useEffect(() => {
    if (!done) return
    void cancelFinisherCues()
    // Ran out with the screen off long ago: no late chime.
    if (ended || !isStaleCue(endWallRef.current, Date.now())) void playClips(['chime_done'])
    const t = window.setTimeout(() => onDoneRef.current(), DONE_SHOW_MS)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done])

  const togglePause = useCallback(() => {
    if (done) return
    const t = Date.now()
    setNow(t)
    const next = clock.pausedAtMs != null ? resumeClock(clock, t) : pauseClock(clock, t)
    setClock(next)
    schedule(next)
  }, [done, clock, schedule])

  /** Moves the clock to `targetSec` in; paused stays paused. */
  const jumpTo = useCallback((targetSec: number, t: number) => {
    const next = clockAt(targetSec * 1000, clock.pausedAtMs != null, t)
    setClock(next)
    setNow(t)
    schedule(next)
  }, [clock, schedule])

  /** A swipe up the grass: on to the next part (past the last set: DONE). */
  const skip = useCallback(() => {
    if (done) return
    const t = Date.now()
    jumpTo(skipTargetSec(parts, elapsedSec(clock, t)), t)
  }, [done, parts, clock, jumpTo])

  /**
   * A swipe down (page 85): the part from its full length; another within 3 s
   * goes to the part before (from the first set: the last round's rest). Its
   * bell plays at once, paused too, so he hears it moved.
   */
  const back = useCallback(() => {
    if (done) return
    const t = Date.now()
    const step = backStep(bagBack.at, t)
    bagBack.at = t
    bagBack.count++
    const at = positionAt(parts, elapsedSec(clock, t))
    if (step === 'previous' && at.index === 0 && onBackToRounds) {
      void cancelFinisherCues()
      soundRoundEnd()
      onBackToRounds(clock.pausedAtMs != null)
      return
    }
    const target = backTargetSec(parts, elapsedSec(clock, t), step)
    const to = positionAt(parts, target)
    heard.current = { index: to.index, tick: to.shown }
    if (to.part.ph === 'work') soundRoundStart()
    else soundRoundEnd()
    jumpTo(target, t)
  }, [done, parts, clock, jumpTo, onBackToRounds])

  /** Held through on the grass (3 s): the finisher ends here. */
  const endNow = useCallback(() => {
    if (done) return
    setEnded(true)
  }, [done])

  // ─── the lock card ───
  const { part } = pos
  const working = part.ph === 'work'
  const resting = part.ph === 'rest'
  const warn = pos.warn && !paused && !done
  const set = setOfPart(plan, part)
  const setNumber = done ? plan.sets.length : part.round
  const partStartWall = clock.startedAtMs + clock.pausedMs + part.startSec * 1000
  const laConfig: LiveActivityConfig | null = done ? null : {
    sessionType: 'bag_work',
    sessionLabel: 'Bag Work',
    state: {
      phase: working ? 'active' : 'rest',
      label: working ? `Finisher ${part.round} of ${plan.sets.length}` : 'Rest',
      detail: working ? `${set.name} · goal ${set.goal}` : `Next: ${set.name}`,
      stepIndex: setNumber,
      stepTotal: plan.sets.length,
      round: setNumber,
      roundTotal: plan.sets.length,
      combo: [plan.sets[part.round - 1]?.name ?? set.name],
      nextCombo: plan.sets[part.round] ? [plan.sets[part.round].name] : undefined,
      ...finisherGlow(pos.index, resting, warn, bagBack.count),
      startedAt: partStartWall,
      endsAt: partStartWall + part.len * 1000,
      isPaused: paused,
      pausedRemaining: paused ? pos.shown : undefined,
    },
  }
  useSessionLiveActivity(laConfig, {
    onPause: () => { if (!paused) togglePause() },
    onResume: () => { if (paused) togglePause() },
    onRestart: () => { if (!done) jumpTo(part.startSec, Date.now()) },
    onEnd: () => onExit?.(),
    onAdvance: skip,
  })

  // ─── the face ───
  const shown = done ? 0 : pos.shown
  const track: TimerTrack = {
    durationSec: part.len,
    endsAtMs: paused || done ? null : now + pos.left * 1000,
    remainingMs: (done ? 0 : pos.left) * 1000,
  }
  // The plate over the clock: the set's name on the red, REST teal, orange near the end, PAUSED, DONE · FINISHER.
  const plate = done ? { text: FINISHER_DONE_WORD, tone: 'red' as const, cls: '' }
    : paused ? { text: 'PAUSED', tone: 'dim' as const, cls: '' }
      : { text: working ? set.name : 'REST', tone: (working ? 'red' : 'teal') as 'red' | 'teal', cls: warn ? 'fin-orange' : '' }
  const tone = paused ? 'pause' : warn ? 'warn' : working ? 'red' : 'rest'
  const next = done ? ['NEXT · COOL-DOWN'] : working ? nextAfterSet(plan, part.round - 1) : []

  return (
    <SessionFrame
      title="FINISHER"
      titleTone="red"
      onEnd={onExit}
      paused={paused && !done}
      className={`bw fin${resting && !done ? ' is-rest' : ''}`}
      right={<span className="fin-of" aria-label={`Set ${setCount(plan, setNumber)}`}>{setCount(plan, setNumber)}</span>}
      grass={
        <GrassZone
          track={track}
          kind="work"
          mode={working || done ? 'work' : 'rest'}
          red={working || done}
          orange={warn}
          state={paused && !done ? 'paused' : 'running'}
          onTap={done ? undefined : togglePause}
          onSkip={done ? undefined : skip}
          onBack={done ? undefined : back}
          hold={{ onHeld: endNow, held: ended }}
          holdWords={['HOLD · END', 'ENDING']}
          label={paused ? 'Finisher paused. Tap to go on. Swipe up to skip. Swipe down to go back. Hold for 3 seconds to end.' : 'Finisher. Tap to pause. Swipe up to skip. Swipe down to go back. Hold for 3 seconds to end.'}
        />
      }
    >
      <TimerColumn className="fin-mid">
        <div className="fin-top">
          {!done && working && <div className="fin-side">{set.side}</div>}
          {!done && resting && <FinisherSetCard set={set} lead="NEXT" />}
        </div>
        <div className="tm-word" data-finisher data-phase={done ? 'done' : part.ph} data-warn={warn ? '1' : '0'}>
          <span key={plate.text + plate.cls + plate.tone} className="tm-settle"><FlapLabel text={plate.text} size="md" tone={plate.cls ? 'ink' : plate.tone} className={plate.cls} animate={false} /></span>
        </div>
        {!done && <HeroClock seconds={shown} kind="work" tint={tone} px={120} />}
        {!done && working && (
          <div className={`tm-count fin-goal is-${tone}`} role="img" aria-label={`Goal ${set.goal}`}>
            <span className="tm-count-l">GOAL</span>
            <span key={set.goal} className="tm-settle"><FlapLabel text={String(set.goal)} size="xl" len={2} className="tm-count-n" animate={false} /></span>
          </div>
        )}
        {next.length > 0 && (
          <div className="tm-next">
            {next.map((p, i) => <span key={i}>{i > 0 && <i aria-hidden>·</i>}{p}</span>)}
          </div>
        )}
      </TimerColumn>
      {paused && !done && <span className="sr-only" role="status">Paused</span>}
    </SessionFrame>
  )
}
