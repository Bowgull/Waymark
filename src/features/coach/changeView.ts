// What the screens read for the week's changes (page 56): the server's views
// (GET /api/weeks/:monday/changes) and the words built from them, in the
// athlete's local time. Pure; relative imports only so the tests run it.

import {
  changesLine,
  logDayLabel,
  logStatus,
  renderWhy,
  untilLine,
  whenLine,
  type ChangeLock,
  type RuneState,
} from '../../lib/coach/changes'

export interface ChangeViewIn {
  id: string
  setId: string | null
  actor: 'you' | 'coach' | 'check_in' | 'weekly_pass' | 'class_tonight'
  kind: string
  who: 'YOU' | 'COACH' | 'MISSED'
  day: number
  session: { id: string | null; type: string; label: string | null; notes: string | null }
  before: string
  after: string
  logBefore: string | null
  why: string
  detail: string | null
  createdAt: number
  undoUntil: number | null
  lock: ChangeLock
  rune: RuneState | null
  put: { line: string; dim: string } | null
  fix: { day: number; name: string } | null
}

export interface WeekChangesIn {
  changes: ChangeViewIn[]
  runes: Record<string, RuneState | null>
}

/** Unix seconds as local wall-clock seconds (the screens' day and clock). */
export function localSec(unixSec: number, offsetMin: number = new Date(unixSec * 1000).getTimezoneOffset()): number {
  return unixSec - offsetMin * 60
}

/** The rune on a day tile. */
export function runeForDay(week: WeekChangesIn | null | undefined, day: number): RuneState | null {
  return week?.runes?.[String(day)] ?? null
}

/** The rune on a session's row: the coach change that targets it, not undone. */
export function runeForSession(week: WeekChangesIn | null | undefined, sessionId: string): RuneState | null {
  const order: RuneState[] = ['miss', 'new', 'missseen', 'seen']
  let best: RuneState | null = null
  for (const c of week?.changes ?? []) {
    if (c.session.id !== sessionId || !c.rune) continue
    if (best == null || order.indexOf(c.rune) < order.indexOf(best)) best = c.rune
  }
  return best
}

/** His own changes the day's back can put back (approved 2026-10-21): a SKIP or a REPLACE, today and later. */
const OWN_UNDOABLE = new Set(['skip', 'swap'])

/**
 * The changes a day's back shows: the coach's (runes), newest last. With
 * `todayDay`, also his own SKIP and REPLACE on today or a later day, so one
 * mis-tap can be put back with the same UNDO.
 */
export function backChanges(week: WeekChangesIn | null | undefined, day: number, todayDay?: number): ChangeViewIn[] {
  return (week?.changes ?? []).filter(c => c.day === day && (c.actor !== 'you' || (todayDay != null && day >= todayDay && OWN_UNDOABLE.has(c.kind))))
}

/** The who line on the day's back: COACH · TUE 6:11 PM, or MISSED · FRI 23 · STRENGTH C. */
export function backWho(c: ChangeViewIn, name: string): { word: string; tone: 'coach' | 'ember' | 'you'; rest: string } {
  if (c.who === 'MISSED') return { word: 'MISSED', tone: 'ember', rest: `${logDayLabel(c.day)} · ${name.toUpperCase()}` }
  return { word: c.who, tone: c.who === 'YOU' ? 'you' : 'coach', rest: whenLine(localSec(c.createdAt), c.day) }
}

/** The day's back: the why, read against today. */
export function backWhy(c: ChangeViewIn, todayDay: number): string {
  return renderWhy(c.why, todayDay, 'back')
}

/** The day's back once put back: its line, read against today. */
export function backPut(c: ChangeViewIn, todayDay: number): { line: string; dim: string } {
  const put = c.put ?? { line: 'Put back as it was.', dim: 'The coach leaves it as you set it this week.' }
  return { line: renderWhy(put.line, todayDay, 'back'), dim: put.dim }
}

/** "Until it starts, 7:00 AM", or the word that replaces UNDO once it's locked. */
export function backUntil(c: ChangeViewIn, todayDay: number, nowLocalSec?: number): string {
  if (c.lock === 'started') return 'Started. It stays.'
  if (c.lock === 'done') return 'Done. It stays.'
  if (c.lock === 'missed') return 'Missed. It stays.'
  if (c.lock === 'passed') return 'Its day has passed. It stays.'
  return untilLine(c.undoUntil, todayDay, c.kind === 'missed' ? c.fix : null, nowLocalSec)
}

export interface LogDay {
  day: number
  label: string
  entries: Array<{ change: ChangeViewIn; who: string; tone: 'coach' | 'ember' | 'you'; why: string; status: ReturnType<typeof logStatus> }>
}

/** The week log: every change this week by day, his and the coach's, undone ones too. */
export function weekLog(week: WeekChangesIn | null | undefined): LogDay[] {
  const byDay = new Map<number, LogDay>()
  const list = [...(week?.changes ?? [])].sort((a, b) => a.day - b.day || a.createdAt - b.createdAt)
  for (const c of list) {
    const d = byDay.get(c.day) ?? { day: c.day, label: logDayLabel(c.day), entries: [] }
    d.entries.push({
      change: c,
      who: `${c.who === 'MISSED' ? 'MISSED' : c.who}`,
      tone: c.who === 'YOU' ? 'you' : c.who === 'MISSED' ? 'ember' : 'coach',
      why: renderWhy(c.why, c.day, 'log'),
      status: logStatus(c.lock),
    })
    byDay.set(c.day, d)
  }
  return [...byDay.values()]
}

/** The log entry's time: "6:10 PM" on its own day, else "TUE 6:11 PM". */
export function logWhen(c: ChangeViewIn): string {
  return whenLine(localSec(c.createdAt), c.day)
}

/** "5 changes ›" under Program's week, or null. */
export function weekChangesLine(week: WeekChangesIn | null | undefined): string | null {
  return changesLine(week?.changes.length ?? 0)
}
