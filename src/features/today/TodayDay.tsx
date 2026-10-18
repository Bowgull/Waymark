import { useEffect, useRef, useState } from 'react'

import { AmPmHeader, Board, CentredCard, FlapButton, FlapLabel, SessionIcon } from '@/design'
import { SessionSummary } from '@/features/dayboard/SessionSummary'
import { iconFor, plannedRowMinutes, sessionDisplayName, type DayBoardSession } from '@/features/dayboard/rowState'
import { mediumHaptic, tapHaptic } from '@/lib/haptics'
import { canReplaceOrSkipTodaySession, isActionableTodaySession } from './timelineStatus'

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
}

// Today's day board (pages 20, 35, 40): the AM / PM groups (sun / moon mark and
// flap), a row per session (painted icon, name on a flap, minutes or ✓). Tap a
// row: a session to do opens its plan with ENTER / REPLACE / SKIP; a finished
// one shows the same summary as Program (bands, lifted values, chips).

export interface TodaySession extends DayBoardSession {
  runSession?: (RunSessionSummary & DayBoardSession['runSession']) | null
}

export interface TodayDayProps {
  sessions: TodaySession[]
  onStart: (id: string) => void
  onSkip: (id: string) => void
  onReplace: (id: string) => void
  onEndEarly: (id: string, action: 'completed' | 'reset') => void
  onConfirmMatch: (activityId: number, row: HTMLElement | null) => void
  onReassignMatch: (activityId: number) => void
  onDismissMatch: (activityId: number) => void
  onAdd: () => void
}

export function TodayDay(props: TodayDayProps) {
  const [openId, setOpenId] = useState<string | null>(null)
  const groups: Array<['am' | 'pm' | null, TodaySession[]]> = [
    ['am', props.sessions.filter(s => s.timeSlot === 'am')],
    ['pm', props.sessions.filter(s => s.timeSlot === 'pm')],
    [null, props.sessions.filter(s => s.timeSlot !== 'am' && s.timeSlot !== 'pm')],
  ]
  return (
    <>
      <Board>
        {groups.map(([slot, list]) => list.length === 0 ? null : (
          <div key={slot ?? 'any'}>
            {slot && <AmPmHeader slot={slot} />}
            <div className="td-rows">
              {list.map(s => (
                <TodayRow key={s.id} s={s} open={openId === s.id} onToggle={() => { tapHaptic(); setOpenId(openId === s.id ? null : s.id) }} {...props} />
              ))}
            </div>
          </div>
        ))}
      </Board>
      <FlapButton label="+ ADD SESSION" onClick={props.onAdd} />
    </>
  )
}

function fmtKm(km: number) { return km >= 10 ? km.toFixed(1) : km.toFixed(2) }
function fmtPace(sec: number) { return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}` }

function TodayRow({ s, open, onToggle, onStart, onSkip, onReplace, onEndEarly, onConfirmMatch, onReassignMatch, onDismissMatch }: TodayDayProps & { s: TodaySession; open: boolean; onToggle: () => void }) {
  const rowRef = useRef<HTMLDivElement>(null)
  const [endOpen, setEndOpen] = useState(false)
  const run = s.runSession ?? null
  const pending = run?.attachmentStatus === 'auto_pending' && run.stravaActivityId != null
  const orphan = run?.attachmentStatus === 'orphan' && run.stravaActivityId != null
  const actionable = isActionableTodaySession(s.status, pending)
  const done = s.status === 'completed' && !orphan
  const skipped = s.status === 'skipped' || s.status === 'missed'
  const name = orphan ? 'UNPLANNED RUN' : sessionDisplayName(s).toUpperCase()
  // Page 35: a done row reads ✓ in the minutes' place (a teal tick once opened); a to-do its planned length.
  const mins = orphan && run?.durationSec ? `${Math.round(run.durationSec / 60)}min` : skipped ? '—' : `~${plannedRowMinutes(s)}min`

  return (
    <div ref={rowRef} className={`td-row${done ? ' is-done' : ''}${skipped ? ' is-skip' : ''}`}>
      <div role="button" tabIndex={0} aria-expanded={open} style={{ display: 'contents' }} onClick={onToggle} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}>
        <SessionIcon kind={iconFor(s)} size={40} />
        <span className="td-nm"><FlapLabel text={name} size="md" len={11} fit /></span>
        {pending && <span className="td-from"><FlapLabel text="FROM STRAVA" size="xs" tone="teal" /></span>}
        {done ? <span className={open ? 'td-tick' : 'td-mins'} aria-label="done">✓</span> : <span className="td-mins">{mins}</span>}
      </div>
      {open && (
        <div className="td-sum" onClick={e => e.stopPropagation()}>
          {(pending || orphan) && run ? (
            <>
              <div className="td-readouts">
                {run.distanceKm != null && <Readout label="Distance" value={`${fmtKm(run.distanceKm)} km`} />}
                {run.paceSecKm != null && <Readout label="Pace" value={`${fmtPace(run.paceSecKm)} /km`} />}
                {run.avgHr != null && <Readout label="Avg HR" value={`${run.avgHr}`} />}
                {run.maxHr != null && <Readout label="Max HR" value={`${run.maxHr}`} />}
              </div>
              {pending ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                  <FlapButton label="CONFIRM" primary onClick={() => { mediumHaptic(); onConfirmMatch(run.stravaActivityId!, rowRef.current) }} />
                  <div className="wm-btns">
                    <FlapButton label="CHANGE" onClick={() => onReassignMatch(run.stravaActivityId!)} />
                    <FlapButton label="NOT TRAINING" size="xs" onClick={() => onDismissMatch(run.stravaActivityId!)} />
                  </div>
                </div>
              ) : (
                <div className="wm-btns" style={{ marginTop: 10 }}>
                  <FlapButton label="ASSIGN" primary onClick={() => onReassignMatch(run.stravaActivityId!)} />
                  <FlapButton label="NOT TRAINING" size="xs" onClick={() => onDismissMatch(run.stravaActivityId!)} />
                </div>
              )}
            </>
          ) : (
            <SessionSummary
              session={s}
              variant="today"
              actions={actionable ? (
                <>
                  <FlapButton label={s.status === 'in_progress' ? 'RESUME' : 'ENTER'} primary onClick={() => onStart(s.id)} />
                  {canReplaceOrSkipTodaySession(s.status) && <FlapButton label="REPLACE" onClick={() => onReplace(s.id)} />}
                  {canReplaceOrSkipTodaySession(s.status) && <FlapButton label="SKIP" onClick={() => onSkip(s.id)} />}
                  {s.status === 'in_progress' && <EndHold onHeld={() => { mediumHaptic(); setEndOpen(true) }} />}
                </>
              ) : undefined}
            />
          )}
        </div>
      )}
      {endOpen && (
        <CentredCard label="End early" head="End early" onDismiss={() => setEndOpen(false)}>
          <p className="wm-prose">Mark this session done or wipe the start and put it back to planned.</p>
          <FlapButton label="MARK COMPLETED" primary onClick={() => { setEndOpen(false); onEndEarly(s.id, 'completed') }} />
          <FlapButton label="RESET" onClick={() => { setEndOpen(false); onEndEarly(s.id, 'reset') }} />
          <FlapButton label="CANCEL" quiet onClick={() => setEndOpen(false)} />
        </CentredCard>
      )}
    </div>
  )
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="td-readout">
      <span className="wm-label">{label}</span>
      <FlapLabel text={value} size="sm" fit />
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
