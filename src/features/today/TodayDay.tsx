import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { AmPmHeader, Board, CentredCard, FlapButton, FlapLabel, SessionIcon, useOutsideClose } from '@/design'
import { CLASS_SKIP_REASONS, SKIP_PLACES, SKIP_REASONS } from '@/components/ui/departures'
import { ReasonTiles } from '@/features/coach/ReasonTiles'
import { Rune } from '@/features/coach/Rune'
import type { RuneState } from '@/lib/coach/changes'
import { SessionSummary } from '@/features/dayboard/SessionSummary'
import { iconFor, plannedRowMinutes, sessionDisplayName, type DayBoardSession } from '@/features/dayboard/rowState'
import { mediumHaptic, tapHaptic } from '@/lib/haptics'
import { overCapBpm, stravaReadouts } from '@/lib/stravaMatch'
import { canReplaceOrSkipTodaySession, isActionableTodaySession } from './timelineStatus'
import { Expand, Strike, SwapRow, Tick } from '@/design/MotionPrimitives'
import { useSwapList } from '@/design/motionKit'
import { bringIntoSight, endHandoff, flyRowToStrip, flyStripToRow, holdHandoff, whenSettled } from '@/app/liveHandoff'

/** A run's Strava / manual row, attached by GET /api/sessions/today. */
export interface RunSessionSummary {
  id: string
  stravaActivityId: number | null
  attachmentStatus: string | null
  source: string
  distanceKm: number | null
  durationSec: number | null
  paceSecKm: number | null
  avgHr: number | null
  maxHr: number | null
  elevationGainM: number | null
  /** A run waiting for CONFIRM on a Zone 2 day: the cap its average heart rate is read against (page 40). */
  zone2CapBpm?: number | null
  /** A run waiting for CONFIRM: the plan line ("Zone 2. 114 to 133 bpm."). */
  planLine?: string | null
}

// Today's day board (pages 20, 35, 40): the AM / PM groups (sun / moon mark and
// flap), a row per session (painted icon, name on a flap, minutes or ✓). Tap a
// row: a session to do opens its plan with ENTER / REPLACE / SKIP; a finished
// one shows the same summary as Program (bands, lifted values, chips). Page 56:
// a row the coach changed carries the small rune by its minutes; SKIP is
// instant and the open row then offers the optional reason tiles.

export interface TodaySession extends DayBoardSession {
  runSession?: (RunSessionSummary & DayBoardSession['runSession']) | null
}

export interface TodayDayProps {
  sessions: TodaySession[]
  onStart: (id: string) => void
  onSkip: (id: string) => void
  onReplace: (id: string) => void
  onEndEarly: (id: string, action: 'completed' | 'reset') => void
  /** CONFIRM on a matched run: the session it lands on, and the card (it glows clay on a failure). */
  onConfirmMatch: (activityId: number, sessionId: string, card: HTMLElement | null) => void
  onReassignMatch: (activityId: number) => void
  onDismissMatch: (activityId: number) => void
  onAdd: () => void
  /** The rune on each changed row (page 56 item 7). */
  runes?: Readonly<Record<string, RuneState | null>>
  /** A skip made here: its reason tiles in the open row (page 56 item 3). */
  skipReasons?: Readonly<Record<string, { reason: string | null; detail: string | null }>>
  onSkipReason?: (id: string, reason: string | null, detail: string | null) => void
  /** The row to open (a skip just made opens its row for the tiles). */
  openId?: string | null
  onOpenChange?: (id: string | null) => void
  /** The block's training week (a run-walk's rounds and minutes come from it). */
  weekNumber?: number | null
  /** + What you learned on a class row finished today without it (page 49). */
  onLearned?: (sessionId: string, mtLogId: string) => void
  /** Classes whose note was written here since Today loaded (the line goes). */
  learnedSaved?: ReadonlySet<string>
  /** Page 71 item 6: the row flying down into the live strip (lift) or back up from it (land). */
  flying?: { id: string; kind: 'lift' | 'land' } | null
  onFlown?: () => void
}

