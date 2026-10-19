// The change model (page 56, approved 2026-10-19). Every change to a session
// is one record: the athlete's own (replace, skip, add, pull forward) and the
// coach's (an ease, a move, a missed session's fix). A record keeps restorable
// state field by field (before / after), who made it, one plain why with the
// real numbers, and the before -> after words the screens show. Pure: the
// server stores records in week_adjustments (0033) and the screens read the
// views built here.
//
// Runes: Dagaz (teal) marks a day the coach changed, Algiz (ember) a missed
// session. New until seen, then dim. The athlete's own changes get no rune.
// An undone change gives no rune.

import { DAY_NAMES } from './sessions'

export type ChangeActor = 'you' | 'coach' | 'check_in' | 'weekly_pass' | 'class_tonight'
export type ChangeRecordKind = 'swap' | 'skip' | 'add' | 'pull_forward' | 'move' | 'ease' | 'shorten' | 'missed' | 'push' | 'make_regular' | 'tm'

/** Session columns a change can set and an undo puts back. */
export interface SessionFields {
  scheduledDate?: number | null
  timeSlot?: string | null
  status?: string
  type?: string
  label?: string | null
  notes?: string | null
  skipReason?: string | null
  skipReasonDetail?: string | null
}

export const RESTORABLE_FIELDS: ReadonlyArray<keyof SessionFields> = ['scheduledDate', 'timeSlot', 'status', 'type', 'label', 'notes', 'skipReason', 'skipReasonDetail']

/** One session's state in a change: some fields, and some context_json keys (null = key absent). */
export interface SessionSnap {
  id: string
  f: SessionFields
  ctx?: Record<string, unknown>
}

/** A side effect outside the sessions table that an undo reverses. */
export type ChangeEffect =
  | { kind: 'tm'; lifts: Array<{ exerciseId: string; kg: number }> }
  | { kind: 'template_extra'; extra: { blockId: string; type: string; dayOfWeek: number; timeSlot: 'am' | 'pm' }; present: boolean }

/** before_json / after_json. */
export interface ChangeState {
  /** The words on the flaps ("3×8", "5 ROUNDS", "RUN-WALK", "FRI C"). */
  show: string
  /** The week log's word when it differs ("B 3×8"). */
  logShow?: string
  /** The day the record belongs to (the rune's and the log's day). */
  day: number
  sessions: SessionSnap[]
  /** after only: sessions this change created (an undo removes them). */
  created?: string[]
  /** after only: sessions whose start locks the undo besides the ones above. */
  watch?: string[]
  effects?: ChangeEffect[]
  /** after only: what the day's back says once it's put back. */
  put?: { line: string; dim: string } | null
}

/** A stored change as the pure code reads it (a week_adjustments row, parsed). */
export interface ChangeRowLike {
  id: string
  changeSetId: string | null
  actor: ChangeActor
  kind: ChangeRecordKind
  targetSessionId: string | null
  sessionType: string
  before: ChangeState
  after: ChangeState
  why: string
  detail: string | null
  undoUntil: number | null
  undoneAt: number | null
  seenAt: number | null
  held: boolean
  createdAt: number
}

/** A session as the undo and lock checks read it now. */
export interface SessionNow {
  id: string
  status: string
  scheduledDate: number | null
  timeSlot?: string | null
  contextJson?: string | null
}

export function isCoachActor(actor: ChangeActor): boolean {
  return actor !== 'you'
}

// ─── Reading stored rows ─────────────────────────────────────

const ACTORS: ReadonlySet<string> = new Set(['you', 'coach', 'check_in', 'weekly_pass', 'class_tonight'])
const KINDS: ReadonlySet<string> = new Set(['swap', 'skip', 'add', 'pull_forward', 'move', 'ease', 'shorten', 'missed', 'push', 'make_regular', 'tm'])

function parseState(raw: string | null | undefined): ChangeState | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as ChangeState
    if (!v || typeof v !== 'object' || typeof v.day !== 'number' || !Array.isArray(v.sessions)) return null
    return { ...v, show: typeof v.show === 'string' ? v.show : '' }
  } catch {
    return null
  }
}

