// The planned hour of today's sessions for the weather (page 72 §3): Waymark
// has AM and PM, not clock times, so the coach uses the hour he usually starts
// that kind of session in that half of the day, from his logs (no setup). A
// class uses its real start time when one is set. Otherwise the PM start in
// Settings, or 7 AM. Pure; relative imports only.

import { sessionIconFor, type SessionIconKey } from '../../design/sessionIconKeys'

export interface CoachHours {
  /** Per session type: the usual start (local minute) in the morning and after noon. */
  usual: Record<string, { am: number | null; pm: number | null }>
  /** Settings' PM start ("18:00"). */
  pmStart: string
}

export interface PlannedIn {
  type: string
  status: string
  timeSlot: string | null
  notes?: string | null
  contextJson?: string | null
}

const RUN_TYPES = new Set(['running', 'foundation_run'])

function minutesOf(hhmm: string | null | undefined): number | null {
  const m = hhmm?.match(/^(\d{1,2}):(\d{2})$/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

function classTime(contextJson: string | null | undefined): number | null {
  if (!contextJson) return null
  try {
    const c = JSON.parse(contextJson) as { suggested?: { time?: unknown }; classTime?: unknown }
    return minutesOf(typeof c.suggested?.time === 'string' ? c.suggested.time : typeof c.classTime === 'string' ? c.classTime : null)
  } catch {
    return null
  }
}

/** The local minute a session is planned for today. */
export function plannedMinute(s: PlannedIn, hours: CoachHours | null): number {
  const pm = s.timeSlot === 'pm'
  if (s.type === 'mt_class') { const t = classTime(s.contextJson); if (t != null) return t }
  const usual = hours?.usual[s.type]?.[pm ? 'pm' : 'am'] ?? null
  if (usual != null) return usual
  if (pm) return minutesOf(hours?.pmStart) ?? 18 * 60
  return 7 * 60
}

/** Today's runs still to do, at their planned hour (epoch ms), for the coach line and the hour marks. */
export function plannedRuns(sessions: readonly PlannedIn[], hours: CoachHours | null, todayMidnightMs: number): Array<{ name: string; at: number; icon: SessionIconKey }> {
  return sessions
    .filter(s => RUN_TYPES.has(s.type) && (s.status === 'planned' || s.status === 'in_progress'))
    .map(s => ({ name: 'Run', at: todayMidnightMs + plannedMinute(s, hours) * 60000, icon: sessionIconFor(s.type, s.type === 'running' ? s.notes ?? null : null) }))
    .sort((a, b) => a.at - b.at)
}