/** Strava's run matched this planned run and waits for CONFIRM (page 40, phone 1). */
function stravaPending(s: TodaySession): boolean {
  return s.runSession?.attachmentStatus === 'auto_pending' && s.runSession.stravaActivityId != null
}

/** Strava's run matched nothing: UNPLANNED RUN under the day (page 40, phone 4). */
function stravaOrphan(s: TodaySession): boolean {
  return s.runSession?.attachmentStatus === 'orphan' && s.runSession.stravaActivityId != null
}

export function TodayDay(props: TodayDayProps) {
  const [ownOpen, setOwnOpen] = useState<string | null>(null)
  const openId = props.openId !== undefined ? props.openId : ownOpen
  const setOpenId = (id: string | null) => { if (props.onOpenChange) props.onOpenChange(id); else setOwnOpen(id) }
  const day = props.sessions.filter(s => !stravaOrphan(s))
  const unplanned = props.sessions.filter(stravaOrphan)
  // A REPLACE (page 59 §5.3 Swap): the old row is struck and collapses, the new one opens in.
  const rows = useSwapList(day, s => s.id)
  const groups: Array<['am' | 'pm' | null, typeof rows]> = [
    ['am', rows.filter(r => r.item.timeSlot === 'am')],
    ['pm', rows.filter(r => r.item.timeSlot === 'pm')],
    [null, rows.filter(r => r.item.timeSlot !== 'am' && r.item.timeSlot !== 'pm')],
  ]
  return (
    <>
      <Board>
        {groups.map(([slot, list]) => list.length === 0 ? null : (
          <div key={slot ?? 'any'}>
            {slot && <AmPmHeader slot={slot} />}
            <div className="td-rows">
              {list.map(({ item: s, key, state, afterExit }) => (
                <SwapRow key={key} state={state} afterExit={afterExit}>
                  {stravaPending(s) ? (
                    <StravaCard s={s} kind="matched" {...props} />
                  ) : (
                    <TodayRow s={s} open={openId === s.id} onToggle={() => { tapHaptic(); setOpenId(openId === s.id ? null : s.id) }} {...props} />
                  )}
                </SwapRow>
              ))}
            </div>
          </div>
        ))}
        {unplanned.map((s, i) => <StravaCard key={s.id} s={s} kind="unplanned" ruled={i > 0 || day.length > 0} {...props} />)}
        {/* page 56: + add session is a quiet line inside the day's board */}
        <div className="td-addrow"><button type="button" className="td-addq" onClick={props.onAdd}>+ add session</button></div>
      </Board>
    </>
  )
}