/** A week_adjustments row -> a change record; null for legacy rows (no kind). */
export function readChangeRow(r: {
  id: string; changeSetId: string | null; actor: string | null; kind: string | null; targetSessionId: string | null; sessionType: string
  beforeJson: string | null; afterJson: string | null; why: string | null; reason: string; detail: string | null
  undoUntil: number | null; undoneAt: number | null; seenAt: number | null; held: number | null; createdAt: number
}): ChangeRowLike | null {
  if (!r.kind || !KINDS.has(r.kind) || !r.actor || !ACTORS.has(r.actor)) return null
  const before = parseState(r.beforeJson)
  const after = parseState(r.afterJson)
  if (!before || !after) return null
  return {
    id: r.id,
    changeSetId: r.changeSetId,
    actor: r.actor as ChangeActor,
    kind: r.kind as ChangeRecordKind,
    targetSessionId: r.targetSessionId,
    sessionType: r.sessionType,
    before,
    after,
    why: r.why ?? r.reason,
    detail: r.detail,
    undoUntil: r.undoUntil,
    undoneAt: r.undoneAt,
    seenAt: r.seenAt,
    held: r.held === 1,
    createdAt: r.createdAt,
  }
}

// ─── Building records ────────────────────────────────────────

/** The listed fields of a session row. */
export function pickFields(row: SessionFields, keys: ReadonlyArray<keyof SessionFields>): SessionFields {
  const out: SessionFields = {}
  for (const k of keys) (out as Record<string, unknown>)[k] = (row as Record<string, unknown>)[k] ?? null
  return out
}

/** The listed context_json keys of a session (null when absent). */
export function pickContext(contextJson: string | null | undefined, keys: readonly string[]): Record<string, unknown> {
  let base: Record<string, unknown> = {}
  if (contextJson) {
    try { base = JSON.parse(contextJson) as Record<string, unknown> } catch { base = {} }
  }
  const out: Record<string, unknown> = {}
  for (const k of keys) out[k] = base[k] ?? null
  return out
}

/** Apply context keys to context_json: null deletes a key, anything else sets it. */
export function applyContext(contextJson: string | null | undefined, keys: Record<string, unknown>): string | null {
  let base: Record<string, unknown> = {}
  if (contextJson) {
    try { base = JSON.parse(contextJson) as Record<string, unknown> } catch { base = {} }
  }
  for (const [k, v] of Object.entries(keys)) {
    if (v == null) delete base[k]
    else base[k] = v
  }
  return Object.keys(base).length > 0 ? JSON.stringify(base) : null
}

/** Fields and context keys that differ between two snaps of one session. */
export function changedKeys(a: SessionSnap, b: SessionSnap): string[] {
  const out: string[] = []
  for (const k of RESTORABLE_FIELDS) {
    if (k in a.f || k in b.f) {
      if ((a.f[k] ?? null) !== (b.f[k] ?? null)) out.push(`f.${k}`)
    }
  }
  const ctxKeys = new Set([...Object.keys(a.ctx ?? {}), ...Object.keys(b.ctx ?? {})])
  for (const k of ctxKeys) {
    if (JSON.stringify(a.ctx?.[k] ?? null) !== JSON.stringify(b.ctx?.[k] ?? null)) out.push(`ctx.${k}`)
  }
  return out
}

/** Every session a change touched (its snaps and the sessions it created). */
export function touchedSessions(c: Pick<ChangeRowLike, 'before' | 'after'>): string[] {
  return [...new Set([...c.before.sessions.map(s => s.id), ...c.after.sessions.map(s => s.id), ...(c.after.created ?? [])])]
}

/** "field@session" keys a change wrote: what a later change collides with. */
export function writtenKeys(c: Pick<ChangeRowLike, 'before' | 'after'>): Set<string> {
  const out = new Set<string>()
  for (const a of c.after.sessions) {
    const b = c.before.sessions.find(s => s.id === a.id) ?? { id: a.id, f: {}, ctx: {} }
    for (const k of changedKeys(b, a)) out.add(`${k}@${a.id}`)
  }
  for (const id of c.after.created ?? []) out.add(`*@${id}`)
  return out
}

// ─── Lock: UNDO until the session starts ─────────────────────

export type ChangeLock = 'open' | 'undone' | 'started' | 'done' | 'missed' | 'passed'

/**
 * Can this change still be undone? Not once it is undone; not once a session
 * it touched has started or been logged (started, done); not once the day of
 * a session it touched has passed: missed when a session it touched was
 * missed, else passed (never "done" for work that didn't happen). A session
 * that no longer exists locks nothing.
 */
