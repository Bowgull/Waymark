import { useEffect, useRef, type ReactNode } from 'react'

import { AmPmHeader, Board, Expand, FlapLabel, SessionIcon, prefersReducedMotion } from '@/design'
import { Rune } from '@/features/coach/Rune'
import { backPut, runeForDay, type ChangeViewIn, type WeekChangesIn } from '@/features/coach/changeView'
import { runeSay, rowChange } from '@/features/plan/changeLines'
import { iconFor, plannedRowMinutes, rowStatus, type DayBoardSession } from '@/features/dayboard/rowState'
import { PixelCursor } from '@/features/plan/PixelCursor'
import { PlanRow } from '@/features/plan/PlanRow'
import { useRowSlots } from '@/features/plan/useRowSlots'

import { dayLine } from './weekModel'
import { useRunWeather } from '@/features/weather/useRunWeather'
import './program.css'

// Program as a day list (page 73, layout B, approved 2026-10-22): THIS WEEK /
// NEXT WEEK on two flap tabs, one quiet line under them, then seven flap date
// labels, each with its icons and one line. Today's date on a gold flap. Tap a
// day: the cursor moves to it and its board opens below, exactly Today's rows
// (AM / PM, icon, name, minutes); opening another day closes the first. Tap a
// session: its real lines open under it. Hold a session for the command
// window. A coach change carries the Dagaz rune; next week has no marks.

const DAY3 = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

export interface PlannerMenu {
  openAct: (s: DayBoardSession, el: HTMLElement) => void
  openAdd: (date: string) => void
  openRune: (change: ChangeViewIn, say: ReactNode, back: string, canUndo: boolean, el: HTMLElement | null) => void
}

export interface PlannerWeekProps {
  week: 'this' | 'next'
  /** THIS WEEK / NEXT WEEK; absent: no tabs (a start still ahead shows only its week). */
  onWeek?: (w: 'this' | 'next') => void
  sub: string
  /** A line under the sub (the raven's plan), and CHANGE DAY. */
  under?: ReactNode
  /** Monday to Sunday (epoch days). */
  days: number[]
  sessions: DayBoardSession[] | null
  todayEpochDay: number
  weekNumber: number
  /** This week's changes (runes and why-lines); null on next week. */
  changes: WeekChangesIn | null
  startsOn?: number | null
  openDay: number | null
  onOpenDay: (d: number | null) => void
  cursor: string | null
  onCursor: (c: string) => void
  det: ReadonlySet<string>
  onDet: (id: string) => void
  menu: PlannerMenu
}

const isoOf = (d: number) => new Date(d * 86400000).toISOString().slice(0, 10)

/** The coach change behind a day's rune: the newest one of the coach's that day. */
function dayChange(changes: WeekChangesIn | null, day: number): ChangeViewIn | null {
  const list = (changes?.changes ?? []).filter(c => c.day === day && c.actor !== 'you' && c.rune != null)
  return list.sort((a, b) => a.createdAt - b.createdAt)[list.length - 1] ?? null
}

function sortDay(list: DayBoardSession[]): DayBoardSession[] {
  return [...list].sort((a, b) => (a.timeSlot === 'pm' ? 1 : 0) - (b.timeSlot === 'pm' ? 1 : 0))
}

/**
 * After a day opens (page 73's motion: 320 ms), its board scrolls into sight:
 * up to its foot, never pushing its own date row past the top.
 */