function TodayRow({ s, open, onToggle, onStart, onSkip, onReplace, onEndEarly, runes, skipReasons, onSkipReason, weekNumber, onLearned, learnedSaved, flying, onFlown }: TodayDayProps & { s: TodaySession; open: boolean; onToggle: () => void }) {
  const rowRef = useRef<HTMLDivElement>(null)
  // Page 71 item 6: this row flies (once its place is drawn and Today has risen).
  const fly = flying?.id === s.id ? flying.kind : null
  const flownRef = useRef(onFlown)
  useEffect(() => { flownRef.current = onFlown })
  useLayoutEffect(() => {
    const el = rowRef.current
    if (!fly || !el) return
    if (fly === 'land') el.style.visibility = 'hidden'
    // the row is drawn: the strip stays unseen until the flight lands, however long Today took
    holdHandoff(fly, s.id)
    // Today opens with the row in sight (before its first paint, after the tab lands at its window)
    const sight = requestAnimationFrame(() => { bringIntoSight(el) })
    let stop: (() => void) | null = null
    // measured only once Today has stopped arriving (the boards' rise, heights gliding), so the
    // copy starts from where the row really stays
    const cancel = whenSettled(el, () => {
      stop = (fly === 'lift' ? flyRowToStrip : flyStripToRow)(el, () => flownRef.current?.())
    })
    // left before it flew (Today unmounted): the strip shows, nothing waits on it
    return () => { cancelAnimationFrame(sight); cancel(); if (stop) stop(); else endHandoff(fly, s.id) }
  }, [fly, s.id])
  const [endOpen, setEndOpen] = useState(false)
  const actionable = isActionableTodaySession(s.status, false)
  const done = s.status === 'completed'
  // Approved 2026-10-21: only his own SKIP is struck; a missed row opens with ENTER, so it can still be done.
  const skipped = s.status === 'skipped'
  const name = sessionDisplayName(s).toUpperCase()
  // Page 35: a done row reads ✓ in the minutes' place (a teal tick once opened); a to-do its planned length.
  // Page 40: a run confirmed from Strava reads its minutes and ✓ ("35min ✓").
  const mins = skipped ? '—' : `~${plannedRowMinutes(s, weekNumber)}min`
  const stravaMin = done && s.runSession?.stravaActivityId != null ? stravaMinutes(s) : null
  const rune = !skipped ? runes?.[s.id] ?? null : null
  const skip = skipped ? skipReasons?.[s.id] ?? null : null
  const tiles = open && skip != null && onSkipReason != null
  // Page 71 / the layout-shift fix: close on the tap, so the rows don't move under the finger before it lands.
  useOutsideClose(rowRef, open, onToggle, { on: 'click' })
  // Page 71: the running session is not in this list (TodayPage leaves it out); the live strip is the way back in.
  const tap = onToggle

  return (
    <div ref={rowRef} data-sid={s.id} className={`td-row${done ? ' is-done' : ''}${skipped ? ' is-skip' : ''}${tiles ? ' is-openx' : ''}`}>
      <div role="button" tabIndex={0} aria-expanded={open} className="td-rowhit" onClick={tap} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap() } }}>
        <SessionIcon kind={iconFor(s)} size={40} />
        <span className="td-nm"><FlapLabel text={name} size="md" len={11} fit /><Strike on={skipped} /></span>
        {stravaMin != null ? (
          <><span className="td-mins">{stravaMin}min</span><Tick className="td-stick" /></>
        ) : done ? <>{rune && <Rune state={rune} size="row" />}<Tick className={open ? 'td-tick' : 'td-mins'} /></>
          : tiles ? <span className="td-skd">SKIPPED</span>
          : <>{rune && <Rune state={rune} size="row" />}<span className="td-mins">{mins}</span></>}
      </div>
      <Expand open={tiles}>
        {skip && onSkipReason && (
          <div className="td-more2" onClick={e => e.stopPropagation()}>
            <ReasonTiles tiles={s.type === 'mt_class' ? CLASS_SKIP_REASONS : SKIP_REASONS} value={skip.reason} onChange={r => onSkipReason(s.id, r, null)} />
            {skip.reason === 'injury' && (
              <ReasonTiles label={false} tiles={SKIP_PLACES.map(p => ({ value: p, label: p.toUpperCase() }))} value={skip.detail} onChange={d => onSkipReason(s.id, 'injury', d)} />
            )}
          </div>
        )}
      </Expand>
      <Expand open={open && !skipped}>
        <div className="td-sum" onClick={e => e.stopPropagation()}>
          <SessionSummary
            session={s}
            weekNumber={weekNumber}
            variant="today"
            onLearned={onLearned && done && s.type === 'mt_class' && !learnedSaved?.has(s.id) ? mtLogId => onLearned(s.id, mtLogId) : undefined}
            actions={actionable ? (
              <>
                <FlapButton label={s.status === 'in_progress' ? 'RESUME' : 'ENTER'} primary onClick={() => onStart(s.id)} />
                {canReplaceOrSkipTodaySession(s.status) && <FlapButton label="REPLACE" onClick={() => onReplace(s.id)} />}
                {canReplaceOrSkipTodaySession(s.status) && <FlapButton label="SKIP" onClick={() => onSkip(s.id)} />}
                {s.status === 'in_progress' && <EndHold onHeld={() => { mediumHaptic(); setEndOpen(true) }} />}
              </>
            ) : undefined}
          />
        </div>
      </Expand>
      {endOpen && (
        <CentredCard label="End early" head="End early" onDismiss={() => setEndOpen(false)}>
          <p className="wm-prose">Mark this session done or wipe the start and put it back to planned.</p>
          <FlapButton label="MARK COMPLETED" primary onClick={() => { setEndOpen(false); onEndEarly(s.id, 'completed') }} />
          <FlapButton label="RESET" onClick={() => { setEndOpen(false); onEndEarly(s.id, 'reset') }} />
        </CentredCard>
      )}
    </div>
  )
}