export function changeLock(c: Pick<ChangeRowLike, 'before' | 'after' | 'undoneAt' | 'kind'> & { undoUntil?: number | null }, sessions: ReadonlyMap<string, SessionNow>, todayDay: number): ChangeLock {
  if (c.undoneAt != null) return 'undone'
  const ids = [...touchedSessions(c), ...(c.after.watch ?? [])]
  let passed = false
  let missed = false
  for (const id of ids) {
    const s = sessions.get(id)
    if (!s) continue
    if (s.status === 'completed') return 'done'
    if (s.status === 'in_progress') return 'started'
    if (s.scheduledDate != null && s.scheduledDate < todayDay) {
      passed = true
      if (s.status === 'missed') missed = true
    }
  }
  // The missed record stays undoable while its fix (a later session) is still to come.
  if (c.kind === 'missed') {
    const fix = [...c.after.sessions.map(s => s.id), ...(c.after.watch ?? [])].map(id => sessions.get(id)).filter((s): s is SessionNow => s != null)
    // Its fix waits for a week not prepared yet: open until that day.
    if (fix.length === 0) return c.undoUntil != null && Math.floor(c.undoUntil / 86400) >= todayDay ? 'open' : 'done'
    return fix.some(s => s.scheduledDate != null && s.scheduledDate < todayDay) ? 'done' : 'open'
  }
  return missed ? 'missed' : passed ? 'passed' : 'open'
}

// ─── Runes ───────────────────────────────────────────────────

/** Dagaz new / seen (teal), Algiz new / seen (ember). */
export type RuneState = 'new' | 'seen' | 'miss' | 'missseen'

/** A change's rune, or null (his own changes and undone ones have none). */
export function runeFor(c: Pick<ChangeRowLike, 'actor' | 'kind' | 'undoneAt' | 'seenAt'>): RuneState | null {
  if (!isCoachActor(c.actor) || c.undoneAt != null) return null
  if (c.kind === 'missed') return c.seenAt == null ? 'miss' : 'missseen'
  return c.seenAt == null ? 'new' : 'seen'
}

const RUNE_RANK: Record<RuneState, number> = { miss: 0, new: 1, missseen: 2, seen: 3 }

/** The one rune a day tile shows: unseen first, a missed session before a change. */
export function dayRune(changes: ReadonlyArray<Pick<ChangeRowLike, 'actor' | 'kind' | 'undoneAt' | 'seenAt' | 'after'>>, day: number): RuneState | null {
  let best: RuneState | null = null
  for (const c of changes) {
    if (c.after.day !== day) continue
    const r = runeFor(c)
    if (r && (best == null || RUNE_RANK[r] < RUNE_RANK[best])) best = r
  }
  return best
}

/** The rune on a session's row: the change that targets it. */
export function rowRune(changes: ReadonlyArray<Pick<ChangeRowLike, 'actor' | 'kind' | 'undoneAt' | 'seenAt' | 'targetSessionId'>>, sessionId: string): RuneState | null {
  let best: RuneState | null = null
  for (const c of changes) {
    if (c.targetSessionId !== sessionId) continue
    const r = runeFor(c)
    if (r && (best == null || RUNE_RANK[r] < RUNE_RANK[best])) best = r
  }
  return best
}

// ─── Words ───────────────────────────────────────────────────

const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function dowOf(epochDay: number): number {
  return new Date(epochDay * 86400000).getUTCDay()
}

/** "today", "yesterday", "tomorrow", else the weekday ("Thursday"). */
export function relativeDay(day: number, refDay: number): string {
  if (day === refDay) return 'today'
  if (day === refDay - 1) return 'yesterday'
  if (day === refDay + 1) return 'tomorrow'
  return DAY_LONG[dowOf(day)]
}

/** A day token for a stored why: rendered relative to the reader's day. */
export function dayToken(day: number): string {
  return `{d:${day}}`
}

/** A session name token: "Strength B" on its own day, "Saturday's run-walk" on another. */
export function nameToken(name: string, day: number): string {
  return `{n:${day}:${name.replace(/[{}:]/g, ' ')}}`
}

/** Words only the day's back shows (the week log leaves them out). */
export function backOnly(text: string): string {
  return `[[${text}]]`
}

/**
 * A stored why as words. `{d:N}` becomes a day relative to `refDay` (the day's
 * back reads it against today, the week log against the entry's own day);
 * `[[...]]` stays on the day's back and leaves the log.
 */
export function renderWhy(text: string, refDay: number, where: 'back' | 'log' = 'back'): string {
  const names = text.replace(/\{n:(-?\d+):([^}]*)\}/g, (_, d: string, name: string) => nameOnDay(name, Number(d), refDay))
  const days = names.replace(/\{d:(-?\d+)\}/g, (_, d: string) => relativeDay(Number(d), refDay))
  const parts = days.replace(/\[\[([^\]]*)\]\]/g, (_, inner: string) => (where === 'back' ? inner : ''))
  const out = parts.replace(/\s{2,}/g, ' ').trim()
  return out.charAt(0).toUpperCase() + out.slice(1)
}

