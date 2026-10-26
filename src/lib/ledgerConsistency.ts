// Ledger · Consistency (page 63 final, approved 2026-10-19, all 6 items).
// Pure: counts over his own session rows, no AI. The board sits on the
// Ledger's first screen between the week rings and Aerobic base.
//
// Closed: CONSISTENCY, a state flap and one bar of the block's counted
// sessions, sorted done | to come | missed, with a brass NEXT BLOCK line at
// the count of done sessions that reaches the next block (70%).
// Open: four groups (next block, when you train, what gets done, why missed).
// After Block Zero: the last 4 / 8 / 13 weeks (WEEK / MONTH / SEASON), no line.

import { KEY_TYPES } from './keyTypes'

const reasonWords = (code: string): string => code.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())

/** The sessions that count: lib/keyTypes (the end gate's list too). Foundation is shown, not counted. */
export const COUNTED_TYPES = KEY_TYPES
/** The share of the block done that reaches the next block (endGate MIN_COMPLETION_RATE). */
export const NEXT_BLOCK_RATE = 0.7

export interface ConsistencyRow {
  type: string
  status: string
  scheduledDate: number | null
  timeSlot: string | null
  startedAt: number | null
  skipReason: string | null
}

export interface ConsistencyBlock {
  blockType: string
  /** Local epoch day the block starts, and its length. */
  startDay: number
  totalWeeks: number
}

export type TileState = 'done' | 'todo' | 'miss'
export type GroupKey = 'strength' | 'runwalk' | 'run' | 'bag' | 'mt'

export interface TypeRow {
  key: GroupKey | 'foundation'
  label: string
  /** "mornings, ~6:40", "evenings", "not counted". */
  sub: string
  tiles: TileState[]
  done: number
  of: number
}

export interface ConsistencyView {
  /** 'block' in Block Zero; 'weeks' after it (the last N weeks, no line). */
  mode: 'block' | 'weeks'
  flap: string
  tone: 'teal' | 'gold'
  done: number
  toCome: number
  missed: number
  /** Done count that reaches the next block; null after Block Zero. */
  nextAt: number | null
  /** The open board's first group: its line and its small line. */
  nextLine: string
  nextSmall: string | null
  am: { done: number; of: number }
  pm: { done: number; of: number }
  types: TypeRow[]
  why: Array<{ label: string; n: number }>
  /** "After a miss, back at the next session 7 of 10 times." Null with no misses. */
  after: { back: number; of: number } | null
  /** Weeks mode: "19 done · last 4 weeks · 5 missed". */
  weeks?: number
}