/** The run's own minutes (the confirmed session's, else Strava's). */
function stravaMinutes(s: TodaySession): number | null {
  const sec = s.durationSec ?? s.runSession?.durationSec ?? null
  return sec != null && sec > 0 ? Math.round(sec / 60) : null
}

/**
 * Page 40: a Strava run on Today. Matched (phone 1): the session icon, its
 * name on a flap, FROM STRAVA in teal, the plan line, four flap readouts (an
 * average heart rate over the Zone 2 cap gets the clay band and chip), then
 * CONFIRM full width with CHANGE and NOT TRAINING under it. Unplanned
 * (phone 4): UNPLANNED RUN under the day with its readouts, then ASSIGN and
 * NOT TRAINING. Nothing truncates.
 */
function StravaCard({ s, kind, ruled = false, onConfirmMatch, onReassignMatch, onDismissMatch }: TodayDayProps & { s: TodaySession; kind: 'matched' | 'unplanned'; ruled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const run = s.runSession!
  const id = run.stravaActivityId!
  const matched = kind === 'matched'
  const over = matched ? overCapBpm(run.avgHr, run.zone2CapBpm ?? null) : null
  return (
    <div ref={ref} data-sid={s.id} className={`td-strava${ruled ? ' is-ruled' : ''}`}>
      <div className="top">
        <SessionIcon kind={matched ? iconFor(s) : 'run'} size={48} />
        <div className="grow">
          <FlapLabel text={matched ? sessionDisplayName(s).toUpperCase() : 'UNPLANNED RUN'} size="md" fit />
          <FlapLabel text="FROM STRAVA" size="xs" tone="teal" />
        </div>
      </div>
      {matched && run.planLine && <p className="plan">{run.planLine}</p>}
      <div className="td-ro">
        {stravaReadouts(run).map(r => {
          const miss = r.key === 'avgHr' && over != null
          return (
            <div key={r.key} className={miss ? 'is-dn' : undefined}>
              <span className="wm-label">{r.label}</span>
              <span className="v">
                <FlapLabel text={r.value} size="md" />
                <span className="u">{r.unit}</span>
                {miss && <i className="dv">+{over} over cap</i>}
              </span>
            </div>
          )
        })}
      </div>
      {matched ? (
        <>
          <FlapButton label="CONFIRM" primary onClick={() => { mediumHaptic(); onConfirmMatch(id, s.id, ref.current) }} />
          <div className="wm-btns is-two">
            <FlapButton label="CHANGE" onClick={() => onReassignMatch(id)} />
            <FlapButton label="NOT TRAINING" size="xs" onClick={() => onDismissMatch(id)} />
          </div>
        </>
      ) : (
        <div className="wm-btns is-two">
          <FlapButton label="ASSIGN" primary onClick={() => onReassignMatch(id)} />
          <FlapButton label="NOT TRAINING" size="xs" onClick={() => onDismissMatch(id)} />
        </div>
      )}
    </div>
  )
}

/** The end button (×): a flap tile. Hold 1.5 s; a clay bar fills along its foot. A tap only says so. */
function EndHold({ onHeld }: { onHeld: () => void }) {
  const [holding, setHolding] = useState(false)
  const [hint, setHint] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])
  const start = () => { setHolding(true); setHint(false); timer.current = window.setTimeout(() => { timer.current = null; setHolding(false); onHeld() }, 1500) }
  const stop = () => { if (!timer.current) return; window.clearTimeout(timer.current); timer.current = null; setHolding(false); setHint(true) }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {hint && <span className="wm-label">Hold to end</span>}
      <button type="button" aria-label="Hold to end early" className={`td-xbtn${holding ? ' is-hold' : ''}`} onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop} onContextMenu={e => e.preventDefault()}>×</button>
    </span>
  )
}
