import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

import { FlapLabel } from '@/design'
import { GrassZone, PhaseWord, RoundClock, SessionFrame, type TimerTrack } from '@/components/timers'
import { heavyHaptic } from '@/lib/haptics'
import {
  soundRoundStart,
  soundRoundEnd,
  soundFinishWarning,
  soundRestWarning,
} from '@/lib/sounds'
import { deactivateSessionAudio } from '@/lib/sessionAudio'
import {
  scheduleRoundCuesUntil,
  scheduleRestCuesUntil,
  cancelRoundActiveCues,
  cancelRestCues,
} from '@/lib/notifications'
import { comboCue } from '@/lib/comboCue'
import { isStaleCue, type EngineState } from '@/lib/sessionResume'
import { bagComboSize, cueShown, lockComboSize, roundsBack, type BagRoundView } from '@/lib/timers/bagRound'
import { freshSnap } from '@/lib/timers/swipeBack'
import { bagGlow } from '@/lib/lockGlow'
import { backStep, comboStrikes, heatFor, workLabel, type Heat } from '@/lib/timers/timerLook'
import { useWakeLock } from '@/lib/wakeLock'

import { useRestTimer } from './useRestTimer'
import { useSessionLiveActivity, type LiveActivityConfig } from './useSessionLiveActivity'

import './bagRound.css'

interface ComboData {
  id: string
  orderIndex: number
  combo: {
    id: string
    text: string
    tier: string
    level: string
    masteryScore?: number
    isFavourite?: number
    techniques?: string
    formTips?: string
    /** Found in an MT class (page 49's glove). Not stored yet; carried to the lock card when it is. */
    fromClass?: boolean | number | null
  } | null
}

interface RoundData {
  id: string
  roundNumber: number
  durationSec: number
  restSec: number
  roundType?: string | null
  coachRationale?: string | null
  combos: ComboData[]
}

type RoundPhase = 'ready' | 'fighting' | 'rest'

interface BagWorkRoundViewProps {
  round: RoundData
  totalRounds: number
  /** The round after this one: its combo flips in on the rest board (NEXT). */
  nextRound?: RoundData | null
  /** Every round of the session: the one combo size is fitted to the longest of them (page 55). */
  rounds?: RoundData[]
  phase: RoundPhase
  onPhaseChange: (phase: RoundPhase) => void
  onNextRound: () => void
  onComplete: () => void
  /** Hold the × (1.5 s): leave the session (kept in progress, resumable). */
  onExit?: () => void
  /** Saved state to come back to (session resume), already brought up to now. */
  resume?: Extract<EngineState, { kind: 'rounds' }> | null
  /** Called on every change so the session can be resumed exactly here. */
  onPersist?: (state: Extract<EngineState, { kind: 'rounds' }>) => void
  /** A round ended: its index (0-based) and the seconds actually worked (the done summary's per-round lines). */
  onRoundDone?: (roundIndex: number, actualSec: number) => void
  /**
   * A swipe down into an earlier round (page 85): the session moves to that
   * round in this state, its timer already set; the round's view mounts on it
   * as on a resume (its cues scheduled there).
   */
  onBackRound?: (state: Extract<EngineState, { kind: 'rounds' }>) => void
}

/**
 * The last swipe down's time (page 85: another within 3 s goes back again).
 * Kept outside the view: going back into an earlier round mounts that round's
 * own view, and the 3 s carry across.
 */
let lastBagBackAt: number | null = null
/** Swipes back this session (module-level like lastBagBackAt: it outlives a round's remount); the lock card flashes on each. */
let bagBacks = 0

/** The combos of a round as its board shows them: the first stacked, the others on THEN. */
function roundView(r: RoundData | null | undefined): BagRoundView {
  const combos = (r?.combos ?? []).filter(rc => rc.combo).map(rc => comboStrikes(rc.combo!.text))
  return { now: combos[0] ?? [], then: combos.slice(1).filter(c => c.length > 0) }
}