const DOW = ['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Fri 20 Nov" for a local epoch day. */
export function dayLabel(epochDay: number): string {
  const d = new Date(epochDay * 86400000)
  return `${DOW[((epochDay % 7) + 7) % 7]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`
}

function tileOf(status: string): TileState | null {
  if (status === 'completed') return 'done'
  if (status === 'skipped' || status === 'missed') return 'miss'
  if (status === 'planned' || status === 'in_progress') return 'todo'
  return null // replaced and the like: not a session any more
}

function groupOf(type: string): GroupKey {
  if (type === 'strength') return 'strength'
  if (type === 'foundation_run' || type === 'skip_rope') return 'runwalk'
  if (type === 'running') return 'run'
  if (type === 'bag_work') return 'bag'
  return 'mt'
}

const GROUP_LABEL: Record<GroupKey, string> = { strength: 'Strength', runwalk: 'Run-walk', run: 'Runs', bag: 'Bag work', mt: 'MT class' }
const GROUP_ORDER: GroupKey[] = ['strength', 'runwalk', 'run', 'bag', 'mt']

/** The mockup's words for a miss reason (Sick, Tired, Rough day, Time, Injury, Sore), else the app's own. */
const WHY_LABEL: Record<string, string> = { sick: 'Sick', illness: 'Sick', tired: 'Tired', rough_day: 'Rough day', schedule: 'Time', injury: 'Injury', too_sore: 'Sore' }
const WHY_ORDER = ['Sick', 'Tired', 'Rough day', 'Time', 'Injury', 'Sore']

const hhmm = (minOfDay: number) => `${Math.floor(minOfDay / 60) % 12 || 12}:${String(minOfDay % 60).padStart(2, '0')}`

/**
 * The usual start, local time, when he keeps one: the median of the starts,
 * shown only when every start sits within 15 minutes of it ("~6:40"; a
 * single start reads plain, "6:30"). Null when the starts wander.
 */
export function usualStart(startedAtSec: number[], tzOffsetMin: number): string | null {
  if (startedAtSec.length === 0) return null
  const mins = startedAtSec.map(s => (((Math.floor(s / 60) - tzOffsetMin) % 1440) + 1440) % 1440).sort((a, b) => a - b)
  const median = mins[Math.floor((mins.length - 1) / 2)]
  if (mins.some(m => Math.abs(m - median) > 15)) return null
  return mins.length === 1 ? hhmm(median) : `~${hhmm(median)}`
}

interface Item { day: number; slot: 'am' | 'pm'; group: GroupKey; tile: TileState; startedAt: number | null; reason: string | null }

function items(rows: ConsistencyRow[], from: number, to: number): Item[] {
  const out: Item[] = []
  for (const r of rows) {
    if (!COUNTED_TYPES.has(r.type) || r.scheduledDate == null || r.scheduledDate < from || r.scheduledDate > to) continue
    const tile = tileOf(r.status)
    if (!tile) continue
    out.push({ day: r.scheduledDate, slot: r.timeSlot === 'pm' ? 'pm' : 'am', group: groupOf(r.type), tile, startedAt: r.startedAt, reason: r.skipReason })
  }
  return out.sort((a, b) => a.day - b.day || (a.slot === 'pm' ? 1 : 0) - (b.slot === 'pm' ? 1 : 0))
}

/** For each miss, was the next session (in order, planned ones included) done? */
export function comebacks(list: Array<{ tile: TileState }>): { back: number; of: number } | null {
  let back = 0
  let of = 0
  list.forEach((s, i) => {
    if (s.tile !== 'miss') return
    const next = list[i + 1]
    if (!next) return
    of++
    if (next.tile === 'done') back++
  })
  return of > 0 ? { back, of } : null
}

/** Days between counted sessions done: the longest, its days and the reason given for its misses. */
export function longestBreak(list: Item[]): { len: number; reason: string | null } {
  const doneDays = [...new Set(list.filter(s => s.tile === 'done').map(s => s.day))].sort((a, b) => a - b)
  let best = { len: 0, reason: null as string | null }
  for (let i = 1; i < doneDays.length; i++) {
    const from = doneDays[i - 1] + 1
    const to = doneDays[i] - 1
    const len = to - from + 1
    if (len <= best.len) continue
    const reasons = list.filter(s => s.tile === 'miss' && s.day >= from && s.day <= to && s.reason).map(s => s.reason!)
    const top = reasons.sort((a, b) => reasons.filter(r => r === b).length - reasons.filter(r => r === a).length)[0] ?? null
    best = { len, reason: top }
  }
  return best
}

function typeRows(due: Item[], foundation: { done: number; of: number } | null, tzOffsetMin: number): TypeRow[] {
  const rows: TypeRow[] = []
  for (const g of GROUP_ORDER) {
    const list = due.filter(s => s.group === g)
    if (list.length === 0) continue
    const am = list.filter(s => s.slot === 'am').length
    const when = am * 2 >= list.length ? 'mornings' : 'evenings'
    const time = usualStart(list.filter(s => s.tile === 'done' && s.startedAt != null).map(s => s.startedAt!), tzOffsetMin)
    rows.push({ key: g, label: GROUP_LABEL[g], sub: time ? `${when}, ${time}` : when, tiles: list.map(s => s.tile), done: list.filter(s => s.tile === 'done').length, of: list.length })
  }
  if (foundation && foundation.of > 0) {
    rows.push({ key: 'foundation', label: 'Foundation', sub: 'not counted', tiles: Array.from({ length: foundation.of }, (_, i) => (i < foundation.done ? 'done' : 'todo')), done: foundation.done, of: foundation.of })
  }
  return rows
}

function whyRows(due: Item[]): Array<{ label: string; n: number }> {
  const counts = new Map<string, number>()
  for (const s of due) {
    if (s.tile !== 'miss') continue
    const label = s.reason ? WHY_LABEL[s.reason] ?? reasonWords(s.reason) : 'No reason'
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  const rank = (l: string) => (l === 'No reason' ? 99 : WHY_ORDER.indexOf(l) >= 0 ? WHY_ORDER.indexOf(l) : 50)
  return [...counts.entries()].sort((a, b) => rank(a[0]) - rank(b[0])).map(([label, n]) => ({ label, n }))
}

const slotOf = (due: Item[], slot: 'am' | 'pm') => ({ done: due.filter(s => s.slot === slot && s.tile === 'done').length, of: due.filter(s => s.slot === slot).length })

/**
 * Block Zero: every counted session of the block. Weeks not made yet are
 * counted from the last week that is (the same shape repeats), so the bar
 * holds the whole block from the first day.
 */
export function blockConsistency(rows: ConsistencyRow[], block: ConsistencyBlock, todayEpochDay: number, opts: { tzOffsetMin?: number; foundation?: { done: number; of: number } | null } = {}): ConsistencyView {
  const tz = opts.tzOffsetMin ?? 0
  const end = block.startDay + block.totalWeeks * 7 - 1
  const list = items(rows, block.startDay, end)
  // weeks with nothing made yet: the last made week's count of counted sessions, all to come
  const weekOf = (day: number) => Math.floor((day - block.startDay) / 7)
  const made = new Set(list.map(s => weekOf(s.day)))
  const lastMade = Math.max(-1, ...made)
  const perWeek = lastMade >= 0 ? list.filter(s => weekOf(s.day) === lastMade).length : 0
  let extra = 0
  for (let w = 0; w < block.totalWeeks; w++) if (!made.has(w) && w > lastMade && block.startDay + w * 7 > todayEpochDay) extra += perWeek

  const due = list.filter(s => s.tile !== 'todo' || s.day < todayEpochDay)
  // a session still planned on a day gone by is missed
  for (const s of due) if (s.tile === 'todo') s.tile = 'miss'
  const done = due.filter(s => s.tile === 'done').length
  const missed = due.length - done
  const toCome = list.length - due.length + extra
  const total = done + missed + toCome
  const nextAt = Math.ceil(NEXT_BLOCK_RATE * total - 1e-9)
  const needLeft = Math.max(0, nextAt - done)

  const lastDone = Math.max(block.startDay - 1, ...due.filter(s => s.tile === 'done').map(s => s.day))
  const breakDays = todayEpochDay - lastDone - 1
  const rate = due.length > 0 ? done / due.length : 1
  let flap: string
  let tone: 'teal' | 'gold' = 'gold'
  let nextLine: string
  // an open break wins while it lasts (page 63's state rule)
  if (breakDays >= 2 && due.length > 0) {
    flap = `${breakDays} DAY BREAK`
    const next = list.find(s => s.tile === 'todo' && s.day >= todayEpochDay)
    nextLine = `One session by ${dayLabel(lastDone + 7)} keeps this break under a week.${next ? ` Next: ${GROUP_LABEL[next.group]}, ${dayLabel(next.day)}.` : ''}`
  } else if (needLeft > toCome) {
    const weeks = rate < 0.5 ? 2 : 1
    flap = weeks === 2 ? 'TWO MORE WEEKS' : 'ONE MORE WEEK'
    nextLine = `Block Zero runs ${weeks === 2 ? 'two more weeks' : 'one more week'}, to ${dayLabel(end + weeks * 7)}. Nothing done is lost.`
  } else if (rate >= NEXT_BLOCK_RATE) {
    flap = 'ON TRACK'
    tone = 'teal'
    nextLine = `On track to reach The Campaign on ${dayLabel(end)}.`
  } else {
    flap = 'AT RISK'
    nextLine = `Do ${needLeft} of your next ${toCome} to reach The Campaign.`
  }
  const brk = longestBreak(due)
  const nextSmall = brk.len >= 2
    ? `Longest break: ${brk.len} days${brk.reason ? ` (${(WHY_LABEL[brk.reason] ?? reasonWords(brk.reason)).toLowerCase()})` : ''}. Keep breaks under a week.`
    : null

  return {
    mode: 'block', flap, tone, done, toCome, missed, nextAt,
    nextLine, nextSmall,
    am: slotOf(due, 'am'), pm: slotOf(due, 'pm'),
    types: typeRows(due, opts.foundation ?? null, tz),
    why: whyRows(due),
    after: comebacks(list),
  }
}

/** WEEK / MONTH / SEASON after Block Zero: the last 4, 8 or 13 weeks. */
export const CONSISTENCY_SPAN: Record<'week' | 'month' | 'season', number> = { week: 4, month: 8, season: 13 }

/**
 * After Block Zero: the last N weeks' counted sessions, no next-block line;
 * the flap counts the weeks done as planned (70% or more of what was planned).
 */
export function weeksConsistency(rows: ConsistencyRow[], weeks: number, todayEpochDay: number, mondayOf: (d: number) => number, opts: { tzOffsetMin?: number; foundation?: { done: number; of: number } | null } = {}): ConsistencyView {
  const firstMon = mondayOf(todayEpochDay) - (weeks - 1) * 7
  const list = items(rows, firstMon, mondayOf(todayEpochDay) + 6)
  for (const s of list) if (s.tile === 'todo' && s.day < todayEpochDay) s.tile = 'miss'
  const due = list.filter(s => s.tile !== 'todo')
  const done = due.filter(s => s.tile === 'done').length
  const missed = due.length - done
  let ok = 0
  for (let w = 0; w < weeks; w++) {
    const wk = list.filter(s => s.day >= firstMon + w * 7 && s.day < firstMon + w * 7 + 7)
    if (wk.length > 0 && wk.filter(s => s.tile === 'done').length >= NEXT_BLOCK_RATE * wk.length) ok++
  }
  return {
    mode: 'weeks', flap: `${ok} OF ${weeks} WKS`, tone: ok * 2 >= weeks ? 'teal' : 'gold',
    done, toCome: list.length - due.length, missed, nextAt: null,
    nextLine: `${ok} of the last ${weeks} weeks done as planned.`, nextSmall: null,
    am: slotOf(due, 'am'), pm: slotOf(due, 'pm'),
    types: typeRows(due, opts.foundation ?? null, opts.tzOffsetMin ?? 0),
    why: whyRows(due),
    after: comebacks(list),
    weeks,
  }
}