function reveal(row: HTMLElement | null | undefined) {
  const main = document.querySelector<HTMLElement>('main')
  const board = row?.nextElementSibling as HTMLElement | null
  if (!main || !row || !board) return
  const view = main.getBoundingClientRect()
  const tabs = document.querySelector<HTMLElement>('.wm-tabs')?.getBoundingClientRect()
  const bottom = Math.min(view.bottom, tabs ? tabs.top : Infinity) - 10
  const need = board.getBoundingClientRect().bottom - bottom
  const room = row.getBoundingClientRect().top - (view.top + 70)
  if (need > 0) main.scrollBy({ top: Math.min(need, Math.max(0, room)), behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
}

export function PlannerWeek(p: PlannerWeekProps) {
  // Page 76 §2: a run's WHERE line, from the weather at its planned hour.
  const weatherFor = useRunWeather()
  const rowEls = useRef(new Map<number, HTMLElement | null>())
  useEffect(() => {
    if (p.openDay == null) return
    const t = window.setTimeout(() => reveal(rowEls.current.get(p.openDay as number)), prefersReducedMotion() ? 0 : 340)
    return () => window.clearTimeout(t)
  }, [p.openDay])
  // A swap, its undo or redo keeps the row: its name flaps flip (page 73's motion).
  const { list, keyOf } = useRowSlots(p.sessions ?? [])
  const marks = p.week === 'this'
  const before = (d: number) => p.startsOn != null && d < p.startsOn
  return (
    <Board className="pg-week">
      {p.onWeek && (
        <div className="pg-wkh" role="tablist" aria-label="Weeks">
          {(['this', 'next'] as const).map(w => (
            <button key={w} type="button" role="tab" aria-selected={p.week === w} className={`pg-wt${p.week === w ? ' is-on' : ''}`} onClick={() => p.onWeek?.(w)}>
              <FlapLabel text={w === 'this' ? 'THIS WEEK' : 'NEXT WEEK'} size="xs" tone={p.week === w ? 'gold' : 'dim'} animate={false} />
            </button>
          ))}
        </div>
      )}
      <p className="pg-wsub">{p.sub}</p>
      {p.under}
      {p.sessions == null && <p className="pg-wsub is-dim">Reading the plan.</p>}
      {p.sessions != null && (
        <div className="pg-days" role="list" aria-label="Days of the week">
          {p.days.map(d => {
            const daySessions = sortDay(list.filter(s => s.scheduledDate === d))
            const shown = daySessions.filter(s => rowStatus(s.status) !== 'skipped').slice(0, 3)
            const today = d === p.todayEpochDay && p.week === 'this'
            const date = new Date(d * 86400000)
            const label = `${DAY3[date.getUTCDay()]} ${date.getUTCDate()}`
            const rune = marks ? runeForDay(p.changes, d) : null
            const change = rune ? dayChange(p.changes, d) : null
            const open = p.openDay === d
            const on = p.cursor === `d:${d}`
            const groups: Array<['am' | 'pm' | null, DayBoardSession[]]> = [
              ['am', daySessions.filter(s => s.timeSlot === 'am')],
              ['pm', daySessions.filter(s => s.timeSlot === 'pm')],
              [null, daySessions.filter(s => s.timeSlot !== 'am' && s.timeSlot !== 'pm')],
            ]
            return (
              <div key={d} role="listitem" className="pg-dayw">
                <div
                  ref={el => { rowEls.current.set(d, el) }}
                  className={`pg-dr${d < p.todayEpochDay && p.week === 'this' ? ' is-past' : ''}${on ? ' is-on' : ''}${before(d) ? ' is-before' : ''}`}
                  data-day={d}
                  role="button"
                  tabIndex={0}
                  aria-expanded={open}
                  aria-label={`${label}${today ? ', today' : ''}: ${dayLine(daySessions, p.weekNumber)}${rune ? (rune.startsWith('miss') ? '. A missed session.' : '. The coach changed it.') : ''}`}
                  onClick={() => { p.onCursor(`d:${d}`); p.onOpenDay(open ? null : d) }}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.onCursor(`d:${d}`); p.onOpenDay(open ? null : d) } }}
                >
                  {on && <PixelCursor />}
                  <span className="dlab"><FlapLabel text={label} size="sm" tone={today ? 'gold' : 'ink'} animate={false} /></span>
                  <span className="ics">
                    {shown.map(s => (
                      <span key={s.id} className={`ic${rowStatus(s.status) === 'done' ? ' is-done' : ''}`}><SessionIcon kind={iconFor(s)} size={shown.length > 2 ? 16 : 22} label="" /></span>
                    ))}
                  </span>
                  <span className="ln">{dayLine(daySessions, p.weekNumber)}</span>
                  {rune && change ? (
                    <button
                      type="button"
                      className="rn"
                      aria-label="What the coach changed"
                      onClick={e => {
                        e.stopPropagation()
                        p.onCursor(`d:${d}`)
                        p.menu.openRune(change, runeSay(change, p.todayEpochDay), backPut(change, p.todayEpochDay).line, d >= p.todayEpochDay && change.lock === 'open', rowEls.current.get(d) ?? null)
                      }}
                    ><Rune state={rune} size="tile" className="is-inline" /></button>
                  ) : <span />}
                </div>
                <Expand open={open} className="pg-dayb">
                  <div className="pg-board">
                    {daySessions.length === 0 && <p className="pg-empty">{before(d) ? 'Before the start. Nothing planned.' : 'No sessions planned.'}</p>}
                    {groups.map(([slot, rows]) => rows.length === 0 ? null : (
                      <div key={slot ?? 'any'}>
                        {slot ? <AmPmHeader slot={slot} /> : <div style={{ height: 6 }} />}
                        <div className="pl-rows">
                          {rows.map(s => {
                            const st = rowStatus(s.status)
                            const holdable = d >= p.todayEpochDay && (s.status === 'planned' || st === 'skipped')
                            return (
                              <PlanRow
                                key={keyOf(s)}
                                session={s}
                                on={p.cursor === `s:${s.id}`}
                                open={p.det.has(s.id)}
                                onTap={() => p.onDet(s.id)}
                                onHold={holdable ? el => { p.onCursor(`s:${s.id}`); p.menu.openAct(s, el) } : undefined}
                                mins={st === 'done' ? '✓' : st === 'skipped' ? '—' : `~${plannedRowMinutes(s, p.weekNumber)}min`}
                                change={marks ? rowChange(p.changes, s, p.todayEpochDay) : null}
                                linesOpts={{ weekNumber: p.weekNumber, weather: weatherFor(s) }}
                              />
                            )
                          })}
                        </div>
                      </div>
                    ))}
                    {d >= p.todayEpochDay && !before(d) && (
                      <div className="pg-addq"><button type="button" onClick={() => p.menu.openAdd(isoOf(d))}>+ add session</button></div>
                    )}
                  </div>
                </Expand>
              </div>
            )
          })}
        </div>
      )}
    </Board>
  )
}