function firstCombo(r: RoundData | null | undefined) {
  return r?.combos.find(rc => rc.combo)?.combo ?? null
}

/**
 * A bag round (page 55 layout 1, "Round and clock on the grass", approved
 * 2026-10-19). The top bar: ×, BAG WORK, and FIGHT (gold; FINISH in the heat).
 * The combo stacked at the top, one strike per line joined by gold ⌄ arrows,
 * at the session's one size (fitted to its longest combo); its form cue on a
 * gold flap under it (lib/comboCue, never AI) for the first 20 s, its space
 * kept after; THEN with the round's other combos, small. ROUND / 3 / OF 6 and
 * the unboxed M:SS clock stand on the grass, a fixed 34% band that nothing
 * sits on and that fills with the round. Last 10 s: the heat on the clock,
 * FINISH and the grass; the combo dims and THEN hides. Rest is teal: REST,
 * NEXT / 4 / OF 6, the next round's combo at full size with its cue in teal.
 * Tap the grass to pause, swipe up to skip to the next phase, hold the × to end.
 */
export function BagWorkRoundView({
  round,
  totalRounds,
  nextRound,
  rounds,
  phase,
  onPhaseChange,
  onNextRound,
  onComplete,
  onExit,
  resume,
  onPersist,
  onRoundDone,
  onBackRound,
}: BagWorkRoundViewProps) {
  const roundTimer = useRestTimer()
  const restTimer = useRestTimer()

  const isLastRound = round.roundNumber >= totalRounds
  const roundIndex = round.roundNumber - 1

  // Cues duck other audio only while they play (lib/sessionAudio); make sure
  // nothing is left ducked when the view goes.
  useEffect(() => {
    return () => { void deactivateSessionAudio() }
  }, [])

  // Resume: put the saved timer back and re-sync the scheduled cues to its
  // real end time (stale ones cancelled, the rest rescheduled).
  const restoredRef = useRef(false)
  const restoreRound = roundTimer.restore
  const restoreRest = restTimer.restore
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    if (!resume || resume.round !== roundIndex || !resume.timer) return
    const t = resume.timer
    if (resume.sub === 'fighting') {
      restoreRound(t)
      if (t.state === 'running') void scheduleRoundCuesUntil(t.endsAtMs, isLastRound ? null : round.restSec)
      else { void cancelRoundActiveCues(); void cancelRestCues() }
    } else if (resume.sub === 'rest') {
      restoreRest(t)
      void cancelRoundActiveCues()
      if (t.state === 'running') void scheduleRestCuesUntil(t.endsAtMs)
      else void cancelRestCues()
    }
  }, [isLastRound, restoreRest, restoreRound, resume, round.restSec, roundIndex])

  // Save on every change: phase and the running timer's end (or what is left).
  const roundSnapshot = roundTimer.snapshot
  const restSnapshot = restTimer.snapshot
  useEffect(() => {
    onPersist?.({
      kind: 'rounds',
      round: roundIndex,
      sub: phase,
      timer: phase === 'fighting' ? roundSnapshot() : phase === 'rest' ? restSnapshot() : null,
    })
  }, [onPersist, phase, roundIndex, roundSnapshot, restSnapshot, roundTimer.isRunning, roundTimer.isPaused, roundTimer.endsAtMs, restTimer.isRunning, restTimer.isPaused, restTimer.endsAtMs])

  useWakeLock(
    (phase === 'fighting' && roundTimer.isRunning && !roundTimer.isPaused) ||
    (phase === 'rest' && restTimer.isRunning && !restTimer.isPaused),
  )

  function handleStartRound() {
    heavyHaptic()
    soundRoundStart()
    roundTimer.start(round.durationSec)
    // The whole round + rest timeline at once: JS sleeps while locked.
    void scheduleRoundCuesUntil(Date.now() + round.durationSec * 1000, isLastRound ? null : round.restSec)
    onPhaseChange('fighting')
  }

  /**
   * `natural`: the round's time ran out. Its rest then starts at the round's
   * real end (not when JS woke up), and a cue that is long past is not played.
   */
  const handleRoundEnd = useCallback((natural = false) => {
    const endedAt = natural && roundTimer.endsAtMs > 0 ? roundTimer.endsAtMs : Date.now()
    if (!natural || !isStaleCue(endedAt, Date.now())) soundRoundEnd()
    onRoundDone?.(roundIndex, natural ? round.durationSec : Math.max(0, Math.min(round.durationSec, round.durationSec - Math.max(0, roundTimer.secondsRemaining))))
    roundTimer.stop()
    void cancelRoundActiveCues()
    if (isLastRound) {
      void cancelRestCues()
      onComplete()
    } else {
      restTimer.startFrom(endedAt, round.restSec)
      // Ended early: the rest cues scheduled at round start are now wrong.
      if (!natural) void scheduleRestCuesUntil(endedAt + round.restSec * 1000)
      onPhaseChange('rest')
    }
  }, [isLastRound, onComplete, onPhaseChange, onRoundDone, restTimer, round.durationSec, round.restSec, roundIndex, roundTimer])

  const handleRestDone = useCallback((natural = false) => {
    if (natural && !isStaleCue(restTimer.endsAtMs, Date.now())) soundRoundStart()
    restTimer.stop()
    void cancelRestCues()
    onNextRound()
  }, [onNextRound, restTimer])

  useEffect(() => {
    // Use <= 0 so a locked-screen jump past zero still fires
    if (phase === 'fighting' && roundTimer.secondsRemaining <= 0 && roundTimer.isRunning && !roundTimer.isPaused) {
      handleRoundEnd(true)
    }
  }, [handleRoundEnd, roundTimer.secondsRemaining, roundTimer.isRunning, roundTimer.isPaused, phase])

  // Last 10 seconds of round — finish warning (screen on only; notification handles locked)
  useEffect(() => {
    if (phase === 'fighting' && roundTimer.secondsRemaining === 10) {
      soundFinishWarning()
    }
  }, [roundTimer.secondsRemaining, phase])

  // Auto-advance rest timer
  useEffect(() => {
    if (phase === 'rest' && restTimer.secondsRemaining <= 0 && restTimer.isRunning && !restTimer.isPaused) {
      handleRestDone(true)
    }
  }, [handleRestDone, restTimer.secondsRemaining, restTimer.isRunning, restTimer.isPaused, phase])

  // 10 seconds left in rest — heads up (screen on only; notification handles locked)
  useEffect(() => {
    if (phase === 'rest' && restTimer.secondsRemaining === 10) {
      soundRestWarning()
    }
  }, [restTimer.secondsRemaining, phase])

  // Live Activity: the lock card (page 55 "combo on two lines"). It counts
  // rounds apart from the step count, shows this round's first combo in a
  // round and the next round's first combo in rest, at one size per session.
  // Nothing changes in the last 10 s (iOS can't redraw then; the bell does it).
  const sessionRounds = useMemo(
    () => rounds ?? [round, nextRound].filter((r): r is RoundData => !!r),
    [nextRound, round, rounds],
  )
  const views = useMemo(() => sessionRounds.map(roundView), [sessionRounds])
  const lockSize = useMemo(() => lockComboSize(views.map(v => v.now)), [views])
  const nowCombo = firstCombo(round)
  const nextCombo = firstCombo(nextRound)
  const laCombo = {
    stepIndex: round.roundNumber,
    stepTotal: totalRounds,
    round: round.roundNumber,
    roundTotal: totalRounds,
    combo: nowCombo ? comboStrikes(nowCombo.text) : undefined,
    nextCombo: nextCombo ? comboStrikes(nextCombo.text) : undefined,
    comboSize: lockSize,
  }
  const activityConfig: LiveActivityConfig | null =
    phase === 'fighting' && roundTimer.isRunning
      ? {
          sessionType: 'bag_work',
          sessionLabel: 'Bag Work',
          state: {
            phase: 'active',
            label: `Round ${round.roundNumber} of ${totalRounds}`,
            detail: nowCombo?.text ?? undefined,
            ...laCombo,
            fromClass: !!nowCombo?.fromClass,
            // page 82: gold, orange in the last 10 s (colour only); flashes as the round starts
            ...bagGlow(round.roundNumber, false, !roundTimer.isPaused && roundTimer.secondsRemaining <= 10, bagBacks),
            startedAt: roundTimer.startedAtMs,
            endsAt: roundTimer.endsAtMs,
            isPaused: roundTimer.isPaused,
            pausedRemaining: roundTimer.isPaused
              ? roundTimer.secondsRemaining
              : undefined,
          },
        }
      : phase === 'rest' && restTimer.isRunning
        ? {
            sessionType: 'bag_work',
            sessionLabel: 'Bag Work',
            state: {
              phase: 'rest',
              label: 'Rest',
              detail: nextCombo?.text ?? `Next: Round ${round.roundNumber + 1}`,
              ...laCombo,
              fromClass: !!nextCombo?.fromClass,
              ...bagGlow(round.roundNumber, true, false, bagBacks),
              startedAt: restTimer.startedAtMs,
              endsAt: restTimer.endsAtMs,
              isPaused: restTimer.isPaused,
              pausedRemaining: restTimer.isPaused
                ? restTimer.secondsRemaining
                : undefined,
            },
          }
        : null

  function pauseRound(pausedRemainingMs?: number) {
    void cancelRoundActiveCues()
    void cancelRestCues()
    roundTimer.pause(pausedRemainingMs)
  }
  function resumeRound(newEndsAtMs?: number) {
    const endsAt = roundTimer.resume(newEndsAtMs)
    if (endsAt > Date.now()) void scheduleRoundCuesUntil(endsAt, isLastRound ? null : round.restSec)
  }
  function pauseRest(pausedRemainingMs?: number) {
    void cancelRestCues()
    restTimer.pause(pausedRemainingMs)
  }
  function resumeRest(newEndsAtMs?: number) {
    const endsAt = restTimer.resume(newEndsAtMs)
    if (endsAt > Date.now()) void scheduleRestCuesUntil(endsAt)
  }

  function restartCurrentPhase() {
    if (phase === 'fighting') {
      roundTimer.start(round.durationSec)
      void scheduleRoundCuesUntil(Date.now() + round.durationSec * 1000, isLastRound ? null : round.restSec)
    } else if (phase === 'rest') {
      restTimer.start(round.restSec)
      void scheduleRestCuesUntil(Date.now() + round.restSec * 1000)
    }
  }

  useSessionLiveActivity(activityConfig, {
    onPause: (pausedRemainingMs) => {
      if (phase === 'fighting') pauseRound(pausedRemainingMs)
      else if (phase === 'rest') pauseRest(pausedRemainingMs)
    },
    onResume: (newEndsAtMs) => {
      if (phase === 'fighting') resumeRound(newEndsAtMs)
      else if (phase === 'rest') resumeRest(newEndsAtMs)
    },
    onRestart: restartCurrentPhase,
    onEnd: () => {
      // Lock-screen End leaves the session (still in progress, resumable).
      onExit?.()
    },
    // "Next →" from the lock screen: fighting → end round early, rest →
    // jump to next round. Mirrors the in-app footer actions.
    onAdvance: () => {
      if (phase === 'fighting') handleRoundEnd()
      else if (phase === 'rest') handleRestDone()
    },
  })


  // ─── The screen ──────────────────────────────────────────────

  const fighting = phase === 'fighting'
  const resting = phase === 'rest'
  const shownSec = fighting ? Math.max(0, roundTimer.secondsRemaining) : resting ? Math.max(0, restTimer.secondsRemaining) : round.durationSec
  const heat = fighting ? heatFor(shownSec) : null
  const paused = (fighting && roundTimer.isPaused) || (resting && restTimer.isPaused)
  const timer = fighting ? roundTimer : resting ? restTimer : null
  const track: TimerTrack = timer && timer.isRunning
    ? { durationSec: timer.durationSec, endsAtMs: timer.isPaused ? null : timer.endsAtMs, remainingMs: timer.secondsRemaining * 1000 }
    : { durationSec: round.durationSec, endsAtMs: null, remainingMs: round.durationSec * 1000 }
  // Rest shows the round coming: its number, its combo, its cue.
  const boardRound = resting && nextRound ? nextRound : round
  const board = roundView(boardRound)
  const cue = comboCue(firstCombo(boardRound))
  const showCue = !!cue && !heat && cueShown(phase, fighting ? round.durationSec - roundTimer.secondsRemaining : 0)
  const shownRound = resting && nextRound ? nextRound.roundNumber : round.roundNumber

  // One combo size for the whole session: the largest at which every round's
  // board fits the zone (page 55 `fitSession`). The zone's size is set by the
  // screen, never by what is in it, so every round lands on the same size.
  const zoneRef = useRef<HTMLDivElement>(null)
  const [comboPx, setComboPx] = useState<number | null>(null)
  useLayoutEffect(() => {
    const z = zoneRef.current
    if (!z) return
    const fit = () => setComboPx(bagComboSize(views, { width: z.clientWidth, height: z.clientHeight }))
    fit()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(fit)
    ro.observe(z)
    return () => ro.disconnect()
  }, [views])

  function togglePause() {
    if (fighting) { if (roundTimer.isPaused) resumeRound(); else pauseRound() }
    else if (resting) { if (restTimer.isPaused) resumeRest(); else pauseRest() }
  }
  function skip() {
    if (fighting) handleRoundEnd()
    else if (resting) handleRestDone()
  }

  /**
   * A swipe down (page 85): the round or rest from its full length; another
   * within 3 s goes to the part before (lib/timers/bagRound roundsBack): the
   * rest before this round, or this rest's own round, whose combo comes back.
   * Its bell plays (paused too, so he hears it moved), and the cues and the
   * lock card move with it as at a natural change; paused stays paused.
   * Nothing is logged here: a round counts when it ends (by its index, so
   * ending it again only replaces its seconds), and the combos are rated once,
   * after the last round.
   */
  function back() {
    const t = Date.now()
    const step = backStep(lastBagBackAt, t)
    lastBagBackAt = t
    bagBacks++
    const allRounds = rounds ?? []
    const to = roundsBack({ round: roundIndex, sub: phase }, step, r => allRounds[r]?.restSec ?? 0)
    if (to.sub === 'ready') return
    const earlier = to.round !== roundIndex ? allRounds[to.round] : null
    if (to.round !== roundIndex && (!earlier || !onBackRound)) return
    const wasPaused = paused
    void cancelRoundActiveCues()
    void cancelRestCues()
    if (to.sub === 'fighting') soundRoundStart()
    else soundRoundEnd()
    if (earlier && onBackRound) {
      // An earlier round: its own view takes it from here.
      roundTimer.stop()
      restTimer.stop()
      onBackRound({ kind: 'rounds', round: to.round, sub: to.sub, timer: freshSnap(wasPaused ? 'paused' : 'running', to.sub === 'fighting' ? earlier.durationSec : earlier.restSec, t) })
      return
    }
    if (to.sub === 'fighting') {
      restTimer.stop()
      roundTimer.restore(freshSnap(wasPaused ? 'paused' : 'running', round.durationSec, t))
      if (!wasPaused) void scheduleRoundCuesUntil(t + round.durationSec * 1000, isLastRound ? null : round.restSec)
    } else {
      roundTimer.stop()
      restTimer.restore(freshSnap(wasPaused ? 'paused' : 'running', round.restSec, t))
      if (!wasPaused) void scheduleRestCuesUntil(t + round.restSec * 1000)
    }
    if (to.sub !== phase) onPhaseChange(to.sub)
  }
  const canBack = phase !== 'ready' || (roundIndex > 0 && !!onBackRound && !!rounds?.[roundIndex - 1])

  const zoneStyle = { '--cs': `${comboPx ?? 36}px`, visibility: comboPx == null ? 'hidden' : undefined } as CSSProperties

  return (
    <SessionFrame
      title="BAG WORK"
      onEnd={onExit}
      paused={paused}
      className={`bw${resting ? ' is-rest' : ''}`}
      grass={
        <GrassZone
          track={track}
          kind={resting ? 'rest' : 'work'}
          mode={resting ? 'rest' : fighting ? 'work' : 'ready'}
          heat={heat}
          band={0.34}
          state={phase === 'ready' ? 'ready' : paused ? 'paused' : 'running'}
          onTap={phase === 'ready' ? handleStartRound : togglePause}
          onSkip={phase === 'ready' ? undefined : skip}
          onBack={canBack ? back : undefined}
        />
      }
    >
      <div ref={zoneRef} className="bw-zone" style={zoneStyle}>
        {board.now.length > 0 && (
          <div className={`bw-stack${heat ? ' is-dim' : ''}`} role="img" aria-label={board.now.join(', ')}>
            {board.now.map((strike, i) => (
              <Fragment key={i}>
                {i > 0 && <span className="bw-dn" aria-hidden>›</span>}
                <FlapLabel text={strike} size="xl" className="bw-strike" />
              </Fragment>
            ))}
          </div>
        )}
        <div className={`bw-cue${showCue ? '' : ' is-hidden'}`} aria-hidden={!showCue}>
          {cue && <FlapLabel text={cue} size="sm" tone={resting ? 'teal' : 'gold'} />}
        </div>
        {board.then.length > 0 && (
          <div className={`bw-then${heat ? ' is-hidden' : ''}`} aria-hidden={!!heat}>
            {board.then.map((strikes, r) => (
              <div key={r} className="bw-then-row" role="img" aria-label={`Then: ${strikes.join(', ')}`}>
                {r === 0 && <span className="wm-label">Then</span>}
                {strikes.map((strike, i) => (
                  <Fragment key={i}>
                    {i > 0 && <span className="bw-ar" aria-hidden>›</span>}
                    <FlapLabel text={strike} size="xs" />
                  </Fragment>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      {/* page 84: FIGHT / FINISH / REST / READY moves from the top right to over the clock */}
      <BagPhaseWord phase={phase} heat={heat} seconds={shownSec} />
      <div className="bw-pair">
        <div className="bw-round" role="img" aria-label={`${resting ? 'Next round' : 'Round'} ${shownRound} of ${totalRounds}`}>
          <span className="bw-lab">{resting ? 'NEXT' : 'ROUND'}</span>
          <FlapLabel text={String(shownRound)} size="xl" tone={resting ? 'teal' : 'gold'} className="bw-digit" />
          <small>OF {totalRounds}</small>
        </div>
        {/* page 71: no START ROUND; the clock waits at the round's length and the grass starts it */}
        <RoundClock
          seconds={shownSec}
          kind={resting ? 'rest' : 'work'}
          heat={heat}
          tone={resting ? 'teal' : 'ink'}
          track={track}
          px={92}
        />
      </div>
      <div className="bw-gspace" aria-hidden />
      {paused && <span className="sr-only" role="status"><FlapLabel text="PAUSED" size="xs" /></span>}
    </SessionFrame>
  )
}

/**
 * Over the clock (page 84; was top right, page 55): FIGHT in gold, FINISH in
 * the heat for the last 10 s, REST in teal, READY; ENDED once the × has been
 * held through (PhaseWord).
 */
function BagPhaseWord({ phase, heat, seconds }: { phase: RoundPhase; heat: Heat | null; seconds: number }) {
  if (phase === 'rest') return <PhaseWord text="REST" tone="teal" />
  if (phase === 'fighting') return <PhaseWord text={workLabel('FIGHT', seconds)} tone="gold" className={heat ? `is-${heat}` : ''} />
  return <PhaseWord text="READY" tone="gold" />
}