/** "Run-Walk" -> "run-walk", "Strength B" -> "strength B": a name mid-sentence. */
export function midName(name: string): string {
  return name.toLowerCase().replace(/ ([abc])$/, (_, l: string) => ` ${l.toUpperCase()}`)
}

/** "Strength B" on its day, "Saturday's run-walk" on another. */
export function nameOnDay(name: string, day: number, refDay: number): string {
  return day === refDay ? name : `${DAY_LONG[dowOf(day)]}'s ${midName(name)}`
}

/** "7:00 AM" from local wall-clock seconds. */
export function clockOf(localSec: number): string {
  const m = Math.floor((((localSec % 86400) + 86400) % 86400) / 60)
  const h = Math.floor(m / 60)
  const mm = String(m % 60).padStart(2, '0')
  return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${h < 12 ? 'AM' : 'PM'}`
}

/** Local wall-clock seconds for a session's planned start. */
export function slotStart(epochDay: number, timeSlot: string | null | undefined, pmStart = '18:00'): number {
  const [h, m] = (timeSlot === 'pm' ? pmStart : '07:00').split(':').map(Number)
  return epochDay * 86400 + ((h || 0) * 60 + (m || 0)) * 60
}

/**
 * The day's back: "Until it starts, 7:00 AM" (today) or "Until it starts, Sat
 * 7:00 AM". Once the planned start has passed and it still hasn't started,
 * just "Until it starts" (`nowLocalSec`: the phone's wall clock).
 */
export function untilLine(undoUntil: number | null, todayDay: number, missedFix?: { day: number; name: string } | null, nowLocalSec?: number): string {
  if (missedFix) return `Until ${DAY_LONG[dowOf(missedFix.day)]}'s ${missedFix.name.replace(/^Strength /, '')} starts`
  if (undoUntil == null || (nowLocalSec != null && nowLocalSec >= undoUntil)) return 'Until it starts'
  const day = Math.floor(undoUntil / 86400)
  return day === todayDay ? `Until it starts, ${clockOf(undoUntil)}` : `Until it starts, ${DAY_NAMES[dowOf(day)]} ${clockOf(undoUntil)}`
}

const DAY3 = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

/** The who line's time: "6:10 PM" on the entry's own day, else "TUE 6:11 PM". */
export function whenLine(createdLocalSec: number, refDay: number): string {
  const day = Math.floor(createdLocalSec / 86400)
  return day === refDay ? clockOf(createdLocalSec) : `${DAY3[dowOf(day)]} ${clockOf(createdLocalSec)}`
}

/** The log's day heading: "TUE 20". */
export function logDayLabel(day: number): string {
  return `${DAY3[dowOf(day)]} ${new Date(day * 86400000).getUTCDate()}`
}

/** WHO on the day's back and in the log. */
export function whoWord(c: Pick<ChangeRowLike, 'actor' | 'kind'>): 'YOU' | 'COACH' | 'MISSED' {
  if (c.actor === 'you') return 'YOU'
  return c.kind === 'missed' ? 'MISSED' : 'COACH'
}

/** The week log's right side for an entry: UNDO, or a word. */
export function logStatus(lock: ChangeLock): 'undo' | 'put back' | 'started' | 'done' | 'missed' | 'passed' {
  if (lock === 'open') return 'undo'
  if (lock === 'undone') return 'put back'
  return lock
}

/** "5 changes ›": this week's change rows, undone ones included. Null when there are none. */
export function changesLine(n: number): string | null {
  if (n <= 0) return null
  return `${n} ${n === 1 ? 'change' : 'changes'} ›`
}

// ─── Show words for an ease ──────────────────────────────────

/** "3×8" for a strength session's main lifts. */
export function setsReps(sets: number, reps: number): string {
  return `${sets}×${reps}`
}

/** "5 ROUNDS" for a run-walk. */
export function roundsWord(rounds: number): string {
  return `${rounds} ${rounds === 1 ? 'ROUND' : 'ROUNDS'}`
}

/** "Strength C" -> "C", for the log's "B 3×8" and "FRI C". */
export function letterOf(label: string | null | undefined): string | null {
  return label?.match(/Strength ([ABC])\b/)?.[1] ?? null
}
