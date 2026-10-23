// Pure pieces of Settings, Body metrics and Logs (page 37 A; page 45 "For the coach").

/** "06:30" -> { h12: 6, mm: 30, slot: 'am' }. */
export function splitTime(hhmm: string): { h12: number; mm: number; slot: 'am' | 'pm' } {
  const [hRaw, mRaw] = hhmm.split(':').map(Number)
  const hh = Number.isFinite(hRaw) ? Math.min(23, Math.max(0, hRaw)) : 0
  const mm = Number.isFinite(mRaw) ? Math.min(59, Math.max(0, mRaw)) : 0
  return { h12: hh % 12 === 0 ? 12 : hh % 12, mm, slot: hh >= 12 ? 'pm' : 'am' }
}

/** { h12, mm, slot } -> "HH:MM" (24 h). */
export function joinTime(h12: number, mm: number, slot: 'am' | 'pm'): string {
  const h = (h12 % 12) + (slot === 'pm' ? 12 : 0)
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/** The flap on a row: "6:30" (the AM / PM flap sits beside it). */
export function timeFlap(hhmm: string): string {
  const { h12, mm } = splitTime(hhmm)
  return `${h12}:${String(mm).padStart(2, '0')}`
}

/** The hour drum: 1..12, wrapping (page 37's ▲ ▼). */
export function stepHour(h12: number, delta: number): number {
  return ((((h12 - 1 + delta) % 12) + 12) % 12) + 1
}

/** The minute drum: 5 a tap, wrapping inside the hour. */
export function stepMinute(mm: number, delta: number): number {
  return (((mm + delta) % 60) + 60) % 60
}

/** "Remind me": 30 -> "30 MIN BEFORE". */
export function leadFlap(min: number): string {
  return `${min} MIN BEFORE`
}

/** Days left on the 7-day sideload signature, from the build time; null without one. */
export function daysUntilRedeploy(buildTimeMs: number, nowMs: number): number | null {
  if (!Number.isFinite(buildTimeMs) || buildTimeMs <= 0) return null
  return Math.min(7, Math.max(0, 7 - Math.floor((nowMs - buildTimeMs) / 86400000)))
}

// ─── Birth date and max HR (page 45) ──────────────────────────

export const MONTHS3 = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate()
}

export interface Ymd { y: number; m: number; d: number }

export function parseDob(iso: string | null | undefined): Ymd | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '')
  if (!m) return null
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
}

export function formatDob(v: Ymd): string {
  return `${v.y}-${String(v.m).padStart(2, '0')}-${String(v.d).padStart(2, '0')}`
}

/** The day never runs past the month's end (31 MAR -> FEB gives 28 or 29). */
export function clampYmd(v: Ymd): Ymd {
  return { ...v, d: Math.min(v.d, daysInMonth(v.y, v.m)) }
}

/** "14 MAR 1996" as the three flaps on the row. */
export function dobFlaps(v: Ymd): [string, string, string] {
  return [String(v.d), MONTHS3[v.m - 1], String(v.y)]
}

/** Max HR estimate from the birth date (Tanaka, as the server seeds it). */
export function tanakaMaxHr(dob: Ymd | null, now: Date): number | null {
  if (!dob) return null
  let age = now.getFullYear() - dob.y
  const dm = now.getMonth() + 1 - dob.m
  if (dm < 0 || (dm === 0 && now.getDate() < dob.d)) age--
  if (age < 10 || age > 100) return null
  return Math.round(208 - 0.7 * age)
}

// ─── Logs ─────────────────────────────────────────────────────

/**
 * The back-and-pain box's text. Onboarding once saved a JSON list of codes
 * (["lower_back_sensitivity"]); show those as plain words ("Lower back
 * sensitivity."). Anything else is his own text, as is. Saving the plain words
 * back keeps "back" in it, so the coach's back read is unchanged.
 */
export function injuriesText(raw: string | null | undefined): string {
  const t = (raw ?? '').trim()
  if (!t.startsWith('[')) return raw ?? ''
  try {
    const list = JSON.parse(t) as unknown
    if (!Array.isArray(list) || !list.every(x => typeof x === 'string')) return raw ?? ''
    return list
      .map(x => x.replace(/[_-]+/g, ' ').trim())
      .filter(Boolean)
      .map(x => `${x.charAt(0).toUpperCase()}${x.slice(1)}.`)
      .join(' ')
  } catch {
    return raw ?? ''
  }
}

export type LogLevelKey = 'debug' | 'info' | 'warn' | 'error'
export type LogFilter = 'all' | LogLevelKey | 'session'

export function countLevels(levels: LogLevelKey[]): Record<LogLevelKey, number> {
  const c = { debug: 0, info: 0, warn: 0, error: 0 }
  for (const l of levels) if (l in c) c[l] += 1
  return c
}

/** The filter flaps, in page 37's order and words. */
export function filterFlaps(total: number, c: Record<LogLevelKey, number>): { key: LogFilter; text: string }[] {
  return [
    { key: 'all', text: `ALL ${total}` },
    { key: 'error', text: `ERRORS ${c.error}` },
    { key: 'warn', text: `WARN ${c.warn}` },
    { key: 'info', text: `INFO ${c.info}` },
    { key: 'debug', text: `DEBUG ${c.debug}` },
    { key: 'session', text: 'THIS SESSION' },
  ]
}

/** "2 h ago" (Recent problems). */
export function agoText(ts: number, now: number): string {
  const sec = Math.max(0, Math.floor((now - ts) / 1000))
  if (sec < 60) return `${sec} s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} h ago`
  return `${Math.floor(hr / 24)} d ago`
}

/** "07:42" (the All list). */
export function clockText(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ─── Body metrics ─────────────────────────────────────────────

/** History date: "OCT 11". */
export function histDate(ms: number): string {
  const d = new Date(ms)
  return `${MONTHS3[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}`
}

/** "SAT 18 OCT" for the Log today head. */
export function todayFlap(d: Date): string {
  const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS3[d.getMonth()]}`
}

/** A typed number for a flap field: digits and one dot, at most `max` characters. */
export function cleanNumber(text: string, max = 5): string {
  let seenDot = false
  let out = ''
  for (const ch of text) {
    if (ch >= '0' && ch <= '9') out += ch
    else if ((ch === '.' || ch === ',') && !seenDot) { seenDot = true; out += '.' }
    if (out.length >= max) break
  }
  return out
}
